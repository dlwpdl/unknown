-- Group safety exits never lock a slot. Repeated actions restrict new activity only.
create table private.meetup_activity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null, -- retain the count even if the post is removed
  action text not null check(action in ('leave','close','create')),
  occurred_at timestamptz not null default now(),
  blocked_until timestamptz,
  primary key(user_id,post_id,action)
);
create index meetup_activity_window on private.meetup_activity(user_id,action,occurred_at desc);
alter table private.meetup_activity enable row level security;
revoke all on private.meetup_activity from public,anon,authenticated,service_role;

create function private.meetup_policy(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'leaves24h',count(*) filter(where action='leave' and occurred_at>now()-interval '24 hours'),
    'closures7d',count(*) filter(where action='close' and occurred_at>now()-interval '7 days'),
    'creates24h',count(*) filter(where action='create' and occurred_at>now()-interval '24 hours'),
    'creates7d',count(*) filter(where action='create' and occurred_at>now()-interval '7 days'),
    'joinBlockedUntil',max(blocked_until) filter(where action='leave' and blocked_until>now()),
    'hostBlockedUntil',max(blocked_until) filter(where action='close' and blocked_until>now()),
    'createBlockedUntil',greatest(
      (select occurred_at+interval '24 hours' from private.meetup_activity where user_id=p_user_id
        and action='create' and occurred_at>now()-interval '24 hours' order by occurred_at desc offset 2 limit 1),
      (select occurred_at+interval '7 days' from private.meetup_activity where user_id=p_user_id
        and action='create' and occurred_at>now()-interval '7 days' order by occurred_at desc offset 9 limit 1)))
  from private.meetup_activity where user_id=p_user_id;
$$;
create function public.get_meetup_policy() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return private.meetup_policy(auth.uid());
end;
$$;

create function private.record_meetup_activity(p_user_id uuid,p_post_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare policy jsonb;
begin
  perform private.lock_relationships();
  insert into private.meetup_activity(user_id,post_id,action) values(p_user_id,p_post_id,p_action) on conflict do nothing;
  if not found then return; end if;
  policy:=private.meetup_policy(p_user_id);
  -- Continuing to leave during a restriction is allowed and never extends that restriction.
  if p_action='leave' and (policy->>'leaves24h')::int>=3 and policy->>'joinBlockedUntil' is null then
    update private.meetup_activity set blocked_until=now()+interval '12 hours'
      where user_id=p_user_id and post_id=p_post_id and action=p_action;
  elsif p_action='close' and (policy->>'closures7d')::int>=2 and policy->>'hostBlockedUntil' is null then
    update private.meetup_activity set blocked_until=now()+interval '24 hours'
      where user_id=p_user_id and post_id=p_post_id and action=p_action;
  end if;
end;
$$;
create function private.assert_meetup_participation(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare release_at text;
begin
  release_at:=private.meetup_policy(p_user_id)->>'joinBlockedUntil';
  if release_at is not null then
    raise exception 'MEETUP_JOIN_RESTRICTED' using detail=release_at;
  end if;
end;
$$;

-- Replace only group cooldowns; historical 1:1 cooldowns remain unchanged.
create or replace function private.relationship_locked_count(p_user_id uuid,p_pool text)
returns integer language sql stable security definer set search_path='' as $$
  select count(*)::integer from private.relationship_cooldowns
  where p_pool='direct' and user_id=p_user_id and pool=p_pool and unlocks_at>now();
$$;
create or replace function private.check_meetup_slot(p_user_id uuid,p_error text default 'MEETUP_LIMIT_REACHED')
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_relationships();
  if private.membership_meetup_count(p_user_id)>=(private.membership_details(p_user_id)->>'meetupLimit')::integer then
    raise exception '%',p_error;
  end if;
end;
$$;

-- Guard both request and approval, including direct writes and old clients.
create function private.guard_meetup_participation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status not in ('pending','approved') then return new; end if;
  if tg_op='UPDATE' and old.status=new.status and old.requester_id=new.requester_id and old.post_id=new.post_id then return new; end if;
  perform private.assert_meetup_participation(new.requester_id);
  return new;
end;
$$;
create trigger meetup_requests_abuse_limit before insert or update on public.meetup_requests
for each row execute function private.guard_meetup_participation();

create or replace function public.leave_meetup(p_post_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.posts; r public.meetup_requests;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_relationships();
  select * into p from public.posts where id=p_post_id and room_preview is not null for update;
  if p.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if p.author_id=u then
    if coalesce(p.room_preview->>'closed','false')='true' then return; end if;
    update public.posts set room_preview=jsonb_set(room_preview,'{closed}','true') where id=p.id;
    update public.meetup_requests set status='cancelled',responded_at=now() where post_id=p.id and status in ('pending','approved');
  else
    select * into r from public.meetup_requests where post_id=p.id and requester_id=u for update;
    if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
    if r.status='cancelled' then return; end if;
    if r.status not in ('approved','pending') then raise exception 'REQUEST_NOT_FOUND'; end if;
    if r.status='approved' and p.status='published' and coalesce(p.room_preview->>'closed','false')<>'true'
      and not coalesce(p.room_preview->>'eventKind'='once' and (p.room_preview->>'endsAt')::timestamptz<=now(),false) then
      perform private.record_meetup_activity(u,p.id,'leave');
    end if;
    update public.meetup_requests set status='cancelled',responded_at=now() where id=r.id;
    update public.posts set room_preview=jsonb_set(room_preview,'{memberCount}',to_jsonb(1+(select count(*) from public.meetup_requests where post_id=p.id and status='approved'))) where id=p.id;
  end if;
end;
$$;

revoke all on function private.meetup_policy(uuid),private.record_meetup_activity(uuid,uuid,text),
  private.assert_meetup_participation(uuid),private.guard_meetup_participation(),public.get_meetup_policy()
  from public,anon,authenticated,service_role;
grant execute on function public.get_meetup_policy() to authenticated;
