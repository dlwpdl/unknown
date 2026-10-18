-- Public place facts only; the existing daily operations publisher owns writes.
create table private.city_place_catalog (
  id boolean primary key default true check(id),
  payload jsonb not null check(jsonb_typeof(payload)='object' and jsonb_typeof(payload->'cities') is not distinct from 'object'
    and jsonb_typeof(payload->'collectedAt') is not distinct from 'string' and octet_length(payload::text)<=2000000),
  refreshed_on date not null,
  updated_at timestamptz not null default now()
);
alter table private.city_place_catalog enable row level security;
revoke all on private.city_place_catalog from public,anon,authenticated,service_role;

create function public.get_city_place_catalog()
returns jsonb language sql stable security definer set search_path='' as $$
  select payload from private.city_place_catalog where id
$$;
revoke all on function public.get_city_place_catalog() from public,anon,authenticated,service_role;
grant execute on function public.get_city_place_catalog() to anon,authenticated;
