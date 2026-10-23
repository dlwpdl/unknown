-- Narrow public projections; existing profile/post privacy predicates remain authoritative.
create or replace function private.unified_search_rank(p_title text,p_query text) returns integer
language sql immutable set search_path='' as $$
 select case when title=p_query then 0 when left(title,length(p_query))=p_query then 1 when strpos(title,p_query)>0 then 2 end
 from(select replace(lower(normalize(regexp_replace(btrim(coalesce(p_title,'')),'[[:space:]]+',' ','g'),NFKC)),'지모코','jimoco') title)s
$$;
revoke all on function private.unified_search_rank(text,text) from public,anon,authenticated,service_role;
alter function private.unified_search_rank(text,text) owner to postgres;

create or replace function public.search_public_directory(p_query text,p_city_id text,p_kind text default 'all',p_offset integer default 0,p_places jsonb default '[]') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text; candidate jsonb; result jsonb;
begin
 if p_query is null or length(btrim(p_query))>120 or p_kind is null or p_kind not in ('all','business','place','person','post','meetup')
  or p_offset is null or p_offset<0 or p_offset>2147483600 or (p_kind='all' and p_offset<>0) then raise exception 'INVALID_UNIFIED_SEARCH_QUERY'; end if;
 if p_city_id is not null and not exists(select 1 from public.cities where id=p_city_id and is_open and province in('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')) then raise exception 'INVALID_UNIFIED_SEARCH_CITY'; end if;
 q:=replace(lower(normalize(regexp_replace(btrim(p_query),'[[:space:]]+',' ','g'),NFKC)),'지모코','jimoco');
 if jsonb_typeof(p_places) is distinct from 'array' or jsonb_array_length(p_places)>2200 then raise exception 'INVALID_UNIFIED_SEARCH_PLACES'; end if;
 -- Current open-city client catalog admits 360 curated/partner keys; 2200 bounds Canada-wide resolution.
 for candidate in select value from jsonb_array_elements(p_places) loop
  if jsonb_typeof(candidate) is distinct from 'object' then raise exception 'INVALID_UNIFIED_SEARCH_PLACES'; end if;
  if (select count(*) from jsonb_object_keys(candidate))<>3 or jsonb_typeof(candidate->'cityId') is distinct from 'string'
   or jsonb_typeof(candidate->'placeId') is distinct from 'string' or jsonb_typeof(candidate->'rank') is distinct from 'number'
   or candidate->>'rank' !~ '^[0-2]$' or length(candidate->>'placeId')>120
   or not(candidate->>'placeId' ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or candidate->>'placeId' ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$')
   or (p_city_id is not null and candidate->>'cityId'<>p_city_id)
   or not exists(select 1 from public.cities where id=candidate->>'cityId' and is_open and province in('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')) then raise exception 'INVALID_UNIFIED_SEARCH_PLACES'; end if;
 end loop;
 if (select count(distinct(value->>'cityId',value->>'placeId')) from jsonb_array_elements(p_places))<>jsonb_array_length(p_places) then raise exception 'INVALID_UNIFIED_SEARCH_PLACES'; end if;
 if q='' then return jsonb_build_object('query',q,'cityId',p_city_id,'kind',p_kind,'offset',p_offset,'items','[]'::jsonb,'links','[]'::jsonb,'hasMore',false,'nextOffset',p_offset); end if;
 with candidates as materialized (
  select value->>'cityId' city,value->>'placeId' place,(value->>'rank')::integer rank from jsonb_array_elements(p_places)
 ), linked as materialized (
  select c.city,c.place,c.rank,l.merchant_id from candidates c join private.webshop_place_links l on l.city_id=c.city and l.place_key=c.place
 ), link_rank as materialized(select merchant_id,min(rank) rank from linked group by merchant_id),
 merchant_candidates as materialized (
  select m.id,m.name,m.city_id,m.address,m.owner_id,m.owner_verified_at,
   least(private.unified_search_rank(m.name,q),l.rank,
    case when private.unified_search_rank(m.industry,q) is not null
     or (q in('cafe','café','coffee','카페','커피') and m.industry ~* '(caf[eé]|coffee|카페|커피)') then 2 end) rank
  from private.merchants m join public.cities c on c.id=m.city_id left join link_rank l on l.merchant_id=m.id
  where c.is_open and c.province in('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT') and (p_city_id is null or m.city_id=p_city_id)
   and m.record_kind='business' and m.deleted_at is null and m.consent='granted' and m.status<>'paused'
   and not exists(select 1 from public.profiles where id=m.id)
   and not exists(select 1 from private.business_blocks where user_id=auth.uid() and business_id=m.id)
   and ((p_kind in('all','business') and (private.unified_search_rank(m.name,q) is not null
    or private.unified_search_rank(m.industry,q) is not null
    or (q in('cafe','café','coffee','카페','커피') and m.industry ~* '(caf[eé]|coffee|카페|커피)'))) or l.merchant_id is not null)
 ), merchants as materialized (
  select m.* from merchant_candidates m where
   (m.owner_verified_at is not null and private.is_active_account(m.owner_id)
    and exists(select 1 from auth.users u where u.id=m.owner_id and u.raw_app_meta_data->'merchant_enabled'='true'::jsonb)
    and not private.is_blocked_between(auth.uid(),m.owner_id) and not private.has_reported(auth.uid(),'user',m.owner_id))
   or exists(select 1 from private.merchant_posts mp where mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id)
   or exists(select 1 from public.posts p where p.business_author_id=m.id and private.public_post_business_id(p.id)=m.id)
 ), people as materialized (
  select p.id,p.nickname::text title,p.city_id,private.unified_search_rank(p.nickname::text,q) rank
  from public.profiles p join public.cities c on c.id=p.city_id
  where p_kind in('all','person') and p.account_status='active' and c.is_open and c.province in('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
   and (p_city_id is null or p.city_id=p_city_id) and private.unified_search_rank(p.nickname::text,q) is not null
   and not private.is_blocked_between(auth.uid(),p.id) and not private.has_reported(auth.uid(),'user',p.id)
 ), post_candidates as materialized (
  select p.id,p.author_id,p.business_author_id,p.title,p.city_id,p.room_preview is not null meetup,t.label,
   coalesce(private.unified_search_rank(p.title,q),2) rank
  from public.posts p join public.tags t on t.id=p.tag_id join public.cities c on c.id=p.city_id
  where p_kind in('all','post','meetup') and p.status='published' and c.is_open and c.province in('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
   and (p_city_id is null or p.city_id=p_city_id) and (p_kind='all' or (p.room_preview is not null)=(p_kind='meetup'))
   and (private.unified_search_rank(p.title,q) is not null or private.unified_search_rank(t.label,q) is not null
    or exists(select 1 from unnest(p.hashtags) tag where private.unified_search_rank(tag,q) is not null))
 ), posts as materialized (
  select p.* from post_candidates p join public.profiles a on a.id=p.author_id and a.account_status='active'
  where not private.is_blocked_between(auth.uid(),a.id) and not private.has_reported(auth.uid(),'user',a.id)
   and not private.has_reported(auth.uid(),'post',p.id) and (p.business_author_id is null or private.public_post_business_id(p.id)=p.business_author_id)
 ), found as (
  select 'business'::text kind,m.id,m.city_id,m.name title,left(coalesce(m.address,''),1000) subtitle,m.rank from merchants m where p_kind in('all','business')
  union all select 'person',id,city_id,title,''::text,rank from people
  union all select case when meetup then 'meetup' else 'post' end,id,city_id,title,label,rank from posts
 ), ranked as (
  select *,row_number() over(partition by kind order by rank,lower(title) collate "C",city_id collate "C",id) position from found
 ), page as materialized (
  select * from ranked where (p_kind='all' and position<=3) or (p_kind<>'all' and kind=p_kind)
  order by kind collate "C",rank,lower(title) collate "C",city_id collate "C",id limit case when p_kind='all' then 12 else 21 end offset p_offset
 ), shown as materialized(select * from page order by kind collate "C",rank,lower(title) collate "C",city_id collate "C",id limit 20)
 select jsonb_build_object('query',q,'cityId',p_city_id,'kind',p_kind,'offset',p_offset,
  'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind',kind,'id',id,'cityId',city_id,'title',title,'subtitle',subtitle,'merchantId',case when kind='business' then id end)) order by kind collate "C",rank,lower(title) collate "C",city_id collate "C",id) from shown),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(jsonb_build_object('cityId',l.city,'placeId',l.place,'merchantId',m.id) order by l.city,l.place) from linked l join merchants m on m.id=l.merchant_id and m.city_id=l.city),'[]'::jsonb),
  'hasMore',p_kind<>'all' and (select count(*)>20 from page),
  'nextOffset',case when p_kind='all' then 0 else p_offset+(select count(*) from shown) end) into result;
 return result;
end $$;
revoke all on function public.search_public_directory(text,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.search_public_directory(text,text,text,integer,jsonb) to anon,authenticated;
alter function public.search_public_directory(text,text,text,integer,jsonb) owner to postgres;
insert into private.behavior_targets(id) values
 ('search.back'),('search.input.clear'),('search.scope.city'),('search.scope.canada'),
 ('search.kind.all'),('search.kind.business'),('search.kind.place'),('search.kind.person'),('search.kind.post'),('search.kind.meetup'),
 ('search.result.business'),('search.result.place'),('search.result.person'),('search.result.post'),('search.result.meetup'),
 ('search.group.more'),('search.more'),('search.results'),('search.entry.map') on conflict do nothing;
notify pgrst,'reload schema';
