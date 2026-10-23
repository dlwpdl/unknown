-- Owner drafts and host operations stay private; no new membership product or slot rule.
create table private.meetup_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 60),
  draft jsonb not null,
  updated_at timestamptz not null default now()
);
create index meetup_templates_owner_idx on private.meetup_templates(owner_id,updated_at desc,id);
create table private.meetup_waitlist (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  invited_at timestamptz,
  cancelled_at timestamptz,
  unique(post_id,user_id)
);
create index meetup_waitlist_queue_idx on private.meetup_waitlist(post_id,joined_at,id) where cancelled_at is null and invited_at is null;
create table private.meetup_cohosts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check(status in('pending','accepted','revoked')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key(post_id,user_id)
);
create index meetup_cohosts_user_idx on private.meetup_cohosts(user_id,post_id) where status<>'revoked';
alter table private.meetup_templates enable row level security;
alter table private.meetup_waitlist enable row level security;
alter table private.meetup_cohosts enable row level security;
revoke all on private.meetup_templates,private.meetup_waitlist,private.meetup_cohosts from public,anon,authenticated,service_role;

create function private.meetup_tool_tier(p_user_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when (m->>'expiresAt')::timestamptz>clock_timestamp() then m->>'tier' else 'free' end
  from(select private.membership_details(p_user_id)m)s;
$$;
create function private.require_meetup_tool_tier(p_user_id uuid,p_minimum text) returns void
language plpgsql security definer set search_path='' as $$
declare tier text:=private.meetup_tool_tier(p_user_id);
begin
  if (case tier when 'premium' then 3 when 'pro' then 2 when 'plus' then 1 else 0 end)
    <(case p_minimum when 'premium' then 3 when 'pro' then 2 else 1 end) then
    raise exception '%_REQUIRED',upper(p_minimum);
  end if;
end;
$$;

create function private.meetup_tool_context(p_post_id uuid,p_user_id uuid,p_open boolean default true) returns public.posts
language plpgsql security definer set search_path='' as $$
declare event public.posts;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(p_user_id);
  select * into event from public.posts where id=p_post_id and status='published' and room_preview is not null;
  if event.id is null or not private.is_active_account(event.author_id)
    or private.is_blocked_between(p_user_id,event.author_id)
    or private.has_reported(p_user_id,'post',event.id)
    or private.has_reported(p_user_id,'user',event.author_id)
    or private.has_reported(event.author_id,'user',p_user_id) then raise exception 'MEETUP_NOT_FOUND'; end if;
  if p_open then
    if coalesce(event.room_preview->>'closed','false')='true' then raise exception 'MEETUP_CLOSED'; end if;
    -- now() predates a relationship-lock wait; paid actions must use the actual deadline.
    if event.room_preview->>'eventKind'='once' and (event.room_preview->>'endsAt')::timestamptz<=clock_timestamp()
      then raise exception 'MEETUP_EXPIRED'; end if;
    perform private.assert_chilling_open(event.room_preview);
  end if;
  return event;
end;
$$;

create function private.meetup_tool_member(p_post_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.meetup_requests r join public.posts p on p.id=r.post_id
    where r.post_id=p_post_id and r.requester_id=p_user_id and r.status='approved'
      and private.is_active_account(r.requester_id) and not private.is_blocked_between(p.author_id,r.requester_id)
      and not private.has_reported(p.author_id,'user',r.requester_id)
      and not private.has_reported(r.requester_id,'user',p.author_id)
      and not private.has_reported(r.requester_id,'post',p.id));
$$;
create function private.meetup_tool_cohost(p_post_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.meetup_cohosts c where c.post_id=p_post_id and c.user_id=p_user_id
    and c.status='accepted' and private.meetup_tool_member(c.post_id,c.user_id));
$$;

create function public.get_meetup_templates() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); items jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'draft',draft,'updatedAt',updated_at)
    order by updated_at desc,id),'[]') into items from private.meetup_templates where owner_id=u;
  return jsonb_build_object('canUse',private.meetup_tool_tier(u)<>'free','templates',items);
