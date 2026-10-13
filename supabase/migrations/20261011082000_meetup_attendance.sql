create table private.meetup_sessions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  host_id uuid not null references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at>starts_at),
  created_at timestamptz not null default now(),
  unique(post_id,starts_at)
);
create index meetup_sessions_due_idx on private.meetup_sessions(ends_at,id);
create table private.meetup_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references private.meetup_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  checked_in_at timestamptz,
  confirmed_at timestamptz,
  confirmation_source text check(confirmation_source in('peer','admin')),
  claim_body text check(char_length(claim_body)<=1000),
  claim_status text not null default 'none' check(claim_status in('none','pending','verified','rejected')),
  claim_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(session_id,user_id),
  check((confirmed_at is null)=(confirmation_source is null))
);
create index meetup_attendance_user_idx on private.meetup_attendance(user_id,session_id);
create index meetup_attendance_claim_idx on private.meetup_attendance(claim_updated_at,id) where claim_status='pending';
create table private.meetup_attendance_confirmations (
  session_id uuid not null,
  witness_id uuid not null,
  attendee_id uuid not null check(attendee_id<>witness_id),
  created_at timestamptz not null default now(),
  primary key(session_id,witness_id,attendee_id),
  foreign key(session_id,witness_id) references private.meetup_attendance(session_id,user_id) on delete cascade,
  foreign key(session_id,attendee_id) references private.meetup_attendance(session_id,user_id) on delete cascade
);
create index meetup_attendance_confirmation_target_idx on private.meetup_attendance_confirmations(session_id,attendee_id,witness_id);
alter table private.meetup_sessions enable row level security;
alter table private.meetup_attendance enable row level security;
alter table private.meetup_attendance_confirmations enable row level security;
revoke all on private.meetup_sessions,private.meetup_attendance,private.meetup_attendance_confirmations from public,anon,authenticated,service_role;
alter table private.meetup_sessions owner to postgres;
alter table private.meetup_attendance owner to postgres;
alter table private.meetup_attendance_confirmations owner to postgres;

create function private.can_attend_session(p_session uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.meetup_sessions s where s.id=p_session and (
    s.host_id=p_user or exists(select 1 from private.meetup_attendance a where a.session_id=s.id and a.user_id=p_user)
    or exists(select 1 from public.meetup_requests r where r.post_id=s.post_id and r.requester_id=p_user
      and r.status='approved' and coalesce(r.responded_at,r.created_at)<=s.ends_at)));
$$;
revoke all on function private.can_attend_session(uuid,uuid) from public,anon,authenticated,service_role;

create function public.create_meetup_session(p_post_id uuid,p_starts_at timestamptz default null,p_ends_at timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; session uuid; start_at timestamptz; end_at timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  select * into event from public.posts where id=p_post_id and status='published' and room_preview is not null;
  if event.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if event.room_preview->>'eventKind'='once' then
    if event.author_id<>u and not exists(select 1 from public.meetup_requests where post_id=event.id and requester_id=u and status='approved')
      then raise exception 'PARTICIPANT_REQUIRED'; end if;
    start_at:=(event.room_preview->>'startsAt')::timestamptz; end_at:=(event.room_preview->>'endsAt')::timestamptz;
  else
    if event.author_id<>u then raise exception 'HOST_REQUIRED'; end if;
    if coalesce(event.room_preview->>'closed','false')='true' then raise exception 'MEETUP_CLOSED'; end if;
    start_at:=p_starts_at; end_at:=p_ends_at;
    if start_at<now()-interval '24 hours' or end_at<=now() then raise exception 'INVALID_SESSION_TIME'; end if;
  end if;
  if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at)
    or end_at<=start_at or end_at-start_at>interval '7 days' or end_at<now()-interval '7 days'
    then raise exception 'INVALID_SESSION_TIME'; end if;
  select id into session from private.meetup_sessions where post_id=event.id and starts_at=start_at;
  if session is not null then return session; end if;
  if exists(select 1 from private.meetup_sessions where post_id=event.id and starts_at<end_at and ends_at>start_at)
    then raise exception 'SESSION_OVERLAP'; end if;
  perform private.enforce_rate_limit('meetup_session',10,interval '1 day',interval '10 seconds');
  insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at) values(event.id,event.author_id,start_at,end_at) returning id into session;
  insert into private.meetup_attendance(session_id,user_id)
    select session,event.author_id union select session,r.requester_id from public.meetup_requests r
      where r.post_id=event.id and r.status='approved' and coalesce(r.responded_at,r.created_at)<=end_at;
  return session;
end;
$$;

create function public.check_in_meetup(p_session_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); session private.meetup_sessions;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  select * into session from private.meetup_sessions where id=p_session_id;
  if not private.can_attend_session(p_session_id,u) then raise exception 'SESSION_NOT_FOUND'; end if;
  if now()<session.starts_at or now()>=session.ends_at then raise exception 'CHECK_IN_CLOSED'; end if;
  if not exists(select 1 from public.posts p where p.id=session.post_id and p.status='published'
    and coalesce(p.room_preview->>'closed','false')<>'true'
    and (p.author_id=u or exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.requester_id=u and r.status='approved'))
    and (coalesce(p.room_preview->>'eventKind','group')='group'
      or ((p.room_preview->>'startsAt')::timestamptz=session.starts_at and (p.room_preview->>'endsAt')::timestamptz=session.ends_at)))
    then raise exception 'CHECK_IN_UNAVAILABLE'; end if;
  insert into private.meetup_attendance(session_id,user_id,checked_in_at) values(session.id,u,now())
    on conflict(session_id,user_id) do update set checked_in_at=coalesce(meetup_attendance.checked_in_at,excluded.checked_in_at);
