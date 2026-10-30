-- The operator's own direct database connection (session user postgres) acting as an active admin account counts as
-- admin without a browser AAL2 session. API clients always connect as authenticator, so the dashboard still needs login + MFA.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal'='aal2' and auth.jwt()->'app_metadata'->>'role'='admin',false)
    and exists(select 1 from auth.users u join public.profiles p on p.id=u.id
      join auth.sessions s on s.user_id=u.id and s.id::text=auth.jwt()->>'session_id'
      where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin' and p.account_status='active'
        and s.aal='aal2' and (s.not_after is null or s.not_after>now()))
  or session_user='postgres' and exists(select 1 from auth.users u join public.profiles p on p.id=u.id
      where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin' and p.account_status='active');
$$;
