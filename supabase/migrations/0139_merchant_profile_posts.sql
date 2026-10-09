-- Counts and pages share canonical visibility; only selected rows load the public DTO.
create function public.get_merchant_profile_posts(p_merchant_id uuid,p_kind text default 'posts',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_kind is null or p_kind not in ('posts','jobs') then raise exception 'INVALID_MERCHANT_PROFILE_KIND'; end if;
  if p_offset is null or p_offset<0 or p_offset>10000 then raise exception 'INVALID_MERCHANT_PROFILE_OFFSET'; end if;
  if public.get_merchant_profile(p_merchant_id) is null then return null; end if;
  with visible as materialized (
    select p.id,p.created_at,t.slug as tag_slug from private.merchant_posts mp
    join public.posts p on p.id=mp.post_id join public.tags t on t.id=p.tag_id
    where mp.merchant_id=p_merchant_id and private.merchant_review_merchant(p.id,auth.uid())=p_merchant_id
      and private.listing_alive(p.kind,p.status,p.listing_status,p.expires_at)
  ) select jsonb_build_object('merchant_id',p_merchant_id,'kind',p_kind,
    'post_count',(select count(*) from visible where tag_slug<>'jobs'),
    'job_count',(select count(*) from visible where tag_slug='jobs'),
    'posts',coalesce((select jsonb_agg(to_jsonb(dto) order by dto.created_at desc,dto.id desc)
      from (select * from visible where (tag_slug='jobs')=(p_kind='jobs')
        order by created_at desc,id desc limit 20 offset p_offset)page
      cross join lateral public.get_public_post(page.id) dto),'[]'::jsonb),
    'has_more',p_offset+20<=10000 and (select count(*) from visible where (tag_slug='jobs')=(p_kind='jobs'))>p_offset+20) into result;
  return result;
end;
$$;
revoke all on function public.get_merchant_profile_posts(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_profile_posts(uuid,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
