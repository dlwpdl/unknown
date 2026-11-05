-- 동네 말풍선 지도 (owner 2026-11-05, docs/ideas/live-map-2026-11-05.md): one 40-character bubble per member at their own place,
-- 👋 손 흔들기 (1 per bubble, 20 a day), chat requests (5 a day) that open the existing 1:1 chat, hide after 3 reports.
-- First the analytics targets for the live-map controls.
insert into private.behavior_targets(id) values
('livemap.filter'),('livemap.dock'),('livemap.dev'),('livemap.bar'),('livemap.end'),('livemap.extend'),('livemap.far'),('livemap.banner'),
('livemap.compose'),('livemap.compose.next'),('livemap.preview'),('livemap.post'),('livemap.profile'),('livemap.chat'),
('livemap.request'),('livemap.request.send'),('livemap.request.cancel'),('livemap.wave'),('livemap.wave.reply'),
('livemap.received'),('livemap.received.accept'),('livemap.received.decline')
on conflict do nothing;

-- Privacy: the phone's place never reaches the server. The app keeps a member's bubble within 100 m of it and sends a point on the
-- ~100 m grid (3 decimals), which the server rounds again before saving, so even a pin dragged to the edge of the circle says nothing
-- finer about home (security review 2026-11-05 F1, F7). The speed check compares shown points. Bubbles are deleted 7 days after they go down.
-- Known and left for now (same review): the daily counts follow the bubble's city day (R1); any member can open any city's map (R2);
-- visibility reads ended_at, which every hiding path also sets (R4); 1시간 더 can be pressed again and again (R5); accepting two
-- requests within 30 seconds hits start_conversation's wait (R6); the phone reports its own place, so faking it can't be stopped here (R7).
create table private.live_bubbles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  city_id text not null references public.cities(id),
  body text not null check (char_length(body) between 1 and 40 and body = btrim(body)),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  audience text not null check (audience in ('city','friends')),
  kind text not null default 'member' check (kind in ('member','pin')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at),
  ended_at timestamptz,
  hidden_at timestamptz
);
-- One bubble per person: posting again ends the old one first.
create unique index live_bubbles_one_open on private.live_bubbles(author_id) where ended_at is null;
create index live_bubbles_city_open on private.live_bubbles(city_id, expires_at) where ended_at is null;
create index live_bubbles_author_recent on private.live_bubbles(author_id, created_at desc);

-- A chat request to someone's bubble, or the owner's answer to a wave (wave_reply: sender is the owner, recipient the waver).
create table private.live_bubble_requests (
  id uuid primary key default gen_random_uuid(),
  bubble_id uuid not null references private.live_bubbles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  greeting smallint check (greeting between 0 and 2),
  wave_reply boolean not null default false,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (bubble_id, sender_id, recipient_id),
  check (sender_id <> recipient_id),
  check (wave_reply or greeting is not null)
);
create index live_bubble_requests_recipient on private.live_bubble_requests(recipient_id, created_at desc);

-- 👋 Only the bubble's owner ever reads who waved; nobody sees a count.
create table private.live_bubble_waves (
  id uuid primary key default gen_random_uuid(),
  bubble_id uuid not null references private.live_bubbles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (bubble_id, sender_id)
);

-- Daily counts in the city's own day: 5 chat requests and 20 waves, counted when sent and never refunded.
create table private.live_bubble_quota (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  requests smallint not null default 0 check (requests between 0 and 5),
  waves smallint not null default 0 check (waves between 0 and 20),
  primary key (user_id, day)
);

