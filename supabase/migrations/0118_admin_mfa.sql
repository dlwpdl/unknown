-- Every administrator path using the shared guard requires a verified second factor.
-- Ordinary member access and service-owned safety monitoring remain unchanged.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal'='aal2' and auth.jwt()->'app_metadata'->>'role'='admin',false)
    and exists(select 1 from auth.users u join public.profiles p on p.id=u.id
      join auth.sessions s on s.user_id=u.id and s.id::text=auth.jwt()->>'session_id'
      where u.id=auth.uid() and u.raw_app_meta_data->>'role'='admin' and p.account_status='active'
        and s.aal='aal2' and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function private.is_admin() from public,anon;
grant execute on function private.is_admin() to authenticated;
notify pgrst,'reload schema';
