-- Personal AI posting (owner 2026-11-13): a member on private.unlimited_posters may connect an AI tool such as Claude Code
-- and write their own posts, with photos, on every personal board. It reuses the business AI connection, OAuth token and
-- merchant-mcp endpoint. Every post goes through public.create_post, the app's own write path, so the content filter,
-- safety queue, watch terms, duplicate and board rules all still apply. Business-only connections behave exactly as before.

-- A connection may now grant personal posts with or without businesses.
alter table private.merchant_mcp_connections add column personal_posts text check(personal_posts in ('drafts','publish'));
alter table private.merchant_mcp_connections drop constraint merchant_mcp_connections_merchant_ids_check;
alter table private.merchant_mcp_connections add constraint merchant_mcp_connections_merchant_ids_check
  check(cardinality(merchant_ids)<=50 and array_position(merchant_ids,null) is null and (cardinality(merchant_ids)>=1 or personal_posts is not null));

create table private.personal_mcp_drafts (
  id uuid primary key, actor_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references private.merchant_mcp_connections(id) on delete cascade,
  city_id text not null references public.cities(id), tag_id smallint not null references public.tags(id), kind text not null check(kind in ('story','listing')),
  title text not null check(char_length(title) between 1 and 80), body text not null check(char_length(body) between 1 and 1000),
  hashtags text[] not null default '{}' check(cardinality(hashtags)<=5), image_paths text[] not null default '{}' check(cardinality(image_paths)<=20),
  price numeric check(price between 0 and 99999999),
  post_id uuid references public.posts(id) on delete set null, published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index personal_mcp_drafts_actor on private.personal_mcp_drafts(actor_id) where published_at is null;
-- One row per upload link the server handed out. shortcut: unused rows stay until the account is deleted; prune if they grow.
create table private.personal_mcp_photos (
  path text primary key, actor_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references private.merchant_mcp_connections(id) on delete cascade,
  content_type text not null check(content_type in ('image/webp','image/jpeg','image/png')), expires_at timestamptz not null
);
do $$ declare t text; begin
  foreach t in array array['private.personal_mcp_drafts','private.personal_mcp_photos'] loop
    execute 'alter table '||t||' enable row level security';
    execute 'alter table '||t||' owner to postgres';
    execute 'revoke all on '||t||' from public,anon,authenticated,service_role';
  end loop;
end $$;

create function private.assert_mcp_personal_user() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=auth.uid() and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  -- Holding the row makes a removal wait for an in-flight call; the next call is refused.
  perform 1 from private.unlimited_posters where user_id=auth.uid() for share;
  if not found then raise exception 'MCP_PERSONAL_POSTS_REQUIRED'; end if;
end $$;

create function public.get_my_personal_mcp_access() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  return private.is_active_account(auth.uid()) and exists(select 1 from private.unlimited_posters where user_id=auth.uid());
end $$;

-- The consent page opens for a listed member even without a business account.
do $$
declare definition text:=pg_get_functiondef('public.get_merchant_mcp_authorization(text)'::regprocedure);
  anchor text:='perform private.assert_mcp_web_user();';
begin
  if position(anchor in definition)=0 then raise exception 'MCP_AUTHORIZATION_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,'if exists(select 1 from private.unlimited_posters where user_id=auth.uid()) then perform private.assert_mcp_personal_user(); else '||anchor||' end if;');
end $$;

do $$
declare definition text:=pg_get_functiondef('public.get_my_merchant_mcp_connections()'::regprocedure);
  anchor text:='c.allow_drafts,c.allow_publish,c.created_at';
begin
  if position(anchor in definition)=0 then raise exception 'MCP_CONNECTIONS_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,'c.allow_drafts,c.allow_publish,c.personal_posts,c.created_at');
end $$;

-- Tokens: a listed member needs no business account. The connection, consent and session checks below are unchanged.
do $$
declare definition text:=pg_get_functiondef('public.gling_access_token_hook(jsonb)'::regprocedure);
  anchor text:=E'\n    and u.raw_app_meta_data->''merchant_enabled''=''true''::jsonb) then';
begin
  if position(anchor in definition)=0 then raise exception 'MCP_TOKEN_HOOK_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,E'\n    and (u.raw_app_meta_data->''merchant_enabled''=''true''::jsonb or exists(select 1 from private.unlimited_posters o where o.user_id=u.id))) then');
