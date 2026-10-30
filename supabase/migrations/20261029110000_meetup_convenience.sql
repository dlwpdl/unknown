-- Meetup convenience + no-show bundle (owner 2026-10-29; policy §6-4, reports gling-idea-note-review §2·§5 and
-- meetup-host-tools §3②·§4). Additive only: new tables/functions/triggers; existing functions keep their signatures,
-- and the few that change are patched by anchor so a drifted production definition stops the migration.
--
-- Tables other features may read (host-loyalty reads absences for attendance counts):
--   private.meetup_rsvps(post_id, user_id, starts_at, response 'going'|'not_going', responded_at)
--   private.meetup_absences(session_id, user_id, host_id, post_id, kind 'no_show'|'excused', recorded_at)
--     kind is decided from private.meetup_attendance (host checked in, member did not) and meetup_rsvps.

-- 0. Tier rank used by every gate below: 0 free, 1 plus, 2 pro, 3 premium/operator.
create function private.meetup_tier_rank(p_user uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case private.meetup_tool_tier(p_user) when 'admin' then 3 when 'premium' then 3 when 'pro' then 2 when 'plus' then 1 else 0 end;
$$;

-- New host-only kind for the empty-meetup suggestion; it files under 'meetups' like reminders.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' or definition not like '%like_summary%' then raise exception 'MEETUP_CONVENIENCE_KIND_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '||
    replace(definition,'CHECK (','CHECK (kind = ''meetup_host_tip'' or ');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure);
  if strpos(definition,'when ''meetup_reminder'' then ''meetups''')=0 then raise exception 'MEETUP_CONVENIENCE_CATEGORY_CHANGED'; end if;
  execute replace(definition,'when ''meetup_reminder'' then ''meetups''','when ''meetup_host_tip'' then ''meetups'' when ''meetup_reminder'' then ''meetups''');
end $$;

-- 1. "갈게요 / 못 가요". Buttons are free; the host's count is plus+.
create table private.meetup_rsvps (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  response text not null check (response in ('going','not_going')),
  responded_at timestamptz not null default clock_timestamp(),
  primary key (post_id, user_id, starts_at)
);
alter table private.meetup_rsvps enable row level security;
revoke all on private.meetup_rsvps from public, anon, authenticated, service_role;

-- The start being answered for: a one-time meetup's start, or a regular meetup's next registered session.
create function private.meetup_next_start(p_post public.posts) returns timestamptz
language sql stable security definer set search_path='' as $$
  select case when p_post.room_preview->>'eventKind'='once'
    then (p_post.room_preview->>'startsAt')::timestamptz
    else (select min(s.starts_at) from private.meetup_sessions s where s.post_id=p_post.id and s.starts_at>clock_timestamp()) end;
$$;

