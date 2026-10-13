create index if not exists posts_public_author_activity_idx on public.posts(author_id,kind,created_at desc,id desc) where status='published' and room_preview is null;
create function public.get_public_user_profile(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'nickname',p.nickname,'neighborhood',p.neighborhood,'cityId',p.city_id,
    'verificationLevel',p.verification_level,'memberSince',p.created_at,'manner',public.get_manner_summary(p.id),
    'storyCount',(select count(*) from public.posts x where x.author_id=p.id and x.status='published' and x.kind='story' and x.room_preview is null and not private.has_reported(auth.uid(),'post',x.id)),
    'listingCount',(select count(*) from public.posts x where x.author_id=p.id and x.status='published' and x.kind='listing' and not private.has_reported(auth.uid(),'post',x.id)),
    'completedCount',(select count(*) from public.posts x where x.author_id=p.id and x.status='published' and x.kind='listing' and x.listing_status='closed' and not private.has_reported(auth.uid(),'post',x.id)))
  from public.profiles p where p.id=p_user_id and p.account_status='active'
    and not private.is_blocked_between(auth.uid(),p.id) and not private.has_reported(auth.uid(),'user',p.id);
$$;
create function public.get_public_user_activity(p_user_id uuid,p_kind text,p_before_created timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_kind is null or p_kind not in('story','listing') then raise exception 'INVALID_POST_KIND'; end if;
  if num_nonnulls(p_before_created,p_before_id)=1 then raise exception 'INVALID_CURSOR'; end if;
  if public.get_public_user_profile(p_user_id) is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(dto) order by page.created_at desc,page.id desc),'[]'::jsonb) into result
  from(select p.id,p.created_at from public.posts p
    where p.author_id=p_user_id and p.status='published' and p.kind=p_kind and p.room_preview is null
      and not private.has_reported(auth.uid(),'post',p.id)
      and (p_before_created is null or (p.created_at,p.id)<(p_before_created,p_before_id))
    order by p.created_at desc,p.id desc limit 30) page
  cross join lateral public.get_public_post(page.id) dto;
  return result;
end;
$$;
revoke all on function public.get_public_user_profile(uuid),public.get_public_user_activity(uuid,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_user_profile(uuid),public.get_public_user_activity(uuid,text,timestamptz,uuid) to anon,authenticated;
notify pgrst,'reload schema';

-- Existing cron, visibility and report functions run as postgres.
alter function public.get_public_user_profile(uuid) owner to postgres;
alter function public.get_public_user_activity(uuid,text,timestamptz,uuid) owner to postgres;
