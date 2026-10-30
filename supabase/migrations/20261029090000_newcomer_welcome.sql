-- Newcomer welcome (owner 2026-10-29, mockup output/design/gling-newcomer-welcome-20261029).
-- Additive only: released apps ignore the new room_preview keys and never call the new RPCs.
-- Meetup labels live in room_preview: newcomerWelcome (host switch) and newcomerOnly (needs newcomerWelcome).

-- 1. One operator value: the newcomer period after sign-up. Change it without an app release:
--    update private.newcomer_config set period_days = 30, updated_at = now();
create table private.newcomer_config (
  id boolean primary key default true check (id),
  period_days integer not null default 60 check (period_days between 1 and 365),
  nudges_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
revoke all on private.newcomer_config from public, anon, authenticated;
insert into private.newcomer_config (id) values (true);

-- End of p_user's newcomer period; null once the period is over (or no profile).
create function private.newcomer_ends_at(p_user uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select r.created_at + make_interval(days => c.period_days)
  from public.profiles r cross join private.newcomer_config c
  where r.id = p_user and c.id and r.created_at + make_interval(days => c.period_days) > now();
$$;

-- 2. Newcomer-only meetups refuse requests from members past their period, whichever RPC inserts them.
create function private.guard_meetup_newcomers_only() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='pending' and (tg_op='INSERT' or old.status is distinct from 'pending')
    and exists(select 1 from public.posts where id=new.post_id and room_preview->>'newcomerOnly'='true')
    and private.newcomer_ends_at(new.requester_id) is null
    then raise exception 'MEETUP_NEWCOMERS_ONLY'; end if;
  return new;
end $$;
create trigger meetup_requests_newcomers_only before insert or update of status on public.meetup_requests
  for each row execute function private.guard_meetup_newcomers_only();

-- 3. Host switch. Turning the welcome off also turns newcomer-only off.
create function public.set_meetup_newcomer(p_post_id uuid, p_welcome boolean, p_only boolean)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); meetup public.posts;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  if p_welcome is null or p_only is null or (p_only and not p_welcome) then raise exception 'INVALID_NEWCOMER_OPTION'; end if;
  perform private.lock_relationships();
  select * into meetup from public.posts where id=p_post_id and author_id=u and status='published' and room_preview is not null for update;
  if meetup.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
  if not private.meetup_is_open(meetup.status,meetup.room_preview) then raise exception 'MEETUP_CLOSED'; end if;
  update public.posts set room_preview=(room_preview-'newcomerWelcome'-'newcomerOnly')
    ||case when p_welcome then '{"newcomerWelcome":true}'::jsonb else '{}'::jsonb end
    ||case when p_only then '{"newcomerOnly":true}'::jsonb else '{}'::jsonb end
  where id=p_post_id;
end $$;

-- 4. My own newcomer status. Attendance reuses the confirmed attendance record.
create function public.get_my_newcomer_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); ends_at timestamptz;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  ends_at:=private.newcomer_ends_at(u);
  return jsonb_build_object(
    'newcomer', ends_at is not null,
    'periodDays', (select period_days from private.newcomer_config where id),
    'endsAt', ends_at,
    'requested', exists(select 1 from public.meetup_requests where requester_id=u),
    'attended', exists(select 1 from private.meetup_attendance where user_id=u and confirmed_at is not null));
end $$;

-- Open meetups a member can still request: published, in their city, not theirs, not paused or full.
create function private.newcomer_meetup_candidates(p_user uuid) returns setof public.posts
language sql stable security definer set search_path='' as $$
  select p.* from public.posts p join public.profiles r on r.id=p_user and r.city_id=p.city_id
  where private.meetup_is_open(p.status,p.room_preview) and p.author_id<>p_user
    and coalesce(p.room_preview->>'recruitingClosed','false')<>'true'
    and (jsonb_typeof(p.room_preview->'capacity') is distinct from 'number'
      or coalesce((p.room_preview->>'memberCount')::numeric,0)<(p.room_preview->>'capacity')::numeric)
    and private.notification_target_visible(p_user,'post',p.id);
$$;

