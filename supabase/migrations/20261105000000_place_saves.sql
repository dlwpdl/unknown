-- Who saved a map place (owner 2026-11-03 G2 "누가 저장했나 + 소개 3칸 + 비슷한 곳 + 들어간 목록 다"), the same shape as
-- get_merchant_saves: a member count, the viewer's friends who share their saved places, and places saved together.
-- A business-linked place counts its business saves too, because that place opens the business page.
create function private.place_savers(p_city text,p_key text) returns table(user_id uuid,saved_at timestamptz)
language sql stable security definer set search_path='' as $$
  select x.user_id,max(x.saved_at) from (
    select s.user_id,s.created_at saved_at from private.saved_places s where s.city_id=p_city and s.place_key=p_key
    union all
    select sm.user_id,sm.created_at from private.webshop_place_links l
      join private.saved_merchants sm on sm.merchant_id=l.merchant_id where l.city_id=p_city and l.place_key=p_key
  ) x where private.is_active_account(x.user_id) and not private.is_operated_character(x.user_id)
  group by x.user_id
$$;

-- A similar place needs at least 3 members who saved both, so one person's saves never show through. Only place keys
-- leave the database; the app names them from its own catalog and drops keys it does not know, so up to 5 come back.
create function public.get_place_saves(p_city_id text,p_place_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); week_start timestamptz;
begin
  if p_city_id is null or p_place_key is null or not exists(select 1 from public.cities c where c.id=p_city_id)
    or not (p_place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or p_place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$') then return null; end if;
  week_start:=date_trunc('week',now() at time zone 'America/Vancouver') at time zone 'America/Vancouver';
  return jsonb_build_object('placeKey',p_place_key,
    'saverCount',(select count(*)::integer from private.place_savers(p_city_id,p_place_key)),
    'weekCount',(select count(*)::integer from private.place_savers(p_city_id,p_place_key) w where w.saved_at>=week_start),
    'friends',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'nickname',f.nickname,'savedAt',f.saved_at) order by f.saved_at desc),'[]'::jsonb)
      from (select p.id,p.nickname,s.saved_at from private.place_savers(p_city_id,p_place_key) s
        join public.profiles p on p.id=s.user_id
        left join private.profile_sharing ps on ps.user_id=s.user_id
        where coalesce(ps.saved_places_to_friends,true) and uid is not null and s.user_id<>uid and private.are_friends(uid,s.user_id) and private.friend_pair_ok(uid,s.user_id)
        order by s.saved_at desc limit 20) f),
    'similar',(select coalesce(jsonb_agg(jsonb_build_object('placeKey',o.place_key,'saverCount',o.savers,'weekCount',o.week_count)
        order by o.together desc,o.savers desc,o.place_key),'[]'::jsonb)
      from (select co.place_key,co.together,
          (select count(*)::integer from private.place_savers(p_city_id,co.place_key)) savers,
          (select count(*)::integer from private.place_savers(p_city_id,co.place_key) w where w.saved_at>=week_start) week_count
        from (select sp.place_key,count(distinct sp.user_id) together
            from private.place_savers(p_city_id,p_place_key) s join private.saved_places sp on sp.user_id=s.user_id and sp.city_id=p_city_id
            where sp.place_key<>p_place_key
            group by sp.place_key having count(distinct sp.user_id)>=3) co
        order by co.together desc,savers desc,co.place_key limit 5) o));
end $$;

do $$ declare signature text; begin
 foreach signature in array array['private.place_savers(text,text)','public.get_place_saves(text,text)'] loop
  execute 'alter function '||signature||' owner to postgres';
  execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
 end loop;
end $$;
grant execute on function public.get_place_saves(text,text) to anon,authenticated;

-- An unknown target rejects the whole analytics batch, so these must reach production before the app build.
insert into private.behavior_targets(id) values
  ('places.saves.friend'),('places.similar'),('places.list'),('places.intro.source')
on conflict (id) do nothing;
notify pgrst,'reload schema';
