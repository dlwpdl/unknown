-- Reuse consented, visible post sources; private contact and review records stay unchanged.
create or replace function public.get_merchant_profile(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id,'city_name',c.name,
    'industry',m.industry,'services',m.services,'address',m.address,
    'avatar_path',m.avatar_path,'banner_path',m.banner_path,'review_post_id',visible.post_id,
    'source_urls',coalesce((select jsonb_agg(source.original_url order by source.created_at desc,source.original_url)
      from (select mp.original_url,max(p.created_at) as created_at
        from private.merchant_posts mp join public.posts p on p.id=mp.post_id
        where mp.merchant_id=m.id and private.valid_merchant_original(mp.original_url)
          and private.listing_alive(p.kind,p.status,p.listing_status,p.expires_at)
          and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id
        group by mp.original_url)source),'[]'::jsonb))
  from private.merchants m join public.cities c on c.id=m.city_id
  join lateral (
    select mp.post_id from private.merchant_posts mp join public.posts p on p.id=mp.post_id
    where mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id
    order by p.created_at desc,p.id desc limit 1
  )visible on true where m.id=p_merchant_id;
$$;
revoke all on function public.get_merchant_profile(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_profile(uuid) to anon,authenticated;
insert into private.behavior_targets(id) values ('company.source') on conflict do nothing;
notify pgrst,'reload schema';
