-- Supabase 로그 줄이기 (owner 2026-11-15 "둘 다").
-- 매분 예약 작업 7개를 한 작업으로 묶고, 푸시·안전 점검 엣지 함수는 할 일이 있을 때만 깨운다.
-- 주기(1분), 비밀값(vault), 요청 본문, 안전 점검 범위(결정 0001: 모든 글·댓글·대화)는 그대로다.

-- Mirrors public.claim_push_notifications: a claimable send/receipt row, or rows its 7-day purge deletes.
create or replace function private.push_work_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from private.push_delivery_queue q
                where q.status in ('pending', 'ticket') and q.next_attempt_at <= now()
                  and (q.lease_until is null or q.lease_until <= now()))
      or exists(select 1 from private.push_delivery_queue q where q.created_at < now() - interval '7 days');
$$;

-- Mirrors public.claim_safety_reviews_v2: abandoned message leases it reclaims, then rows claim_safety_reviews selects.
create or replace function private.safety_work_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.safety_review_queue q
                where q.status in ('pending', 'failed') and coalesce(q.next_attempt_at, now()) <= now() and q.attempts < 5)
      or exists(select 1 from public.safety_review_queue q
                where q.target_type = 'message' and q.status = 'processing' and q.updated_at < now() - interval '5 minutes');
$$;

-- Each step has its own exception block, so one failure neither stops nor rolls back the others.
create or replace function private.run_minute_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin perform private.process_discovery_posts(500);
  exception when others then raise warning 'gling-minute-jobs discovery % %', sqlstate, sqlerrm; end;
  begin perform private.expire_chilling_events();
  exception when others then raise warning 'gling-minute-jobs chilling % %', sqlstate, sqlerrm; end;
  begin perform private.send_meetup_reminders();
  exception when others then raise warning 'gling-minute-jobs reminders % %', sqlstate, sqlerrm; end;
  begin perform private.expire_meetup_waitlist_offers();
  exception when others then raise warning 'gling-minute-jobs waitlist % %', sqlstate, sqlerrm; end;
  begin perform private.send_due_meetup_announcements();
  exception when others then raise warning 'gling-minute-jobs announcements % %', sqlstate, sqlerrm; end;
  -- The push send claim used to flush security-login alerts every minute; keep that cadence without waking the function.
  begin perform private.flush_account_security_logins();
  exception when others then raise warning 'gling-minute-jobs security-logins % %', sqlstate, sqlerrm; end;
  -- HTTP steps log only the SQLSTATE: their arguments carry vault secrets.
  begin
    if private.push_work_due() then
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'gling_push_project_url') || '/functions/v1/push-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gling_push_notifications_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
    end if;
  exception when others then raise warning 'gling-minute-jobs push %', sqlstate; end;
  begin
    if private.safety_work_due() then
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'gling_project_url') || '/functions/v1/safety-monitor',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-safety-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gling_safety_monitor_secret')
        ),
        body := '{"limit":20}'::jsonb,
        timeout_milliseconds := 20000
      );
    end if;
  exception when others then raise warning 'gling-minute-jobs safety %', sqlstate; end;
end;
$$;

revoke all on function private.push_work_due(), private.safety_work_due(), private.run_minute_jobs()
  from public, anon, authenticated, service_role;

-- Secret rotation keeps working, but no longer brings back the separate per-minute jobs.
create or replace function public.configure_push_delivery(p_project_url text, p_push_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' or char_length(p_push_secret) < 32 then
    raise exception 'INVALID_PUSH_CONFIGURATION';
  end if;

  delete from vault.secrets where name in ('gling_push_project_url', 'gling_push_notifications_secret');
  perform vault.create_secret(p_project_url, 'gling_push_project_url');
  perform vault.create_secret(p_push_secret, 'gling_push_notifications_secret');

  -- private.run_minute_jobs (job gling-minute-jobs) reads these secrets every minute.
  perform cron.unschedule(jobid) from cron.job where jobname = 'gling-push-delivery';
end;
$$;

create or replace function public.configure_safety_monitor(p_project_url text, p_monitor_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin') and auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' or char_length(p_monitor_secret) < 32 then
    raise exception 'INVALID_SAFETY_CONFIGURATION';
  end if;

  delete from vault.secrets where name in ('gling_project_url', 'gling_safety_monitor_secret');
  perform vault.create_secret(p_project_url, 'gling_project_url');
  perform vault.create_secret(p_monitor_secret, 'gling_safety_monitor_secret');

  -- private.run_minute_jobs (job gling-minute-jobs) reads these secrets every minute.
  perform cron.unschedule(jobid) from cron.job where jobname = 'gling-safety-monitor-every-minute';
end;
$$;

select cron.unschedule(jobid) from cron.job
where jobname in ('gling-safety-monitor-every-minute', 'gling-discovery-posts', 'gling-push-delivery', 'gling-chilling-expiry',
                  'gling-meetup-reminders', 'gling-meetup-convenience', 'gling-meetup-announcements');
select cron.schedule('gling-minute-jobs', '* * * * *', 'select private.run_minute_jobs()');