end;
$$;

create function public.confirm_meetup_attendance(p_session_id uuid,p_attendee_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); session private.meetup_sessions;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  if p_attendee_id is null or p_attendee_id=u then raise exception 'INVALID_ATTENDEE'; end if;
  perform private.assert_active_account(p_attendee_id);
  select * into session from private.meetup_sessions where id=p_session_id;
  if not private.can_attend_session(p_session_id,u) then raise exception 'SESSION_NOT_FOUND'; end if;
  if session.ends_at>now() or session.ends_at<now()-interval '7 days' then raise exception 'CONFIRMATION_CLOSED'; end if;
  if not exists(select 1 from private.meetup_attendance where session_id=session.id and user_id=u and checked_in_at is not null)
    or not exists(select 1 from private.meetup_attendance where session_id=session.id and user_id=p_attendee_id and checked_in_at is not null)
    then raise exception 'CHECK_IN_REQUIRED'; end if;
  insert into private.meetup_attendance_confirmations(session_id,witness_id,attendee_id) values(session.id,u,p_attendee_id) on conflict do nothing;
  if exists(select 1 from private.meetup_attendance_confirmations where session_id=session.id and witness_id=p_attendee_id and attendee_id=u) then
    update private.meetup_attendance set confirmed_at=coalesce(confirmed_at,now()),confirmation_source=coalesce(confirmation_source,'peer')
      where session_id=session.id and user_id in(u,p_attendee_id);
  end if;
end;
$$;

create function public.claim_meetup_attendance(p_session_id uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); session private.meetup_sessions; attendance private.meetup_attendance;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u); perform private.lock_relationships();
  select * into session from private.meetup_sessions where id=p_session_id;
  if not private.can_attend_session(p_session_id,u) then raise exception 'SESSION_NOT_FOUND'; end if;
  if session.ends_at>now() or session.ends_at<now()-interval '7 days' then raise exception 'CONFIRMATION_CLOSED'; end if;
  if char_length(btrim(coalesce(p_body,''))) not between 10 and 1000 then raise exception 'INVALID_CLAIM'; end if;
  insert into private.meetup_attendance(session_id,user_id) values(session.id,u) on conflict do nothing;
  select * into attendance from private.meetup_attendance where session_id=session.id and user_id=u for update;
  if attendance.confirmed_at is not null then raise exception 'ALREADY_CONFIRMED'; end if;
  if attendance.claim_status in('pending','rejected') then raise exception 'CLAIM_ALREADY_SUBMITTED'; end if;
  perform private.enforce_rate_limit('attendance_claim',5,interval '1 day',interval '10 seconds');
  update private.meetup_attendance set claim_body=btrim(p_body),claim_status='pending',claim_updated_at=now() where id=attendance.id;
  return attendance.id;
end;
$$;

create function public.get_meetup_sessions(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; items jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into event from public.posts where id=p_post_id and room_preview is not null;
  if event.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if event.author_id<>u and not exists(select 1 from public.meetup_requests where post_id=event.id and requester_id=u and status='approved')
    and not exists(select 1 from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id where s.post_id=event.id and a.user_id=u)
    then return jsonb_build_object('isHost',false,'member',false,'kind',coalesce(event.room_preview->>'eventKind','group'),'sessions','[]'::jsonb); end if;
  select coalesce(jsonb_agg(item order by starts_at desc),'[]'::jsonb) into items from(
    select s.starts_at,jsonb_build_object('id',s.id,'startsAt',s.starts_at,'endsAt',s.ends_at,
      'checkedIn',mine.checked_in_at is not null,'verified',mine.confirmed_at is not null,'claimStatus',coalesce(mine.claim_status,'none'),
      'members',coalesce((select jsonb_agg(jsonb_build_object('id',a.user_id,'nickname',p.nickname,'checkedIn',a.checked_in_at is not null,
        'verified',a.confirmed_at is not null,'confirmedByMe',exists(select 1 from private.meetup_attendance_confirmations w where w.session_id=s.id and w.witness_id=u and w.attendee_id=a.user_id)) order by p.nickname)
        from private.meetup_attendance a join public.profiles p on p.id=a.user_id where a.session_id=s.id and p.account_status='active'),'[]'::jsonb)) item
    from private.meetup_sessions s left join private.meetup_attendance mine on mine.session_id=s.id and mine.user_id=u
    where s.post_id=event.id and private.can_attend_session(s.id,u) order by s.starts_at desc limit 12
  ) sessions;
  return jsonb_build_object('isHost',event.author_id=u,'member',true,'kind',coalesce(event.room_preview->>'eventKind','group'),'sessions',items);
end;
$$;
revoke all on function public.create_meetup_session(uuid,timestamptz,timestamptz),public.check_in_meetup(uuid),
  public.confirm_meetup_attendance(uuid,uuid),public.claim_meetup_attendance(uuid,text),public.get_meetup_sessions(uuid) from public,anon,authenticated;
grant execute on function public.create_meetup_session(uuid,timestamptz,timestamptz),public.check_in_meetup(uuid),
  public.confirm_meetup_attendance(uuid,uuid),public.claim_meetup_attendance(uuid,text),public.get_meetup_sessions(uuid) to authenticated;

-- Existing cron, visibility and report functions run as postgres.
alter function private.can_attend_session(uuid,uuid) owner to postgres;
alter function public.create_meetup_session(uuid,timestamptz,timestamptz) owner to postgres;
alter function public.check_in_meetup(uuid) owner to postgres;
alter function public.confirm_meetup_attendance(uuid,uuid) owner to postgres;
alter function public.claim_meetup_attendance(uuid,text) owner to postgres;
alter function public.get_meetup_sessions(uuid) owner to postgres;
