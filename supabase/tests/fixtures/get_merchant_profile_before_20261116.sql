CREATE OR REPLACE FUNCTION public.get_merchant_profile(p_merchant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when m.consent='granted' then profile||jsonb_build_object('intro_vibe',m.intro_vibe,'intro_order',m.intro_order,'intro_tip',m.intro_tip,'saved',private.is_active_account(auth.uid()) and private.saved_merchant_at(auth.uid(),p_merchant_id) is not null,
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
$function$

