-- Restrict both post paths before privacy checks; retain all existing visibility gates.
do $$
declare
  definition text;
  old_lookup text := $old$
    select p.id post_id from public.posts p left join private.merchant_posts mp on mp.post_id=p.id and mp.merchant_id=m.id
    where (mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id) or (p.business_author_id=m.id and private.public_post_business_id(p.id)=m.id)
    order by p.created_at desc,p.id desc limit 1$old$;
  new_lookup text := $new$
    select candidate.id post_id from (
      select p.id,p.created_at from private.merchant_posts mp join public.posts p on p.id=mp.post_id
      where mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id
      union
      select p.id,p.created_at from public.posts p
      where p.business_author_id=m.id and private.public_post_business_id(p.id)=m.id
    )candidate order by candidate.created_at desc,candidate.id desc limit 1$new$;
begin
  definition := pg_get_functiondef('private.business_base_get_merchant_profile(uuid)'::regprocedure);
  if array_length(string_to_array(definition,old_lookup),1) <> 2 then
    raise exception 'MERCHANT_PROFILE_LOOKUP_SHAPE_CHANGED';
  end if;
  execute replace(definition,old_lookup,new_lookup);
end $$;
