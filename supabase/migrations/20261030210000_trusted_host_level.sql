-- Canada trust levels (owner 2026-10-30 "추천안대로 실명제 하고", policy §6-10, docs/specs/trust-levels-canada-2026-10-30.md).
-- Additive only. profiles.verification_level keeps 1..3 and every released reader keeps working; new apps show:
--   1 계정 확인: 소셜 로그인 + 휴대폰 문자 인증 (문자 업체 연결 전까지 문자 쪽은 준비 중)
--   2 신분증 확인: 신분증 + 얼굴 자동 대조 (업체 연결 전까지는 관리자 부여만)
--   3 믿을 수 있는 호스트: Lv2 + 모임 참석·매너 기준. 이 파일이 자동 판정을 더한다.
-- v1.4.6 labels 2 "전화번호 확인 완료" and 3 "신분증과 본인 촬영 대조 완료"; both stay true because each level includes the one below.
-- Admin grants stay: the job never removes an admin's 3, and an admin taking a 3 away keeps the job from giving it back.
-- Others only ever see the level; no-show and report details stay server-side, and only the owner reads their own checklist.

-- 1. One-row rule, changed without an app release, e.g.
--      update private.trusted_host_rule set min_confirmed_meetups=5, updated_at=now();
--      update private.trusted_host_rule set enabled=false, updated_at=now();  -- auto badges return to Lv2 on the next run
--    A day value of 0 (or min_hosted_meetups 0) switches that check off.
create table private.trusted_host_rule (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  min_confirmed_meetups integer not null default 3 check (min_confirmed_meetups between 1 and 100),
  min_hosted_meetups integer not null default 3 check (min_hosted_meetups between 0 and 100),
  no_show_days integer not null default 90 check (no_show_days between 0 and 730),
  conduct_days integer not null default 365 check (conduct_days between 0 and 3650),
  updated_at timestamptz not null default now()
);
insert into private.trusted_host_rule default values;

-- 2. 'granted' = the job gave this 3; 'held' = an admin took a 3 away, so the job leaves the account alone.
create table private.trusted_host_auto (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state text not null check (state in ('granted','held')),
  updated_at timestamptz not null default now()
);
alter table private.trusted_host_rule enable row level security;
alter table private.trusted_host_auto enable row level security;
revoke all on private.trusted_host_rule, private.trusted_host_auto from public, anon, authenticated, service_role;

-- 3. One account's standing. Attendance = an ended session the member was peer/admin-confirmed at; hosting reuses
--    private.meetup_hosted_count (an ended session someone else checked in to or was confirmed at).
--    "Conduct" = no upheld report (reports.status 'actioned') and no published manner rating of 5 or lower.
-- shortcut: counts sessions, not distinct guests, so one helper account can build the record; add a distinct-guest minimum if that shows up.
create function private.trusted_host_progress(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'enabled',r.enabled,'level',p.verification_level,
    'confirmedMeetups',jsonb_build_object('required',r.min_confirmed_meetups,'count',c.confirmed),
    'hostedMeetups',jsonb_build_object('required',r.min_hosted_meetups,'count',c.hosted),
    'noRecentNoShow',jsonb_build_object('days',r.no_show_days,'met',c.no_show_free),
    'goodConduct',jsonb_build_object('days',r.conduct_days,'met',c.conduct_clean),
    'eligible',r.enabled and p.account_status='active' and p.verification_level>=2
      and c.confirmed>=r.min_confirmed_meetups and c.hosted>=r.min_hosted_meetups and c.no_show_free and c.conduct_clean)
  from private.trusted_host_rule r
  join public.profiles p on p.id=p_user_id
  cross join lateral (select
    (select count(distinct a.session_id)::int from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id
      where a.user_id=p_user_id and a.confirmed_at is not null and s.ends_at<=now()) as confirmed,
    private.meetup_hosted_count(p_user_id) as hosted,
    not exists(select 1 from private.meetup_absences x where x.user_id=p_user_id and x.kind='no_show'
      and x.recorded_at>now()-make_interval(days=>r.no_show_days)) as no_show_free,
    not exists(select 1 from public.reports x where x.reported_user_id=p_user_id and x.status='actioned'
        and coalesce(x.resolved_at,x.created_at)>now()-make_interval(days=>r.conduct_days))
      and not exists(select 1 from private.trust_reviews x where x.kind='manner' and x.subject_id=p_user_id
        and x.status='published' and x.score<=5 and x.created_at>now()-make_interval(days=>r.conduct_days)) as conduct_clean) c
  where r.id;
$$;

-- 4. Hourly job: take back the job's own badges that no longer qualify, then promote qualifying Lv2 accounts.
create function private.refresh_trusted_hosts() returns integer
language plpgsql security definer set search_path='' as $$
declare lost integer; won integer;
begin
  with gone as (
    delete from private.trusted_host_auto a where a.state='granted'
      and not coalesce((private.trusted_host_progress(a.user_id)->>'eligible')::boolean,false)
    returning a.user_id)
  update public.profiles p set verification_level=2, updated_at=now() from gone where p.id=gone.user_id and p.verification_level=3;
  get diagnostics lost=row_count;
  with fresh as (
    insert into private.trusted_host_auto(user_id,state)
    select p.id,'granted' from public.profiles p
    where p.verification_level=2 and p.account_status='active'
      and not private.is_operated_character(p.id)  -- personas never host real members (20261030200000)
      and not exists(select 1 from private.trusted_host_auto a where a.user_id=p.id)
      and coalesce((private.trusted_host_progress(p.id)->>'eligible')::boolean,false)
    returning user_id)
  update public.profiles p set verification_level=3, updated_at=now() from fresh where p.id=fresh.user_id;
  get diagnostics won=row_count;
  return lost+won;
end $$;

-- 5. Own checklist for the trust screen. Counts and met/unmet only; never another account's record.
create function public.get_my_trust_progress() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(u);
  return private.trusted_host_progress(u);
end $$;

-- 6. Admin setter keeps its signature and audit log; it now also tells the job who owns the badge.
do $$
declare definition text; anchor text:='  perform public.log_admin_access(''trust_level'', p_user_id, null);';
begin
  definition:=pg_get_functiondef('public.set_admin_verification_level(uuid,smallint)'::regprocedure);
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'TRUST_LEVEL_SETTER_CHANGED'; end if;
  execute replace(definition,anchor,
    E'  if p_level=3 then delete from private.trusted_host_auto where user_id=p_user_id;\n'
    ||E'  elsif previous_level=3 then insert into private.trusted_host_auto(user_id,state) values(p_user_id,''held'')\n'
    ||E'    on conflict(user_id) do update set state=''held'', updated_at=now();\n'
    ||E'  end if;\n'||anchor);
end $$;

-- 7. Account deletion drops the flag with the rest of the account's trust data.
create function private.erase_deleted_trusted_host() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from private.trusted_host_auto where user_id=new.id;
  return new;
end $$;
create trigger profiles_erase_trusted_host after update of account_status on public.profiles
  for each row when(new.account_status='deleted' and old.account_status is distinct from new.account_status)
  execute function private.erase_deleted_trusted_host();

revoke all on function private.trusted_host_progress(uuid), private.refresh_trusted_hosts(), private.erase_deleted_trusted_host()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_trust_progress() from public, anon, authenticated, service_role;
grant execute on function public.get_my_trust_progress() to authenticated;

select cron.schedule('gling-trusted-hosts','17 * * * *',$job$ select private.refresh_trusted_hosts(); $job$);
notify pgrst,'reload schema';
