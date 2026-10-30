-- Owner 2026-10-30 ("사이트맵에서 조용히 빼기"): the daily web build leaves Gling-operated character posts out of
-- the sitemap, llms.txt and prerendered pages without marking the pages themselves. Only the build holds the token.
-- Rule: every character post from 2026-10-30 (PT) on; older ones once a city has 30+ posts from real members.
create table if not exists private.search_build_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
revoke all on private.search_build_tokens from public, anon, authenticated;

create or replace function public.get_search_excluded_post_ids(p_token text)
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_token is null or not exists (select 1 from private.search_build_tokens t
      where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    with member_cities as (
      select p.city_id from public.posts p join auth.users u on u.id = p.author_id
      where p.status = 'published' and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'gling_persona')
        and coalesce(u.raw_app_meta_data->>'role', '') <> 'admin'
      group by p.city_id having count(*) >= 30)
    select p.id from public.posts p join auth.users u on u.id = p.author_id
    where coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'gling_persona'
      and (p.created_at >= timestamptz '2026-10-30 00:00 America/Vancouver' or p.city_id in (select city_id from member_cities));
end;
$$;
revoke all on function public.get_search_excluded_post_ids(text) from public;
grant execute on function public.get_search_excluded_post_ids(text) to anon, authenticated, service_role;
