-- Owner 2026-11-03 "글링앱에 비즈니스글 복사해올때, 글링 비즈니스프로필로 카피해와", "연결안됏지만 보여지는건 어쨋든 그 비즈니스
-- 여야할거같고, 나중에 가입하면 연결시킬수잇게?": the admin's own copy of a business's public post shows under that business,
-- also before the business has answered (consent pending) and before an owner connects. A withdrawn business (revoked) stays
-- blocked. Until it agrees, the business shows only its name, city, industry and these posts; its other fields, photos, webshop
-- and map places stay private, and it stays out of the directory and search (they already require granted).

create or replace function public.link_admin_merchant_post(p_merchant_id uuid, p_post_id uuid, p_original_url text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare as_business boolean;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform public.log_admin_access('analytics');
  if not exists(select 1 from private.merchants where id=p_merchant_id and consent in ('granted','pending')) then raise exception 'MERCHANT_CONSENT_REQUIRED'; end if;
  if not private.valid_merchant_original(p_original_url) then raise exception 'INVALID_ORIGINAL_URL'; end if;
  if not exists(select 1 from public.posts p join private.merchants m on m.id=p_merchant_id where p.id=p_post_id and p.city_id=m.city_id and p.status='published') then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  -- Only the admin's own post moves under the business; anyone else's post stays under its author.
  select m.record_kind='business' and p.author_id=auth.uid()
  into as_business from private.merchants m join public.posts p on p.id=p_post_id where m.id=p_merchant_id;
  insert into private.merchant_posts(merchant_id,post_id,original_url,published_as_business) values(p_merchant_id,p_post_id,p_original_url,as_business)
  on conflict(post_id) do update set original_url=excluded.original_url,updated_at=now(),
    published_as_business=private.merchant_posts.published_as_business or excluded.published_as_business
    where private.merchant_posts.merchant_id=excluded.merchant_id;
  if not found then raise exception 'POST_ALREADY_LINKED'; end if;
  return p_post_id;
end;
$function$;

create or replace function private.public_post_business_id_for(p_post_id uuid, p_viewer uuid)
returns uuid language sql stable security definer set search_path to '' as $function$
  select m.id from public.posts p join private.merchants m on m.id=p.business_author_id
  join public.profiles actor on actor.id=p.author_id and actor.account_status='active'
  where p.id=p_post_id and p.status='published' and m.record_kind='business' and m.deleted_at is null
    and (m.consent='granted' or (m.consent='pending'
      -- Before the business agrees, only an admin's own copy linked as the business shows under its name.
      and exists(select 1 from private.merchant_posts mp where mp.post_id=p.id and mp.merchant_id=m.id and mp.published_as_business)
      and exists(select 1 from auth.users u where u.id=p.author_id and u.raw_app_meta_data->>'role'='admin')))
    and m.status<>'paused' and not exists(select 1 from public.profiles where id=m.id)
    and not exists(select 1 from private.business_blocks where user_id=p_viewer and business_id=m.id)
    and not private.is_blocked_between(p_viewer,p.author_id)
    and not private.has_reported(p_viewer,'post',p.id) and not private.has_reported(p_viewer,'user',p.author_id);
$function$;

-- A business that has not agreed yet gave no permission, so its posts say we copied what it made public instead.
create or replace function private.bind_business_post_identity()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.published_as_business then
    update public.posts set business_author_id=new.merchant_id where id=new.post_id
      and (business_author_id is null or business_author_id=new.merchant_id);
    if not found then raise exception 'BUSINESS_IDENTITY_CONFLICT'; end if;
    update public.posts p set body=p.body||E'\n\n'||case when m.consent='pending' then '비즈니스가 공개한 내용을 글링에서 옮겨 게시한 안내입니다.'
        else '비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.' end from private.merchants m
      where p.id=new.post_id and m.id=new.merchant_id and p.author_id is distinct from m.owner_id
        and not exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=p.author_id)
        and strpos(p.body,'글링에서 대신 게시한 안내')=0 and strpos(p.body,'글링에서 옮겨 게시한 안내')=0;  -- older posts say 업체의 허락을 받아 … at the top
  end if;
  return new;
