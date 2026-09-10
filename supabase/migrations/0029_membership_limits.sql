-- Existing content is retained on downgrade; limits apply when adding active memberships.
create function private.membership_meetup_count(p_user_id uuid)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.posts p
  where p.status='published' and p.room_preview is not null
    and coalesce(p.room_preview->>'closed','false') <> 'true'
    and (p.author_id=p_user_id or exists(select 1 from public.meetup_requests r
      where r.post_id=p.id and r.requester_id=p_user_id and r.status='approved'));
$$;
revoke all on function private.membership_meetup_count(uuid) from public, anon, authenticated;

create function private.check_meetup_slot(p_user_id uuid, p_error text default 'MEETUP_LIMIT_REACHED')
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':meetup_membership',0));
  if private.membership_meetup_count(p_user_id) >= (private.membership_details(p_user_id)->>'meetupLimit')::integer then
    raise exception '%',p_error;
  end if;
end;
$$;
revoke all on function private.check_meetup_slot(uuid,text) from public, anon, authenticated;

create function private.guard_meetup_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare participant uuid;
begin
  if tg_table_name='posts' then
    if new.status<>'published' or new.room_preview is null or coalesce(new.room_preview->>'closed','false')='true' then return new; end if;
    if tg_op='UPDATE' and old.status='published' and old.room_preview is not null and coalesce(old.room_preview->>'closed','false')<>'true' then return new; end if;
    -- Re-publication also checks approved participants, preventing a hide/show quota bypass.
    for participant in select new.author_id union select requester_id from public.meetup_requests where post_id=new.id and status='approved' order by 1 loop
      perform private.check_meetup_slot(participant);
    end loop;
  else
    if new.status not in ('pending','approved') then return new; end if;
    if tg_op='UPDATE' and old.status=new.status then return new; end if;
    if exists(select 1 from public.posts where id=new.post_id and coalesce(room_preview->>'closed','false')='true') then raise exception 'MEETUP_CLOSED'; end if;
    perform private.assert_active_account(new.requester_id);
    perform private.check_meetup_slot(new.requester_id,case when new.status='approved' then 'REQUESTER_MEETUP_LIMIT_REACHED' else 'MEETUP_LIMIT_REACHED' end);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_meetup_membership() from public, anon, authenticated;
create trigger posts_membership_limit before insert or update of status,room_preview on public.posts
for each row execute function private.guard_meetup_membership();
create trigger meetup_requests_membership_limit before insert or update of status on public.meetup_requests
for each row execute function private.guard_meetup_membership();

create function public.leave_meetup(p_post_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid:=auth.uid(); meetup public.posts; changed integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  select * into meetup from public.posts where id=p_post_id and room_preview is not null for update;
  if meetup is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if meetup.author_id=current_user_id then
    update public.posts set room_preview=jsonb_set(room_preview,'{closed}','true') where id=p_post_id;
    update public.meetup_requests set status='cancelled',responded_at=now() where post_id=p_post_id and status in ('pending','approved');
  else
    update public.meetup_requests set status='cancelled',responded_at=now()
      where post_id=p_post_id and requester_id=current_user_id and status in ('pending','approved');
    get diagnostics changed=row_count;
    if changed=0 then raise exception 'REQUEST_NOT_FOUND'; end if;
    update public.posts set room_preview=jsonb_set(room_preview,'{memberCount}',to_jsonb(1+(select count(*) from public.meetup_requests where post_id=p_post_id and status='approved')))
      where id=p_post_id;
  end if;
end;
$$;
revoke all on function public.leave_meetup(uuid) from public, anon, authenticated;
grant execute on function public.leave_meetup(uuid) to authenticated;

create or replace function public.start_conversation(other_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid:=auth.uid(); low_user_id uuid; high_user_id uuid; conversation_id uuid;
  day_start timestamptz; daily_limit integer;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  if current_user_id=other_user_id then raise exception 'INVALID_RECIPIENT'; end if;
  if not private.is_active_account(other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  if private.is_blocked_between(current_user_id,other_user_id) then raise exception 'BLOCKED'; end if;
  low_user_id:=least(current_user_id,other_user_id); high_user_id:=greatest(current_user_id,other_user_id);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':conversation',0));
  perform pg_advisory_xact_lock(hashtextextended(low_user_id::text||':'||high_user_id::text,0));
  select id into conversation_id from public.conversations where user_low_id=low_user_id and user_high_id=high_user_id;
  if conversation_id is not null then return conversation_id; end if;
  if (select count(*) from public.conversations where current_user_id in (user_low_id,user_high_id))>=30 then
    raise exception 'CONVERSATION_LIMIT_REACHED';
  end if;
  select date_trunc('day',now() at time zone c.timezone) at time zone c.timezone into day_start
    from public.profiles p join public.cities c on c.id=p.city_id where p.id=current_user_id;
  daily_limit:=(private.membership_details(current_user_id)->>'conversationLimit')::integer;
  if (select count(*) from private.action_rate_events where user_id=current_user_id and action='conversation' and created_at>=day_start)>=daily_limit then
    raise exception 'DAILY_CONVERSATION_LIMIT_REACHED';
  end if;
  -- Keep the existing anti-spam cooldown; membership determines the local-calendar-day allowance.
  perform private.enforce_rate_limit('conversation',daily_limit,now()-day_start,interval '30 seconds');
  insert into public.conversations(user_low_id,user_high_id) values(low_user_id,high_user_id)
    on conflict(user_low_id,user_high_id) do nothing;
  select id into conversation_id from public.conversations where user_low_id=low_user_id and user_high_id=high_user_id;
  return conversation_id;
end;
$$;

create or replace function public.get_membership()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare current_user_id uuid:=auth.uid(); usage_day date; day_start timestamptz;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(current_user_id);
  select (now() at time zone c.timezone)::date,date_trunc('day',now() at time zone c.timezone) at time zone c.timezone into usage_day,day_start
    from public.profiles p join public.cities c on c.id=p.city_id where p.id=current_user_id;
  return private.membership_details(current_user_id)||jsonb_build_object(
    'postsUsed',(select count(*) from public.posts where author_id=current_user_id and posted_on=usage_day),
    'meetupsUsed',private.membership_meetup_count(current_user_id),
    'conversationsUsed',(select count(*) from private.action_rate_events where user_id=current_user_id and action='conversation' and created_at>=day_start),
    'conversationPeriod','day');
end;
$$;