-- Up to three first-timer-friendly meetups starting this week; else meetups opened this week.
create function private.newcomer_welcome_meetups(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids uuid[];
begin
  select array_agg(id order by starts) into ids from (
    select p.id, (p.room_preview->>'startsAt')::timestamptz starts from private.newcomer_meetup_candidates(p_user) p
    where p.room_preview->>'newcomerWelcome'='true' and p.room_preview->>'eventKind'='once'
      and (p.room_preview->>'startsAt')::timestamptz between now() and now()+interval '7 days'
    order by starts limit 3) welcome;
  if ids is not null then return jsonb_build_object('mode','welcome','ids',to_jsonb(ids)); end if;
  select array_agg(id order by created desc) into ids from (
    select p.id, p.created_at created from private.newcomer_meetup_candidates(p_user) p
    where p.created_at>now()-interval '7 days'
    order by p.created_at desc limit 3) fresh;
  return jsonb_build_object('mode',case when ids is null then 'none' else 'fresh' end,'ids',coalesce(to_jsonb(ids),'[]'::jsonb));
end $$;

create function public.get_newcomer_welcome_meetups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return private.newcomer_welcome_meetups(auth.uid());
end $$;

-- 5. First-week nudges. They reuse the trending_meetup kind so the 2026-10-09 recommendation cadence,
-- daily cap, quiet hours, meetup mute and old-app routes all apply unchanged. Each step is sent at most once.
create table private.newcomer_nudges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  step text not null check (step in ('day0','day1','day3','day7','day7_attended')),
  notification_id uuid,
  sent_at timestamptz not null default now(),
  primary key (user_id, step)
);
revoke all on private.newcomer_nudges from public, anon, authenticated;

-- Korean place count for "두 곳"; English copy reads it back in notification-copy.ts.
create function private.newcomer_place_count(p_count integer) returns text
language sql immutable set search_path='' as $$
  select case when p_count between 1 and 4 then (array['한','두','세','네'])[p_count]||' 곳' else p_count::text||'곳' end;
$$;

