-- Passive dwell/view analytics are not a burst of member requests.
insert into private.behavior_targets(id) values ('app_tabs_notifications.pressable.3') on conflict do nothing;

create or replace function public.run_admin_alert_checks()
returns integer language plpgsql security definer set search_path='' as $$
declare
  rec record;
  raised integer := 0;
begin
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

  for rec in select fingerprint, message from private.client_errors
    where first_seen > now() - interval '30 minutes' order by first_seen limit 5
  loop
    perform private.notify_admins('admin_error_spike', 'client_error', md5(rec.fingerprint)::uuid,
      '새 앱 오류가 보고됐어요 · ' || left(rec.message, 120), '/admin?section=errors', interval '1 hour');
    raised := raised + 1;
  end loop;

  for rec in select user_id, count(*) as hits from private.action_rate_events
    where created_at > now() - interval '10 minutes' and action <> 'behavior'
    group by user_id having count(*) >= 20
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
