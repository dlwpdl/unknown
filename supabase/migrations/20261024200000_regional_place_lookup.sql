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
 select jsonb_build_object('name',name,'address',address) into item from private.saved_partner_places where city_id=p_city and place_key=p_key;
 return item;
end $$;
revoke all on function private.saved_place_info(text,text) from public,anon,authenticated,service_role;
alter function private.saved_place_info(text,text) owner to postgres;
