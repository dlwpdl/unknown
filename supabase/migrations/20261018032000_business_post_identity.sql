-- Linking a curated personal post does not confer official business authorship.
alter table private.merchant_posts add column published_as_business boolean not null default false;
create unique index merchant_post_business_identity_idx on private.merchant_posts(post_id) where published_as_business;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.publish_merchant_workspace_draft(uuid,uuid,timestamptz)'::regprocedure);
  anchor:='insert into private.merchant_posts(post_id,merchant_id,original_url,creation_request_id) values(pid,m.id,d.original_url,d.id);';
  if position(anchor in definition)=0 then raise exception 'business publication binding changed'; end if;
  definition:=replace(definition,anchor,
    'insert into private.merchant_posts(post_id,merchant_id,original_url,creation_request_id,published_as_business) '
    ||'values(pid,m.id,d.original_url,d.id,m.record_kind=''business'' and (coalesce(auth.uid()=m.owner_id,false) or exists(select 1 from private.merchant_operators where merchant_id=m.id and user_id=auth.uid())));');
  definition:=replace(definition,'case when auth.uid()=m.owner_id then',
    'case when auth.uid()=m.owner_id or exists(select 1 from private.merchant_operators where merchant_id=m.id and user_id=auth.uid()) then');
  definition:=replace(definition,'업체','비즈니스');
  execute definition;
end $$;

create function private.public_post_business_id(p_post_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select m.id from private.merchant_posts mp join private.merchants m on m.id=mp.merchant_id
  join public.posts p on p.id=mp.post_id join public.profiles actor on actor.id=p.author_id and actor.account_status='active'
  where mp.post_id=p_post_id and mp.published_as_business and m.record_kind='business' and m.deleted_at is null
    and m.consent='granted' and m.status<>'paused' and not private.is_blocked_between(auth.uid(),p.author_id)
    and not private.has_reported(auth.uid(),'post',p.id) and not private.has_reported(auth.uid(),'user',p.author_id)
    and exists(select 1 from public.get_public_post(p_post_id));
$$;
alter function private.public_post_business_id(uuid) owner to postgres;
revoke all on function private.public_post_business_id(uuid) from public,anon,authenticated,service_role;

create function public.get_public_post_businesses(p_post_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>50 or array_position(p_post_ids,null) is not null then raise exception 'INVALID_BUSINESS_POST_PAGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',ids.id,'business_id',m.id,'business_name',m.name) order by ids.id),'[]') into result
  from (select distinct unnest(p_post_ids) id)ids join private.merchants m on m.id=private.public_post_business_id(ids.id);
  return result;
end $$;
alter function public.get_public_post_businesses(uuid[]) owner to postgres;
revoke all on function public.get_public_post_businesses(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_public_post_businesses(uuid[]) to anon,authenticated;

-- A basic business with its own public post needs a profile, without gaining review privileges.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor:='''review_post_id'',visible.post_id';
  if position(anchor in definition)=0 then raise exception 'business profile DTO changed'; end if;
  definition:=replace(definition,anchor,'''review_post_id'',case when private.merchant_review_merchant(visible.post_id,auth.uid())=m.id then visible.post_id end');
  anchor:='where mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id';
  if position(anchor in definition)=0 then raise exception 'business profile visibility changed'; end if;
  execute replace(definition,anchor,
    'where mp.merchant_id=m.id and (private.merchant_review_merchant(mp.post_id,auth.uid())=m.id or private.public_post_business_id(mp.post_id)=m.id)');
  definition:=pg_get_functiondef('public.get_merchant_profile_posts(uuid,text,integer)'::regprocedure);
  anchor:='where mp.merchant_id=p_merchant_id and private.merchant_review_merchant(p.id,auth.uid())=p_merchant_id';
  if position(anchor in definition)=0 then raise exception 'business profile post visibility changed'; end if;
  execute replace(definition,anchor,
    'where mp.merchant_id=p_merchant_id and (private.merchant_review_merchant(p.id,auth.uid())=p_merchant_id or private.public_post_business_id(p.id)=p_merchant_id)');
end $$;

-- Match an official business name while retaining the feed's own cursor and visibility predicates.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_public_feed_page_v2(text,smallint,text,timestamptz,uuid,integer)'::regprocedure);
  anchor:='(select post.id from eligible post where q is not null and post.author_id in';
  if position(anchor in definition)=0 then raise exception 'business feed search anchor changed'; end if;
  execute replace(definition,anchor,
    '(select post.id from eligible post where q is not null and post.id in (select mp.post_id from private.merchant_posts mp '
    ||'join private.merchants m on m.id=mp.merchant_id where mp.published_as_business and m.name ilike ''%''||q||''%'' '
    ||'and private.public_post_business_id(mp.post_id)=m.id) order by post.sort_at desc,post.id desc limit page_size) union '||anchor);
  if to_regprocedure('public.get_discovery_posts(text,smallint,text,timestamptz,uuid,integer)') is not null then
    definition:=pg_get_functiondef('public.get_discovery_posts(text,smallint,text,timestamptz,uuid,integer)'::regprocedure);
    anchor:='(q is null or (post.title||'' ''||post.body||'' ''||array_to_string(post.hashtags,'' '')) ilike ''%''||q||''%'')';
    if position(anchor in definition)=0 then raise exception 'business discovery search anchor changed'; end if;
    execute replace(definition,anchor,
      '(q is null or (post.title||'' ''||post.body||'' ''||array_to_string(post.hashtags,'' '')) ilike ''%''||q||''%'' '
      ||'or exists(select 1 from private.merchants m where m.id=private.public_post_business_id(post.id) and m.name ilike ''%''||q||''%''))');
  end if;
end $$;
notify pgrst,'reload schema';