end;
$$;
create function public.save_meetup_template(p_name text,p_draft jsonb,p_template_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); template_id uuid; item record;
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.require_meetup_tool_tier(u,'plus');
  if p_name is null or char_length(trim(p_name)) not between 1 and 60
    or jsonb_typeof(p_draft) is distinct from 'object' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_draft-array['title','body','applicationQuestion','category']<>'{}'::jsonb
    or not exists(select 1 from jsonb_each_text(p_draft)e where char_length(trim(e.value))>0) then raise exception 'INVALID_TEMPLATE'; end if;
  for item in select * from jsonb_each(p_draft) loop
    if jsonb_typeof(item.value) is distinct from 'string'
      or char_length(trim(item.value#>>'{}'))>(case item.key when 'title' then 60 when 'body' then 5000 when 'applicationQuestion' then 300 else 40 end)
      then raise exception 'INVALID_TEMPLATE'; end if;
  end loop;
  if p_draft ? 'category' and p_draft->>'category' not in('','casual','party','festival','sports','hobby','travel') then raise exception 'INVALID_TEMPLATE'; end if;
  if p_template_id is null then
    insert into private.meetup_templates(owner_id,name,draft) values(u,trim(p_name),p_draft) returning id into template_id;
  else
    update private.meetup_templates set name=trim(p_name),draft=p_draft,updated_at=clock_timestamp()
      where id=p_template_id and owner_id=u returning id into template_id;
    if template_id is null then raise exception 'TEMPLATE_NOT_FOUND'; end if;
  end if;
  return template_id;
end;
$$;
create function public.delete_meetup_template(p_template_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  delete from private.meetup_templates where id=p_template_id and owner_id=auth.uid();
end;
$$;

create function public.propose_meetup_dates(p_post_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,
  p_cadence text,p_count integer default 4,p_timezone text default 'UTC') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; step_days integer;
begin
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u and not private.meetup_tool_cohost(event.id,u) then raise exception 'HOST_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(event.author_id,'pro');
  if coalesce(event.room_preview->>'eventKind','group')<>'group' then raise exception 'RECURRING_GROUP_REQUIRED'; end if;
  if p_cadence is null or p_cadence not in('weekly','fortnightly') or p_count is null or p_count not between 1 and 12
    or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'INVALID_RECURRENCE'; end if;
  if p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_starts_at<=clock_timestamp() or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '7 days' then raise exception 'INVALID_SESSION_TIME'; end if;
  step_days:=case p_cadence when 'weekly' then 7 else 14 end;
  return(select jsonb_agg(jsonb_build_object(
    'startsAt',((p_starts_at at time zone p_timezone)+make_interval(days=>n*step_days)) at time zone p_timezone,
    'endsAt',((p_ends_at at time zone p_timezone)+make_interval(days=>n*step_days)) at time zone p_timezone) order by n)
    from generate_series(0,p_count-1)n);
end;
$$;

create function public.confirm_meetup_occurrence(p_post_id uuid,p_starts_at timestamptz,p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; session_id uuid; existing private.meetup_sessions;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u and not private.meetup_tool_cohost(event.id,u) then raise exception 'HOST_REQUIRED'; end if;
  if coalesce(event.room_preview->>'eventKind','group')<>'group' then raise exception 'RECURRING_GROUP_REQUIRED'; end if;
  select * into existing from private.meetup_sessions where post_id=event.id and starts_at=p_starts_at;
  if existing.id is not null then
    if existing.ends_at<>p_ends_at then raise exception 'SESSION_OVERLAP'; end if;
    return existing.id;
  end if;
  perform private.require_meetup_tool_tier(event.author_id,'pro');
  perform private.assert_meetup_hosting(event.author_id,false);
  if p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_starts_at<=clock_timestamp() or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '7 days' then raise exception 'INVALID_SESSION_TIME'; end if;
  if event.author_id=u then return public.create_meetup_session(event.id,p_starts_at,p_ends_at); end if;
  if exists(select 1 from private.meetup_sessions where post_id=event.id and starts_at<p_ends_at and ends_at>p_starts_at)
    then raise exception 'SESSION_OVERLAP'; end if;
  perform private.enforce_rate_limit('meetup_session',10,interval '1 day',interval '10 seconds');
  insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at)
    values(event.id,event.author_id,p_starts_at,p_ends_at) returning id into session_id;
  insert into private.meetup_attendance(session_id,user_id)
    select session_id,event.author_id union select session_id,r.requester_id from public.meetup_requests r
      where r.post_id=event.id and r.status='approved' and coalesce(r.responded_at,r.created_at)<=p_ends_at;
  return session_id;
end;
$$;

create function public.set_meetup_waitlist(p_post_id uuid,p_opt_in boolean) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_opt_in is null then raise exception 'INVALID_WAITLIST'; end if;
  if not p_opt_in then
    update private.meetup_waitlist set cancelled_at=coalesce(cancelled_at,clock_timestamp()) where post_id=p_post_id and user_id=u;
    return;
  end if;
  event:=private.meetup_tool_context(p_post_id,u);
  perform private.require_meetup_tool_tier(event.author_id,'pro');
  perform private.assert_meetup_participation(u);
  if event.author_id=u or exists(select 1 from public.meetup_requests where post_id=event.id and requester_id=u and status='approved')
    then raise exception 'WAITLIST_NOT_ELIGIBLE'; end if;
  if not exists(select 1 from private.chilling_profiles where id=u) then raise exception 'CHILLING_PROFILE_REQUIRED'; end if;
  insert into private.meetup_waitlist(post_id,user_id) values(event.id,u)
    on conflict(post_id,user_id) do update set joined_at=case when meetup_waitlist.cancelled_at is null then meetup_waitlist.joined_at else clock_timestamp() end,
      invited_at=case when meetup_waitlist.cancelled_at is null then meetup_waitlist.invited_at else null end,cancelled_at=null;
end;
$$;

create function private.meetup_waitlist_eligible(p_post_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.posts p where p.id=p_post_id and private.is_active_account(p_user_id)
    and not private.is_blocked_between(p.author_id,p_user_id)
    and not private.has_reported(p.author_id,'user',p_user_id)
    and not private.has_reported(p_user_id,'user',p.author_id)
    and not private.has_reported(p_user_id,'post',p.id)
    and not exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=p_user_id and r.status='approved'));
$$;
create function public.invite_next_meetup_waitlist(p_post_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; entry private.meetup_waitlist;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(u,'pro');
  if 1+(select count(*) from public.meetup_requests where post_id=event.id and status='approved')
    >=coalesce((event.room_preview->>'capacity')::int,8) then raise exception 'MEETUP_FULL'; end if;
  select * into entry from private.meetup_waitlist w where w.post_id=event.id and w.cancelled_at is null and w.invited_at is null
    and private.meetup_waitlist_eligible(w.post_id,w.user_id) order by w.joined_at,w.id limit 1 for update;
  if entry.id is null then return false; end if;
  perform private.enforce_rate_limit('meetup_waitlist_invite',30,interval '1 day',interval '2 seconds');
  update private.meetup_waitlist set invited_at=clock_timestamp() where id=entry.id;
  perform private.create_notification(entry.user_id,'meetup_request',u,'post',event.id,
    '기다리던 모임에서 참여를 제안했어요. 모임에서 신청 내용을 확인해주세요. 초대는 참여 승인이나 자리 예약이 아니에요.','/post/'||event.id::text);
  return true;
end;
$$;

create function public.invite_meetup_cohost(p_post_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(u,'pro');
  if p_user_id is null or p_user_id=u or not private.meetup_tool_member(event.id,p_user_id) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  if exists(select 1 from private.meetup_cohosts where post_id=event.id and user_id=p_user_id and status in('pending','accepted')) then return; end if;
  perform private.enforce_rate_limit('meetup_cohost_invite',20,interval '1 day',interval '2 seconds');
  insert into private.meetup_cohosts(post_id,user_id,status) values(event.id,p_user_id,'pending')
    on conflict(post_id,user_id) do update set status='pending',invited_at=clock_timestamp(),accepted_at=null;
  perform private.create_notification(p_user_id,'meetup_request',u,'post',event.id,
    '공동 호스트 초대가 왔어요. 수락하면 회차·참석 확인을 함께 관리해요. 비공개 신청 답변과 계정 관리는 공유되지 않아요.','/post/'||event.id::text);
end;
$$;
create function public.respond_meetup_cohost(p_post_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_accept is null then raise exception 'INVALID_RESPONSE'; end if;
  if not p_accept then
    update private.meetup_cohosts set status='revoked' where post_id=p_post_id and user_id=u and status in('pending','accepted');
    return;
  end if;
  event:=private.meetup_tool_context(p_post_id,u);
  perform private.require_meetup_tool_tier(event.author_id,'pro');
  if not private.meetup_tool_member(event.id,u) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  if exists(select 1 from private.meetup_cohosts where post_id=event.id and user_id=u and status='accepted') then return; end if;
  update private.meetup_cohosts set status='accepted',accepted_at=clock_timestamp() where post_id=event.id and user_id=u and status='pending';
  if not found then raise exception 'COHOST_INVITATION_REQUIRED'; end if;
end;
$$;
create function public.remove_meetup_cohost(p_post_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  perform private.lock_relationships();
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_user_id is distinct from u and not exists(select 1 from public.posts where id=p_post_id and author_id=u) then raise exception 'HOST_REQUIRED'; end if;
  update private.meetup_cohosts set status='revoked' where post_id=p_post_id and user_id=p_user_id;
end;
$$;

create function public.get_meetup_host_tools(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; owner boolean; cohost boolean; available boolean; pro boolean; mine jsonb; roles jsonb; candidates jsonb;
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  owner:=event.author_id=u; cohost:=private.meetup_tool_cohost(event.id,u);
  available:=private.meetup_is_open(event.status,event.room_preview);
  pro:=private.meetup_tool_tier(event.author_id) in('pro','premium');
  select jsonb_build_object('joinedAt',w.joined_at,'invitedAt',w.invited_at,'position',
    (select count(*) from private.meetup_waitlist other where other.post_id=event.id and other.cancelled_at is null and other.invited_at is null
      and (other.joined_at,other.id)<=(w.joined_at,w.id) and private.meetup_waitlist_eligible(other.post_id,other.user_id)))
    into mine from private.meetup_waitlist w where w.post_id=event.id and w.user_id=u and w.cancelled_at is null
      and private.meetup_waitlist_eligible(w.post_id,w.user_id);
  select coalesce(jsonb_agg(jsonb_build_object('userId',c.user_id,'status',c.status) order by c.invited_at,c.user_id),'[]')
    into roles from private.meetup_cohosts c where c.post_id=event.id and c.status in('pending','accepted')
      and (owner or c.user_id=u) and private.meetup_tool_member(c.post_id,c.user_id);
  select coalesce(jsonb_agg(r.requester_id order by r.created_at,r.id),'[]') into candidates from public.meetup_requests r
    where owner and r.post_id=event.id and private.meetup_tool_member(event.id,r.requester_id)
      and not exists(select 1 from private.meetup_cohosts c where c.post_id=event.id and c.user_id=r.requester_id and c.status in('pending','accepted'));
  return jsonb_build_object('tier',private.meetup_tool_tier(u),'isHost',owner,'isCohost',cohost,
    'canManageSessions',available and pro and (owner or cohost),'canInvite',available and pro and owner,
    'kind',coalesce(event.room_preview->>'eventKind','group'),'available',available,
    'canJoinWaitlist',available and pro and not owner and not private.meetup_tool_member(event.id,u),
    'waitlist',mine,'waitlistCount',case when owner then(select count(*) from private.meetup_waitlist w where w.post_id=event.id
      and w.cancelled_at is null and w.invited_at is null and private.meetup_waitlist_eligible(w.post_id,w.user_id)) end,
    'cohosts',roles,'candidates',candidates);
end;
$$;

create function public.get_meetup_host_aggregates(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event public.posts;
begin
  event:=private.meetup_tool_context(p_post_id,auth.uid(),false);
  if event.author_id<>auth.uid() then raise exception 'HOST_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(auth.uid(),'premium');
  return jsonb_build_object(
    'applications',(select count(*) from public.meetup_requests where post_id=event.id),
    'approvals',(select count(*) from public.meetup_requests where post_id=event.id and status='approved'),
    'confirmedAttendance',(select count(*) from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
      where s.post_id=event.id and a.user_id<>event.author_id and a.confirmed_at is not null),
    'repeatParticipants',(select count(*) from(select a.user_id from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
      where s.post_id=event.id and a.user_id<>event.author_id and a.confirmed_at is not null group by a.user_id having count(distinct s.id)>1)repeated));
end;
$$;

-- A later reapplication needs a fresh role invitation and waitlist opt-in.
create function private.close_meetup_tool_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status then
    perform private.lock_relationships();
    if old.status='approved' and new.status<>'approved' then
      update private.meetup_cohosts set status='revoked' where post_id=new.post_id and user_id=new.requester_id;
    end if;
    if new.status in('approved','rejected','cancelled') then
      update private.meetup_waitlist set cancelled_at=coalesce(cancelled_at,clock_timestamp()) where post_id=new.post_id and user_id=new.requester_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger meetup_tools_membership_changed after update of status on public.meetup_requests
for each row execute function private.close_meetup_tool_membership();

create function private.purge_meetup_tool_account_data(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_relationships();
  delete from private.meetup_templates where owner_id=p_user_id;
  delete from private.meetup_waitlist where user_id=p_user_id
    or post_id in(select id from public.posts where author_id=p_user_id);
  delete from private.meetup_cohosts where user_id=p_user_id
    or post_id in(select id from public.posts where author_id=p_user_id);
end;
$$;
-- Reuse first-pass soft erasure and its existing deleted-account retry, before Auth deletion.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  anchor:='  delete from public.notifications';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_TOOLS_ACCOUNT_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,'  perform private.purge_meetup_tool_account_data(current_user_id);'||E'\n'||anchor);
  definition:=pg_get_functiondef('public.delete_my_account(text)'::regprocedure);
  anchor:='  if current_status = ''deleted'' then';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_TOOLS_ACCOUNT_RETRY_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' perform private.purge_meetup_tool_account_data(current_user_id);');
end;
$$;

revoke all on function private.meetup_tool_tier(uuid),private.require_meetup_tool_tier(uuid,text),private.meetup_tool_context(uuid,uuid,boolean),
  private.meetup_tool_member(uuid,uuid),private.meetup_tool_cohost(uuid,uuid),private.meetup_waitlist_eligible(uuid,uuid),private.close_meetup_tool_membership(),
  private.purge_meetup_tool_account_data(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_meetup_templates(),public.save_meetup_template(text,jsonb,uuid),public.delete_meetup_template(uuid),
  public.propose_meetup_dates(uuid,timestamptz,timestamptz,text,integer,text),public.confirm_meetup_occurrence(uuid,timestamptz,timestamptz),
  public.set_meetup_waitlist(uuid,boolean),public.invite_next_meetup_waitlist(uuid),public.invite_meetup_cohost(uuid,uuid),
  public.respond_meetup_cohost(uuid,boolean),public.remove_meetup_cohost(uuid,uuid),public.get_meetup_host_tools(uuid),public.get_meetup_host_aggregates(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_meetup_templates(),public.save_meetup_template(text,jsonb,uuid),public.delete_meetup_template(uuid),
  public.propose_meetup_dates(uuid,timestamptz,timestamptz,text,integer,text),public.confirm_meetup_occurrence(uuid,timestamptz,timestamptz),
  public.set_meetup_waitlist(uuid,boolean),public.invite_next_meetup_waitlist(uuid),public.invite_meetup_cohost(uuid,uuid),
  public.respond_meetup_cohost(uuid,boolean),public.remove_meetup_cohost(uuid,uuid),public.get_meetup_host_tools(uuid),public.get_meetup_host_aggregates(uuid)
  to authenticated;

-- Match the existing private attendance ownership; never trust a caller-supplied role.
alter table private.meetup_templates owner to postgres;
alter table private.meetup_waitlist owner to postgres;
alter table private.meetup_cohosts owner to postgres;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in('meetup_tool_tier','require_meetup_tool_tier','meetup_tool_context','meetup_tool_member','meetup_tool_cohost','meetup_waitlist_eligible','close_meetup_tool_membership','purge_meetup_tool_account_data'))
      or (n.nspname='public' and p.proname in('get_meetup_templates','save_meetup_template','delete_meetup_template','propose_meetup_dates',
        'confirm_meetup_occurrence','set_meetup_waitlist','invite_next_meetup_waitlist','invite_meetup_cohost','respond_meetup_cohost','remove_meetup_cohost','get_meetup_host_tools','get_meetup_host_aggregates')) loop
    execute format('alter function %s owner to postgres',f.signature);
  end loop;
end;
$$;
notify pgrst,'reload schema';
