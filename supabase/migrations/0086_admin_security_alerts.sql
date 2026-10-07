-- 관리자 알림 확장: 다계정 의심, 앱 오류 급증, 요청 폭주를 관리자에게 보낸다.
-- 알림 본문·라우트는 기존 safety_alert 와 같은 방식으로 쌓이고, 앱에서 탭하면
-- /admin?section=... 로 열린다. 같은 대상은 중복 알림을 만들지 않는다.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'comment','reply','post_like','comment_like','message',
  'meetup_request','meetup_approved','meetup_rejected',
  'interest_post','nearby_meetup','moderation_warning','moderation_blocked',
  'safety_alert','trending_post',
  'admin_security','admin_multiacct','admin_error_spike'
));
alter table public.notifications drop constraint notifications_target_type_check;
alter table public.notifications add constraint notifications_target_type_check check (target_type in (
  'post','comment','message','meetup_request','user','listing_review','chilling_profile','chilling_application',
  'ip','client_error'
));

create or replace function private.notify_admins(p_kind text, p_target_type text, p_target_id uuid, p_body text,
  p_route text, p_dedupe interval default interval '6 hours')
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from public.notifications n
    where n.kind = p_kind and n.target_id = p_target_id and n.created_at > now() - p_dedupe) then return; end if;
  insert into public.notifications(user_id, kind, target_type, target_id, body, route)
  select profile.id, p_kind, p_target_type, p_target_id, left(p_body, 300), p_route
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  where auth_user.raw_app_meta_data->>'role' = 'admin' and profile.account_status = 'active';
end;
$$;
revoke all on function private.notify_admins(text,text,uuid,text,text,interval) from public,anon,authenticated,service_role;

create or replace function public.run_admin_alert_checks()
returns integer language plpgsql security definer set search_path='' as $$
declare
  rec record;
  raised integer := 0;
begin
  -- 1) 같은 IP·기기에서 여러 계정: 최근 24시간 안에 3개 이상이면 관리자 확인 대상.
  -- 크론에는 JWT 가 없어 관리자 RPC 를 부를 수 없으므로 같은 조건을 여기서 직접 센다.
  for rec in
    select host(s.ip) as ip, count(distinct s.user_id) as users
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.ip is not null
      and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '1 day'
      and u.email not like '%@seed.gling.invalid'
    group by 1 having count(distinct s.user_id) >= 3
  loop
    perform private.notify_admins('admin_multiacct', 'ip', md5(rec.ip)::uuid,
      '같은 IP에서 ' || rec.users || '개 계정이 확인됐어요 · ' || rec.ip, '/admin?section=users');
    raised := raised + 1;
  end loop;

  -- 2) 새 앱 오류: 30분 안에 처음 보고된 오류 지문마다 한 번만 알린다.
  for rec in select fingerprint, message from private.client_errors
    where first_seen > now() - interval '30 minutes' order by first_seen limit 5
  loop
    perform private.notify_admins('admin_error_spike', 'client_error', md5(rec.fingerprint)::uuid,
      '새 앱 오류가 보고됐어요 · ' || left(rec.message, 120), '/admin?section=errors', interval '1 hour');
    raised := raised + 1;
  end loop;

  -- 3) 요청 폭주: 10분에 20건 이상이면 브루트포스·자동화 의심으로 올린다.
  for rec in select user_id, count(*) as hits from private.action_rate_events
    where created_at > now() - interval '10 minutes' group by user_id having count(*) >= 20
  loop
    perform private.notify_admins('admin_security', 'user', rec.user_id,
      '짧은 시간에 요청이 몰렸어요 · 10분에 ' || rec.hits || '건', '/admin?section=users', interval '1 hour');
    raised := raised + 1;
  end loop;

  return raised;
end;
$$;
revoke all on function public.run_admin_alert_checks() from public,anon,authenticated;
grant execute on function public.run_admin_alert_checks() to service_role;

-- 크론은 배포 후 이 마이그레이션에서 바로 건다. 비밀값을 쓰지 않아 안전하다.
select cron.unschedule(jobid) from cron.job where jobname = 'gling-admin-alerts';
select cron.schedule('gling-admin-alerts', '*/10 * * * *', $job$ select public.run_admin_alert_checks(); $job$);

notify pgrst, 'reload schema';