do $$ declare t text; begin
 foreach t in array array['live_bubbles','live_bubble_requests','live_bubble_waves','live_bubble_quota'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('alter table private.%I owner to postgres',t);
 end loop;
end $$;

create function private.live_distance_m(p_lat1 double precision,p_lon1 double precision,p_lat2 double precision,p_lon2 double precision)
returns double precision language sql immutable set search_path='' as $$
  select 2*6371008.8*asin(least(1,sqrt(power(sin(radians(p_lat2-p_lat1)/2),2)
    +cos(radians(p_lat1))*cos(radians(p_lat2))*power(sin(radians(p_lon2-p_lon1)/2),2))))
$$;

create function private.live_day(p_city_id text) returns date
language sql stable security definer set search_path='' as $$
  select (now() at time zone coalesce((select c.timezone from public.cities c where c.id=p_city_id),'America/Vancouver'))::date
$$;

create function private.live_person(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'nickname',p.nickname::text,'trustLevel',least(greatest(coalesce(p.verification_level,1),1),3))
  from public.profiles p where p.id=p_user
$$;

-- Who may see (and so wave at or ask) a bubble: never a blocked pair, an operated character, an inactive account,
-- a bubble or person the viewer reported, or a friends-only bubble of a non-friend.
create function private.live_bubble_visible(p_bubble_id uuid,p_viewer uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.live_bubbles b where b.id=p_bubble_id and b.ended_at is null and b.expires_at>now()
    and (b.author_id=p_viewer or (
      private.is_active_account(p_viewer) and private.is_active_account(b.author_id)
      and not private.is_blocked_between(p_viewer,b.author_id)
      and not private.is_operated_character(b.author_id)
      and not private.has_reported(p_viewer,'live_bubble',b.id) and not private.has_reported(p_viewer,'user',b.author_id)
      and (b.audience='city' or private.are_friends(b.author_id,p_viewer)))))
$$;

-- A person on someone's sheet (a sender or a waver) stays only while the pair could still meet.
create function private.live_pair_ok(p_viewer uuid,p_other uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_active_account(p_other) and not private.is_blocked_between(p_viewer,p_other) and not private.is_operated_character(p_other)
    and not private.has_reported(p_viewer,'user',p_other)
$$;

create function private.live_bubble_json(b private.live_bubbles,p_viewer uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',b.id,
    -- A pin speaks for Gling, so it never names the admin account behind it.
    'author',case when b.kind='pin' then jsonb_build_object('id','gling','nickname','글링','trustLevel',3) else private.live_person(b.author_id) end,
    'body',b.body,'latitude',b.latitude,'longitude',b.longitude,'audience',b.audience,'kind',b.kind,'createdAt',b.created_at,'expiresAt',b.expires_at,
    'sent',(select jsonb_build_object('id',r.id,'status',r.status,'greeting',r.greeting,'conversationId',r.conversation_id)
      from private.live_bubble_requests r where r.bubble_id=b.id and r.sender_id=p_viewer and not r.wave_reply),
    'waved',exists(select 1 from private.live_bubble_waves w where w.bubble_id=b.id and w.sender_id=p_viewer))
$$;

create function private.assert_live_member(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(p_user);
  if private.is_operated_character(p_user) then raise exception 'PERSONA_NOT_ALLOWED'; end if;
end $$;

create function public.get_live_map(p_city_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); mine private.live_bubbles; used private.live_bubble_quota;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  if not exists(select 1 from public.cities where id=p_city_id) then raise exception 'INVALID_CITY'; end if;
  select * into mine from private.live_bubbles b where b.author_id=uid and b.ended_at is null and b.expires_at>now();
  select * into used from private.live_bubble_quota q where q.user_id=uid and q.day=private.live_day(p_city_id);
  return jsonb_build_object(
    'bubbles',coalesce((select jsonb_agg(private.live_bubble_json(b,uid) order by b.created_at desc) from (
      select b.* from private.live_bubbles b where b.city_id=p_city_id and b.author_id<>uid and b.ended_at is null and b.expires_at>now()
        and private.live_bubble_visible(b.id,uid) order by b.created_at desc limit 300) b),'[]'::jsonb),
    'mine',case when mine.id is null then null else private.live_bubble_json(mine,uid) end,
    'received',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'bubbleId',r.bubble_id,'bubbleBody',b.body,'sender',private.live_person(r.sender_id),
        'greeting',coalesce(r.greeting,0),'waveReply',r.wave_reply,'status',r.status,'createdAt',r.created_at,'conversationId',r.conversation_id) order by r.created_at desc)
      from private.live_bubble_requests r join private.live_bubbles b on b.id=r.bubble_id
      where r.recipient_id=uid and b.ended_at is null and b.expires_at>now() and private.live_pair_ok(uid,r.sender_id)),'[]'::jsonb),
    'waves',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'sender',private.live_person(w.sender_id),'createdAt',w.created_at,
        'reply',(select jsonb_build_object('id',r.id,'status',r.status,'greeting',0,'conversationId',r.conversation_id) from private.live_bubble_requests r
          where r.bubble_id=w.bubble_id and r.sender_id=uid and r.recipient_id=w.sender_id and r.wave_reply)) order by w.created_at desc)
      from private.live_bubble_waves w where w.bubble_id=mine.id and private.live_pair_ok(uid,w.sender_id)),'[]'::jsonb),
    'requestLimit',5,'requestsLeft',5-coalesce(used.requests,0),'wavesLeft',20-coalesce(used.waves,0));
