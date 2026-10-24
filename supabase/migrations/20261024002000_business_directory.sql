-- Optional directory; the existing public profile remains the visibility authority.
insert into private.behavior_targets(id) values
  ('business.news.author'),('business.news.post'),('business.directory.open'),('business.directory.back'),
  ('business.directory.query.clear'),('business.directory.industry'),('business.directory.industries'),('business.directory.list'),('business.directory.profile'),
  ('business.directory.save'),('business.directory.more'),('business.directory.retry')
on conflict(id) do nothing;

create function public.get_public_business_directory(
  p_city_id text,p_query text default '',p_industry text default null,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=btrim(p_query); industry_filter text:=btrim(p_industry); result jsonb;
begin
  if p_city_id is null or length(p_city_id) not between 1 and 100 or btrim(p_city_id)<>p_city_id
    or p_city_id ~ '[[:cntrl:]]' or p_query is null or length(p_query)>200 or p_query ~ '[[:cntrl:]]'
    or p_industry is not null and (length(industry_filter) not between 1 and 200 or p_industry ~ '[[:cntrl:]]')
    or p_offset is null or p_offset<0 or p_offset>10000 then
    raise exception 'INVALID_BUSINESS_DIRECTORY_REQUEST';
  end if;
  with profiles as materialized (
    select public.get_merchant_profile(m.id) profile
    from private.merchants m join public.cities c on c.id=m.city_id and c.is_open
    where m.city_id=p_city_id and m.record_kind='business' and m.deleted_at is null
      and m.consent='granted' and m.status<>'paused'
  ), visible as materialized (
    select profile->>'id' id,profile->>'name' name,profile->>'city_id' city_id,
      coalesce(nullif(btrim(profile->>'industry'),''),'기타') industry,
      profile->>'services' services,profile->>'address' address,
      profile->'avatar_path' avatar_path,profile->'banner_path' banner_path,
      coalesce((profile->>'saved')::boolean,false) saved
    from profiles where profile is not null
  ), page as materialized (
    select * from visible
    where (industry_filter is null or industry=industry_filter)
      and (q='' or strpos(lower(name),lower(q))>0 or strpos(lower(industry),lower(q))>0
        or strpos(lower(services),lower(q))>0 or strpos(lower(address),lower(q))>0)
    order by industry collate "C",name collate "C",id collate "C" limit 21 offset p_offset
  ), items as (
    select * from page order by industry collate "C",name collate "C",id collate "C" limit 20
  ) select jsonb_build_object('city_id',p_city_id,'query',q,'industry',industry_filter,'offset',p_offset,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'city_id',i.city_id,
      'industry',i.industry,'services',i.services,'address',i.address,'avatar_path',i.avatar_path,
      'banner_path',i.banner_path,'saved',i.saved,'has_webshop',public.get_public_webshop(i.id::uuid) is not null)
      order by i.industry collate "C",i.name collate "C",i.id collate "C") from items i),'[]'::jsonb),
    'industries',coalesce((select jsonb_agg(industry order by industry collate "C") from (select distinct industry from visible) v),'[]'::jsonb),
    'has_more',(select count(*)>20 from page),'next_offset',p_offset+(select count(*) from items)) into result;
  return result;
end $$;
alter function public.get_public_business_directory(text,text,text,integer) owner to postgres;
revoke all on function public.get_public_business_directory(text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_public_business_directory(text,text,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
