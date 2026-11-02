-- The private admin dashboard address no longer lives in this public repository (2026-11-02).
-- Operators store it once in Vault, like the other server-only values:
--   select vault.create_secret('https://<dashboard host>', 'gling_admin_dashboard_origin');
-- Until then admins get null and the app keeps its /admin -> /notifications fallback.
-- Same rule as 20261030120000: the admin role on an active account; the dashboard keeps its own login + MFA.
create or replace function public.get_admin_dashboard_origin()
returns text language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin' and p.account_status='active')
  then (select s.decrypted_secret from vault.decrypted_secrets s where s.name='gling_admin_dashboard_origin') end;
$$;