end $$;

-- No default on the new argument: the business screen's five-argument call keeps resolving to the wrapper below.
create function public.save_merchant_mcp_connection(p_expected_actor_id uuid,p_client_id uuid,p_merchant_ids uuid[],p_allow_drafts boolean,p_allow_publish boolean,
  p_personal_posts text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; mid uuid;
begin
  -- Businesses keep the business-account check; personal posts need the operator's list instead.
  if coalesce(cardinality(p_merchant_ids),0)>0 or p_personal_posts is null then perform private.assert_mcp_web_user(); end if;
  if p_personal_posts is not null then perform private.assert_mcp_personal_user(); end if;
  if p_expected_actor_id is distinct from auth.uid() then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_merchant_ids is null or cardinality(p_merchant_ids)>50 or array_position(p_merchant_ids,null) is not null
    or (select count(distinct id) from unnest(p_merchant_ids)id)<>cardinality(p_merchant_ids)
    or p_allow_drafts is null or p_allow_publish is null or p_personal_posts not in ('drafts','publish')
    or (cardinality(p_merchant_ids)=0 and (p_personal_posts is null or p_allow_drafts or p_allow_publish)) then raise exception 'INVALID_MCP_INPUT'; end if;
  if not exists(select 1 from auth.oauth_clients where id=p_client_id and deleted_at is null) then raise exception 'MCP_CLIENT_NOT_FOUND'; end if;
  if (p_allow_publish or p_personal_posts='publish') and not exists(select 1 from auth.oauth_clients where id=p_client_id and deleted_at is null
    and private.mcp_trusted_redirect_uris(redirect_uris)) then raise exception 'MCP_PUBLISH_CLIENT_UNVERIFIED'; end if;
  perform 1 from private.merchant_mcp_connections where actor_id=auth.uid() and client_id=p_client_id and revoked_at is null for update;
  for mid in select id from unnest(p_merchant_ids)id order by id loop
    perform private.mcp_assert_business(mid);
    if private.merchant_workspace_plan(mid)='basic' then raise exception 'MCP_PLAN_REQUIRED'; end if;
  end loop;
  perform private.enforce_rate_limit('merchant-mcp-connect',20,interval '1 day');
  -- A changed scope creates a new ID; reconnecting never revives an older token.
  update private.merchant_mcp_connections set revoked_at=clock_timestamp() where actor_id=auth.uid() and client_id=p_client_id and revoked_at is null;
  insert into private.merchant_mcp_connections(actor_id,client_id,merchant_ids,allow_drafts,allow_publish,personal_posts)
    values(auth.uid(),p_client_id,p_merchant_ids,p_allow_drafts,p_allow_publish,p_personal_posts) returning id into cid;
  return jsonb_build_object('id',cid,'client_id',p_client_id,'merchant_ids',p_merchant_ids,'allow_drafts',p_allow_drafts,'allow_publish',p_allow_publish,'personal_posts',p_personal_posts);
end;
$$;

create or replace function public.save_merchant_mcp_connection(p_expected_actor_id uuid,p_client_id uuid,p_merchant_ids uuid[],p_allow_drafts boolean,p_allow_publish boolean) returns jsonb
language sql security definer set search_path='' as $$
  select public.save_merchant_mcp_connection(p_expected_actor_id,p_client_id,p_merchant_ids,p_allow_drafts,p_allow_publish,null::text);
$$;

-- Every personal call re-checks the list, the account, the connection, the consent and the bound session.
create function private.personal_mcp_connection(p_actor_id uuid,p_client_id uuid,p_connection_id uuid,p_session_id uuid) returns private.merchant_mcp_connections
language plpgsql security definer set search_path='' as $$
declare c private.merchant_mcp_connections;
begin
  perform private.assert_mcp_personal_user();
  select c0.* into c from private.merchant_mcp_connections c0 join auth.oauth_clients o on o.id=c0.client_id and o.deleted_at is null
    where c0.id=p_connection_id and c0.actor_id=p_actor_id and c0.client_id=p_client_id and c0.personal_posts is not null
      and c0.revoked_at is null and c0.expires_at>now()
      and exists(select 1 from auth.oauth_consents a where a.user_id=p_actor_id and a.client_id=p_client_id and a.revoked_at is null) for share of c0;
  if c.id is null or not exists(select 1 from private.merchant_mcp_sessions b join auth.sessions s on s.id=b.session_id
    where b.session_id=p_session_id and b.connection_id=c.id and s.user_id=p_actor_id and s.oauth_client_id=p_client_id
      and s.scopes='offline_access' and (s.not_after is null or s.not_after>now())) then raise exception 'MCP_CONNECTION_REQUIRED'; end if;
  perform private.enforce_rate_limit('personal-mcp',180,interval '1 minute');
  return c;
end $$;

-- Only photos uploaded through this member's own upload links, inside the link window, with the app's type and size rules.
create function private.assert_personal_mcp_photos(p_actor_id uuid,p_paths text[]) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if p_paths is null or cardinality(p_paths)>20 or array_position(p_paths,null) is not null
    or (select count(distinct x) from unnest(p_paths)x)<>cardinality(p_paths)
    or exists(select 1 from unnest(p_paths)x where not exists(select 1 from private.personal_mcp_photos s where s.path=x and s.actor_id=p_actor_id))
    then raise exception 'INVALID_IMAGE_PATH'; end if;
  -- Signed upload links outlive this window, so a later upload never attaches.
  if exists(select 1 from unnest(p_paths)x join private.personal_mcp_photos s on s.path=x
    left join storage.objects o on o.bucket_id='post-images' and o.name=x where o.id is null or o.created_at>s.expires_at) then raise exception 'PHOTO_NOT_UPLOADED'; end if;
  -- 2 MiB is MAX_IMAGE_BYTES in src/lib/image-upload.ts.
  if exists(select 1 from unnest(p_paths)x join private.personal_mcp_photos s on s.path=x join storage.objects o on o.bucket_id='post-images' and o.name=x
    where o.metadata->>'mimetype' is distinct from s.content_type or coalesce(o.metadata->>'size','') !~ '^[0-9]{1,9}$' or (o.metadata->>'size')::int not between 1 and 2097152)
    then raise exception 'PHOTO_INVALID'; end if;
end $$;

-- Server-only dispatch for personal tools, and the one context call for every connection.
create function public.dispatch_personal_mcp(p_actor_id uuid,p_client_id uuid,p_connection_id uuid,p_session_id uuid,p_tool text,p_arguments jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.merchant_mcp_connections; personal text; has_business boolean; result jsonb; keys text[]; d private.personal_mcp_drafts;
  did uuid; is_draft boolean; tid smallint; tkind text; tslug text; post_kind text; tags text[]; paths text[]; price_value numeric; n int; stamp text; offset_value int; pid uuid;
  saved_claims text:=current_setting('request.jwt.claims',true);
begin
  -- The same AAL1 member session as business dispatch: private.is_admin() stays false for the whole call.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated','aal','aal1','app_metadata','{}'::jsonb)::text,true);
  if p_tool='_context' then
    select c0.personal_posts,cardinality(c0.merchant_ids)>0 into personal,has_business from private.merchant_mcp_connections c0 where c0.id=p_connection_id and c0.actor_id=p_actor_id;
    -- A business-only connection gets exactly the business context and errors it always got.
    if coalesce(has_business,true) then
      begin result:=public.dispatch_merchant_mcp(p_actor_id,p_client_id,p_connection_id,p_session_id,'_context','{}');
      exception when others then if personal is null then raise; end if; has_business:=false; result:=null; end;
    end if;
    if personal is not null then
      begin perform private.personal_mcp_connection(p_actor_id,p_client_id,p_connection_id,p_session_id);
      exception when others then if not has_business then raise; end if; personal:=null; end;
    end if;
    result:=coalesce(result,'{"allow_drafts":false,"allow_publish":false}'::jsonb)||jsonb_build_object('business',has_business,'personal_posts',personal);
  else
    if p_tool='publish_personal_draft' then
      -- Enter create_post's lock order before the shared account locks below.
      perform private.lock_relationships(); perform 1 from public.profiles where id=p_actor_id for update;
    end if;
    c:=private.personal_mcp_connection(p_actor_id,p_client_id,p_connection_id,p_session_id);
    keys:=case p_tool when 'list_post_boards' then array[]::text[] when 'list_my_posts' then array['offset']
      when 'create_photo_uploads' then array['count','content_type'] when 'preview_personal_draft' then array['draft_id']
      when 'save_personal_draft' then array['draft_id','city_id','board','title','body','hashtags','image_paths','price','expected_updated_at']
      when 'publish_personal_draft' then array['draft_id','expected_updated_at'] end;
    if keys is null or (p_tool='publish_personal_draft' and c.personal_posts<>'publish') then raise exception 'MCP_TOOL_NOT_ALLOWED'; end if;
    perform private.mcp_assert_keys(p_arguments,keys);
    if octet_length(p_arguments::text)>40000 then raise exception 'INVALID_MCP_INPUT'; end if;
    is_draft:=p_tool in ('save_personal_draft','preview_personal_draft','publish_personal_draft');
    did:=case when is_draft then (p_arguments->>'draft_id')::uuid end;
    if is_draft and did is null then raise exception 'INVALID_MCP_INPUT'; end if;
    case p_tool
    when 'list_post_boards' then
      -- housing, jobs and used are listing boards in the app (src/lib/listing-details.ts LISTING_CATEGORIES).
      select jsonb_build_object('home_city_id',(select city_id from public.profiles where id=p_actor_id),
        'cities',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.cities where is_open),'[]'::jsonb),
        'boards',coalesce((select jsonb_agg(jsonb_build_object('board',slug,'name',label,'kind',case when slug in ('housing','jobs','used') then 'listing' else 'story' end,
            'fields',case when slug in ('housing','jobs','used') then '["title","body","price","hashtags","image_paths"]' else '["title","body","hashtags","image_paths"]' end::jsonb) order by sort_order,id)
          from public.tags where kind='post' and slug<>'business'),'[]'::jsonb),
        'limits',jsonb_build_object('title',80,'body',1000,'hashtags',5,'photos',20,'photo_bytes',2097152),
        'active_listings',private.active_listing_count(p_actor_id),'listing_limit',private.listing_limit(p_actor_id)) into result;
    when 'list_my_posts' then
      offset_value:=coalesce((p_arguments->>'offset')::int,0);
      if offset_value not between 0 and 10000 then raise exception 'INVALID_MCP_INPUT'; end if;
      select jsonb_build_object('posts',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),'active_listings',private.active_listing_count(p_actor_id),'listing_limit',private.listing_limit(p_actor_id)) into result from (
        select p.id,t.slug board,p.city_id,p.kind,p.title,left(p.body,220) body_preview,p.price,p.listing_status,p.image_paths,p.created_at
        from public.posts p join public.tags t on t.id=p.tag_id
        where p.author_id=p_actor_id and p.business_author_id is null and p.status='published' and p.deleted_at is null and p.room_preview is null
        order by p.created_at desc,p.id desc limit 20 offset offset_value)x;
    when 'create_photo_uploads' then
      if jsonb_typeof(p_arguments->'count') is distinct from 'number' or p_arguments->>'count' !~ '^([1-9]|10)$'
        or coalesce(p_arguments->>'content_type','') not in ('image/webp','image/jpeg','image/png') then raise exception 'INVALID_MCP_INPUT'; end if;
      n:=(p_arguments->>'count')::int;
      perform private.enforce_rate_limit('personal-mcp-photos',100,interval '10 minutes');
      -- The batch shape the app uploads, <member>/<time>-<random>-<n>.<ext>, inside the member's own folder.
      stamp:=p_actor_id::text||'/'||floor(extract(epoch from clock_timestamp())*1000)::bigint||'-'||encode(extensions.gen_random_bytes(6),'hex')||'-';
      with made as (insert into private.personal_mcp_photos(path,actor_id,connection_id,content_type,expires_at)
        select stamp||i||case p_arguments->>'content_type' when 'image/webp' then '.webp' when 'image/jpeg' then '.jpg' else '.png' end,
          p_actor_id,c.id,p_arguments->>'content_type',clock_timestamp()+interval '10 minutes' from generate_series(0,n-1)i
        returning path,content_type,expires_at)
      select jsonb_build_object('uploads',jsonb_agg(jsonb_build_object('path',path,'content_type',content_type) order by path),'expires_at',min(expires_at),'max_bytes',2097152) into result from made;
    when 'save_personal_draft' then
      if jsonb_typeof(p_arguments->'title') is distinct from 'string' or jsonb_typeof(p_arguments->'body') is distinct from 'string'
        or jsonb_typeof(p_arguments->'city_id') is distinct from 'string' or jsonb_typeof(p_arguments->'board') is distinct from 'string'
        or coalesce(jsonb_typeof(p_arguments->'hashtags'),'array')<>'array' or coalesce(jsonb_typeof(p_arguments->'image_paths'),'array')<>'array'
        or coalesce(jsonb_typeof(p_arguments->'price'),'null') not in ('number','null')
        or char_length(btrim(p_arguments->>'title')) not between 1 and 80 or char_length(btrim(p_arguments->>'body')) not between 1 and 1000 then raise exception 'INVALID_MCP_INPUT'; end if;
      select id,kind,slug into tid,tkind,tslug from public.tags where slug=p_arguments->>'board';
      -- The business board is for business profiles and meetups have their own flow, whoever the member is.
      if tid is null or tkind<>'post' or tslug='business' then raise exception 'INVALID_TAG'; end if;
      post_kind:=case when tslug in ('housing','jobs','used') then 'listing' else 'story' end;
      price_value:=(p_arguments->>'price')::numeric;
      if price_value is not null and post_kind<>'listing' then raise exception 'INVALID_POST_KIND'; end if;
      if price_value not between 0 and 99999999 then raise exception 'INVALID_PRICE'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(p_arguments->'hashtags','[]'))v where jsonb_typeof(v)<>'string')
        or exists(select 1 from jsonb_array_elements(coalesce(p_arguments->'image_paths','[]'))v where jsonb_typeof(v)<>'string') then raise exception 'INVALID_MCP_INPUT'; end if;
      tags:=array(select jsonb_array_elements_text(coalesce(p_arguments->'hashtags','[]')));
      paths:=array(select jsonb_array_elements_text(coalesce(p_arguments->'image_paths','[]')));
      if cardinality(tags)>5 then raise exception 'TOO_MANY_HASHTAGS'; end if;
      select * into d from private.personal_mcp_drafts where id=did for update;
      if d.id is not null and d.actor_id<>p_actor_id then raise exception 'POST_DRAFT_NOT_FOUND'; end if;
      if d.id is null or (d.city_id,d.tag_id,d.title,d.body,d.hashtags,d.image_paths,d.price) is distinct from
        (p_arguments->>'city_id',tid,btrim(p_arguments->>'title'),btrim(p_arguments->>'body'),tags,paths,price_value) then
        if d.published_at is not null then raise exception 'POST_DRAFT_PUBLISHED'; end if;
        if d.id is not null and (p_arguments->>'expected_updated_at')::timestamptz is distinct from d.updated_at then raise exception 'POST_DRAFT_CHANGED'; end if;
        if not exists(select 1 from public.cities where id=p_arguments->>'city_id' and is_open) then raise exception 'CITY_NOT_OPEN'; end if;
        perform private.assert_content_allowed(concat_ws(' ',p_arguments->>'title',p_arguments->>'body',array_to_string(tags,' ')));
        perform private.assert_personal_mcp_photos(p_actor_id,paths);
        if d.id is null then
          if (select count(*) from private.personal_mcp_drafts where actor_id=p_actor_id and published_at is null)>=1000 then raise exception 'POST_DRAFT_CAP'; end if;
          insert into private.personal_mcp_drafts(id,actor_id,connection_id,city_id,tag_id,kind,title,body,hashtags,image_paths,price)
            values(did,p_actor_id,c.id,p_arguments->>'city_id',tid,post_kind,btrim(p_arguments->>'title'),btrim(p_arguments->>'body'),tags,paths,price_value);
        else
          update private.personal_mcp_drafts set connection_id=c.id,city_id=p_arguments->>'city_id',tag_id=tid,kind=post_kind,title=btrim(p_arguments->>'title'),
            body=btrim(p_arguments->>'body'),hashtags=tags,image_paths=paths,price=price_value,updated_at=clock_timestamp() where id=did;
        end if;
      end if;
    when 'publish_personal_draft' then
      select * into d from private.personal_mcp_drafts where id=did and actor_id=p_actor_id for update;
      if d.id is null then raise exception 'POST_DRAFT_NOT_FOUND'; end if;
      -- A retry with the same draft ID returns the first post instead of writing another one.
      if d.published_at is null then
        if (p_arguments->>'expected_updated_at')::timestamptz is distinct from d.updated_at then raise exception 'POST_DRAFT_CHANGED'; end if;
        perform private.assert_personal_mcp_photos(p_actor_id,d.image_paths);
        -- Upload links only point into the member's folder, so only their own posts can already hold these photos.
        if exists(select 1 from public.posts where author_id=p_actor_id and image_paths && d.image_paths) then raise exception 'PHOTO_ALREADY_USED'; end if;
        pid:=public.create_post(d.city_id,d.tag_id,d.title,d.body,d.hashtags,d.image_paths,null,d.kind,d.price);
        -- Owned by the member like app uploads, so deleting the post from the app can remove them.
        update storage.objects set owner=p_actor_id,owner_id=p_actor_id::text where bucket_id='post-images' and name=any(d.image_paths) and owner_id is null;
        update private.personal_mcp_drafts set post_id=pid,published_at=clock_timestamp() where id=did;
      end if;
    when 'preview_personal_draft' then null;
    end case;
    if is_draft then
      select jsonb_build_object('id',d0.id,'city_id',d0.city_id,'board',t.slug,'kind',d0.kind,'title',d0.title,'body',d0.body,'hashtags',d0.hashtags,
        'image_paths',d0.image_paths,'price',d0.price,'post_id',d0.post_id,'published_at',d0.published_at,'updated_at',d0.updated_at) into result
        from private.personal_mcp_drafts d0 join public.tags t on t.id=d0.tag_id where d0.id=did and d0.actor_id=p_actor_id;
      if result is null then raise exception 'POST_DRAFT_NOT_FOUND'; end if;
    end if;
    -- Tool, connection and time only: no arguments, text or credentials.
    insert into private.merchant_mcp_audit(connection_id,merchant_id,tool) values(c.id,null,p_tool);
  end if;
  perform set_config('request.jwt.claims',coalesce(saved_claims,'{}'),true);
  return result;
exception when others then
  perform set_config('request.jwt.claims',coalesce(saved_claims,'{}'),true);
  raise;
end;
$$;

do $$ declare signature text; begin
  foreach signature in array array['private.assert_mcp_personal_user()','public.get_my_personal_mcp_access()',
    'public.save_merchant_mcp_connection(uuid,uuid,uuid[],boolean,boolean,text)','private.personal_mcp_connection(uuid,uuid,uuid,uuid)',
    'private.assert_personal_mcp_photos(uuid,text[])','public.dispatch_personal_mcp(uuid,uuid,uuid,uuid,text,jsonb)'] loop
    execute 'alter function '||signature||' owner to postgres';
    execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;
grant execute on function public.get_my_personal_mcp_access(),public.save_merchant_mcp_connection(uuid,uuid,uuid[],boolean,boolean,text) to authenticated;
grant execute on function public.dispatch_personal_mcp(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