create function public.get_meetup_rsvp(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; start_at timestamptz; host boolean; member boolean; counts jsonb;
begin
  event:=private.meetup_tool_context(p_post_id,u,false);
  host:=event.author_id=u; member:=private.meetup_tool_member(event.id,u);
  start_at:=private.meetup_next_start(event);
  if not private.meetup_is_open(event.status,event.room_preview) or start_at is null or start_at<=clock_timestamp() then start_at:=null; end if;
  if host and start_at is not null and private.meetup_tier_rank(u)>=1 then
    select jsonb_build_object('going',count(*) filter (where v.response='going'),'notGoing',count(*) filter (where v.response='not_going'),
      'noAnswer',count(*) filter (where v.response is null)) into counts
    from public.meetup_requests r left join private.meetup_rsvps v on v.post_id=r.post_id and v.user_id=r.requester_id and v.starts_at=start_at
    where r.post_id=event.id and r.status='approved' and private.meetup_tool_member(event.id,r.requester_id);
  end if;
  return jsonb_build_object('available',start_at is not null and (host or member),'startsAt',start_at,'isHost',host,'member',member,
    'kind',coalesce(event.room_preview->>'eventKind','group'),
    'mine',(select response from private.meetup_rsvps where post_id=event.id and user_id=u and starts_at=start_at),
    'canSeeCounts',host and private.meetup_tier_rank(u)>=1,'counts',counts);
end $$;

-- p_release (one-time meetups only) also leaves through the existing leave_meetup path, so the usual leave rules apply,
-- and a plus+ host's next waitlisted member hears about the free seat right away.
create function public.set_meetup_rsvp(p_post_id uuid, p_going boolean, p_release boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts; start_at timestamptz;
begin
  if p_going is null or p_release is null or (p_going and p_release) then raise exception 'INVALID_RESPONSE'; end if;
  perform private.lock_relationships();
  event:=private.meetup_tool_context(p_post_id,u);
  if not private.meetup_tool_member(event.id,u) then raise exception 'APPROVED_MEMBER_REQUIRED'; end if;
  start_at:=private.meetup_next_start(event);
  if start_at is null or start_at<=clock_timestamp() then raise exception 'RSVP_UNAVAILABLE'; end if;
  if p_release and event.room_preview->>'eventKind' is distinct from 'once' then raise exception 'INVALID_RESPONSE'; end if;
  perform private.enforce_rate_limit('meetup_rsvp',30,interval '1 day',interval '1 second');
  insert into private.meetup_rsvps(post_id,user_id,starts_at,response) values(event.id,u,start_at,case when p_going then 'going' else 'not_going' end)
    on conflict(post_id,user_id,starts_at) do update set response=excluded.response,responded_at=clock_timestamp();
  if p_release then
    perform public.leave_meetup(event.id);
    -- With waitlist promotion on, the seat-freed trigger already offered the seat with a deadline.
    if private.meetup_tier_rank(event.author_id)>=1 and not exists(select 1 from private.meetup_automation a
      where a.post_id=event.id and a.promote_waitlist and private.meetup_tier_rank(event.author_id)>=2) then
      perform private.offer_meetup_waitlist(event.id,null);
    end if;
  end if;
  return public.get_meetup_rsvp(event.id);
end $$;

-- 2. Per-meetup automation (host only) and the host's no-show rule.
create table private.meetup_automation (
  post_id uuid primary key references public.posts(id) on delete cascade,
  approve_same_city boolean not null default false,
  approve_newcomer boolean not null default false,
  approve_age boolean not null default false,
  promote_waitlist boolean not null default false,
  offer_hours integer not null default 3 check (offer_hours between 1 and 24),
  updated_at timestamptz not null default now()
);
create table private.meetup_no_show_rules (
  host_id uuid primary key references public.profiles(id) on delete cascade,
  threshold integer not null check (threshold between 1 and 5),
  updated_at timestamptz not null default now()
);
alter table private.meetup_automation enable row level security;
alter table private.meetup_no_show_rules enable row level security;
revoke all on private.meetup_automation, private.meetup_no_show_rules from public, anon, authenticated, service_role;

create function private.meetup_host_post(p_post_id uuid) returns public.posts
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); event public.posts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  select * into event from public.posts where id=p_post_id and author_id=u and status='published' and room_preview is not null;
  if event.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  return event;
end $$;

create function public.get_meetup_automation(p_post_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare event public.posts:=private.meetup_host_post(p_post_id); a private.meetup_automation; rank integer:=private.meetup_tier_rank(auth.uid());
begin
  select * into a from private.meetup_automation where post_id=event.id;
  return jsonb_build_object('rank',rank,'canAutoApprove',rank>=1,'canPromote',rank>=2,'canNoShowRule',rank>=1,
    'ageRange',event.room_preview ? 'recommendedAgeMin' and event.room_preview ? 'recommendedAgeMax',
    'approve',jsonb_build_object('sameCity',coalesce(a.approve_same_city,false),'newcomer',coalesce(a.approve_newcomer,false),'age',coalesce(a.approve_age,false)),
    'promote',coalesce(a.promote_waitlist,false),'offerHours',coalesce(a.offer_hours,3),
    'noShowThreshold',(select threshold from private.meetup_no_show_rules where host_id=auth.uid()));
end $$;

create function public.set_meetup_auto_approval(p_post_id uuid, p_same_city boolean, p_newcomer boolean, p_age boolean) returns void
language plpgsql security definer set search_path='' as $$
declare event public.posts:=private.meetup_host_post(p_post_id);
begin
  if p_same_city is null or p_newcomer is null or p_age is null then raise exception 'INVALID_RESPONSE'; end if;
  if (p_same_city or p_newcomer or p_age) then perform private.require_meetup_tool_tier(event.author_id,'plus'); end if;
  if p_age and not (event.room_preview ? 'recommendedAgeMin' and event.room_preview ? 'recommendedAgeMax') then raise exception 'AGE_RANGE_REQUIRED'; end if;
  insert into private.meetup_automation(post_id,approve_same_city,approve_newcomer,approve_age) values(event.id,p_same_city,p_newcomer,p_age)
    on conflict(post_id) do update set approve_same_city=excluded.approve_same_city,approve_newcomer=excluded.approve_newcomer,
      approve_age=excluded.approve_age,updated_at=now();
end $$;

create function public.set_meetup_waitlist_promotion(p_post_id uuid, p_on boolean, p_hours integer default 3) returns void
language plpgsql security definer set search_path='' as $$
declare event public.posts:=private.meetup_host_post(p_post_id);
begin
  if p_on is null or p_hours is null or p_hours not between 1 and 24 then raise exception 'INVALID_RESPONSE'; end if;
  if p_on then perform private.require_meetup_tool_tier(event.author_id,'pro'); end if;
  insert into private.meetup_automation(post_id,promote_waitlist,offer_hours) values(event.id,p_on,p_hours)
    on conflict(post_id) do update set promote_waitlist=excluded.promote_waitlist,offer_hours=excluded.offer_hours,updated_at=now();
end $$;

-- null turns the rule off; it covers all of this host's meetups.
create function public.set_meetup_no_show_rule(p_threshold integer) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_threshold is null then delete from private.meetup_no_show_rules where host_id=u; return; end if;
  if p_threshold not between 1 and 5 then raise exception 'INVALID_RESPONSE'; end if;
  perform private.require_meetup_tool_tier(u,'plus');
  insert into private.meetup_no_show_rules(host_id,threshold) values(u,p_threshold)
    on conflict(host_id) do update set threshold=excluded.threshold,updated_at=now();
end $$;

-- 3. Waitlist: plus+ members go first (participant perk); an offer may carry a reply deadline (pro promotion).
alter table private.meetup_waitlist add column offer_expires_at timestamptz;

create function private.meetup_waitlist_priority(p_user uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when private.meetup_tier_rank(p_user)>=1 then 0 else 1 end;
$$;

do $$
declare d text;
begin
  d:=pg_get_functiondef('public.invite_next_meetup_waitlist(uuid)'::regprocedure);
  if strpos(d,'order by w.joined_at,w.id limit 1 for update')=0 then raise exception 'WAITLIST_INVITE_ORDER_CHANGED'; end if;
  execute replace(d,'order by w.joined_at,w.id limit 1 for update','order by private.meetup_waitlist_priority(w.user_id),w.joined_at,w.id limit 1 for update');
  d:=pg_get_functiondef('public.get_meetup_host_tools(uuid)'::regprocedure);
  if strpos(d,'and (other.joined_at,other.id)<=(w.joined_at,w.id)')=0 then raise exception 'WAITLIST_POSITION_CHANGED'; end if;
  execute replace(d,'and (other.joined_at,other.id)<=(w.joined_at,w.id)',
    'and (private.meetup_waitlist_priority(other.user_id),other.joined_at,other.id)<=(private.meetup_waitlist_priority(w.user_id),w.joined_at,w.id)');
end $$;

-- Offers the next free seat to the next eligible waitlisted member. p_hours null = plain invite (no deadline).
create function private.offer_meetup_waitlist(p_post_id uuid, p_hours integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare event public.posts; entry private.meetup_waitlist; free_seats integer; open_offers integer;
begin
  perform private.lock_relationships();
  select * into event from public.posts where id=p_post_id for update;
  if event.id is null or not private.meetup_is_open(event.status,event.room_preview)
    or coalesce(event.room_preview->>'recruitingClosed','false')='true' or not private.is_active_account(event.author_id) then return false; end if;
  free_seats:=coalesce((event.room_preview->>'capacity')::int,8)-1-(select count(*) from public.meetup_requests where post_id=event.id and status='approved');
  select count(*) into open_offers from private.meetup_waitlist w where w.post_id=event.id and w.cancelled_at is null
    and w.invited_at is not null and w.offer_expires_at>clock_timestamp();
  if free_seats-open_offers<1 then return false; end if;
  select * into entry from private.meetup_waitlist w where w.post_id=event.id and w.cancelled_at is null and w.invited_at is null
    and private.meetup_waitlist_eligible(w.post_id,w.user_id)
    order by private.meetup_waitlist_priority(w.user_id),w.joined_at,w.id limit 1 for update;
  if entry.id is null then return false; end if;
  update private.meetup_waitlist set invited_at=clock_timestamp(),
    offer_expires_at=case when p_hours is null then null else clock_timestamp()+make_interval(hours=>p_hours) end where id=entry.id;
  insert into private.meetup_role_audit(post_id,actor_id,action,target_id) values(event.id,event.author_id,'waitlist_invite',entry.user_id);
  perform private.create_notification(entry.user_id,'meetup_request',event.author_id,'post',event.id,
    case when p_hours is null then '기다리던 모임에 자리가 났어요. 지금 신청하면 호스트가 확인해요.'
      else '기다리던 모임에 자리가 났어요. '||p_hours||'시간 안에 신청하면 바로 함께할 수 있어요.' end,'/post/'||event.id::text);
  return true;
end $$;

-- A freed seat goes to the waitlist automatically when the (pro+) host turned promotion on.
create function private.meetup_seat_freed() returns trigger
language plpgsql security definer set search_path='' as $$
declare hours integer;
begin
  select a.offer_hours into hours from private.meetup_automation a join public.posts p on p.id=a.post_id
    where a.post_id=new.post_id and a.promote_waitlist and private.meetup_tier_rank(p.author_id)>=2;
  if hours is not null then
    begin perform private.offer_meetup_waitlist(new.post_id,hours);
    exception when others then null; -- shortcut: a failed offer must never block leaving; the expiry job retries next round.
    end;
  end if;
  return null;
end $$;
create trigger meetup_requests_seat_freed after update of status on public.meetup_requests
  for each row when (old.status='approved' and new.status<>'approved') execute function private.meetup_seat_freed();

-- An unanswered offer lapses and moves to the next person.
create function private.expire_meetup_waitlist_offers() returns integer
language plpgsql security definer set search_path='' as $$
declare entry record; moved integer:=0;
begin
  perform private.lock_relationships();
  for entry in select w.id,w.post_id,a.offer_hours,a.promote_waitlist and private.meetup_tier_rank(p.author_id)>=2 promote
    from private.meetup_waitlist w join public.posts p on p.id=w.post_id left join private.meetup_automation a on a.post_id=w.post_id
    where w.cancelled_at is null and w.invited_at is not null and w.offer_expires_at<=clock_timestamp()
      and not exists(select 1 from public.meetup_requests r where r.post_id=w.post_id and r.requester_id=w.user_id
        and r.status in('pending','approved') and r.created_at>=w.invited_at)
    for update of w skip locked
  loop
    update private.meetup_waitlist set cancelled_at=clock_timestamp() where id=entry.id;
    moved:=moved+1;
    if entry.promote then perform private.offer_meetup_waitlist(entry.post_id,entry.offer_hours); end if;
  end loop;
  return moved;
end $$;

-- 4. Auto-approval: runs at commit so the request, its application and the host notice already exist.
-- It approves through the host's own respond_meetup_request, so every capacity/slot/block check still applies;
-- any refusal leaves the request pending for the host as before.
create function private.auto_approve_meetup_request() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.meetup_requests; p public.posts; rules private.meetup_automation; offered boolean; matched boolean; saved text;
begin
  select * into r from public.meetup_requests where id=new.id;
  if r.status is distinct from 'pending' then return null; end if;
  select * into rules from private.meetup_automation where post_id=r.post_id;
  if rules.post_id is null then return null; end if;
  select * into p from public.posts where id=r.post_id;
  offered:=rules.promote_waitlist and private.meetup_tier_rank(p.author_id)>=2 and exists(select 1 from private.meetup_waitlist w
    where w.post_id=r.post_id and w.user_id=r.requester_id and w.cancelled_at is null and w.invited_at is not null and w.offer_expires_at>clock_timestamp());
  matched:=private.meetup_tier_rank(p.author_id)>=1 and (rules.approve_same_city or rules.approve_newcomer or rules.approve_age)
    and (not rules.approve_same_city or exists(select 1 from public.profiles x where x.id=r.requester_id and x.city_id=p.city_id))
    and (not rules.approve_newcomer or private.newcomer_ends_at(r.requester_id) is not null)
    and (not rules.approve_age or coalesce((select extract(year from age(current_date,i.date_of_birth))::int
      between (p.room_preview->>'recommendedAgeMin')::int and (p.room_preview->>'recommendedAgeMax')::int
      from private.personal_info i where i.user_id=r.requester_id),false));
  if not (offered or coalesce(matched,false)) then return null; end if;
  saved:=current_setting('request.jwt.claims',true);
  begin
    perform set_config('request.jwt.claims',jsonb_build_object('sub',p.author_id,'role','authenticated')::text,true);
    perform public.respond_meetup_request(r.id,'approved');
    perform set_config('request.jwt.claims',coalesce(saved,''),true);
    update public.notifications set body=case when offered then '대기하던 분이 시간 안에 신청해서 바로 승인됐어요.'
      else '자동 승인 조건에 맞는 신청이라 바로 승인됐어요.' end
      where user_id=p.author_id and kind='meetup_request' and target_type='meetup_request' and target_id=r.id;
  exception when others then
    perform set_config('request.jwt.claims',coalesce(saved,''),true);
  end;
  return null;
end $$;
create constraint trigger meetup_requests_auto_approve after insert or update of status on public.meetup_requests
  deferrable initially deferred for each row when (new.status='pending') execute function private.auto_approve_meetup_request();

-- 5. No-show records. A session counts only when its host checked in; a member who said "못 가요" before the start
-- is excused, a member who neither checked in nor was confirmed is a no-show.
create table private.meetup_absences (
  session_id uuid not null references private.meetup_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  kind text not null check (kind in ('no_show','excused')),
  recorded_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index meetup_absences_host_user_idx on private.meetup_absences(host_id,user_id) where kind='no_show';
create table private.meetup_absence_runs (session_id uuid primary key references private.meetup_sessions(id) on delete cascade, ran_at timestamptz not null default now());
alter table private.meetup_absences enable row level security;
alter table private.meetup_absence_runs enable row level security;
revoke all on private.meetup_absences, private.meetup_absence_runs from public, anon, authenticated, service_role;

create function private.record_meetup_absences(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; recorded integer:=0; added integer;
begin
  for s in select x.* from private.meetup_sessions x
    where x.ends_at<=p_now and x.ends_at>p_now-interval '7 days' and not exists(select 1 from private.meetup_absence_runs r where r.session_id=x.id)
    order by x.ends_at limit 200
  loop
    insert into private.meetup_absence_runs(session_id) values(s.id) on conflict do nothing;
    if not exists(select 1 from private.meetup_attendance a where a.session_id=s.id and a.user_id=s.host_id and a.checked_in_at is not null) then continue; end if;
    insert into private.meetup_absences(session_id,user_id,host_id,post_id,kind)
    select s.id,m.user_id,s.host_id,s.post_id,
      case when exists(select 1 from private.meetup_rsvps v where v.post_id=s.post_id and v.user_id=m.user_id and v.starts_at=s.starts_at
        and v.response='not_going' and v.responded_at<s.starts_at) then 'excused' else 'no_show' end
    from (select r.requester_id user_id from public.meetup_requests r where r.post_id=s.post_id and r.status='approved'
            and coalesce(r.responded_at,r.created_at)<s.starts_at
          union select v.user_id from private.meetup_rsvps v where v.post_id=s.post_id and v.starts_at=s.starts_at and v.response='not_going') m
    where m.user_id<>s.host_id and not exists(select 1 from private.meetup_attendance a where a.session_id=s.id and a.user_id=m.user_id
      and (a.checked_in_at is not null or a.confirmed_at is not null))
    on conflict do nothing;
    get diagnostics added=row_count; recorded:=recorded+added;
  end loop;
  return recorded;
end $$;

-- With the host's rule on, a member past the no-show threshold can join this host's meetups only through a waitlist offer.
create function private.guard_meetup_no_show_rule() returns trigger
language plpgsql security definer set search_path='' as $$
declare limit_count integer;
begin
  if new.status<>'pending' or (tg_op='UPDATE' and old.status='pending') then return new; end if;
  select threshold into limit_count from private.meetup_no_show_rules where host_id=new.host_id;
  if limit_count is null or private.meetup_tier_rank(new.host_id)<1 then return new; end if;
  if (select count(*) from private.meetup_absences where host_id=new.host_id and user_id=new.requester_id and kind='no_show')>=limit_count
    and not exists(select 1 from private.meetup_waitlist w where w.post_id=new.post_id and w.user_id=new.requester_id and w.cancelled_at is null
      and w.invited_at is not null and (w.offer_expires_at is null or w.offer_expires_at>clock_timestamp()))
    then raise exception 'MEETUP_WAITLIST_ONLY'; end if;
  return new;
end $$;
create trigger meetup_requests_no_show_rule before insert or update of status on public.meetup_requests
  for each row execute function private.guard_meetup_no_show_rule();

-- 6. Title-only draft: one per meetup draft on free, unlimited regenerations on plus+ (still inside the daily AI cap).
create table private.meetup_title_drafts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  draft_key uuid not null,
  uses integer not null default 1 check (uses >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, draft_key)
);
alter table private.meetup_title_drafts enable row level security;
revoke all on private.meetup_title_drafts from public, anon, authenticated, service_role;

-- shortcut: the key is one meetup-create screen; a modified client could rotate keys, but each draft still spends the daily AI quota.
create function public.reserve_meetup_title_draft(p_draft_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); used integer; rank integer;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_draft_key is null then raise exception 'INVALID_DRAFT_KEY'; end if;
  rank:=private.meetup_tier_rank(u);
  insert into private.meetup_title_drafts(user_id,draft_key) values(u,p_draft_key)
    on conflict(user_id,draft_key) do update set uses=meetup_title_drafts.uses+1 returning uses into used;
  if used>1 and rank<1 then raise exception 'MEETUP_TITLE_DRAFT_PLUS_REQUIRED'; end if;
  return jsonb_build_object('dailyUsed',public.reserve_ai_draft(),'canRegenerate',rank>=1);
end $$;

create function public.release_meetup_title_draft(p_user_id uuid, p_draft_key uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.meetup_title_drafts set uses=uses-1 where user_id=p_user_id and draft_key=p_draft_key and uses>0;
  perform public.release_ai_draft(p_user_id);
end $$;

-- 7. Plus+ members hear about a new meetup first; everyone else gets the usual notice 30 minutes later.
create table private.early_meetup_alerts (post_id uuid primary key references public.posts(id) on delete cascade, sent_at timestamptz not null default now());
alter table private.early_meetup_alerts enable row level security;
revoke all on private.early_meetup_alerts from public, anon, authenticated, service_role;

do $$
declare d text; anchor text:='select q.* from private.discovery_post_queue q';
begin
  d:=pg_get_functiondef('private.process_discovery_posts(integer)'::regprocedure);
  if array_length(string_to_array(d,anchor),1)<>2 then raise exception 'DISCOVERY_QUEUE_ANCHOR_CHANGED'; end if;
  execute replace(d,anchor,anchor||' where not exists(select 1 from public.posts held where held.id=q.post_id
      and held.room_preview is not null and held.created_at>clock_timestamp()-interval ''30 minutes'')');
end $$;

create function private.send_early_meetup_alerts() returns integer
language plpgsql security definer set search_path='' as $$
declare post public.posts; sent integer:=0; added integer;
begin
  for post in select p.* from public.posts p
    where p.room_preview is not null and p.created_at>clock_timestamp()-interval '30 minutes'
      and private.meetup_is_open(p.status,p.room_preview) and private.is_active_account(p.author_id)
      and not exists(select 1 from private.early_meetup_alerts e where e.post_id=p.id)
      and not exists(select 1 from auth.users a where a.id=p.author_id
        and (a.email like '%@seed.gling.invalid' or a.raw_app_meta_data->'review_access'='true'::jsonb))
    order by p.created_at limit 20
  loop
    insert into private.early_meetup_alerts(post_id) values(post.id);
    -- Same rows and copy as process_discovery_posts; its later pass skips these through notifications_discovery_once_idx.
    insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
    select prefs.user_id,case when match.interested then 'interest_post' else 'nearby_meetup' end,post.author_id,'post',post.id,
      case when match.interested then '관심 있는 주제에 새 글이 올라왔어요. 한번 읽어볼까요?' else '우리 동네에 새 모임이 생겼어요. 어떤 모임인지 볼까요?' end,
      '/post/'||post.id::text
    from public.notification_preferences prefs
    join public.profiles recipient on recipient.id=prefs.user_id and recipient.city_id=post.city_id and recipient.account_status='active'
    cross join lateral (select prefs.interests and (post.tag_id=any(prefs.interest_tag_ids) or exists (
      select 1 from unnest(post.hashtags) hashtag where lower(private.canonicalize_hashtag(hashtag))=any(prefs.interest_hashtags)
    )) interested) match
    where (prefs.interests or prefs.nearby) and prefs.user_id<>post.author_id and (match.interested or prefs.nearby)
      and private.meetup_tier_rank(prefs.user_id)>=1
    on conflict do nothing;
    get diagnostics added=row_count; sent:=sent+added;
  end loop;
  return sent;
end $$;

-- 8. Empty meetups: no request 48 hours before start -> one suggestion to the host; none by the start -> off the list.
-- Nothing here creates requests or members; empty seats are never filled automatically.
create table private.meetup_empty_nudges (post_id uuid primary key references public.posts(id) on delete cascade, sent_at timestamptz not null default now());
alter table private.meetup_empty_nudges enable row level security;
revoke all on private.meetup_empty_nudges from public, anon, authenticated, service_role;

create function private.tidy_empty_meetups(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare event public.posts; changed integer:=0; closed integer;
begin
  perform private.lock_relationships();
  for event in select p.* from public.posts p
    where p.room_preview->>'eventKind'='once' and private.meetup_is_open(p.status,p.room_preview)
      and (p.room_preview->>'startsAt')::timestamptz between p_now and p_now+interval '48 hours'
      and p.created_at<=p_now-interval '6 hours' and private.is_active_account(p.author_id)
      and not exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.status in('pending','approved'))
      and not exists(select 1 from private.meetup_empty_nudges n where n.post_id=p.id)
      and not exists(select 1 from auth.users a where a.id=p.author_id
        and (a.email like '%@seed.gling.invalid' or a.raw_app_meta_data->'review_access'='true'::jsonb))
  loop
    insert into private.meetup_empty_nudges(post_id) values(event.id);
    perform private.create_notification(event.author_id,'meetup_host_tip',null,'post',event.id,
      left(event.title,60)||case when event.room_preview->>'newcomerWelcome'='true'
        then ' 모임에 아직 신청이 없어요. 날짜를 바꿔 보는 건 어때요?'
        else ' 모임에 아직 신청이 없어요. 날짜를 바꾸거나 ''처음 와도 돼요''를 켜 보세요.' end,'/post/'||event.id::text);
    changed:=changed+1;
  end loop;
  update public.posts p set room_preview=room_preview||'{"closed":true,"closedEmpty":true}'::jsonb
    where p.room_preview->>'eventKind'='once' and private.meetup_is_open(p.status,p.room_preview)
      and (p.room_preview->>'startsAt')::timestamptz<=p_now
      and not exists(select 1 from public.meetup_requests r where r.post_id=p.id and r.status in('pending','approved'));
  get diagnostics closed=row_count;
  return changed+closed;
end $$;

-- Account deletion: the new private rows go with the account (FK cascades cover profile deletion; soft erasure runs this).
create function private.purge_meetup_convenience_account_data(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  delete from private.meetup_rsvps where user_id=p_user_id;
  delete from private.meetup_title_drafts where user_id=p_user_id;
  delete from private.meetup_no_show_rules where host_id=p_user_id;
  delete from private.meetup_absences where user_id=p_user_id or host_id=p_user_id;
end $$;
do $$
declare definition text; anchor text:='perform private.purge_meetup_tool_account_data(current_user_id);';
begin
  definition:=pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MEETUP_CONVENIENCE_PURGE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' perform private.purge_meetup_convenience_account_data(current_user_id);');
end $$;

revoke all on function private.meetup_tier_rank(uuid), private.meetup_next_start(public.posts), private.meetup_host_post(uuid),
  private.meetup_waitlist_priority(uuid), private.offer_meetup_waitlist(uuid,integer), private.meetup_seat_freed(),
  private.expire_meetup_waitlist_offers(), private.auto_approve_meetup_request(), private.record_meetup_absences(timestamptz),
  private.guard_meetup_no_show_rule(), private.send_early_meetup_alerts(), private.tidy_empty_meetups(timestamptz),
  private.purge_meetup_convenience_account_data(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_meetup_rsvp(uuid), public.set_meetup_rsvp(uuid,boolean,boolean), public.get_meetup_automation(uuid),
  public.set_meetup_auto_approval(uuid,boolean,boolean,boolean), public.set_meetup_waitlist_promotion(uuid,boolean,integer),
  public.set_meetup_no_show_rule(integer), public.reserve_meetup_title_draft(uuid), public.release_meetup_title_draft(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_meetup_rsvp(uuid), public.set_meetup_rsvp(uuid,boolean,boolean), public.get_meetup_automation(uuid),
  public.set_meetup_auto_approval(uuid,boolean,boolean,boolean), public.set_meetup_waitlist_promotion(uuid,boolean,integer),
  public.set_meetup_no_show_rule(integer), public.reserve_meetup_title_draft(uuid) to authenticated;
grant execute on function public.release_meetup_title_draft(uuid,uuid) to service_role;

select cron.schedule('gling-meetup-convenience','* * * * *',$job$ select private.send_early_meetup_alerts(); select private.expire_meetup_waitlist_offers(); $job$);
select cron.schedule('gling-meetup-tidy','*/10 * * * *',$job$ select private.record_meetup_absences(); select private.tidy_empty_meetups(); $job$);

insert into private.behavior_targets(id) values
 ('meetup.rsvp.going'),('meetup.rsvp.not_going'),('meetup.rsvp.release'),('meetup.rsvp.retry'),
 ('meetup.automation.same_city.on'),('meetup.automation.same_city.off'),('meetup.automation.newcomer.on'),('meetup.automation.newcomer.off'),
 ('meetup.automation.age.on'),('meetup.automation.age.off'),('meetup.automation.promote.on'),('meetup.automation.promote.off'),
 ('meetup.automation.no_show.on'),('meetup.automation.no_show.off'),('meetup.automation.hours'),('meetup.automation.threshold'),
 ('meetup.automation.membership'),('meetup.automation.retry'),
 ('meetup-create.title-draft'),('meetup-create.title-draft.membership'),('meetup-create.place.pick'),('meetup-create.place.clear'),
 ('notifications.meetup-rsvp')
on conflict do nothing;
notify pgrst,'reload schema';
