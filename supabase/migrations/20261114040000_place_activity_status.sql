-- 지도 '뜨는 중·인기' from what members do in the app (owner 2026-11-13 "지금 핫한거 뭐 트렌딩 이런거 ... 암것도 안됏네"):
-- saves alone left every city without a single state. Same function and the same rows (placeKey, saverCount, status), so
-- released apps read it unchanged; saverCount is still the save total the place screen shows.
--
-- A member is active at a place when they saved it (the place or its business), marked it 가 봤어요, wrote a review of it, or
-- posted with it attached (the body's map line on exactly one map place of the city, the rule private.post_catalog_place
-- uses). Doing several of these counts that member once, at their latest. Posts count only while public (get_public_post,
-- as get_city_place_signals does). Opening a place screen is not recorded on the server, so it does not count.
-- Inactive accounts and operated characters never count, so the team cannot make a place trend.
-- 뜨는 중: 2+ members active in the last 7 days and among the city's top 10 by that count; 인기: the same with 30 days and
-- top 20. One member alone never makes either, and 뜨는 중 wins when both hold.
create or replace function public.get_city_place_saves(p_city_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  with pins as (
    select p.id,p.author_id,p.created_at,m[1]::numeric lat,m[2]::numeric lng from public.posts p
      cross join lateral regexp_match(coalesce(p.body,''),
        '(?:^|\n)Google 지도: https://www\.google\.com/maps/search/\?api=1&query=(-?[0-9]{1,3}(?:\.[0-9]{1,15})?)%2C(-?[0-9]{1,3}(?:\.[0-9]{1,15})?)(?:\n|$)') m
    where p.city_id=p_city_id and p.status='published' and p.room_preview is null and p.created_at>=now()-interval '30 days'
      and exists(select 1 from public.get_public_post(p.id))
  ), catalog as (
    -- Read the map JSON only when some recent post has a map line.
    select e->>'id' id,(e->>'latitude')::numeric lat,(e->>'longitude')::numeric lng
    from private.city_place_catalog c
      cross join lateral unnest(array['places','regionalPlaces','extraPlaces','morePlaces']) list
      cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'cities'->p_city_id->list)='array'
        then c.payload->'cities'->p_city_id->list else '[]'::jsonb end) e
    where c.id and exists(select 1 from pins) and e->>'cityId'=p_city_id
      and jsonb_typeof(e->'latitude')='number' and jsonb_typeof(e->'longitude')='number'
      and length(btrim(coalesce(e->>'name',''))) between 1 and 300
  ), acts as (
    select s.place_key,s.user_id,s.created_at acted_at,true saved from private.saved_places s where s.city_id=p_city_id
    union all
    select l.place_key,sm.user_id,sm.created_at,true from private.webshop_place_links l
      join private.saved_merchants sm on sm.merchant_id=l.merchant_id where l.city_id=p_city_id
    union all
    -- 가 봤어요 is kept against the saved key: 'place:<city>:<place key>', or the business's key once the place links to one.
    select substr(b.saved_key,char_length(p_city_id)+8),b.user_id,b.been_at,false from private.saved_place_been b
      where starts_with(b.saved_key,'place:'||p_city_id||':')
    union all
    select l.place_key,b.user_id,b.been_at,false from private.webshop_place_links l
      join private.saved_place_been b on b.saved_key='merchant:'||l.city_id||':'||l.merchant_id::text where l.city_id=p_city_id
    union all
    select p.place_review_osm_id,p.author_id,p.created_at,false from public.posts p
      where p.city_id=p_city_id and p.place_review_osm_id is not null and p.place_review_score is not null
        and p.status='published' and p.created_at>=now()-interval '30 days' and exists(select 1 from public.get_public_post(p.id))
    union all
    -- Two places on the same spot: unknown which one, so neither.
    select min(c.id),pins.author_id,pins.created_at,false from pins join catalog c on c.lat=pins.lat and c.lng=pins.lng
      group by pins.id,pins.author_id,pins.created_at having count(distinct c.id)=1
  ), people as (
    select a.place_key,a.user_id,bool_or(a.saved) saved,max(a.acted_at) last_at from acts a
    where private.is_active_account(a.user_id) and not private.is_operated_character(a.user_id)
    group by a.place_key,a.user_id
  ), totals as (
    select p.place_key,(count(*) filter (where p.saved))::integer savers,
      (count(*) filter (where p.last_at>=now()-interval '7 days'))::integer recent,
      (count(*) filter (where p.last_at>=now()-interval '30 days'))::integer monthly,max(p.last_at) last_at
    from people p group by p.place_key
  ), ranked as (
    select t.place_key,t.savers,case
      when t.recent>=2 and row_number() over (order by t.recent desc,t.last_at desc,t.place_key)<=10 then 'trending'
      when t.monthly>=2 and row_number() over (order by t.monthly desc,t.last_at desc,t.place_key)<=20 then 'popular' end status
    from totals t
  ), shown as (
    -- A place with a state always fits in the 2000 rows released apps accept.
    select r.* from ranked r where r.savers>0 or r.status is not null
    order by r.status is null,r.savers desc,r.place_key limit 2000
  )
  select coalesce(jsonb_agg(jsonb_build_object('placeKey',s.place_key,'saverCount',s.savers,'status',s.status)
    order by s.status is null,s.savers desc,s.place_key),'[]'::jsonb) from shown s
$$;
alter function public.get_city_place_saves(text) owner to postgres;
revoke all on function public.get_city_place_saves(text) from public,anon,authenticated,service_role;
grant execute on function public.get_city_place_saves(text) to anon,authenticated;

-- The map's state chips (the earlier shortcut borrowed discovery.subcategory) and the search screen's price filter.
-- An unknown target rejects the whole analytics batch, so this must reach production before the app build.
insert into private.behavior_targets(id) values
  ('discovery.status'),
  ('search.price')
on conflict (id) do nothing;
notify pgrst,'reload schema';