end $$;

create function public.post_live_bubble(p_city_id text,p_body text,p_audience text,p_minutes integer,p_latitude double precision,p_longitude double precision,
  p_kind text default 'member')
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); admin boolean; body text:=btrim(coalesce(p_body,'')); last private.live_bubbles; lat double precision:=p_latitude; lon double precision:=p_longitude;
  meters double precision; hours double precision; new_id uuid;
begin
  perform private.assert_live_member(uid);
  -- An admin right now, signed in with the second step; once having been one is not enough to place 글링 pins anywhere.
  admin:=private.is_admin();
  if char_length(body) not between 1 and 40 then raise exception 'INVALID_BODY'; end if;
  perform private.assert_content_allowed(body);
  if p_audience not in ('city','friends') or p_minutes not in (30,60,180) or p_kind not in ('member','pin') then raise exception 'INVALID_BUBBLE'; end if;
  if p_kind='pin' and not admin then raise exception 'ADMIN_REQUIRED'; end if;
  if not exists(select 1 from public.cities where id=p_city_id) then raise exception 'INVALID_CITY'; end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'INVALID_BUBBLE'; end if;
  -- A member's bubble sits on the ~100 m grid whatever the app sent; a 글링 pin keeps the exact spot the admin chose.
  if p_kind='member' then lat:=round(p_latitude::numeric,3)::double precision; lon:=round(p_longitude::numeric,3)::double precision; end if;
  if not admin then
    select * into last from private.live_bubbles b where b.author_id=uid order by b.created_at desc limit 1;
    if last.id is not null then
      -- Back in the last point's cell or one next to it: keep that point, so someone living near a grid line never shows two points by turns.
      if abs(last.latitude-lat)<=0.0011 and abs(last.longitude-lon)<=0.0011 then lat:=last.latitude; lon:=last.longitude; end if;
      meters:=private.live_distance_m(last.latitude,last.longitude,lat,lon);
      hours:=greatest(extract(epoch from now()-last.created_at)/3600,1/3600.0);
      -- Small hops are GPS noise; within an hour nobody covers ground faster than 200 km/h, and nobody ever faster than a plane.
      if meters>2000 and meters/1000/hours>(case when hours<1 then 200 else 1000 end) then raise exception 'LOCATION_UNAVAILABLE'; end if;
    end if;
  end if;
  perform private.enforce_rate_limit('live_bubble_post',30,interval '1 day');
  update private.live_bubbles set ended_at=now() where author_id=uid and ended_at is null;
  insert into private.live_bubbles(author_id,city_id,body,latitude,longitude,audience,kind,expires_at)
    values(uid,p_city_id,body,lat,lon,p_audience,p_kind,now()+make_interval(mins=>p_minutes)) returning id into new_id;
  return new_id;
end $$;

create function public.end_live_bubble() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update private.live_bubbles set ended_at=now() where author_id=auth.uid() and ended_at is null;
end $$;

