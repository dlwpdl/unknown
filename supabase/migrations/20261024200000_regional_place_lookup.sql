-- The legacy internal table also holds initial reviewed bundled identities.
-- OSM rows are ordinary place metadata, never a public partnership/business/Visited claim.
do $seed$
declare expected record; found_name text; found_address text;
begin
 for expected in select * from jsonb_to_recordset($regional_initial$[
  {
    "city_id": "vancouver",
    "place_key": "osm:way:41745659",
    "name": "Town Centre Park",
    "address": "1299 Pinetree Way, Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:way:41843304",
    "name": "Como Lake Park",
    "address": "700 Gatensbury Street, Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:way:41841917",
    "name": "Blue Mountain Park",
    "address": "975 King Albert Avenue, Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:way:1004996176",
    "name": "Mundy Park",
    "address": "641 Hillcrest Street, Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:relation:21109172",
    "name": "Minnekhada Regional Park",
    "address": "Quarry Road entrance, Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:way:42472552",
    "name": "Gates Park",
    "address": "2300 Reeve Street, Port Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:way:212904864",
    "name": "Lions Park",
    "address": "2300 Lions Way, Port Coquitlam, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:relation:1304120",
    "name": "Queen's Park",
    "address": "Queen's Park, New Westminster, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:way:170530924",
    "name": "Westminster Pier Park",
    "address": "Westminster Pier Park, Fourth Street / Sixth Street overpass access, New Westminster, BC, Canada"
  },
  {
    "city_id": "vancouver",
    "place_key": "osm:node:9381204484",
    "name": "Port Coquitlam Cenotaph",
    "address": "Veterans Park, 2580 Shaughnessy Street, Port Coquitlam, BC, Canada"
  }
]$regional_initial$::jsonb)
  as initial_places(city_id text,place_key text,name text,address text) order by place_key
 loop
  insert into private.saved_partner_places(city_id,place_key,name,address)
   values(expected.city_id,expected.place_key,expected.name,expected.address) on conflict(city_id,place_key) do nothing;
  select s.name,s.address into found_name,found_address from private.saved_partner_places s
   where s.city_id=expected.city_id and s.place_key=expected.place_key for share;
  if not found or found_name is distinct from expected.name or found_address is distinct from expected.address then
   raise exception 'REGIONAL_PLACE_SEED_CONFLICT';
  end if;
 end loop;
end $seed$;

-- Add optional regional identities to the same trusted projection. Existing base identities win.
create or replace function private.saved_place_info(p_city text,p_key text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare item jsonb; begin
 if exists(select 1 from private.webshop_place_links l join private.merchants m on m.id=l.merchant_id
  where l.place_key=p_key and (l.city_id<>p_city or m.city_id<>p_city)) then return null; end if;
 select p into item from private.city_place_catalog c cross join lateral jsonb_array_elements(coalesce(c.payload->'cities'->p_city->'places','[]'::jsonb)
   || case when jsonb_typeof(c.payload->'cities'->p_city->'regionalPlaces')='array' then c.payload->'cities'->p_city->'regionalPlaces' else '[]'::jsonb end) with ordinality as entries(p,ordinal)
  where p->>'id'=p_key and p->>'cityId'=p_city and p_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$'
  and p->>'category' in ('food','cafe','places') and jsonb_typeof(p->'name')='string' and length(btrim(p->>'name')) between 1 and 300
  and jsonb_typeof(p->'address')='string' and length(p->>'address')<=1000
  and case when jsonb_typeof(p->'latitude')='number' then (p->>'latitude')::numeric between 40 and 85 else false end
  and case when jsonb_typeof(p->'longitude')='number' then (p->>'longitude')::numeric between -142 and -52 else false end
  and p->>'sourceUrl'='https://www.openstreetmap.org/'||replace(substr(p_key,5),':','/') order by ordinal limit 1;
 if item is not null then return jsonb_build_object('name',item->>'name','address',coalesce(item->>'address','')); end if;
 -- A present regional field is authoritative, including empty or malformed tombstones.
 if p_key ~ '^osm:' and exists(select 1 from private.city_place_catalog c where (c.payload->'cities'->p_city) ? 'regionalPlaces') then return null; end if;
 select jsonb_build_object('name',name,'address',address) into item from private.saved_partner_places where city_id=p_city and place_key=p_key;
 return item;
end $$;
revoke all on function private.saved_place_info(text,text) from public,anon,authenticated,service_role;
alter function private.saved_place_info(text,text) owner to postgres;
