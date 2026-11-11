-- owner 2026-11-11 "피드 장소 표시=글 아래 장소 카드, 지도에서 글 모으기=다음 단계로": a Gling map place picked while writing
-- also goes with the post's share preview (app chat card, KakaoTalk/SMS link preview).
--
-- No table changes. Compose place search (1.5.0, PR #126) already writes the picked place's coordinates as the body's map line:
--   Google 지도: https://www.google.com/maps/search/?api=1&query=<lat>%2C<lng>
--   위치: <name>
-- The post counts as that place only when the coordinates equal exactly one Gling map place of the same city
-- (the app uses the same rule, mapPinPlace, for the feed and post detail card). The name comes from the map data, not the
-- user-editable '위치:' line. Meetup posts never expose their body and are skipped.
-- The app's map and compose search offer places, regionalPlaces, extraPlaces and morePlaces, so all four lists are read.
-- shortcut: reads the map JSON (≤2MB) for one city per preview. A "this place's posts" screen would instead store the place on
--   the post (the unused 20261111210100 draft) and fill it with this function.

create function private.post_catalog_place(p_body text, p_city text) returns jsonb
language sql stable security definer set search_path='' as $$
  with pin as (
    select m[1]::numeric lat, m[2]::numeric lng
    from regexp_match(coalesce(p_body,''),
      '(?:^|\n)Google 지도: https://www\.google\.com/maps/search/\?api=1&query=(-?[0-9]{1,3}(?:\.[0-9]{1,15})?)%2C(-?[0-9]{1,3}(?:\.[0-9]{1,15})?)(?:\n|$)') m
  ), hits as (
    select e->>'id' id, e->>'name' name
    from pin, private.city_place_catalog c
      cross join lateral unnest(array['places','regionalPlaces','extraPlaces','morePlaces']) list
      cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'cities'->p_city->list)='array'
        then c.payload->'cities'->p_city->list else '[]'::jsonb end) e
    where c.id and e->>'cityId'=p_city
      and jsonb_typeof(e->'latitude')='number' and jsonb_typeof(e->'longitude')='number'
      and (e->>'latitude')::numeric=pin.lat and (e->>'longitude')::numeric=pin.lng
      and length(btrim(coalesce(e->>'name',''))) between 1 and 300
  )
  -- Two places on the same spot: unknown which one, so none.
  select case when count(distinct id)=1 then jsonb_build_object('id',min(id),'name',min(name)) end from hits;
$$;
revoke all on function private.post_catalog_place(text,text) from public,anon,authenticated,service_role;
alter function private.post_catalog_place(text,text) owner to postgres;

-- Add one 'place' field to the function the share previews read. As in the earlier preview migrations, read the live
-- definition, change one spot, and stop if it is not what we expect.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
  anchor constant text := '''closed'',';
begin
  if (char_length(definition) - char_length(replace(definition, anchor, ''))) / char_length(anchor) <> 1
    or position('private.post_catalog_place' in definition) > 0 then
    raise exception 'shared preview projection changed; review before adding the place';
  end if;
  execute replace(definition, anchor,
    '''place'',case when p.room_preview is null then private.post_catalog_place(p.body,p.city_id)->>''name'' end,'||anchor);
end $migration$;
notify pgrst, 'reload schema';
