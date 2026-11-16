-- owner 2026-11-15 "공개 함수 3초 끊김: 원인 찾아 고치기": get_shared_link_preview and get_merchant_profile (anon, 3s statement_timeout)
-- sometimes ran 3.7-4.6s during the web deploy prerender. Same results, less work per call:
--  1. private.post_catalog_place (added 20261111210000, called by every share preview) read the 1.8MB map JSON 8 times per call
--     and also for posts with no map pin. Now: no pin -> the map JSON is not read; pin -> read the city once.
--  2. public.get_merchant_profile read its `profile` subquery in 20 places, so the planner ran
--     private.business_base_get_merchant_profile (and its public-post checks) about 7 times per call. `offset 0` keeps it one call.
-- No grant, owner, search_path, SECURITY DEFINER or returned-field change: create or replace keeps all of them.

create or replace function private.post_catalog_place(p_body text, p_city text) returns jsonb
language sql stable security definer set search_path='' as $$
  with pin as materialized (
    select m[1]::numeric lat, m[2]::numeric lng
    from regexp_match(coalesce(p_body,''),
      '(?:^|\n)Google 지도: https://www\.google\.com/maps/search/\?api=1&query=(-?[0-9]{1,3}(?:\.[0-9]{1,15})?)%2C(-?[0-9]{1,3}(?:\.[0-9]{1,15})?)(?:\n|$)') m
  ), city as materialized (
    select c.payload->'cities'->p_city j from private.city_place_catalog c where c.id and exists(select 1 from pin)
  ), hits as (
    select e->>'id' id, e->>'name' name
    from pin, city
      cross join lateral unnest(array['places','regionalPlaces','extraPlaces','morePlaces']) list
      cross join lateral jsonb_array_elements(case when jsonb_typeof(city.j->list)='array' then city.j->list else '[]'::jsonb end) e
    where e->>'cityId'=p_city
      and jsonb_typeof(e->'latitude')='number' and jsonb_typeof(e->'longitude')='number'
      and (e->>'latitude')::numeric=pin.lat and (e->>'longitude')::numeric=pin.lng
      and length(btrim(coalesce(e->>'name',''))) between 1 and 300
  )
  -- Two places on the same spot: unknown which one, so none.
  select case when count(distinct id)=1 then jsonb_build_object('id',min(id),'name',min(name)) end from hits;
$$;

-- Read the live definition, change one spot, and stop if it is not what we expect (same as the earlier preview migrations).
do $migration$
declare
  definition text := pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor constant text := 'private.business_base_get_merchant_profile(p_merchant_id) profile)x';
begin
  if (char_length(definition) - char_length(replace(definition, anchor, ''))) / char_length(anchor) <> 1 then
    raise exception 'merchant profile projection changed; review before adding offset 0';
  end if;
  execute replace(definition, anchor, 'private.business_base_get_merchant_profile(p_merchant_id) profile offset 0)x');
end $migration$;
notify pgrst, 'reload schema';
