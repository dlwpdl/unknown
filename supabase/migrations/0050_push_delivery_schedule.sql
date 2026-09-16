-- 푸시 발송 배선. 알림 행은 이미 큐에 쌓이지만 큐를 비우는 쪽이 없어 실제로 발송되지 않았다.
-- 비밀값은 마이그레이션에 넣지 않는다. 배포 후 service_role 로 configure_push_delivery 를 한 번 호출한다.
create function public.configure_push_delivery(p_project_url text, p_push_secret text)
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

  perform cron.unschedule(jobid) from cron.job where jobname = 'gling-push-delivery';

  -- 엣지 함수가 한 번에 send/receipt 두 단계를 각각 100건까지 처리한다.
  perform cron.schedule(
    'gling-push-delivery',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'gling_push_project_url') || '/functions/v1/push-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gling_push_notifications_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );
end;
$$;

revoke all on function public.configure_push_delivery(text, text) from public, anon, authenticated;
grant execute on function public.configure_push_delivery(text, text) to service_role;
