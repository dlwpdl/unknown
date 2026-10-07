-- Raise each platform's minimum only after its new store build is available to users.
create table public.app_release_policy (
  platform text primary key check (platform in ('ios', 'android')),
  minimum_build integer not null check (minimum_build >= 0)
);

alter table public.app_release_policy enable row level security;
create policy "anyone reads app release policy" on public.app_release_policy
  for select to anon, authenticated using (true);
revoke all on public.app_release_policy from anon, authenticated;
grant select on public.app_release_policy to anon, authenticated;

insert into public.app_release_policy (platform, minimum_build)
values ('ios', 50), ('android', 50);
