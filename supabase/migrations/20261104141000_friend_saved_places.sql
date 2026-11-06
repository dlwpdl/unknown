-- 지도 탭 '보여 줄 곳 · 친구가 저장한 곳' (owner 2026-11-04 "친구기능도 넣어버리자 한번에"). Places only: no location
-- sharing and no people on the map. Friends are mutually accepted, pass private.friend_pair_ok (operated characters,
-- blocked or reported pairs and inactive accounts drop out) and have not turned sharing off (no row = shared, the default).
-- Pins come from private.profile_saved_places, the same list the profile map uses, so a saved listing, saved person or
-- source record never reaches the map. friendCount counts every friend who passes the pair check, so the app can tell
-- '친구 0명' apart from '보여 준 친구 0명'.
create function public.get_friend_saved_places(p_city_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_city_id is null or p_city_id !~ '^[a-z][a-z0-9-]{0,63}$' then raise exception 'INVALID_CITY'; end if;
  return (with friends as (
      select case when f.user_low_id=uid then f.user_high_id else f.user_low_id end id
      from private.friendships f
      where f.accepted_at is not null and (f.user_low_id=uid or f.user_high_id=uid)
    ), ok as (
      select fr.id from friends fr where private.friend_pair_ok(uid,fr.id)
    ), saves as (
      select s.place_key,ok.id user_id,s.saved_at
      from ok
      left join private.profile_sharing ps on ps.user_id=ok.id
      cross join lateral private.profile_saved_places(ok.id) s
      where coalesce(ps.saved_places_to_friends,true) and s.city_id=p_city_id and s.place_key is not null
    ), places as (
      -- One friend can reach a place twice (the place and its business); keep their latest save.
      select x.place_key,count(*)::integer friend_count,max(x.saved_at) last_saved,
        (array_agg(x.user_id order by x.saved_at desc,x.user_id))[1:3] first_ids
      from (select place_key,user_id,max(saved_at) saved_at from saves group by place_key,user_id) x
      group by x.place_key order by friend_count desc,last_saved desc,x.place_key limit 300
    )
    select jsonb_build_object('friendCount',(select count(*)::integer from ok),
      'places',coalesce(jsonb_agg(jsonb_build_object('placeKey',pl.place_key,'friendCount',pl.friend_count,
        'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,'avatarPath',p.avatar_path) order by n.ord),'[]'::jsonb)
          from unnest(pl.first_ids) with ordinality n(id,ord) join public.profiles p on p.id=n.id))
        order by pl.friend_count desc,pl.last_saved desc,pl.place_key),'[]'::jsonb))
    from places pl);
end $$;
alter function public.get_friend_saved_places(text) owner to postgres;
revoke all on function public.get_friend_saved_places(text) from public,anon,authenticated,service_role;
grant execute on function public.get_friend_saved_places(text) to authenticated;

-- New controls: the '보여 줄 곳' chip and its three choices, the empty-map actions and the notice before a first friend
-- request. An unknown target rejects the whole analytics batch, so this must reach production before the app build.
insert into private.behavior_targets(id) values
  ('discovery.scope'),
  ('discovery.scope.all'),
  ('discovery.scope.mine'),
  ('discovery.scope.friends'),
  ('discovery.scope.empty'),
  ('friend.notice.continue'),
  ('friend.notice.hide')
on conflict (id) do nothing;
notify pgrst,'reload schema';
