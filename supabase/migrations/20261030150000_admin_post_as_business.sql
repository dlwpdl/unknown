-- Owner 2026-10-30: when the admin links its own post to a business, the post appears under that business profile;
-- a post with no business link stays under the admin profile. Only the elevated-admin RPC can do this, and the
-- business's monthly cap stays untouched: the admin's link is recorded as managed usage (see consume_business_usage).
do $migration$
declare definition text; anchor text;
begin
  -- The cap exemption this relies on (20261026070100) must be the live one; stop if it drifted.
  definition:=pg_get_functiondef('private.consume_business_usage(uuid,text,uuid,text)'::regprocedure);
  if position('managed:=auth.uid() is distinct from m.owner_id and coalesce(private.is_admin_id(auth.uid()),false);' in definition)=0
    or position('if not managed and cap is not null and used>=cap then raise exception ''BUSINESS_MONTHLY_LIMIT_REACHED''; end if;' in definition)=0
  then raise exception 'business usage admin exemption changed'; end if;

  definition:=pg_get_functiondef('public.link_admin_merchant_post(uuid,uuid,text)'::regprocedure);
  if position('if not private.is_admin() then raise exception ''ADMIN_REQUIRED''; end if;' in definition)=0
    or position('perform public.log_admin_access(''analytics'');' in definition)=0 then raise exception 'admin post link guard changed'; end if;
  anchor:='insert into private.merchant_posts(merchant_id,post_id,original_url) values(p_merchant_id,p_post_id,p_original_url)';
  if (select count(*) from regexp_matches(definition,'insert into private\.merchant_posts','g'))<>1 or position(anchor in definition)=0
  then raise exception 'admin post link insert changed'; end if;
  -- Official identity only for the calling admin's own non-meetup post; other members' posts stay curated links.
  definition:=replace(definition,anchor,
    'insert into private.merchant_posts(merchant_id,post_id,original_url,published_as_business) values(p_merchant_id,p_post_id,p_original_url,'
    ||'exists(select 1 from public.posts p join private.merchants m on m.id=p_merchant_id where p.id=p_post_id and p.author_id=auth.uid() '
    ||'and m.record_kind=''business'' and m.deleted_at is null and p.room_preview is null '
    ||'and not exists(select 1 from public.tags t where t.id=p.tag_id and t.kind=''meetup'')))');
  anchor:='on conflict(post_id) do update set original_url=excluded.original_url,updated_at=now()';
  if position(anchor in definition)=0 then raise exception 'admin post link conflict changed'; end if;
  -- Re-linking upgrades an earlier curated link of the admin's own post; it never downgrades official identity.
  definition:=replace(definition,anchor,
    'on conflict(post_id) do update set original_url=excluded.original_url,'
    ||'published_as_business=private.merchant_posts.published_as_business or excluded.published_as_business,updated_at=now()');
  execute definition;
end $migration$;
revoke all on function public.link_admin_merchant_post(uuid,uuid,text) from public,anon;
notify pgrst,'reload schema';
