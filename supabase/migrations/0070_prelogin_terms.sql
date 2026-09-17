-- Terms are shown before authentication. Once authenticated, bind the explicit
-- agreement to that account with server time; this does not grant AI consent.
create table private.login_terms_acceptances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version text not null check (version = '2026-09-17'),
  accepted_at timestamptz not null default now()
);
alter table private.login_terms_acceptances enable row level security;
revoke all on private.login_terms_acceptances from public, anon, authenticated, service_role;

create function public.accept_login_terms(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_version is distinct from '2026-09-17' then raise exception 'NOTICE_VERSION_MISMATCH'; end if;
  insert into private.login_terms_acceptances(user_id,version) values(u,p_version)
  on conflict(user_id) do update set version=excluded.version,accepted_at=now();
end;
$$;
revoke all on function public.accept_login_terms(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_login_terms(text) to authenticated;

do $$
declare definition text; anchor text := '  delete from private.meetup_activity where user_id=current_user_id;';
begin
  definition := pg_get_functiondef('private.purge_account_data(text)'::regprocedure);
  if strpos(definition,anchor)=0 then raise exception 'account cleanup anchor missing'; end if;
  execute replace(definition,anchor,anchor||E'\n  delete from private.login_terms_acceptances where user_id=current_user_id;');
end;
$$;
