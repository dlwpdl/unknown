-- Host loyalty (owner 2026-10-29 "1번 호스트 팔로우 앵콜 단체공지 ... 3번 진행해 뱃지같은거라던지"; report
-- output/reviews/meetup-host-tools-2026-10-29 §3·§4·§7). Additive only: released apps keep their RPCs and never call these.
-- Tiers (report §4): follow, encore, member-wide notices and badges are free; scheduled/targeted notices plus;
-- roster, auto next session and check-in staff pro. Every new notice reuses kind meetup_changed (category meetups,
-- "내 소식" tab, normal push, '/post/' or '/chat' routes) so released apps open them without a new kind.
-- Nothing here makes persona/seed accounts follow, encore or join anyone: every write is the caller's own action.

-- 1. Private tables; only the security-definer RPCs below read or write them.
create table private.host_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id,host_id), check(follower_id<>host_id)
);
create index host_follows_host_idx on private.host_follows(host_id,created_at desc);
create table private.meetup_encores (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  notified_post_id uuid references public.posts(id) on delete set null,
  primary key(post_id,user_id)
);
create index meetup_encores_host_idx on private.meetup_encores(host_id,user_id) where notified_post_id is null;
-- One fan-out per meetup and a per-recipient log for the frequency cap.
create table private.host_meetup_broadcasts (
  post_id uuid primary key references public.posts(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  recipients integer not null default 0,
  created_at timestamptz not null default now()
);
create table private.host_follow_alerts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key(user_id,post_id,sent_at)
);
create index host_follow_alerts_recent_idx on private.host_follow_alerts(user_id,sent_at desc);
create table private.meetup_announcements (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 500),
  audience text not null default 'members' check(audience in('members','pending','waitlist')),
  send_at timestamptz not null default now(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  failed_reason text check(char_length(failed_reason)<=120),
  message_id uuid references public.messages(id) on delete set null,
  recipients integer,
  pinned boolean not null default true,
  created_at timestamptz not null default now()
);
create index meetup_announcements_post_idx on private.meetup_announcements(post_id,send_at desc);
create index meetup_announcements_due_idx on private.meetup_announcements(send_at) where sent_at is null and cancelled_at is null;
-- Host-only roster notes: never returned to the member or anyone else.
create table private.meetup_member_notes (
  host_id uuid not null references public.profiles(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  note text not null default '' check(char_length(note)<=500),
  regular boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(host_id,member_id), check(host_id<>member_id)
);
create table private.meetup_checkin_staff (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create table private.meetup_auto_next (
  post_id uuid primary key references public.posts(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  cadence text not null check(cadence in('weekly','fortnightly')),
  enabled boolean not null default true,
  last_session_id uuid,
  updated_at timestamptz not null default now()
);
create index if not exists meetup_sessions_host_idx on private.meetup_sessions(host_id,ends_at);
alter table private.host_follows enable row level security;
alter table private.meetup_encores enable row level security;
alter table private.host_meetup_broadcasts enable row level security;
alter table private.host_follow_alerts enable row level security;
alter table private.meetup_announcements enable row level security;
alter table private.meetup_member_notes enable row level security;
alter table private.meetup_checkin_staff enable row level security;
alter table private.meetup_auto_next enable row level security;
revoke all on private.host_follows,private.meetup_encores,private.host_meetup_broadcasts,private.host_follow_alerts,
  private.meetup_announcements,private.meetup_member_notes,private.meetup_checkin_staff,private.meetup_auto_next
  from public,anon,authenticated,service_role;

-- 2. Helpers.
create function private.host_tier_at_least(p_user_id uuid,p_minimum text) returns boolean
language sql stable security definer set search_path='' as $$
  -- Same ranking as private.require_meetup_tool_tier (admin above premium).
  select (case private.meetup_tool_tier(p_user_id) when 'admin' then 4 when 'premium' then 3 when 'pro' then 2 when 'plus' then 1 else 0 end)
    >=(case p_minimum when 'premium' then 3 when 'pro' then 2 else 1 end);
$$;
-- Attendance = an ended session with a check-in or a peer/admin confirmation; a host's own sessions do not count.
create function private.meetup_attended_count(p_user_id uuid,p_host_id uuid default null) returns integer
language sql stable security definer set search_path='' as $$
  select count(distinct a.session_id)::int from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
  where a.user_id=p_user_id and s.host_id<>p_user_id and (p_host_id is null or s.host_id=p_host_id)
    and s.ends_at<=now() and (a.checked_in_at is not null or a.confirmed_at is not null);
$$;
-- A hosted meetup counts once someone other than the host actually showed up.
create function private.meetup_hosted_count(p_user_id uuid) returns integer
language sql stable security definer set search_path='' as $$
  select count(*)::int from private.meetup_sessions s where s.host_id=p_user_id and s.ends_at<=now()
    and exists(select 1 from private.meetup_attendance a where a.session_id=s.id and a.user_id<>p_user_id
      and (a.checked_in_at is not null or a.confirmed_at is not null));
$$;
create function private.meetup_badge_level(p_count integer) returns integer
language sql immutable set search_path='' as $$
  select case when p_count>=25 then 25 when p_count>=10 then 10 when p_count>=5 then 5 when p_count>=1 then 1 else 0 end;
$$;
create function private.host_loyalty_pair_ok(p_viewer uuid,p_other uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_other is not null and private.is_active_account(p_other) and not private.is_blocked_between(p_viewer,p_other)
    and not private.has_reported(p_viewer,'user',p_other) and not private.has_reported(p_other,'user',p_viewer);
$$;
-- A follower hears from one host at most once a day and from all followed hosts at most 3 times a day.
create function private.host_follow_alert_allowed(p_user_id uuid,p_host_id uuid,p_bypass_host boolean) returns boolean
language sql stable security definer set search_path='' as $$
  select (p_bypass_host or not exists(select 1 from private.host_follow_alerts a where a.user_id=p_user_id and a.host_id=p_host_id and a.sent_at>now()-interval '20 hours'))
    and (select count(*) from private.host_follow_alerts a where a.user_id=p_user_id and a.sent_at>now()-interval '24 hours')<3;
$$;

-- 3. Badges (free). Only levels leave the server, for active and unblocked accounts.
create function public.get_meetup_badges(p_user_ids uuid[] default null,p_post_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); ids uuid[];
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  ids:=coalesce(p_user_ids,(select array[p.author_id] from public.posts p where p.id=p_post_id and p.room_preview is not null));
  if ids is null or cardinality(ids)>100 then raise exception 'INVALID_BADGE_REQUEST'; end if;
  return coalesce((select jsonb_object_agg(id::text,jsonb_build_object(
      'attended',private.meetup_badge_level(private.meetup_attended_count(id)),
      'hosted',private.meetup_badge_level(private.meetup_hosted_count(id))))
    from(select distinct id from unnest(ids) id)x where id=u or private.host_loyalty_pair_ok(u,id)),'{}'::jsonb);
end $$;

-- 4. Viewer state for one meetup: follow, encore, notices, staff and auto next.
create function public.get_meetup_loyalty(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; host boolean; member boolean; participated boolean; ended boolean; pinned jsonb; result jsonb;
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  host:=event.author_id=u;
  member:=private.meetup_tool_member(event.id,u);
  participated:=member or exists(select 1 from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
    where s.post_id=event.id and a.user_id=u and (a.checked_in_at is not null or a.confirmed_at is not null));
  ended:=not private.meetup_is_open(event.status,event.room_preview);
  if host or member then
    select jsonb_build_object('id',a.id,'body',a.body,'sentAt',a.sent_at) into pinned from private.meetup_announcements a
    where a.post_id=event.id and a.audience='members' and a.pinned and a.sent_at>now()-interval '14 days' and a.cancelled_at is null
    order by a.sent_at desc limit 1;
  end if;
  result:=jsonb_build_object('isHost',host,'hostTier',private.meetup_tool_tier(event.author_id),
    'kind',coalesce(event.room_preview->>'eventKind','group'),'ended',ended,
    'following',exists(select 1 from private.host_follows where follower_id=u and host_id=event.author_id),
    'canEncore',not host and ended and participated,
    'encored',exists(select 1 from private.meetup_encores where post_id=event.id and user_id=u),
    'isStaff',not host and member and exists(select 1 from private.meetup_checkin_staff where post_id=event.id and user_id=u),
    'hostBadges',jsonb_build_object('hosted',private.meetup_badge_level(private.meetup_hosted_count(event.author_id))),
    'pinned',pinned);
  if host then
    result:=result||jsonb_build_object(
      'followerCount',(select count(*) from private.host_follows f where f.host_id=u and private.is_active_account(f.follower_id)),
      'encoreCount',(select count(*) from private.meetup_encores e where e.post_id=event.id and private.is_active_account(e.user_id)),
      'sentToday',(select count(*) from private.meetup_announcements a where a.post_id=event.id and a.cancelled_at is null and a.send_at>now()-interval '24 hours' and a.send_at<=now()),
      'scheduled',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'body',a.body,'audience',a.audience,'sendAt',a.send_at) order by a.send_at)
        from private.meetup_announcements a where a.post_id=event.id and a.sent_at is null and a.cancelled_at is null),'[]'::jsonb),
      'autoNext',(select jsonb_build_object('enabled',c.enabled,'cadence',c.cadence) from private.meetup_auto_next c where c.post_id=event.id));
  end if;
  return result;
end $$;

-- 5. Follow a meetup's host (free). Identified by the meetup so the client never needs the host's id.
create function public.set_meetup_host_follow(p_post_id uuid,p_follow boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  if p_follow is null then raise exception 'INVALID_FOLLOW'; end if;
  event:=private.meetup_tool_context(p_post_id,u,false);
  if event.author_id=u then raise exception 'CANNOT_FOLLOW_SELF'; end if;
  if not p_follow then
    delete from private.host_follows where follower_id=u and host_id=event.author_id;
    return false;
  end if;
  if exists(select 1 from private.host_follows where follower_id=u and host_id=event.author_id) then return true; end if;
  if (select count(*) from private.host_follows where follower_id=u)>=500 then raise exception 'FOLLOW_LIMIT'; end if;
  perform private.enforce_rate_limit('host_follow',60,interval '1 day',interval '1 second');
  insert into private.host_follows(follower_id,host_id) values(u,event.author_id) on conflict do nothing;
  return true;
end $$;

-- 6. Encore (free): someone who took part in an ended meetup asks the host to run it again.
create function public.set_meetup_encore(p_post_id uuid,p_encore boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  if p_encore is null then raise exception 'INVALID_ENCORE'; end if;
  event:=private.meetup_tool_context(p_post_id,u,false);
  if not p_encore then
    delete from private.meetup_encores where post_id=event.id and user_id=u;
    return false;
  end if;
  if event.author_id=u or private.meetup_is_open(event.status,event.room_preview) then raise exception 'ENCORE_NOT_AVAILABLE'; end if;
  if not private.meetup_tool_member(event.id,u) and not exists(select 1 from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
    where s.post_id=event.id and a.user_id=u and (a.checked_in_at is not null or a.confirmed_at is not null)) then raise exception 'PARTICIPANT_REQUIRED'; end if;
  perform private.enforce_rate_limit('meetup_encore',30,interval '1 day',interval '1 second');
  insert into private.meetup_encores(post_id,user_id,host_id) values(event.id,u,event.author_id) on conflict do nothing;
  return true;
end $$;

-- 7. A new meetup tells the host's followers and everyone who asked for an encore, once.
create function private.notify_host_new_meetup() returns trigger
language plpgsql security definer set search_path='' as $$
declare nickname text; recipient record; sent integer:=0;
begin
  -- Only meetups created in the last hour: older posts also update room_preview (member counts, edits).
  if new.created_at<now()-interval '1 hour' or not private.meetup_is_open(new.status,new.room_preview)
    or not private.is_active_account(new.author_id) then return new; end if;
  insert into private.host_meetup_broadcasts(post_id,host_id) values(new.id,new.author_id) on conflict do nothing;
  if not found then return new; end if;
  select p.nickname::text into nickname from public.profiles p where p.id=new.author_id;
  -- shortcut: fans out inside the creating transaction; move to a queue if a host passes a few thousand followers.
  for recipient in
    select x.user_id,bool_or(x.encore) encore from(
      select f.follower_id user_id,false encore from private.host_follows f where f.host_id=new.author_id
      union all select e.user_id,true from private.meetup_encores e where e.host_id=new.author_id and e.notified_post_id is null and e.post_id<>new.id
    )x group by x.user_id
  loop
    if recipient.user_id=new.author_id or not private.host_loyalty_pair_ok(new.author_id,recipient.user_id)
      or (new.room_preview->>'newcomerOnly'='true' and private.newcomer_ends_at(recipient.user_id) is null)
      or not private.host_follow_alert_allowed(recipient.user_id,new.author_id,recipient.encore) then continue; end if;
    if private.create_notification(recipient.user_id,'meetup_changed',new.author_id,'post',new.id,
      case when recipient.encore then '또 열어 달라고 했던 '||nickname||'님이 새 모임을 열었어요. ' else nickname||'님이 새 모임을 열었어요. ' end||left(new.title,80),
      '/post/'||new.id::text) is not null then
      insert into private.host_follow_alerts(user_id,host_id,post_id) values(recipient.user_id,new.author_id,new.id) on conflict do nothing;
      sent:=sent+1;
    end if;
  end loop;
  update private.meetup_encores set notified_post_id=new.id where host_id=new.author_id and notified_post_id is null and post_id<>new.id;
  update private.host_meetup_broadcasts set recipients=sent where post_id=new.id;
  return new;
end $$;
create trigger posts_host_new_meetup after insert or update of room_preview,status on public.posts
  for each row when (new.room_preview ? 'eventKind' and new.status='published') execute function private.notify_host_new_meetup();

-- 8. Meetup notices. Member notices are also a "[공지]" message in the group room, so the existing message
-- safety review, watch terms and reports cover them; the room pins the latest one.
create function private.deliver_meetup_announcement(p_announcement_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare a private.meetup_announcements; event public.posts; room uuid; message uuid; route text; body text; recipient uuid; sent integer:=0;
begin
  select * into a from private.meetup_announcements where id=p_announcement_id for update;
  if a.id is null or a.sent_at is not null or a.cancelled_at is not null then return 0; end if;
  -- Callers run as the host (the RPC directly, the scheduler through the host's claims).
  if auth.uid() is distinct from a.host_id then raise exception 'HOST_REQUIRED'; end if;
  select * into event from public.posts where id=a.post_id;
  if event.id is null or event.author_id<>a.host_id or not private.meetup_is_open(event.status,event.room_preview) then raise exception 'MEETUP_CLOSED'; end if;
  route:='/post/'||event.id::text;
  if a.audience='members' then
    select id into room from public.conversations where group_post_id=event.id;
    if room is not null then
      message:=public.send_message(room,'[공지] '||a.body);
      -- The notice below is the push; the room's message stays in the chat without a second push.
      delete from private.push_delivery_queue where notification_id in(select n.id from public.notifications n
        where n.kind='message' and n.target_type='message' and n.target_id=message);
      route:='/chat?conversationId='||room::text;
    end if;
  end if;
  body:='「'||left(event.title,60)||'」 공지: '||a.body;
  for recipient in
    select r.requester_id from public.meetup_requests r where a.audience='members' and r.post_id=event.id and r.status='approved'
    union select r.requester_id from public.meetup_requests r where a.audience='pending' and r.post_id=event.id and r.status='pending'
    union select w.user_id from private.meetup_waitlist w where a.audience='waitlist' and w.post_id=event.id
      and w.cancelled_at is null and w.invited_at is null and private.meetup_waitlist_eligible(w.post_id,w.user_id)
  loop
    if private.host_loyalty_pair_ok(a.host_id,recipient)
      and private.create_notification(recipient,'meetup_changed',a.host_id,'post',event.id,body,route) is not null then sent:=sent+1; end if;
  end loop;
  update private.meetup_announcements set sent_at=clock_timestamp(),message_id=message,recipients=sent where id=a.id;
  return sent;
end $$;

create function public.post_meetup_announcement(p_post_id uuid,p_body text,p_audience text default 'members',p_send_at timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; clean text:=btrim(coalesce(p_body,'')); target timestamptz; announcement uuid;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  if char_length(clean) not between 1 and 500 then raise exception 'INVALID_ANNOUNCEMENT'; end if;
  if p_audience is null or p_audience not in('members','pending','waitlist') then raise exception 'INVALID_ANNOUNCEMENT_AUDIENCE'; end if;
  perform private.assert_content_allowed(clean);
  -- Targeting and scheduling are plus; a member-wide notice sent now is free.
  if p_audience<>'members' or p_send_at is not null then perform private.require_meetup_tool_tier(u,'plus'); end if;
  target:=coalesce(p_send_at,clock_timestamp());
  if p_send_at is not null and (not isfinite(p_send_at) or p_send_at<clock_timestamp()+interval '5 minutes' or p_send_at>clock_timestamp()+interval '30 days'
    or (event.room_preview->>'eventKind'='once' and p_send_at>=(event.room_preview->>'endsAt')::timestamptz)) then raise exception 'INVALID_ANNOUNCEMENT_TIME'; end if;
  -- At most 3 notices in any 24 hours per meetup, counting scheduled ones at their send time.
  if (select count(*) from private.meetup_announcements a where a.post_id=event.id and a.cancelled_at is null
    and a.send_at>target-interval '24 hours' and a.send_at<target+interval '24 hours')>=3 then raise exception 'ANNOUNCEMENT_DAILY_LIMIT'; end if;
  if p_send_at is not null and (select count(*) from private.meetup_announcements a where a.post_id=event.id and a.sent_at is null and a.cancelled_at is null)>=5
    then raise exception 'ANNOUNCEMENT_SCHEDULE_LIMIT'; end if;
  perform private.enforce_rate_limit('meetup_announcement',12,interval '1 day',interval '20 seconds');
  insert into private.meetup_announcements(post_id,host_id,body,audience,send_at) values(event.id,u,clean,p_audience,target) returning id into announcement;
  if p_send_at is null then perform private.deliver_meetup_announcement(announcement); end if;
  return announcement;
end $$;

-- cancel = an unsent scheduled notice; unpin = take the sent notice off the room's top.
create function public.update_meetup_announcement(p_announcement_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_action='cancel' then
    update private.meetup_announcements set cancelled_at=clock_timestamp() where id=p_announcement_id and host_id=u and sent_at is null and cancelled_at is null;
  elsif p_action='unpin' then
    update private.meetup_announcements set pinned=false where id=p_announcement_id and host_id=u and sent_at is not null;
  else raise exception 'INVALID_ACTION'; end if;
  if not found then raise exception 'ANNOUNCEMENT_NOT_FOUND'; end if;
end $$;

create function private.send_due_meetup_announcements() returns integer
language plpgsql security definer set search_path='' as $$
declare item record; saved text:=current_setting('request.jwt.claims',true); sent integer:=0;
begin
  for item in select id,host_id from private.meetup_announcements where sent_at is null and cancelled_at is null and send_at<=now()
    order by send_at,id limit 50 for update skip locked
  loop
    begin
      -- Deliver as the host so send_message keeps every membership, closure and rate check (precedent: 0142).
      perform set_config('request.jwt.claims',jsonb_build_object('sub',item.host_id,'role','authenticated')::text,true);
      perform private.assert_active_account(item.host_id);
      perform private.deliver_meetup_announcement(item.id);
      sent:=sent+1;
    exception when others then
      update private.meetup_announcements set cancelled_at=clock_timestamp(),failed_reason=left(sqlerrm,120) where id=item.id;
    end;
  end loop;
  perform set_config('request.jwt.claims',coalesce(saved,''),true);
  return sent;
end $$;

-- 9. Member roster (pro): attendance with this host, 단골 (3+), host-only note and 정회원.
create function public.get_meetup_roster(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(u,'pro');
  return coalesce((select jsonb_agg(row order by (row->>'attended')::int desc,row->>'nickname') from(
    select jsonb_build_object('userId',r.requester_id,'nickname',p.nickname,'attended',private.meetup_attended_count(r.requester_id,u),
      'lastAttendedAt',(select max(s.ends_at) from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
        where a.user_id=r.requester_id and s.host_id=u and s.ends_at<=now() and (a.checked_in_at is not null or a.confirmed_at is not null)),
      'note',coalesce(n.note,''),'regular',coalesce(n.regular,false),
      'staff',exists(select 1 from private.meetup_checkin_staff st where st.post_id=event.id and st.user_id=r.requester_id)) row
    from public.meetup_requests r join public.profiles p on p.id=r.requester_id
    left join private.meetup_member_notes n on n.host_id=u and n.member_id=r.requester_id
    where r.post_id=event.id and r.status='approved' and private.meetup_tool_member(event.id,r.requester_id))x),'[]'::jsonb);
end $$;

create function public.set_meetup_member_note(p_post_id uuid,p_member_id uuid,p_note text,p_regular boolean) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; clean text:=btrim(coalesce(p_note,''));
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(u,'pro');
  if p_regular is null or char_length(clean)>500 then raise exception 'INVALID_MEMBER_NOTE'; end if;
  if p_member_id is null or not private.meetup_tool_member(event.id,p_member_id) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  perform private.enforce_rate_limit('meetup_member_note',200,interval '1 day',interval '0 seconds');
  if clean='' and not p_regular then delete from private.meetup_member_notes where host_id=u and member_id=p_member_id; return; end if;
  insert into private.meetup_member_notes(host_id,member_id,note,regular) values(u,p_member_id,clean,p_regular)
    on conflict(host_id,member_id) do update set note=excluded.note,regular=excluded.regular,updated_at=clock_timestamp();
end $$;

-- 10. Check-in staff (pro): a host-picked member may mark other members checked in, nothing else.
create function public.set_meetup_checkin_staff(p_post_id uuid,p_user_id uuid,p_staff boolean) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u,false);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  if p_staff is null then raise exception 'INVALID_RESPONSE'; end if;
  if not p_staff then delete from private.meetup_checkin_staff where post_id=event.id and user_id=p_user_id; return; end if;
  perform private.require_meetup_tool_tier(u,'pro');
  if p_user_id is null or p_user_id=u or not private.meetup_tool_member(event.id,p_user_id) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  if exists(select 1 from private.meetup_checkin_staff where post_id=event.id and user_id=p_user_id) then return; end if;
  if (select count(*) from private.meetup_checkin_staff where post_id=event.id)>=3 then raise exception 'STAFF_LIMIT'; end if;
  perform private.enforce_rate_limit('meetup_checkin_staff',20,interval '1 day',interval '1 second');
  insert into private.meetup_checkin_staff(post_id,user_id) values(event.id,p_user_id);
  perform private.create_notification(p_user_id,'meetup_changed',u,'post',event.id,
    '「'||left(event.title,60)||'」 체크인을 맡게 됐어요. 모임 시간에 참석 확인 화면에서 체크인할 수 있어요.','/post/'||event.id::text);
end $$;

create function public.staff_check_in_meetup(p_session_id uuid,p_attendee_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); session private.meetup_sessions; event public.posts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  select * into session from private.meetup_sessions where id=p_session_id;
  if session.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  event:=private.meetup_tool_context(session.post_id,u,false);
  if event.author_id<>u and not (private.meetup_tool_member(event.id,u)
    and exists(select 1 from private.meetup_checkin_staff where post_id=event.id and user_id=u)) then raise exception 'STAFF_REQUIRED'; end if;
  perform private.require_meetup_tool_tier(event.author_id,'pro');
  if coalesce(event.room_preview->>'closed','false')='true' then raise exception 'CHECK_IN_UNAVAILABLE'; end if;
  if clock_timestamp()<session.starts_at or clock_timestamp()>=session.ends_at then raise exception 'CHECK_IN_CLOSED'; end if;
  if p_attendee_id is null or not (p_attendee_id=event.author_id or private.meetup_tool_member(event.id,p_attendee_id))
    or not private.can_attend_session(session.id,p_attendee_id) then raise exception 'INVALID_ATTENDEE'; end if;
  insert into private.meetup_attendance(session_id,user_id,checked_in_at) values(session.id,p_attendee_id,clock_timestamp())
    on conflict(session_id,user_id) do update set checked_in_at=coalesce(meetup_attendance.checked_in_at,excluded.checked_in_at);
end $$;

-- Leaving or being removed ends the staff role.
create function private.close_meetup_checkin_staff() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.status='approved' and new.status is distinct from 'approved' then
    delete from private.meetup_checkin_staff where post_id=new.post_id and user_id=new.requester_id;
  end if;
  return new;
end $$;
create trigger meetup_requests_checkin_staff after update of status on public.meetup_requests
  for each row execute function private.close_meetup_checkin_staff();

-- 11. Next session (pro): when a regular meetup's latest session ends, open the next one and tell members and followers.
create function public.set_meetup_auto_next(p_post_id uuid,p_enabled boolean,p_cadence text default 'weekly') returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  if p_enabled is null or p_cadence is null or p_cadence not in('weekly','fortnightly') then raise exception 'INVALID_RECURRENCE'; end if;
  event:=private.meetup_tool_context(p_post_id,u,p_enabled);
  if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
  if not p_enabled then update private.meetup_auto_next set enabled=false,updated_at=clock_timestamp() where post_id=event.id; return; end if;
  perform private.require_meetup_tool_tier(u,'pro');
  if coalesce(event.room_preview->>'eventKind','group')<>'group' then raise exception 'RECURRING_GROUP_REQUIRED'; end if;
  insert into private.meetup_auto_next(post_id,host_id,cadence) values(event.id,u,p_cadence)
    on conflict(post_id) do update set enabled=true,cadence=excluded.cadence,updated_at=clock_timestamp();
end $$;

create function private.open_next_meetup_sessions(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare cfg record; last private.meetup_sessions; zone text; step interval; next_start timestamptz; next_end timestamptz;
  session uuid; nickname text; recipient record; body text; opened integer:=0; guard integer;
begin
  for cfg in select c.post_id,c.cadence,p.author_id,p.title,p.room_preview from private.meetup_auto_next c join public.posts p on p.id=c.post_id
    where c.enabled and p.author_id=c.host_id and private.meetup_is_open(p.status,p.room_preview) and coalesce(p.room_preview->>'eventKind','group')='group'
      and private.is_active_account(p.author_id) and private.host_tier_at_least(p.author_id,'pro')
  loop
    select * into last from private.meetup_sessions where post_id=cfg.post_id order by starts_at desc limit 1;
    if last.id is null or last.ends_at>p_now then continue; end if;
    zone:=coalesce(nullif(cfg.room_preview->>'timezone',''),'America/Vancouver');
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then zone:='America/Vancouver'; end if;
    step:=case cfg.cadence when 'weekly' then interval '7 days' else interval '14 days' end;
    -- Local wall-clock steps keep the same time across DST; skip dates already in the past.
    next_start:=((last.starts_at at time zone zone)+step) at time zone zone;
    next_end:=((last.ends_at at time zone zone)+step) at time zone zone;
    guard:=0;
    while next_start<=p_now and guard<60 loop
      next_start:=((next_start at time zone zone)+step) at time zone zone; next_end:=((next_end at time zone zone)+step) at time zone zone; guard:=guard+1;
    end loop;
    if next_start<=p_now or next_end<=next_start then continue; end if;
    insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at) values(cfg.post_id,cfg.author_id,next_start,next_end)
      on conflict(post_id,starts_at) do nothing returning id into session;
    if session is null then continue; end if;
    -- Same attendance roster create_meetup_session builds.
    insert into private.meetup_attendance(session_id,user_id)
      select session,cfg.author_id union select session,r.requester_id from public.meetup_requests r
        where r.post_id=cfg.post_id and r.status='approved' on conflict do nothing;
    update private.meetup_auto_next set last_session_id=session,updated_at=clock_timestamp() where post_id=cfg.post_id;
    opened:=opened+1;
    select p.nickname::text into nickname from public.profiles p where p.id=cfg.author_id;
    body:='「'||left(cfg.title,60)||'」 다음 모임 날짜가 잡혔어요. '||to_char(next_start at time zone zone,'MM/DD HH24:MI')||' (모임 현지 시간)';
    for recipient in
      select x.user_id,bool_or(x.member) member from(
        select r.requester_id user_id,true member from public.meetup_requests r where r.post_id=cfg.post_id and r.status='approved'
        union all select f.follower_id,false from private.host_follows f where f.host_id=cfg.author_id
      )x group by x.user_id
    loop
      if recipient.user_id=cfg.author_id or not private.host_loyalty_pair_ok(cfg.author_id,recipient.user_id) then continue; end if;
      if not recipient.member and not private.host_follow_alert_allowed(recipient.user_id,cfg.author_id,false) then continue; end if;
      if private.create_notification(recipient.user_id,'meetup_changed',cfg.author_id,'post',cfg.post_id,body,'/post/'||cfg.post_id::text) is not null
        and not recipient.member then
        insert into private.host_follow_alerts(user_id,host_id,post_id) values(recipient.user_id,cfg.author_id,cfg.post_id) on conflict do nothing;
      end if;
    end loop;
  end loop;
  return opened;
end $$;

-- 12. Account deletion: reuse the host-tools purge hook that purge_account_data and delete_my_account already call.
create function private.purge_host_loyalty_account_data(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from private.host_follows where follower_id=p_user_id or host_id=p_user_id;
  delete from private.meetup_encores where user_id=p_user_id or host_id=p_user_id;
  delete from private.host_follow_alerts where user_id=p_user_id or host_id=p_user_id;
  delete from private.meetup_announcements where host_id=p_user_id;
  delete from private.meetup_member_notes where host_id=p_user_id or member_id=p_user_id;
  delete from private.meetup_checkin_staff where user_id=p_user_id or post_id in(select id from public.posts where author_id=p_user_id);
  delete from private.meetup_auto_next where host_id=p_user_id;
end $$;
do $$
declare definition text; anchor text:='  delete from private.meetup_templates where owner_id=p_user_id;';
begin
  definition:=pg_get_functiondef('private.purge_meetup_tool_account_data(uuid)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'HOST_LOYALTY_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||E'\n  perform private.purge_host_loyalty_account_data(p_user_id);');
end $$;

-- 13. Grants, owners, schedules and analytics targets.
revoke all on function private.host_tier_at_least(uuid,text),private.meetup_attended_count(uuid,uuid),private.meetup_hosted_count(uuid),
  private.meetup_badge_level(integer),private.host_loyalty_pair_ok(uuid,uuid),private.host_follow_alert_allowed(uuid,uuid,boolean),
  private.notify_host_new_meetup(),private.deliver_meetup_announcement(uuid),private.send_due_meetup_announcements(),
  private.close_meetup_checkin_staff(),private.open_next_meetup_sessions(timestamptz),private.purge_host_loyalty_account_data(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_meetup_badges(uuid[],uuid),public.get_meetup_loyalty(uuid),public.set_meetup_host_follow(uuid,boolean),
  public.set_meetup_encore(uuid,boolean),public.post_meetup_announcement(uuid,text,text,timestamptz),public.update_meetup_announcement(uuid,text),
  public.get_meetup_roster(uuid),public.set_meetup_member_note(uuid,uuid,text,boolean),public.set_meetup_checkin_staff(uuid,uuid,boolean),
  public.staff_check_in_meetup(uuid,uuid),public.set_meetup_auto_next(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.get_meetup_badges(uuid[],uuid),public.get_meetup_loyalty(uuid),public.set_meetup_host_follow(uuid,boolean),
  public.set_meetup_encore(uuid,boolean),public.post_meetup_announcement(uuid,text,text,timestamptz),public.update_meetup_announcement(uuid,text),
  public.get_meetup_roster(uuid),public.set_meetup_member_note(uuid,uuid,text,boolean),public.set_meetup_checkin_staff(uuid,uuid,boolean),
  public.staff_check_in_meetup(uuid,uuid),public.set_meetup_auto_next(uuid,boolean,text) to authenticated;

alter table private.host_follows owner to postgres;
alter table private.meetup_encores owner to postgres;
alter table private.host_meetup_broadcasts owner to postgres;
alter table private.host_follow_alerts owner to postgres;
alter table private.meetup_announcements owner to postgres;
alter table private.meetup_member_notes owner to postgres;
alter table private.meetup_checkin_staff owner to postgres;
alter table private.meetup_auto_next owner to postgres;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in('host_tier_at_least','meetup_attended_count','meetup_hosted_count','meetup_badge_level',
        'host_loyalty_pair_ok','host_follow_alert_allowed','notify_host_new_meetup','deliver_meetup_announcement','send_due_meetup_announcements',
        'close_meetup_checkin_staff','open_next_meetup_sessions','purge_host_loyalty_account_data'))
      or (n.nspname='public' and p.proname in('get_meetup_badges','get_meetup_loyalty','set_meetup_host_follow','set_meetup_encore',
        'post_meetup_announcement','update_meetup_announcement','get_meetup_roster','set_meetup_member_note','set_meetup_checkin_staff',
        'staff_check_in_meetup','set_meetup_auto_next')) loop
    execute format('alter function %s owner to postgres',f.signature);
  end loop;
end $$;

select cron.unschedule(jobid) from cron.job where jobname in('gling-meetup-announcements','gling-meetup-next-session');
select cron.schedule('gling-meetup-announcements','*/5 * * * *',$job$ select private.send_due_meetup_announcements(); $job$);
select cron.schedule('gling-meetup-next-session','21 * * * *',$job$ select private.open_next_meetup_sessions(); $job$);

insert into private.behavior_targets(id) values
 ('meetup.host.follow'),('meetup.encore'),('meetup.notice.unpin'),('meetup.notice.audience'),('meetup.notice.schedule'),
 ('meetup.notice.send'),('meetup.notice.cancel'),('meetup.roster.note'),('meetup.roster.note.save'),('meetup.roster.regular.on'),
 ('meetup.roster.regular.off'),('meetup.roster.staff.on'),('meetup.roster.staff.off'),('meetup.auto-next.on'),('meetup.auto-next.off'),
 ('meetup.auto-next.cadence'),('meetup.staff.check-in')
on conflict do nothing;
notify pgrst,'reload schema';
