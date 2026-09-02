-- Explicit notice acceptance and a reproducible scheduler for the safety worker.

alter table public.profiles
add column terms_accepted_at timestamptz,
add column privacy_accepted_at timestamptz,
add column ai_safety_consent_at timestamptz,
add column consent_version text;

update public.profiles as profile
set terms_accepted_at = now(),
    privacy_accepted_at = now(),
    ai_safety_consent_at = now(),
    consent_version = 'synthetic-seed'
from auth.users as auth_user
where auth_user.id = profile.id
  and auth_user.email like '%@seed.gling.invalid';

create function public.accept_launch_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_version <> '2026-09-02' then raise exception 'NOTICE_VERSION_MISMATCH'; end if;
  perform private.assert_active_account(current_user_id);

  update public.profiles
  set terms_accepted_at = now(),
      privacy_accepted_at = now(),
      ai_safety_consent_at = now(),
      consent_version = p_version,
      updated_at = now()
  where id = current_user_id;
end;
$$;

revoke all on function public.accept_launch_terms(text) from public, anon, authenticated;
grant execute on function public.accept_launch_terms(text) to authenticated;

create function public.create_profile_with_consent(
  p_nickname text,
  p_city_id text,
  p_avatar_path text,
  p_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_status text;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_version <> '2026-09-02' then raise exception 'NOTICE_VERSION_MISMATCH'; end if;
  if p_avatar_path is not null and p_avatar_path not like current_user_id::text || '/%' then
    raise exception 'INVALID_AVATAR_PATH';
  end if;

  select account_status into current_status
  from public.profiles where id = current_user_id for update;

  if current_status is null then
    insert into public.profiles (
      id, nickname, city_id, avatar_path,
      terms_accepted_at, privacy_accepted_at, ai_safety_consent_at, consent_version
    ) values (
      current_user_id, trim(p_nickname), p_city_id, p_avatar_path,
      now(), now(), now(), p_version
    );
  elsif current_status = 'reactivation_pending' then
    update public.profiles
    set nickname = trim(p_nickname),
        city_id = p_city_id,
        avatar_path = p_avatar_path,
        account_status = 'active',
        account_status_note = null,
        account_status_changed_at = now(),
        deleted_at = null,
        terms_accepted_at = now(),
        privacy_accepted_at = now(),
        ai_safety_consent_at = now(),
        consent_version = p_version,
        updated_at = now()
    where id = current_user_id;
  elsif current_status = 'active' then
    update public.profiles
    set terms_accepted_at = now(),
        privacy_accepted_at = now(),
        ai_safety_consent_at = now(),
        consent_version = p_version,
        updated_at = now()
    where id = current_user_id;
  else
    raise exception 'ACCOUNT_LOCKED';
  end if;
end;
$$;

revoke all on function public.create_profile_with_consent(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_profile_with_consent(text, text, text, text) to authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.configure_safety_monitor(p_project_url text, p_monitor_secret text)
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

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'gling-safety-monitor-every-minute';

  perform cron.schedule(
    'gling-safety-monitor-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'gling_project_url') || '/functions/v1/safety-monitor',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-safety-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gling_safety_monitor_secret')
        ),
        body := '{"limit":20}'::jsonb,
        timeout_milliseconds := 20000
      );
    $job$
  );
end;
$$;

revoke all on function public.configure_safety_monitor(text, text) from public, anon, authenticated;
grant execute on function public.configure_safety_monitor(text, text) to service_role;
