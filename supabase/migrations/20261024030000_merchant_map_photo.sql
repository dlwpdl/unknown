-- Map cards have their own image; channel logo/banner and older clients keep their contract.
alter table private.merchants add column map_photo_path text
  constraint merchants_map_photo_path_check check(map_photo_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
    and split_part(split_part(map_photo_path,'/',2),'_',1)=id::text);
create index merchants_map_photo_path_idx on private.merchants(map_photo_path) where map_photo_path is not null;

do $$
declare definition text; anchor text; signature text;
begin
  definition:=pg_get_functiondef('public.get_my_merchant_profile(uuid)'::regprocedure);
  anchor:='''avatar_path'',m.avatar_path,''banner_path'',m.banner_path,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MY_MERCHANT_PHOTO_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||'''map_photo_path'',m.map_photo_path,');

  definition:=pg_get_functiondef('public.get_my_business_chat_profiles()'::regprocedure);
  anchor:='''city_name'',c.name,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_CHAT_PROFILE_FIELDS_CHANGED'; end if;
  execute replace(definition,anchor,anchor||$avatar$
      'avatar_path',case when m.avatar_path is not null then 'business-profile/'||m.id::text||'/avatar/'||md5(m.avatar_path) end,$avatar$);

  foreach signature in array array['private.can_read_merchant_profile_image(text)','private.can_delete_merchant_profile_image(text)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='avatar_path=p_path or banner_path=p_path';
    if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_PHOTO_STORAGE_GUARD_CHANGED: %',signature; end if;
    execute replace(definition,anchor,anchor||' or map_photo_path=p_path');
  end loop;

  definition:=pg_get_functiondef('public.account_image_cleanup_paths(uuid,text,text[])'::regprocedure);
  anchor:='avatar_path=path or banner_path=path';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_PHOTO_ACCOUNT_CLEANUP_CHANGED'; end if;
  execute replace(definition,anchor,anchor||' or map_photo_path=path');

  definition:=pg_get_functiondef('private.erase_deleted_merchant_channel_images()'::regprocedure);
  anchor:='avatar_path is not null or banner_path is not null';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_PHOTO_ERASURE_FILTER_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||' or map_photo_path is not null');
  anchor:='updated_at=clock_timestamp() where id=m.id;';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_PHOTO_ERASURE_CHANGED'; end if;
  execute replace(definition,anchor,'map_photo_path=null,'||anchor);

  definition:=pg_get_functiondef('private.erase_deleted_merchant_workspace()'::regprocedure);
  anchor:='set avatar_path=null,banner_path=null,';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'MERCHANT_PHOTO_WORKSPACE_ERASURE_CHANGED'; end if;
  execute replace(definition,anchor,'set map_photo_path=null,avatar_path=null,banner_path=null,');

  definition:=pg_get_functiondef('public.get_business_public_media(uuid,text,integer,uuid)'::regprocedure);
  anchor:='p_kind not in (''post'',''avatar'',''banner'')';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_MEDIA_KINDS_CHANGED'; end if;
  definition:=replace(definition,anchor,'p_kind not in (''post'',''avatar'',''banner'',''map'')');
  anchor:='case when p_kind=''avatar'' then m.avatar_path else m.banner_path end';
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'BUSINESS_MEDIA_PHOTO_RESOLVER_CHANGED'; end if;
  execute replace(definition,anchor,'case p_kind when ''avatar'' then m.avatar_path when ''banner'' then m.banner_path when ''map'' then m.map_photo_path end');
end $$;

create function public.save_my_merchant_profile_photos(p_merchant_id uuid,p_avatar_path text,p_banner_path text,p_map_photo_path text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  m:=private.lock_merchant_profile_owner(p_merchant_id,true);
  if m.avatar_path is not distinct from p_avatar_path and m.banner_path is not distinct from p_banner_path and m.map_photo_path is not distinct from p_map_photo_path then
    return public.get_my_merchant_profile(m.id);
  end if;
  if p_expected_updated_at is distinct from m.updated_at then raise exception 'MERCHANT_PROFILE_CHANGED'; end if;
  perform private.assert_merchant_profile_image(p_avatar_path,m.id,m.avatar_path);
  perform private.assert_merchant_profile_image(p_banner_path,m.id,m.banner_path);
  perform private.assert_merchant_profile_image(p_map_photo_path,m.id,m.map_photo_path);
  update private.merchants set avatar_path=p_avatar_path,banner_path=p_banner_path,map_photo_path=p_map_photo_path,updated_at=clock_timestamp() where id=m.id;
  return public.get_my_merchant_profile(m.id);
end $$;

create function public.get_city_business_map_photos(p_city_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('placeKey',p.place_key,'merchantId',p.merchant_id,'cityId',p.city_id,
    'photoPath','business-profile/'||p.merchant_id::text||'/map/'||md5(p.map_photo_path)) order by p.place_key),'[]'::jsonb)
  from (select l.place_key,l.merchant_id,l.city_id,m.map_photo_path from private.webshop_place_links l
    join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id
    where l.city_id=p_city_id and m.map_photo_path is not null and public.get_merchant_profile(m.id) is not null
      and exists(select 1 from storage.objects o where o.bucket_id='merchant-profile-images' and o.name=m.map_photo_path)
    order by l.place_key limit 1000) p;
$$;
alter function public.save_my_merchant_profile_photos(uuid,text,text,text,timestamptz) owner to postgres;
alter function public.get_city_business_map_photos(text) owner to postgres;
revoke all on function public.save_my_merchant_profile_photos(uuid,text,text,text,timestamptz),public.get_city_business_map_photos(text) from public,anon,authenticated,service_role;
grant execute on function public.save_my_merchant_profile_photos(uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.get_city_business_map_photos(text) to anon,authenticated;
notify pgrst,'reload schema';