end $function$;

-- A pending business with such a post gets a profile of its name, city, industry and posts; every other field is blanked.
create or replace function public.get_merchant_profile(p_merchant_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select case when m.consent='granted' then profile||jsonb_build_object('saved',private.is_active_account(auth.uid()) and private.saved_merchant_at(auth.uid(),p_merchant_id) is not null,
    'avatar_path',case when profile->>'avatar_path' is not null then 'business-profile/'||p_merchant_id::text||'/avatar/'||md5(profile->>'avatar_path') end,
    'banner_path',case when profile->>'banner_path' is not null then 'business-profile/'||p_merchant_id::text||'/banner/'||md5(profile->>'banner_path') end,
    'can_message',false,
    'can_business_message',auth.uid() is not null and private.business_chat_can_use(auth.uid(),null)
      and private.business_chat_business_ready(m.id)
      and not private.is_blocked_between(auth.uid(),m.owner_id) and not private.has_reported(auth.uid(),'user',m.owner_id))
  else jsonb_build_object('id',profile->'id','name',profile->'name','city_id',profile->'city_id','city_name',profile->'city_name',
    'industry',profile->'industry','services','','address','','public_phone','','business_hours','',
    'avatar_path',null,'banner_path',null,'review_post_id',null,'source_urls','[]'::jsonb,'can_message',false,'can_business_message',false,
    'saved',private.is_active_account(auth.uid()) and private.saved_merchant_at(auth.uid(),p_merchant_id) is not null,
    'notifications_enabled',profile->'notifications_enabled') end
  from (select private.business_base_get_merchant_profile(p_merchant_id) profile)x
  join private.merchants m on m.id=p_merchant_id and m.record_kind='business' and m.deleted_at is null and m.status<>'paused'
    and (m.consent='granted' or (m.consent='pending'
      and exists(select 1 from public.posts p where p.business_author_id=m.id and private.public_post_business_id(p.id)=m.id)))
  where profile is not null and not exists(select 1 from public.profiles where id=m.id)
    and not exists(select 1 from private.business_blocks where user_id=auth.uid() and business_id=m.id);
$function$;

create or replace function public.get_public_post_businesses(p_post_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>50 or array_position(p_post_ids,null) is not null then raise exception 'INVALID_BUSINESS_POST_PAGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',ids.id,'business_id',m.id,'business_name',m.name,
    'avatar_path',case when m.avatar_path is not null and m.consent='granted' then 'business-profile/'||m.id::text||'/avatar/'||md5(m.avatar_path) end) order by ids.id),'[]') into result
  from (select distinct unnest(p_post_ids) id)ids join private.merchants m on m.id=private.public_post_business_id(ids.id);
  return result;
end $function$;

-- These treat a non-null profile as "the business's own photos, webshop and map places are public"; that still needs granted.
do $$
declare fn text; definition text; anchor constant text:='public\.get_merchant_profile\(([a-z_.]+)\) is not null';
begin
  foreach fn in array array['public.get_business_public_media(uuid,text,integer,uuid)','public.get_city_business_links(text)',
    'public.get_city_business_map_photos(text)','public.get_public_webshop(uuid)','public.resolve_webshop_redirect(uuid,uuid,text,text,text)'] loop
    definition:=pg_get_functiondef(fn::regprocedure);
    if (select count(*) from regexp_matches(definition,anchor,'g'))<>1 then raise exception 'BUSINESS_ASSET_GATE_CHANGED: %',fn; end if;
    execute regexp_replace(definition,anchor,'(\& and exists(select 1 from private.merchants consented where consented.id=\1 and consented.consent=''granted''))');
  end loop;
end $$;

notify pgrst,'reload schema';