-- 1시간 더 띄우기: never more than 3 hours from now.
create function public.extend_live_bubble() returns timestamptz
language plpgsql security definer set search_path='' as $$
declare until timestamptz;
begin
  perform private.assert_live_member(auth.uid());
  update private.live_bubbles set expires_at=least(expires_at+interval '1 hour',now()+interval '3 hours')
    where author_id=auth.uid() and ended_at is null and expires_at>now() returning expires_at into until;
  if until is null then raise exception 'BUBBLE_GONE'; end if;
  return until;
end $$;

-- Counted at once and never given back (a cancel or a decline keeps the count).
create function private.use_live_quota(p_user uuid,p_city_id text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare counted smallint; d date:=private.live_day(p_city_id);
begin
  if p_kind='request' then
    insert into private.live_bubble_quota as q(user_id,day,requests) values(p_user,d,1)
      on conflict(user_id,day) do update set requests=q.requests+1 where q.requests<5 returning requests into counted;
    if counted is null then raise exception 'REQUEST_LIMIT'; end if;
  else
    insert into private.live_bubble_quota as q(user_id,day,waves) values(p_user,d,1)
      on conflict(user_id,day) do update set waves=q.waves+1 where q.waves<20 returning waves into counted;
    if counted is null then raise exception 'WAVE_LIMIT'; end if;
  end if;
end $$;

create function public.send_live_bubble_request(p_bubble_id uuid,p_greeting integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); b private.live_bubbles; new_id uuid; nickname text;
begin
  perform private.assert_live_member(uid);
  if p_greeting is null or p_greeting not between 0 and 2 then raise exception 'INVALID_GREETING'; end if;
  select * into b from private.live_bubbles where id=p_bubble_id for update;
  if b.id is null or b.author_id=uid or not private.live_bubble_visible(b.id,uid) then raise exception 'BUBBLE_GONE'; end if;
  if b.kind='pin' then raise exception 'NOT_ALLOWED'; end if;
  if exists(select 1 from private.live_bubble_requests r where r.bubble_id=b.id and r.sender_id=uid and r.recipient_id=b.author_id) then raise exception 'ALREADY_SENT'; end if;
  perform private.use_live_quota(uid,b.city_id,'request');
  insert into private.live_bubble_requests(bubble_id,sender_id,recipient_id,greeting) values(b.id,uid,b.author_id,p_greeting) returning id into new_id;
  select p.nickname::text into nickname from public.profiles p where p.id=uid;
  perform private.create_notification(b.author_id,'live_bubble_request',uid,'user',uid,
    coalesce(nickname,'이웃')||'님이 말풍선을 보고 대화를 신청했어요.','/discover?bubbleRequest='||new_id::text);
  return new_id;
end $$;

create function public.cancel_live_bubble_request(p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from private.live_bubble_requests where id=p_request_id and sender_id=auth.uid() and status='pending';
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
end $$;

-- Accepting opens the existing 1:1 chat through start_conversation; a decline tells the sender nothing more than the status.
create function public.respond_live_bubble_request(p_request_id uuid,p_response text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r private.live_bubble_requests; conversation uuid; nickname text;
begin
  perform private.assert_live_member(uid);
  if p_response not in ('accepted','declined') then raise exception 'INVALID_RESPONSE'; end if;
  select * into r from private.live_bubble_requests where id=p_request_id and recipient_id=uid for update;
  if r.id is null or r.status<>'pending' or not private.live_pair_ok(uid,r.sender_id) then raise exception 'REQUEST_NOT_FOUND'; end if;
  if not exists(select 1 from private.live_bubbles b where b.id=r.bubble_id and b.ended_at is null and b.expires_at>now()) then raise exception 'BUBBLE_GONE'; end if;
  if p_response='declined' then
    update private.live_bubble_requests set status='declined',responded_at=now() where id=r.id;
    return null;
  end if;
  conversation:=public.start_conversation(r.sender_id,null);
  update private.live_bubble_requests set status='accepted',responded_at=now(),conversation_id=conversation where id=r.id;
  select p.nickname::text into nickname from public.profiles p where p.id=uid;
  perform private.create_notification(r.sender_id,'live_bubble_accepted',uid,'user',uid,
    coalesce(nickname,'이웃')||'님이 대화 신청을 받았어요. 지금 이야기해 보세요.','/chat?conversationId='||conversation::text);
  return conversation;
end $$;

create function public.wave_live_bubble(p_bubble_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); b private.live_bubbles; new_id uuid; nickname text;
begin
  perform private.assert_live_member(uid);
  select * into b from private.live_bubbles where id=p_bubble_id for update;
  if b.id is null or b.author_id=uid or not private.live_bubble_visible(b.id,uid) then raise exception 'BUBBLE_GONE'; end if;
  if b.kind='pin' then raise exception 'NOT_ALLOWED'; end if;
  if exists(select 1 from private.live_bubble_waves w where w.bubble_id=b.id and w.sender_id=uid) then raise exception 'ALREADY_WAVED'; end if;
  perform private.use_live_quota(uid,b.city_id,'wave');
  insert into private.live_bubble_waves(bubble_id,sender_id) values(b.id,uid) returning id into new_id;
  select p.nickname::text into nickname from public.profiles p where p.id=uid;
  -- Same bell row and setting as a like (설정 › 좋아요 turns it off).
  perform private.create_notification(b.author_id,'live_bubble_wave',uid,'user',uid,coalesce(nickname,'이웃')||'님이 손을 흔들었어요.','/discover');
  return new_id;
end $$;

-- The owner answers a wave with a chat request: one of the owner's five a day.
create function public.reply_live_bubble_wave(p_wave_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); w private.live_bubble_waves; b private.live_bubbles; new_id uuid; nickname text;
begin
  perform private.assert_live_member(uid);
  select * into w from private.live_bubble_waves where id=p_wave_id;
  select * into b from private.live_bubbles where id=w.bubble_id for update;
  if w.id is null or b.author_id is distinct from uid or b.ended_at is not null or b.expires_at<=now() or not private.live_pair_ok(uid,w.sender_id) then raise exception 'BUBBLE_GONE'; end if;
  if exists(select 1 from private.live_bubble_requests r where r.bubble_id=b.id and r.sender_id=uid and r.recipient_id=w.sender_id) then raise exception 'ALREADY_SENT'; end if;
  perform private.use_live_quota(uid,b.city_id,'request');
  insert into private.live_bubble_requests(bubble_id,sender_id,recipient_id,wave_reply) values(b.id,uid,w.sender_id,true) returning id into new_id;
  select p.nickname::text into nickname from public.profiles p where p.id=uid;
  perform private.create_notification(w.sender_id,'live_bubble_request',uid,'user',uid,
    coalesce(nickname,'이웃')||'님이 손 흔들기에 답해 대화를 신청했어요.','/discover?bubbleRequest='||new_id::text);
  return new_id;
end $$;

-- A bubble that goes down (ended, replaced, hidden or expired) takes its waves and unanswered requests with it.
create function private.live_bubble_went_down() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from private.live_bubble_waves where bubble_id=new.id;
  delete from private.live_bubble_requests where bubble_id=new.id and status='pending';
  return new;
end $$;
create trigger live_bubbles_down after update of ended_at on private.live_bubbles
  for each row when (old.ended_at is null and new.ended_at is not null) execute function private.live_bubble_went_down();

-- Reports from three different people take a bubble down at once. Only accounts signed up 7 or more days ago count, so a few fresh
-- sign-ups can't keep taking someone's bubble down; every report, newer accounts' too, still waits for an admin in the report queue.
create function private.hide_reported_live_bubble() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (select count(distinct r.reporter_id) from public.reports r join auth.users u on u.id=r.reporter_id
      where r.target_type='live_bubble' and r.target_id=new.target_id and u.created_at<=now()-interval '7 days')>=3 then
    update private.live_bubbles set hidden_at=coalesce(hidden_at,now()),ended_at=coalesce(ended_at,now()) where id=new.target_id;
  end if;
  return new;
end $$;
create trigger reports_hide_live_bubble after insert on public.reports
  for each row when (new.target_type='live_bubble') execute function private.hide_reported_live_bubble();

create function private.tidy_live_bubbles() returns void
language sql security definer set search_path='' as $$
  update private.live_bubbles set ended_at=expires_at where ended_at is null and expires_at<=now();
  delete from private.live_bubbles where ended_at<now()-interval '7 days';
  delete from private.live_bubble_quota where day<current_date-2;
$$;
select cron.schedule('gling-live-bubbles-tidy','*/10 * * * *',$job$ select private.tidy_live_bubbles(); $job$);

-- ADR-0001: every bubble line goes through the safety review queue and the watch-term scan like posts do.
create function private.live_bubble_safety_content(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('authorId',b.author_id,'cityId',b.city_id,'audience',b.audience,'createdAt',b.created_at,
    'text',concat_ws(E'\n','동네 말풍선 · 보는 사람: '||case b.audience when 'friends' then '친구만' else '도시 전체' end,b.body))
  from private.live_bubbles b where b.id=p_id
$$;
create function public.get_live_bubble_safety_content(p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return private.live_bubble_safety_content(p_target_id);
end $$;
create function public.get_admin_live_bubble_content(p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare content jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  content:=private.live_bubble_safety_content(p_target_id);
  if content is null then raise exception 'TARGET_NOT_FOUND'; end if;
  perform public.log_admin_access('safety',(content->>'authorId')::uuid,p_target_id);
  return content;
end $$;

-- Extend the saved report, safety and notification contracts instead of replacing their newer branches.
do $$
declare tbl text; definition text; anchor text;
begin
  foreach tbl in array array['reports','safety_review_queue','safety_alerts','notifications'] loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||tbl)::regclass and conname=tbl||'_target_type_check';
    if definition is null or left(definition,7)<>'CHECK (' then raise exception 'LIVE_TARGET_CONSTRAINT_CHANGED: %',tbl; end if;
    execute format('alter table public.%I drop constraint %I',tbl,tbl||'_target_type_check');
    execute format('alter table public.%I add constraint %I check ((%s) or target_type=''live_bubble'')',tbl,tbl||'_target_type_check',substring(definition from 8 for char_length(definition)-8));
  end loop;

  definition:=pg_get_functiondef('public.create_report(text,uuid,text,text)'::regprocedure); anchor:='else raise exception ''INVALID_TARGET_TYPE'';';
  if strpos(definition,anchor)=0 then raise exception 'LIVE_REPORT_CHANGED'; end if;
  execute replace(definition,anchor,$branch$
    when 'live_bubble' then select b.author_id into target_user_id from private.live_bubbles b
      where b.id=target_id and (private.is_admin() or private.live_bubble_visible(b.id,current_user_id));
    $branch$||anchor);
  definition:=pg_get_functiondef('private.capture_report_evidence()'::regprocedure); anchor:='case new.target_type';
  if strpos(definition,anchor)=0 then raise exception 'LIVE_REPORT_EVIDENCE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$
    when 'live_bubble' then select to_jsonb(b)-'latitude'-'longitude' into new.evidence from private.live_bubbles b where b.id=new.target_id;
  $branch$);
  definition:=pg_get_functiondef('public.moderate_report(uuid,text,text)'::regprocedure); anchor:='case report.target_type';
  if strpos(definition,anchor)=0 then raise exception 'LIVE_REPORT_MODERATION_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$branch$ when 'live_bubble' then update private.live_bubbles set hidden_at=coalesce(hidden_at,now()),ended_at=coalesce(ended_at,now()) where id=report.target_id; $branch$);

  definition:=pg_get_functiondef('private.enqueue_safety_review()'::regprocedure);
  anchor:='when ''chilling_applications'' then ''chilling_application''';
  if strpos(definition,anchor)=0 then raise exception 'LIVE_SAFETY_QUEUE_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''live_bubbles'' then ''live_bubble''');
  definition:=pg_get_functiondef('private.scan_watch_terms()'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'LIVE_WATCH_TERMS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''live_bubbles'' then ''live_bubble''');
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure); anchor:='case p_target_type';
  if strpos(definition,anchor)=0 then raise exception 'LIVE_NOTIFICATION_TARGET_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' when ''live_bubble'' then private.is_admin_id(p_user_id) ');
  definition:=pg_get_functiondef('public.export_admin_safety_evidence(bigint)'::regprocedure);
  anchor:='when ''post'' then (select to_jsonb(p) from public.posts p where p.id = a.target_id)';
  if strpos(definition,anchor)=0 then raise exception 'LIVE_SAFETY_EVIDENCE_CHANGED'; end if;
  execute replace(definition,anchor,'when ''live_bubble'' then private.live_bubble_safety_content(a.target_id) '||anchor);

  -- Requests use the bell like friend requests; a wave behaves like a like and follows 설정 › 좋아요.
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.notifications'::regclass and conname='notifications_kind_check';
  if definition is null or definition not like 'CHECK (%' or definition like '%live_bubble%' then raise exception 'LIVE_NOTIFICATION_KIND_CHANGED'; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '||
    replace(definition,'CHECK (','CHECK (kind = ''live_bubble_request'' or kind = ''live_bubble_accepted'' or kind = ''live_bubble_wave'' or ');
  definition:=pg_get_functiondef('private.notification_category(text,text)'::regprocedure); anchor:='when ''message_reaction'' then ''messages''';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'LIVE_NOTIFICATION_CATEGORY_CHANGED'; end if;
  execute replace(definition,anchor,'when ''live_bubble_request'' then ''direct_requests'' when ''live_bubble_accepted'' then ''direct_requests'' when ''live_bubble_wave'' then ''post_likes'' '||anchor);
end $$;

create trigger live_bubbles_safety_review after insert on private.live_bubbles for each row execute function private.enqueue_safety_review();
create trigger live_bubbles_watch_terms after insert on private.live_bubbles for each row execute function private.scan_watch_terms();

do $$ declare signature text; begin
 foreach signature in array array['private.live_distance_m(double precision,double precision,double precision,double precision)','private.live_day(text)',
  'private.live_person(uuid)','private.live_bubble_visible(uuid,uuid)','private.live_pair_ok(uuid,uuid)','private.live_bubble_json(private.live_bubbles,uuid)',
  'private.assert_live_member(uuid)','private.use_live_quota(uuid,text,text)','private.live_bubble_went_down()','private.hide_reported_live_bubble()',
  'private.tidy_live_bubbles()','private.live_bubble_safety_content(uuid)','public.get_live_bubble_safety_content(uuid)','public.get_admin_live_bubble_content(uuid)',
  'public.get_live_map(text)','public.post_live_bubble(text,text,text,integer,double precision,double precision,text)',
  'public.end_live_bubble()','public.extend_live_bubble()','public.send_live_bubble_request(uuid,integer)','public.cancel_live_bubble_request(uuid)',
  'public.respond_live_bubble_request(uuid,text)','public.wave_live_bubble(uuid)','public.reply_live_bubble_wave(uuid)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.get_live_map(text),
  public.post_live_bubble(text,text,text,integer,double precision,double precision,text),
  public.end_live_bubble(),public.extend_live_bubble(),public.send_live_bubble_request(uuid,integer),public.cancel_live_bubble_request(uuid),
  public.respond_live_bubble_request(uuid,text),public.wave_live_bubble(uuid),public.reply_live_bubble_wave(uuid),public.get_admin_live_bubble_content(uuid) to authenticated;
grant execute on function public.get_live_bubble_safety_content(uuid) to service_role;
notify pgrst,'reload schema';
