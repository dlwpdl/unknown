-- Admin notification taps did nothing on the phone (owner 2026-10-30): the app session is aal1, so
-- private.is_admin() (aal2 only) hid the dashboard address and the app fell back to /admin → /notifications.
-- Handing out only the address needs the admin role on an active account; the dashboard keeps its own login + MFA.
create or replace function public.get_admin_dashboard_origin()
returns text language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin' and p.account_status='active')
  then 'https://cayden-macbookpro.tailb6648f.ts.net' end;
$$;
