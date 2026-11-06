-- 지도 목록·핀의 저장 수와 지금 상태 (owner 2026-11-05 M3 "목록에 저장 수, 저장 많은 순", M1 "장소마다 지금 상태 표시"). Read-only: one
-- city's totals per place and never who, so one read fills the whole list. Counted like private.place_savers, so the list and the place screen agree.
-- Counting: someone who blocked the viewer or hid their saves from friends still counts as one nameless head (the same total for every viewer); inactive accounts and operated characters never count.
-- The status rule lives here so it can change without a store release: 뜨는 중 is 3+ members saving in the last 7 days, 인기 is 10+ members overall.
create function public.get_city_place_saves(p_city_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  with saves as (
    select s.place_key,s.user_id,s.created_at saved_at from private.saved_places s where s.city_id=p_city_id
    union all
    select l.place_key,sm.user_id,sm.created_at from private.webshop_place_links l
      join private.saved_merchants sm on sm.merchant_id=l.merchant_id where l.city_id=p_city_id
  ), people as (
    -- One person can reach a place twice (the place and its business); they count once, with their latest save.
    select x.place_key,x.user_id,max(x.saved_at) saved_at from saves x group by x.place_key,x.user_id
  ), totals as (
    select p.place_key,count(*)::integer savers,(count(*) filter (where p.saved_at>=now()-interval '7 days'))::integer recent
    from people p where private.is_active_account(p.user_id) and not private.is_operated_character(p.user_id)
    group by p.place_key order by savers desc,p.place_key limit 2000
  )
  select coalesce(jsonb_agg(jsonb_build_object('placeKey',t.place_key,'saverCount',t.savers,
    'status',case when t.recent>=3 then 'trending' when t.savers>=10 then 'popular' end)),'[]'::jsonb) from totals t
$$;
alter function public.get_city_place_saves(text) owner to postgres;
revoke all on function public.get_city_place_saves(text) from public,anon,authenticated,service_role;
grant execute on function public.get_city_place_saves(text) to anon,authenticated;
notify pgrst,'reload schema';
