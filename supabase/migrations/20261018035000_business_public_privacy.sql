-- Official provenance survives unlinking/retiring a business; the real actor stays private.
alter table public.posts add column business_author_id uuid;
update public.posts p set business_author_id=mp.merchant_id from private.merchant_posts mp
  where mp.post_id=p.id and mp.published_as_business;
create index posts_business_author_idx on public.posts(business_author_id,created_at desc,id desc) where business_author_id is not null;
create table private.business_blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(user_id,business_id)
);
alter table private.business_blocks enable row level security;
alter table private.business_blocks owner to postgres;
revoke all on private.business_blocks from public,anon,authenticated,service_role;
create function public.block_business(p_business_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
  perform private.lock_relationships();
  perform private.assert_active_account(auth.uid());
  if not exists(select 1 from private.merchants where id=p_business_id and record_kind='business' and deleted_at is null)
    then raise exception 'MERCHANT_UNAVAILABLE'; end if;
  insert into private.business_blocks(user_id,business_id) values(auth.uid(),p_business_id) on conflict do nothing;
end $$;
revoke all on function public.block_business(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.block_business(uuid,uuid) to authenticated;
revoke insert on public.posts from authenticated;

create function private.guard_business_post_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user not in ('postgres','supabase_admin') and
    ((tg_op='INSERT' and new.business_author_id is not null) or
     (tg_op='UPDATE' and new.business_author_id is distinct from old.business_author_id)) then raise exception 'BUSINESS_IDENTITY_PRIVATE'; end if;
  return new;
end $$;
create trigger guard_business_post_identity before insert or update on public.posts
  for each row execute function private.guard_business_post_identity();
create function private.bind_business_post_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.published_as_business then
    update public.posts set business_author_id=new.merchant_id where id=new.post_id
      and (business_author_id is null or business_author_id=new.merchant_id);
    if not found then raise exception 'BUSINESS_IDENTITY_CONFLICT'; end if;
  end if;
  return new;
end $$;
create trigger bind_business_post_identity after insert or update on private.merchant_posts
  for each row execute function private.bind_business_post_identity();
create function private.is_official_business_post(p_post_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.posts where id=p_post_id and business_author_id is not null);
$$;
create function private.public_post_business_id_for(p_post_id uuid,p_viewer uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select m.id from public.posts p join private.merchants m on m.id=p.business_author_id
  join public.profiles actor on actor.id=p.author_id and actor.account_status='active'
  where p.id=p_post_id and p.status='published' and m.record_kind='business' and m.deleted_at is null
    and m.consent='granted' and m.status<>'paused' and not exists(select 1 from public.profiles where id=m.id)
    and not exists(select 1 from private.business_blocks where user_id=p_viewer and business_id=m.id)
    and not private.is_blocked_between(p_viewer,p.author_id)
    and not private.has_reported(p_viewer,'post',p.id) and not private.has_reported(p_viewer,'user',p.author_id);
$$;
create or replace function private.public_post_business_id(p_post_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select private.public_post_business_id_for(p_post_id,auth.uid());
$$;
create function private.business_public_image_paths(p_post_id uuid,p_paths text[]) returns text[]
language sql stable security definer set search_path='' as $$
  select case when private.is_official_business_post(p_post_id) then
    array(select 'business-post/'||p_post_id::text||'/'||(ordinality-1)::text||'/'||md5(path) from unnest(p_paths) with ordinality paths(path,ordinality))
    else p_paths end;
$$;
revoke all on function private.guard_business_post_identity(),private.bind_business_post_identity(),
  private.is_official_business_post(uuid),private.business_public_image_paths(uuid,text[]) from public,anon,authenticated,service_role;

create view private.business_public_posts as select p.* from public.posts p
  where p.business_author_id is null or private.public_post_business_id(p.id) is not null;
create view private.personal_public_posts as select p.* from public.posts p where p.business_author_id is null;
revoke all on private.business_public_posts,private.personal_public_posts from public,anon,authenticated,service_role;
create policy "official post actors are private" on public.posts as restrictive for select to anon,authenticated
  using(business_author_id is null or (select private.is_admin()));
grant execute on function private.is_official_business_post(uuid) to anon,authenticated;
create policy "business report actors and evidence are private" on public.reports as restrictive for select to authenticated
  using((select private.is_admin()) or (target_type<>'merchant_review_reply'
    and (target_type<>'post' or (not private.is_official_business_post(target_id) and evidence->>'business_author_id' is null))));

create view private.personal_listing_reviews as select r.* from public.listing_reviews r
  where not private.is_official_business_post(r.post_id);
alter view private.personal_listing_reviews owner to postgres;
revoke all on private.personal_listing_reviews from public,anon,authenticated,service_role;
create policy "business listing actors are private" on public.listing_reviews as restrictive for select to anon,authenticated
  using((select private.is_admin()) or not private.is_official_business_post(post_id));
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('public.start_conversation(uuid,uuid)'::regprocedure);
  if position('p_post_id' in definition)=0 then raise exception 'conversation origin changed'; end if;
  execute regexp_replace(definition,'\mbegin\M','begin if private.is_official_business_post(p_post_id) then raise exception ''MERCHANT_CONTACT_UNAVAILABLE''; end if;','i');
  definition:=pg_get_functiondef('private.listing_review_partner(uuid,uuid)'::regprocedure);
  anchor:='and c.origin_post_id is not null';
  if position(anchor in definition)=0 then raise exception 'listing review origin changed'; end if;
  execute replace(definition,anchor,anchor||' and not private.is_official_business_post(c.origin_post_id)');
  definition:=pg_get_functiondef('public.get_listing_reputation(uuid,integer)'::regprocedure);
  execute replace(definition,'public.listing_reviews','private.personal_listing_reviews');
end $$;

do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.is_public_post_image(text)'::regprocedure);
  execute replace(definition,'FUNCTION public.is_public_post_image(','FUNCTION private.business_base_is_public_post_image(');
end $$;
revoke all on function private.business_base_is_public_post_image(text) from public,anon,authenticated,service_role;
create or replace function public.is_public_post_image(image_path text) returns boolean
language sql stable strict security definer set search_path='' as $$
  select not exists(select 1 from public.posts p where p.business_author_id is not null and p.image_paths @> array[image_path])
    and private.business_base_is_public_post_image(image_path);
$$;

-- Preserve legacy signatures, redaction and cursors; only private implementations see actors/keys.
do $privacy$
declare proc record; definition text; base text; header text; args text; columns text; item record; expression text;
begin
  for proc in select p.* from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any(array[
    'get_public_feed','get_public_feed_page','get_public_feed_page_v2','get_public_post','get_saved_posts',
    'get_public_author_posts','get_public_popular_feed_page','get_discovery_posts']) loop
    if not proc.proretset or not ('author_id'=any(proc.proargnames)) then raise exception 'business DTO contract changed: %',proc.proname; end if;
    definition:=pg_get_functiondef(proc.oid);
    base:=replace(definition,'FUNCTION public.'||proc.proname||'(','FUNCTION private.business_base_'||proc.proname||'(');
    base:=replace(base,'public.posts','private.business_public_posts');
    base:=replace(base,'public.is_public_post_image','private.business_base_is_public_post_image');
    if proc.proname='get_public_author_posts' then
      if base !~ 'post\.author_id\s*=\s*p_author_id' then raise exception 'personal author page changed'; end if;
      base:=regexp_replace(base,'post\.author_id\s*=\s*p_author_id','post.business_author_id is null and post.author_id=p_author_id','g');
    end if;
    if proc.proname='get_public_feed_page_v2' then
      base:=replace(base,'post.author_id in (select matched.id','post.business_author_id is null and post.author_id in (select matched.id');
    elsif proc.proname='get_public_feed_page' then
      base:=regexp_replace(base,'profile\.nickname(::text)?','(case when post.business_author_id is null then profile.nickname::text else (select merchant.name from private.merchants merchant where merchant.id=post.business_author_id) end)','g');
      base:=replace(base,'profile.neighborhood','(case when post.business_author_id is null then profile.neighborhood else null::text end)');
    end if;
    execute base;
    execute format('revoke all on function private.business_base_%I(%s) from public,anon,authenticated,service_role',proc.proname,pg_get_function_identity_arguments(proc.oid));
    select string_agg(format('%I',proc.proargnames[n]),',' order by n) into args from generate_series(1,proc.pronargs)n;
    columns:='';
    for item in select proc.proargnames[n] name from generate_subscripts(proc.proallargtypes,1)n where proc.proargmodes[n]='t' loop
      expression:=case item.name
        when 'author_id' then 'coalesce(b.id,r.author_id)'
        when 'author_nickname' then 'coalesce(b.name,r.author_nickname)::text'
        when 'author_neighborhood' then 'case when b.id is null then r.author_neighborhood else null::text end'
        when 'author_verification_level' then 'case when b.id is null then r.author_verification_level else 0::smallint end'
        when 'image_paths' then 'private.business_public_image_paths(r.id,r.image_paths)'
        else format('r.%I',item.name) end;
      columns:=columns||case when columns='' then '' else ',' end||expression;
    end loop;
    header:=replace(split_part(definition,'AS $function$',1),'LANGUAGE sql','LANGUAGE plpgsql');
    if header=definition then raise exception 'business DTO body delimiter changed: %',proc.proname; end if;
    execute header||format('AS $function$ begin return query select %s from private.business_base_%I(%s) r left join private.merchants b on b.id=private.public_post_business_id(r.id) where not private.is_official_business_post(r.id) or b.id is not null; end $function$;',columns,proc.proname,coalesce(args,''));
  end loop;
  foreach base in array array['public.get_public_user_profile(uuid)','public.get_public_user_activity(uuid,text,timestamptz,uuid)','public.get_trade_profile(uuid)'] loop
    if to_regprocedure(base) is not null then
      definition:=pg_get_functiondef(base::regprocedure);
      execute replace(definition,'public.posts','private.personal_public_posts');
    end if;
  end loop;
end $privacy$;

-- Public business pages list official publications, independently of review eligibility.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.get_merchant_profile_posts(uuid,text,integer)'::regprocedure);
  anchor:='from private\.merchant_posts mp\s+join public\.posts p on p\.id=mp\.post_id';
  if definition !~ anchor then raise exception 'business channel post source changed'; end if;
  definition:=regexp_replace(definition,anchor,'from public.posts p','g');
  anchor:='where mp.merchant_id=p_merchant_id and (private.merchant_review_merchant(p.id,auth.uid())=p_merchant_id or private.public_post_business_id(p.id)=p_merchant_id)';
  if position(anchor in definition)=0 then raise exception 'business channel visibility changed'; end if;
  execute replace(definition,anchor,'where p.business_author_id=p_merchant_id and private.public_post_business_id(p.id)=p_merchant_id');
  definition:=pg_get_functiondef('public.get_merchant_profile(uuid)'::regprocedure);
  anchor:='select mp.post_id from private.merchant_posts mp join public.posts p on p.id=mp.post_id';
  if position(anchor in definition)=0 then raise exception 'business profile source changed'; end if;
  definition:=replace(definition,anchor,'select p.id post_id from public.posts p left join private.merchant_posts mp on mp.post_id=p.id and mp.merchant_id=m.id');
  anchor:='where mp.merchant_id=m.id and (private.merchant_review_merchant(mp.post_id,auth.uid())=m.id or private.public_post_business_id(mp.post_id)=m.id)';
  if position(anchor in definition)=0 then raise exception 'business profile visibility changed'; end if;
  definition:=replace(definition,anchor,'where (mp.merchant_id=m.id and private.merchant_review_merchant(mp.post_id,auth.uid())=m.id) or (p.business_author_id=m.id and private.public_post_business_id(p.id)=m.id)');
  execute replace(definition,'FUNCTION public.get_merchant_profile(','FUNCTION private.business_base_get_merchant_profile(');
end $$;
revoke all on function private.business_base_get_merchant_profile(uuid) from public,anon,authenticated,service_role;
create or replace function public.get_merchant_profile(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select profile||jsonb_build_object(
    'avatar_path',case when profile->>'avatar_path' is not null then 'business-profile/'||p_merchant_id::text||'/avatar/'||md5(profile->>'avatar_path') end,
    'banner_path',case when profile->>'banner_path' is not null then 'business-profile/'||p_merchant_id::text||'/banner/'||md5(profile->>'banner_path') end,
    'can_message',false)
  from (select private.business_base_get_merchant_profile(p_merchant_id) profile)x
  join private.merchants m on m.id=p_merchant_id and m.record_kind='business' and m.deleted_at is null
    and m.consent='granted' and m.status<>'paused'
  where profile is not null and not exists(select 1 from public.profiles where id=m.id)
    and not exists(select 1 from private.business_blocks where user_id=auth.uid() and business_id=m.id);
$$;
create or replace function public.get_public_post_businesses(p_post_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>50 or array_position(p_post_ids,null) is not null then raise exception 'INVALID_BUSINESS_POST_PAGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('post_id',ids.id,'business_id',m.id,'business_name',m.name,
    'avatar_path',case when m.avatar_path is not null then 'business-profile/'||m.id::text||'/avatar/'||md5(m.avatar_path) end) order by ids.id),'[]') into result
  from (select distinct unnest(p_post_ids) id)ids join private.merchants m on m.id=private.public_post_business_id(ids.id);
  return result;
end $$;

-- Existing upload checks stay private; only the opaque media endpoint serves business images publicly.
create or replace function private.can_read_merchant_profile_image(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  select id into mid from private.merchants where avatar_path=p_path or banner_path=p_path limit 1;
  if mid is null then return private.can_upload_merchant_profile_image(p_path); end if;
  perform private.assert_merchant_content_access(mid);
  return true;
exception when sqlstate 'P0001' then return false;
end $$;
create function public.get_business_public_media(p_id uuid,p_kind text,p_index integer default 0,p_viewer uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare path text; bucket text;
begin
  if p_kind is null or p_kind not in ('post','avatar','banner') or p_index is null or p_index not between 0 and 19 then raise exception 'INVALID_BUSINESS_MEDIA'; end if;
  if p_viewer is not null and not private.is_active_account(p_viewer) then return null; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_viewer,'role',case when p_viewer is null then 'anon' else 'authenticated' end)::text,true);
  if p_kind='post' then
    if p_index>0 and p_viewer is null then return null; end if;
    select p.image_paths[p_index+1] into path from public.posts p where p.id=p_id and private.public_post_business_id(p.id) is not null;
    bucket:='post-images';
  else
    if p_index<>0 then raise exception 'INVALID_BUSINESS_MEDIA'; end if;
    select case when p_kind='avatar' then m.avatar_path else m.banner_path end into path from private.merchants m
      where m.id=p_id and public.get_merchant_profile(m.id) is not null;
    bucket:='merchant-profile-images';
  end if;
  if path is null then return null; end if;
  return jsonb_build_object('bucket',bucket,'path',path,'version',md5(path));
end $$;
revoke all on function public.get_business_public_media(uuid,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_business_public_media(uuid,text,integer,uuid) to service_role;

-- Raw object listings/signatures must not recover uploader keys, including thumbnail variants.
create function private.can_read_business_storage(p_bucket text,p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare mid uuid; bound boolean:=false;
begin
  if p_bucket not in ('post-images','merchant-profile-images') then return true; end if;
  if p_bucket='merchant-profile-images' then
    return private.can_read_merchant_profile_image(p_path);
  end if;
  for mid in select distinct p.business_author_id from public.posts p cross join lateral unnest(p.image_paths) paths(path)
    where p.business_author_id is not null and (path=p_path or
      regexp_replace(path,'\.[^./]*$','')||'.thumb.webp'=p_path or path||'.thumb.webp'=p_path) loop
    bound:=true;
    begin perform private.assert_merchant_content_access(mid); return true;
    exception when sqlstate 'P0001' then null; end;
  end loop;
  return not bound;
end $$;
revoke all on function private.can_read_business_storage(text,text) from public,anon,authenticated,service_role;
grant execute on function private.can_read_business_storage(text,text) to anon,authenticated;
create policy "business media keys are private" on storage.objects as restrictive for select to anon,authenticated
  using(private.can_read_business_storage(bucket_id,name));

create or replace function public.start_merchant_conversation(p_merchant_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  raise exception 'MERCHANT_CONTACT_UNAVAILABLE';
end $$;

-- Ranking/share projections must use the same identity and media boundary as feed/detail.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.get_weekly_ranking(text)'::regprocedure);
  if position('author.nickname' in definition)=0 or position('p.author_id' in definition)=0 then raise exception 'ranking identity changed'; end if;
  definition:=replace(definition,'public.posts','private.business_public_posts');
  definition:=replace(definition,'''authorId'', p.author_id','''authorId'', coalesce(p.business_author_id,p.author_id)');
  execute replace(definition,'''nickname'', author.nickname','''nickname'', case when p.business_author_id is null then author.nickname::text else (select m.name from private.merchants m where m.id=p.business_author_id) end');
  if to_regprocedure('public.get_shared_link_preview(uuid)') is not null then
    definition:=pg_get_functiondef('public.get_shared_link_preview(uuid)'::regprocedure);
    if position('p.image_paths[1]' in definition)=0 then raise exception 'share photo changed'; end if;
    definition:=replace(definition,'public.posts','private.business_public_posts');
    definition:=replace(definition,'public.is_public_post_image','private.business_base_is_public_post_image');
    execute replace(definition,'then p.image_paths[1] end','then (private.business_public_image_paths(p.id,p.image_paths))[1] end');
  end if;
end $$;

do $$ declare definition text; anchor text:='p.status\s*=\s*''published'''; begin
  definition:=pg_get_functiondef('private.notification_target_visible(uuid,text,uuid)'::regprocedure);
  if definition !~ anchor then raise exception 'notification post visibility changed'; end if;
  execute regexp_replace(definition,anchor,'p.status=''published'' and (p.business_author_id is null or private.public_post_business_id_for(p.id,p_user_id) is not null)','g');
end $$;

-- Preserve real safety actors in posts, while inbox/realtime/push payloads never store the linked identity.
create function private.mask_business_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  if new.target_type<>'post' then return new; end if;
  select p.author_id,p.title,m.name into item from public.posts p join private.merchants m on m.id=p.business_author_id where p.id=new.target_id;
  if found and (new.actor_id is null or new.actor_id=item.author_id) then
    new.actor_id:=null;
    new.body:=left(item.name||' · '||item.title,300);
  end if;
  return new;
end $$;
create trigger business_notification_identity before insert or update on public.notifications
  for each row execute function private.mask_business_notification();
create function private.mask_bound_business_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.notifications set actor_id=actor_id where target_type='post' and target_id=new.id
    and (actor_id is null or actor_id=new.author_id);
  return new;
end $$;
create trigger business_notifications_bound after update of business_author_id on public.posts
  for each row when(new.business_author_id is not null) execute function private.mask_bound_business_notifications();
update public.notifications n set actor_id=n.actor_id from public.posts p
  where p.id=n.target_id and n.target_type='post' and p.business_author_id is not null
    and (n.actor_id is null or n.actor_id=p.author_id);

-- Poll visibility must accept a business author without querying a personal profile by business ID.
do $$ declare signature text; definition text; anchor text:='public.get_public_user_profile(visible.author_id) is not null'; begin
  foreach signature in array array['public.get_post_poll(uuid)','public.vote_post_poll(uuid,integer,uuid)'] loop
    if to_regprocedure(signature) is not null then
      definition:=pg_get_functiondef(signature::regprocedure);
      if position(anchor in definition)=0 then raise exception 'poll visibility changed'; end if;
      execute replace(definition,anchor,'('||anchor||' or public.get_merchant_profile(visible.author_id) is not null)');
    end if;
  end loop;
  if to_regclass('public.post_polls') is not null then
    alter policy "visible post polls" on public.post_polls using(exists(select 1 from public.get_public_post(post_id) visible
      where public.get_public_user_profile(visible.author_id) is not null or public.get_merchant_profile(visible.author_id) is not null));
  end if;
end $$;

-- Explicit ownership is needed when migrations are applied by supabase_admin.
do $$ declare proc record; begin
  for proc in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and (p.proname like 'business_base_%' or p.proname=any(array[
      'guard_business_post_identity','bind_business_post_identity','is_official_business_post','business_public_image_paths','public_post_business_id_for',
      'mask_business_notification','mask_bound_business_notifications','can_read_business_storage'])))
    or (n.nspname='public' and p.proname in ('get_business_public_media','block_business')) loop
    execute format('alter function %s owner to postgres',proc.oid::regprocedure);
  end loop;
end $$;
revoke all on function private.mask_business_notification(),private.mask_bound_business_notifications() from public,anon,authenticated,service_role;
revoke all on function private.public_post_business_id_for(uuid,uuid) from public,anon,authenticated,service_role;
alter view private.business_public_posts owner to postgres;
alter view private.personal_public_posts owner to postgres;
notify pgrst,'reload schema';
