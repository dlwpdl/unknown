-- 2026-09-19 requires separate unchecked terms and privacy checkboxes before
-- authentication. Keep the previous version valid for already shipped clients.
alter table private.login_terms_acceptances
  drop constraint login_terms_acceptances_version_check,
  add constraint login_terms_acceptances_version_check
    check (version in ('2026-09-17', '2026-09-19'));

create or replace function public.accept_login_terms(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_version is null or p_version not in ('2026-09-17', '2026-09-19') then
    raise exception 'NOTICE_VERSION_MISMATCH';
  end if;
  insert into private.login_terms_acceptances(user_id,version) values(u,p_version)
  on conflict(user_id) do update set version=excluded.version,accepted_at=now()
    where private.login_terms_acceptances.version <= excluded.version;
end;
$$;