create function private.send_newcomer_nudges(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare member record; zone text; local_now timestamp; day integer; week_start timestamp; target uuid; places integer;
  attended_host uuid; stage text; welcome jsonb; body text; sent_id uuid; sent integer:=0;
begin
  if not coalesce((select nudges_enabled from private.newcomer_config where id),false) then return 0; end if;
  for member in
    select r.id, r.created_at from public.profiles r
    left join public.notification_preferences prefs on prefs.user_id=r.id
    where r.created_at>p_now-interval '8 days' and r.account_status='active' and coalesce(prefs.meetups,true)
      and private.newcomer_ends_at(r.id) is not null
      and not exists(select 1 from auth.users a where a.id=r.id
        and (a.email like '%@seed.gling.invalid' or a.raw_app_meta_data->'review_access'='true'::jsonb))
  loop
    zone:=coalesce(private.recommendation_timezone(member.id),'America/Vancouver');
    local_now:=p_now at time zone zone;
    day:=local_now::date-(member.created_at at time zone zone)::date;
    stage:=null; target:=null; body:=null; attended_host:=null;
    if day=0 then
      welcome:=private.newcomer_welcome_meetups(member.id);
      if welcome->>'mode'='welcome' then target:=(welcome->'ids'->>0)::uuid; end if;
      stage:='day0'; body:='가입 축하해요. 처음 가기 편한 모임부터 모아 뒀어요.';
    elsif extract(hour from local_now)<10 then continue;
    elsif day=1 then
      select p.id, p.title into target, body from private.newcomer_meetup_candidates(member.id) p
      where p.room_preview->>'eventKind'='once' and (p.room_preview->>'startsAt')::timestamptz between p_now and p_now+interval '7 days'
      order by coalesce(p.room_preview->>'newcomerWelcome'='true',false) desc, (p.room_preview->>'startsAt')::timestamptz limit 1;
      stage:='day1'; body:='이번 주 모임이 올라왔어요. '||left(trim(body),80)||', 아직 자리 있어요.';
    elsif day=3 and not exists(select 1 from public.meetup_requests where requester_id=member.id) then
      -- This weekend = the coming Saturday 00:00 (or now, on a weekend) until Monday 00:00, local time.
      week_start:=date_trunc('week',local_now);
      select count(*), (array_agg(p.id order by (p.room_preview->>'startsAt')::timestamptz))[1] into places, target
      from private.newcomer_meetup_candidates(member.id) p
      where p.room_preview->>'newcomerWelcome'='true' and p.room_preview->>'eventKind'='once'
        and (p.room_preview->>'startsAt')::timestamptz between greatest(p_now,(week_start+interval '5 days') at time zone zone)
          and ((week_start+interval '7 days') at time zone zone);
      stage:='day3'; body:='이번 주말엔 처음 오는 분 반기는 모임이 '||private.newcomer_place_count(places)||' 있어요.';
    elsif day=7 then
      week_start:=date_trunc('week',local_now)+interval '7 days';
      select s.host_id into attended_host from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
      where a.user_id=member.id and a.confirmed_at is not null and s.host_id<>member.id order by s.ends_at desc limit 1;
      if attended_host is not null then
        select p.id into target from private.newcomer_meetup_candidates(member.id) p
        where p.author_id=attended_host and p.room_preview->>'eventKind'='once'
          and (p.room_preview->>'startsAt')::timestamptz between (week_start at time zone zone) and ((week_start+interval '7 days') at time zone zone)
        order by (p.room_preview->>'startsAt')::timestamptz limit 1;
      end if;
      if target is not null then
        stage:='day7_attended'; body:='첫 모임 어땠어요? 다음 주에도 같은 호스트 모임이 있어요.';
      else
        select p.id into target from private.newcomer_meetup_candidates(member.id) p
        where p.room_preview->>'eventKind'='once'
          and (p.room_preview->>'startsAt')::timestamptz between (week_start at time zone zone) and ((week_start+interval '7 days') at time zone zone)
        order by coalesce(p.room_preview->>'newcomerWelcome'='true',false) desc, (p.room_preview->>'startsAt')::timestamptz limit 1;
        stage:='day7'; body:='벌써 일주일이네요. 다음 주 모임도 열렸어요.';
      end if;
    end if;
    -- Nothing to point at means nothing to say; the step can still go out later that same day.
    if stage is null or target is null or exists(select 1 from private.newcomer_nudges n where n.user_id=member.id
      and (n.step=stage or (stage like 'day7%' and n.step like 'day7%'))) then continue; end if;
    sent_id:=private.create_notification(member.id,'trending_meetup',null,'post',target,body,'/post/'||target::text);
    if sent_id is null then continue; end if;
    -- Sign-up day stays in the in-app inbox only.
    if stage='day0' then delete from private.push_delivery_queue where notification_id=sent_id; end if;
    insert into private.newcomer_nudges(user_id,step,notification_id) values (member.id,stage,sent_id) on conflict do nothing;
    sent:=sent+1;
  end loop;
  return sent;
end $$;

revoke all on function private.newcomer_ends_at(uuid), private.guard_meetup_newcomers_only(),
  private.newcomer_meetup_candidates(uuid), private.newcomer_welcome_meetups(uuid), private.newcomer_place_count(integer),
  private.send_newcomer_nudges(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.set_meetup_newcomer(uuid,boolean,boolean), public.get_my_newcomer_status(),
  public.get_newcomer_welcome_meetups() from public, anon;
grant execute on function public.set_meetup_newcomer(uuid,boolean,boolean), public.get_my_newcomer_status(),
  public.get_newcomer_welcome_meetups() to authenticated;

-- Hourly: each member's local hour decides, so DST needs no schedule change.
select cron.unschedule(jobid) from cron.job where jobname='gling-newcomer-nudges';
select cron.schedule('gling-newcomer-nudges', '13 * * * *', $job$ select private.send_newcomer_nudges(); $job$);

insert into private.behavior_targets(id) values
 ('onboarding.welcome.meetup'),('meetup.newcomer.welcome.on'),('meetup.newcomer.welcome.off'),
 ('meetup.newcomer.audience.anyone'),('meetup.newcomer.audience.newcomers'),
 ('today.newcomer.meetups'),('today.newcomer.hide')
on conflict do nothing;
