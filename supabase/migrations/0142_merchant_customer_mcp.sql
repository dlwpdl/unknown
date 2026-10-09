-- Customer AI access is independent of the app JWT and the existing administrator MCP.
do $$ begin
  if exists(select 1 from pg_roles where rolname='gling_mcp') then raise exception 'MCP_ROLE_MUST_NOT_ACCESS_DATABASE'; end if;
  -- Use the existing trusted business-function owner; never widen helper access to API roles.
  if not has_function_privilege(current_user,'private.lock_merchant_profile_owner(uuid,boolean)','EXECUTE')
    or not has_function_privilege(current_user,'private.assert_merchant_profile_image(text,uuid,text)','EXECUTE') then
    raise exception 'MCP_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;
create table private.merchant_mcp_connections (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references auth.oauth_clients(id), merchant_ids uuid[] not null,
  allow_drafts boolean not null default false, allow_publish boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 days', revoked_at timestamptz,
  check(cardinality(merchant_ids) between 1 and 50 and array_position(merchant_ids,null) is null)
);
create unique index merchant_mcp_one_active_client on private.merchant_mcp_connections(actor_id,client_id) where revoked_at is null;
create table private.merchant_mcp_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  connection_id uuid not null references private.merchant_mcp_connections(id) on delete cascade
);
create table private.merchant_mcp_changes (
  id uuid primary key, connection_id uuid not null references private.merchant_mcp_connections(id) on delete cascade,
  merchant_id uuid not null references private.merchants(id), kind text not null check(kind in ('profile','edit_post','delete_post')),
  post_id uuid references public.posts(id), expected_revision text not null, before_value jsonb not null, changes jsonb not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
  reviewed_at timestamptz, status text not null default 'pending' check(status in ('pending','applied','rejected')),
  check(octet_length(changes::text)<=24000)
);
create index merchant_mcp_pending_changes on private.merchant_mcp_changes(merchant_id,created_at desc) where status='pending';
create table private.merchant_mcp_audit (
  id bigint generated always as identity primary key, connection_id uuid not null references private.merchant_mcp_connections(id) on delete cascade,
  merchant_id uuid references private.merchants(id), tool text not null, created_at timestamptz not null default now()
);
create index merchant_mcp_audit_connection on private.merchant_mcp_audit(connection_id,created_at desc);
alter table private.merchant_mcp_connections enable row level security;
alter table private.merchant_mcp_changes enable row level security;
alter table private.merchant_mcp_audit enable row level security;
alter table private.merchant_mcp_sessions enable row level security;
revoke all on private.merchant_mcp_connections,private.merchant_mcp_changes,private.merchant_mcp_audit,private.merchant_mcp_sessions from public,anon,authenticated,service_role;

create function private.assert_mcp_web_user() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=auth.uid() and account_status='active' for share;
  if not found then raise exception 'ACCOUNT_LOCKED'; end if;
  perform 1 from auth.users where id=auth.uid() for share;
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') then raise exception 'MCP_BUSINESS_ACCOUNT_REQUIRED'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then raise exception 'MERCHANT_ACCOUNT_REQUIRED'; end if;
  perform private.assert_merchant_access();
end;
$$;
create function private.mcp_assert_business(p_merchant_id uuid,p_write boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  m:=private.lock_merchant_profile_owner(p_merchant_id,p_write);
  -- An operator-capable shared guard must not expand this owner-only AI grant.
  if m.owner_id is distinct from auth.uid() then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
end;
$$;
create function public.save_merchant_mcp_connection(p_client_id uuid,p_merchant_ids uuid[],p_allow_drafts boolean,p_allow_publish boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; mid uuid;
begin
  perform private.assert_mcp_web_user();
  if p_merchant_ids is null or cardinality(p_merchant_ids) not between 1 and 50 or array_position(p_merchant_ids,null) is not null
    or (select count(distinct id) from unnest(p_merchant_ids)id)<>cardinality(p_merchant_ids)
    or p_allow_drafts is null or p_allow_publish is null then raise exception 'INVALID_MCP_INPUT'; end if;
  if not exists(select 1 from auth.oauth_clients where id=p_client_id and deleted_at is null) then raise exception 'MCP_CLIENT_NOT_FOUND'; end if;
  perform 1 from private.merchant_mcp_connections where actor_id=auth.uid() and client_id=p_client_id and revoked_at is null for update;
  for mid in select id from unnest(p_merchant_ids)id order by id loop perform private.mcp_assert_business(mid); end loop;
  perform private.enforce_rate_limit('merchant-mcp-connect',20,interval '1 day');
  -- A changed scope creates a new ID; reconnecting never revives an older token.
  update private.merchant_mcp_connections set revoked_at=clock_timestamp() where actor_id=auth.uid() and client_id=p_client_id and revoked_at is null;
  insert into private.merchant_mcp_connections(actor_id,client_id,merchant_ids,allow_drafts,allow_publish)
    values(auth.uid(),p_client_id,p_merchant_ids,p_allow_drafts,p_allow_publish) returning id into cid;
  return jsonb_build_object('id',cid,'client_id',p_client_id,'merchant_ids',p_merchant_ids,'allow_drafts',p_allow_drafts,'allow_publish',p_allow_publish);
end;
$$;
create function public.get_my_merchant_mcp_connections() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  -- Keep the owner's revocation list available after business access is removed.
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by (x.revoked_at is null and x.expires_at>now()) desc,x.created_at desc,x.id) from (
    select c.id,c.client_id,coalesce(o.client_name,'AI 도구') client_name,c.merchant_ids,c.allow_drafts,c.allow_publish,c.created_at,c.expires_at,c.revoked_at,
      exists(select 1 from private.merchant_mcp_sessions b join auth.sessions s on s.id=b.session_id where b.connection_id=c.id
        and (s.not_after is null or s.not_after>now()) and exists(select 1 from auth.oauth_consents where user_id=c.actor_id and client_id=c.client_id and revoked_at is null)) is_connected,
      coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from private.merchants m
        where m.id=any(c.merchant_ids) and m.owner_id=auth.uid() and m.owner_verified_at is not null),'[]'::jsonb) businesses,
      (select max(a.created_at) from private.merchant_mcp_audit a where a.connection_id=c.id) last_used_at
    from private.merchant_mcp_connections c join auth.oauth_clients o on o.id=c.client_id
    where c.actor_id=auth.uid() order by (c.revoked_at is null and c.expires_at>now()) desc,c.created_at desc,c.id limit 100)x),'[]'::jsonb);
end;
$$;
create function public.get_merchant_mcp_authorization(p_authorization_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.assert_mcp_web_user();
  if p_authorization_id !~ '^[A-Za-z0-9_-]{8,200}$' then raise exception 'INVALID_MCP_INPUT'; end if;
  select jsonb_build_object('authorization_id',r.authorization_id,'client_id',r.client_id,'client_name',coalesce(o.client_name,'AI 도구'),
    'redirect_uri',r.redirect_uri,'scope',r.scope,'expires_at',r.expires_at) into result
    from auth.oauth_authorizations r join auth.oauth_clients o on o.id=r.client_id and o.deleted_at is null
    where r.authorization_id=p_authorization_id and (r.user_id is null or r.user_id=auth.uid()) and r.status in ('pending','approved') and r.expires_at>now();
  if result is null then raise exception 'MCP_AUTHORIZATION_EXPIRED'; end if;
  if result->>'scope' is distinct from 'offline_access' then raise exception 'MCP_SCOPE_NOT_ALLOWED'; end if;
  return result;
end;
$$;
create function public.revoke_merchant_mcp_connection(p_connection_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  -- Revocation stays available after business access has been turned off.
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=auth.uid() for share;
  perform 1 from auth.users where id=auth.uid() for share;
  update private.merchant_mcp_connections set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_connection_id and actor_id=auth.uid();
  if not found then raise exception 'MCP_CONNECTION_REQUIRED'; end if;
  return true;
end;
$$;

-- Preserve the original sign-in/provider/review/MFA rules verbatim.
alter function public.gling_access_token_hook(jsonb) rename to gling_app_access_token_hook;
alter function public.gling_app_access_token_hook(jsonb) set schema private;
create function public.gling_access_token_hook(event jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare cid text:=coalesce(event->>'client_id',event#>>'{claims,client_id}'); conn private.merchant_mcp_connections; claims jsonb:=event->'claims'; uid uuid:=(event->>'user_id')::uuid;
begin
  if cid is null and event->>'authentication_method' not like 'oauth_provider/%' and claims->>'role' is distinct from 'gling_mcp' then
    return private.gling_app_access_token_hook(event);
  end if;
  if cid is null or not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=uid and p.account_status='active'
    and u.raw_app_meta_data->'merchant_enabled'='true'::jsonb and coalesce(u.raw_app_meta_data->>'role','')<>'admin') then
    return '{"error":{"http_code":403,"message":"Business AI approval is required."}}'::jsonb;
  end if;
  select c.* into conn from private.merchant_mcp_connections c join auth.oauth_clients o on o.id=c.client_id and o.deleted_at is null
    where c.actor_id=uid and c.client_id=cid::uuid and c.revoked_at is null and c.expires_at>now()
      and exists(select 1 from auth.oauth_consents a where a.user_id=uid and a.client_id=c.client_id and a.revoked_at is null);
  -- Identity scopes would also issue a native ID token usable by normal account APIs.
  if conn.id is null or claims->>'iss' is null or claims->>'scope' is distinct from 'offline_access'
    or not exists(select 1 from auth.sessions where id=(claims->>'session_id')::uuid and user_id=uid and oauth_client_id=cid::uuid
      and scopes='offline_access' and (not_after is null or not_after>now())) then
    return '{"error":{"http_code":403,"message":"Business AI approval is required."}}'::jsonb;
  end if;
  insert into private.merchant_mcp_sessions(session_id,connection_id) values((claims->>'session_id')::uuid,conn.id) on conflict do nothing;
  if not exists(select 1 from private.merchant_mcp_sessions where session_id=(claims->>'session_id')::uuid and connection_id=conn.id) then
    return '{"error":{"http_code":403,"message":"Reconnect this business AI tool."}}'::jsonb;
  end if;
  -- A non-user subject also prevents these credentials reaching native account APIs.
  claims:=claims||jsonb_build_object('sub','mcp:'||conn.id::text,'gling_actor_id',uid,'role','gling_mcp','aud',regexp_replace(claims->>'iss','/auth/v1$','/functions/v1/merchant-mcp'),
    'client_id',cid,'gling_connection_id',conn.id,'email','','phone','','app_metadata','{}'::jsonb,'user_metadata','{}'::jsonb);
  return jsonb_build_object('claims',claims);
end;
$$;
revoke all on function public.gling_access_token_hook(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.gling_access_token_hook(jsonb) to supabase_auth_admin;

create function private.mcp_assert_keys(value jsonb,allowed text[]) returns void
language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(value)k where not k=any(allowed)) then raise exception 'INVALID_MCP_INPUT'; end if;
end;
$$;
create function private.mcp_content_snapshot(p_merchant_id uuid,p_post_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_post_id is null then
    result:=public.get_my_merchant_profile(p_merchant_id);
  else
    select jsonb_build_object('id',p.id,'title',p.title,'body',p.body,'image_paths',p.image_paths,'status',p.status,'updated_at',p.updated_at,'created_at',p.created_at,'tag_slug',t.slug)
      into result from public.posts p join private.merchant_posts mp on mp.post_id=p.id join public.tags t on t.id=p.tag_id
      where mp.merchant_id=p_merchant_id and p.id=p_post_id and p.status='published' and p.room_preview is null;
    if result is null then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
  end if;
  return result||jsonb_build_object('revision',encode(extensions.digest((case when p_post_id is null then result else result-'updated_at' end)::text,'sha256'),'hex'));
end;
$$;
create function private.mcp_validate_change(p_kind text,p_before jsonb,p_changes jsonb,p_merchant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare paths text[]; k text;
begin
  if p_kind='profile' then
    perform private.mcp_assert_keys(p_changes,array['name','industry','services','address','avatar_path','banner_path']);
    if p_changes='{}'::jsonb then raise exception 'INVALID_MCP_INPUT'; end if;
    foreach k in array array['name','industry','services','address'] loop
      if p_changes?k and (jsonb_typeof(p_changes->k)<>'string' or length(p_changes->>k)>case k when 'name' then 120 when 'industry' then 80 when 'services' then 1500 else 300 end
        or (k='name' and length(btrim(p_changes->>k))=0)) then raise exception 'INVALID_MCP_INPUT'; end if;
    end loop;
    perform private.assert_content_allowed(concat_ws(' ',p_changes->>'name',p_changes->>'industry',p_changes->>'services',p_changes->>'address'));
    foreach k in array array['avatar_path','banner_path'] loop
      if p_changes?k then
        if jsonb_typeof(p_changes->k) not in ('string','null') then raise exception 'INVALID_MCP_INPUT'; end if;
        perform private.assert_merchant_profile_image(p_changes->>k,p_merchant_id,p_before->>k);
      end if;
    end loop;
  elsif p_kind='edit_post' then
    perform private.mcp_assert_keys(p_changes,array['title','body','image_paths']);
    if p_changes='{}'::jsonb or (p_changes?'title' and (jsonb_typeof(p_changes->'title')<>'string' or length(btrim(p_changes->>'title')) not between 1 and 100))
      or (p_changes?'body' and (jsonb_typeof(p_changes->'body')<>'string' or length(btrim(p_changes->>'body')) not between 1 and 4700)) then raise exception 'INVALID_MCP_INPUT'; end if;
    perform private.assert_content_allowed(concat_ws(' ',p_changes->>'title',p_changes->>'body'));
    if p_changes?'image_paths' then
      if jsonb_typeof(p_changes->'image_paths')<>'array' then raise exception 'INVALID_MCP_INPUT'; end if;
      select array_agg(v) into paths from jsonb_array_elements_text(p_changes->'image_paths')v;
      perform private.assert_merchant_image_paths(coalesce(paths,'{}'),array(select jsonb_array_elements_text(p_before->'image_paths')));
    end if;
  elsif p_kind='delete_post' then
    if p_changes is distinct from '{}'::jsonb then raise exception 'INVALID_MCP_INPUT'; end if;
  else raise exception 'INVALID_MCP_INPUT'; end if;
end;
$$;

create function public.dispatch_merchant_mcp(p_actor_id uuid,p_client_id uuid,p_connection_id uuid,p_session_id uuid,p_tool text,p_arguments jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.merchant_mcp_connections; mid uuid; did uuid; offset_value int; result jsonb; snapshot jsonb;
  d private.merchant_workspace_drafts; proposal private.merchant_mcp_changes; expected text; keys text[]; same_draft boolean;
  saved_claims text:=current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated','aal','aal1','app_metadata','{}'::jsonb)::text,true);
  perform private.assert_mcp_web_user();
  select c0.* into c from private.merchant_mcp_connections c0 join auth.oauth_clients o on o.id=c0.client_id and o.deleted_at is null
    where c0.id=p_connection_id and c0.actor_id=p_actor_id and c0.client_id=p_client_id and c0.revoked_at is null and c0.expires_at>now()
      and exists(select 1 from auth.oauth_consents a where a.user_id=p_actor_id and a.client_id=p_client_id and a.revoked_at is null) for share of c0;
  if c.id is null then raise exception 'MCP_CONNECTION_REQUIRED'; end if;
  if not exists(select 1 from private.merchant_mcp_sessions b join auth.sessions s on s.id=b.session_id
    where b.session_id=p_session_id and b.connection_id=c.id and s.user_id=p_actor_id and s.oauth_client_id=p_client_id
      and s.scopes='offline_access' and (s.not_after is null or s.not_after>now())) then raise exception 'MCP_CONNECTION_REQUIRED'; end if;
  perform private.enforce_rate_limit('merchant-mcp',180,interval '1 minute');
  keys:=case p_tool
    when '_context' then array[]::text[] when 'list_my_businesses' then array[]::text[] when 'get_business_profile' then array['merchant_id']
    when 'list_business_posts' then array['merchant_id','offset'] when 'get_business_post' then array['merchant_id','post_id']
    when 'list_business_drafts' then array['merchant_id','offset'] when 'preview_business_draft' then array['merchant_id','draft_id']
    when 'get_business_change' then array['merchant_id','request_id']
    when 'save_business_draft' then array['merchant_id','draft_id','title','body','tag_slug','image_paths','original_url','expected_updated_at']
    when 'publish_business_draft' then array['merchant_id','draft_id','expected_updated_at']
    when 'propose_business_change' then array['merchant_id','request_id','kind','post_id','expected_revision','changes'] end;
  if keys is null or (p_tool in ('save_business_draft','propose_business_change') and not c.allow_drafts)
    or (p_tool='publish_business_draft' and not c.allow_publish) then raise exception 'MCP_TOOL_NOT_ALLOWED'; end if;
  perform private.mcp_assert_keys(p_arguments,keys);
  if octet_length(p_arguments::text)>40000 then raise exception 'INVALID_MCP_INPUT'; end if;
  if p_tool in ('_context','list_my_businesses') then
    select jsonb_build_object('businesses',coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'city_id',m.city_id) order by m.name,m.id),'[]'::jsonb),
      'allow_drafts',c.allow_drafts,'allow_publish',c.allow_publish) into result from private.merchants m
      where m.id=any(c.merchant_ids) and m.owner_id=p_actor_id and m.owner_verified_at is not null;
  else
    mid:=(p_arguments->>'merchant_id')::uuid;
    if mid is null or not mid=any(c.merchant_ids) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
    perform private.mcp_assert_business(mid,p_tool in ('save_business_draft','propose_business_change','publish_business_draft'));
    offset_value:=coalesce((p_arguments->>'offset')::int,0);
    if offset_value not between 0 and 10000 then raise exception 'INVALID_MCP_INPUT'; end if;
    case p_tool
    when 'get_business_profile' then result:=private.mcp_content_snapshot(mid);
    when 'get_business_post' then
      if p_arguments->>'post_id' is null then raise exception 'INVALID_MCP_INPUT'; end if;
      result:=private.mcp_content_snapshot(mid,(p_arguments->>'post_id')::uuid);
    when 'list_business_posts' then
      select jsonb_build_object('merchant_id',mid,'posts',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) into result from (
        select p.id,p.title,left(p.body,220) body_preview,p.image_paths,p.created_at,p.updated_at,t.slug tag_slug,
          private.mcp_content_snapshot(mid,p.id)->>'revision' revision
        from public.posts p join private.merchant_posts mp on mp.post_id=p.id join public.tags t on t.id=p.tag_id
        where mp.merchant_id=mid and p.status='published' and p.room_preview is null order by p.created_at desc,p.id desc limit 20 offset offset_value)x;
    when 'list_business_drafts' then
      select jsonb_build_object('merchant_id',mid,'drafts',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) into result from (
        select id,title,left(body,220) body_preview,image_paths,tag_slug,approved_at,post_id,published_at,archived_at,updated_at
        from private.merchant_workspace_drafts where merchant_id=mid and channel='gling' order by updated_at desc,id desc limit 20 offset offset_value)x;
    when 'preview_business_draft','save_business_draft','publish_business_draft' then
      did:=(p_arguments->>'draft_id')::uuid;
      if did is null then raise exception 'INVALID_MCP_INPUT'; end if;
      select * into d from private.merchant_workspace_drafts where id=did for update;
      if d.id is not null and (d.merchant_id<>mid or d.channel<>'gling') then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
      if p_tool='save_business_draft' then
        if p_arguments?'image_paths' and jsonb_typeof(p_arguments->'image_paths')<>'array' then raise exception 'INVALID_MCP_INPUT'; end if;
        if jsonb_typeof(p_arguments->'title') is distinct from 'string' or jsonb_typeof(p_arguments->'body') is distinct from 'string' then raise exception 'INVALID_MCP_INPUT'; end if;
        if coalesce(p_arguments->>'tag_slug','business') not in ('business','jobs') then raise exception 'INVALID_MCP_INPUT'; end if;
        same_draft:=d.id is not null and d.title=btrim(p_arguments->>'title') and d.body=btrim(p_arguments->>'body')
          and d.original_url is not distinct from p_arguments->>'original_url' and d.tag_slug=coalesce(p_arguments->>'tag_slug','business') and d.kind='story'
          and (not p_arguments?'image_paths' or d.image_paths=array(select jsonb_array_elements_text(p_arguments->'image_paths')));
        if not same_draft then
          if d.id is not null and (p_arguments->>'expected_updated_at')::timestamptz is distinct from d.updated_at then raise exception 'MERCHANT_DRAFT_CHANGED'; end if;
          perform public.save_merchant_workspace_draft(mid,did,'gling',p_arguments->>'title',p_arguments->>'body',p_arguments->>'original_url',coalesce(p_arguments->>'tag_slug','business'),'story',
            case when p_arguments?'image_paths' then array(select jsonb_array_elements_text(p_arguments->'image_paths')) end);
        end if;
      elsif p_tool='publish_business_draft' then
        if d.id is null or d.approved_by is distinct from p_actor_id then raise exception 'MERCHANT_DRAFT_APPROVAL_REQUIRED'; end if;
        perform public.publish_merchant_workspace_draft(mid,did,(p_arguments->>'expected_updated_at')::timestamptz);
      elsif d.id is null then raise exception 'MERCHANT_DRAFT_NOT_FOUND'; end if;
      select jsonb_build_object('id',id,'merchant_id',merchant_id,'title',title,'body',body,'image_paths',image_paths,'tag_slug',tag_slug,'original_url',original_url,
        'approved_at',approved_at,'post_id',post_id,'published_at',published_at,'archived_at',archived_at,'updated_at',updated_at) into result from private.merchant_workspace_drafts where id=did;
    when 'propose_business_change' then
      did:=(p_arguments->>'request_id')::uuid; expected:=p_arguments->>'expected_revision';
      if did is null or expected is null or (p_arguments->>'kind'='profile' and p_arguments?'post_id')
        or (p_arguments->>'kind'<>'profile' and p_arguments->>'post_id' is null) then raise exception 'INVALID_MCP_INPUT'; end if;
      snapshot:=private.mcp_content_snapshot(mid,(p_arguments->>'post_id')::uuid);
      select * into proposal from private.merchant_mcp_changes where id=did for update;
      if proposal.id is not null then
        if proposal.connection_id<>c.id or proposal.merchant_id<>mid or proposal.kind is distinct from p_arguments->>'kind'
          or proposal.post_id is distinct from (p_arguments->>'post_id')::uuid or proposal.expected_revision<>expected
          or proposal.changes is distinct from p_arguments->'changes' then raise exception 'MCP_REQUEST_CONFLICT'; end if;
      else
        if snapshot->>'revision'<>expected then raise exception 'MERCHANT_POST_CHANGED'; end if;
        perform private.mcp_validate_change(p_arguments->>'kind',snapshot,p_arguments->'changes',mid);
        if (select count(*) from private.merchant_mcp_changes r join private.merchant_mcp_connections gc on gc.id=r.connection_id
          where r.merchant_id=mid and r.status='pending' and r.expires_at>now() and gc.revoked_at is null and gc.expires_at>now())>=100 then raise exception 'MCP_CHANGE_CAP'; end if;
        insert into private.merchant_mcp_changes(id,connection_id,merchant_id,kind,post_id,expected_revision,before_value,changes)
          values(did,c.id,mid,p_arguments->>'kind',(p_arguments->>'post_id')::uuid,expected,snapshot,p_arguments->'changes');
      end if;
      select to_jsonb(r)-'connection_id' into result from private.merchant_mcp_changes r where id=did;
    when 'get_business_change' then
      select to_jsonb(r)-'connection_id' into result from private.merchant_mcp_changes r join private.merchant_mcp_connections gc on gc.id=r.connection_id
        where r.id=(p_arguments->>'request_id')::uuid and r.merchant_id=mid and gc.actor_id=p_actor_id;
      if result is null then raise exception 'MCP_CHANGE_NOT_FOUND'; end if;
    end case;
  end if;
  if p_tool<>'_context' then insert into private.merchant_mcp_audit(connection_id,merchant_id,tool) values(c.id,mid,p_tool); end if;
  perform set_config('request.jwt.claims',coalesce(saved_claims,'{}'),true);
  return result;
exception when others then
  perform set_config('request.jwt.claims',coalesce(saved_claims,'{}'),true);
  raise;
end;
$$;
revoke all on function public.dispatch_merchant_mcp(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_merchant_mcp(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

create function public.get_my_merchant_mcp_changes(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_mcp_web_user(); perform private.mcp_assert_business(p_merchant_id);
  return coalesce((select jsonb_agg(to_jsonb(x) order by (x.status='pending') desc,x.created_at desc,x.id) from (
    select r.id,r.kind,r.post_id,r.before_value,r.changes,r.status,r.created_at,r.expires_at from private.merchant_mcp_changes r
      join private.merchant_mcp_connections c on c.id=r.connection_id where r.merchant_id=p_merchant_id and c.actor_id=auth.uid()
      and (r.status<>'pending' or (r.expires_at>now() and c.revoked_at is null and c.expires_at>now()))
      order by (r.status='pending') desc,r.created_at desc,r.id limit 50)x),'[]'::jsonb);
end;
$$;
create function public.review_merchant_mcp_change(p_request_id uuid,p_apply boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.merchant_mcp_changes; c private.merchant_mcp_connections; current_value jsonb; paths text[];
begin
  perform private.assert_mcp_web_user();
  if p_apply is null then raise exception 'INVALID_MCP_INPUT'; end if;
  select * into r from private.merchant_mcp_changes where id=p_request_id;
  select * into c from private.merchant_mcp_connections where id=r.connection_id and actor_id=auth.uid() for share;
  if c.id is null then raise exception 'MCP_CHANGE_NOT_FOUND'; end if;
  perform private.mcp_assert_business(r.merchant_id,true);
  select * into r from private.merchant_mcp_changes where id=p_request_id for update;
  if r.status<>'pending' then return jsonb_build_object('id',r.id,'status',r.status); end if;
  if p_apply then
    if c.revoked_at is not null or c.expires_at<=now() or not c.allow_drafts or not r.merchant_id=any(c.merchant_ids)
      or not exists(select 1 from auth.oauth_clients where id=c.client_id and deleted_at is null)
      or not exists(select 1 from auth.oauth_consents where user_id=auth.uid() and client_id=c.client_id and revoked_at is null) then raise exception 'MCP_CONNECTION_REQUIRED'; end if;
    if r.expires_at<=now() then raise exception 'MCP_CHANGE_EXPIRED'; end if;
    if r.post_id is not null then
      perform 1 from public.posts p join private.merchant_posts mp on mp.post_id=p.id where p.id=r.post_id and mp.merchant_id=r.merchant_id for update of p;
      if not found then raise exception 'MERCHANT_POST_NOT_FOUND'; end if;
    end if;
    current_value:=private.mcp_content_snapshot(r.merchant_id,r.post_id);
    if current_value->>'revision'<>r.expected_revision then raise exception 'MERCHANT_POST_CHANGED'; end if;
    perform private.mcp_validate_change(r.kind,current_value,r.changes,r.merchant_id);
    if r.kind='profile' then
      perform public.save_my_merchant_profile(r.merchant_id,
        case when r.changes?'avatar_path' then r.changes->>'avatar_path' else current_value->>'avatar_path' end,
        case when r.changes?'banner_path' then r.changes->>'banner_path' else current_value->>'banner_path' end,(current_value->>'updated_at')::timestamptz);
      update private.merchants set name=case when r.changes?'name' then btrim(r.changes->>'name') else name end,
        industry=case when r.changes?'industry' then btrim(r.changes->>'industry') else industry end,
        services=case when r.changes?'services' then btrim(r.changes->>'services') else services end,
        address=case when r.changes?'address' then btrim(r.changes->>'address') else address end,updated_at=clock_timestamp() where id=r.merchant_id;
    elsif r.kind='edit_post' then
      if r.changes?'image_paths' then paths:=array(select jsonb_array_elements_text(r.changes->'image_paths')); end if;
      perform public.edit_merchant_post(r.merchant_id,r.post_id,coalesce(r.changes->>'title',current_value->>'title'),coalesce(r.changes->>'body',current_value->>'body'),paths);
    else perform public.remove_merchant_post(r.merchant_id,r.post_id); end if;
  end if;
  update private.merchant_mcp_changes set status=case when p_apply then 'applied' else 'rejected' end,reviewed_at=clock_timestamp() where id=r.id;
  insert into private.merchant_mcp_audit(connection_id,merchant_id,tool) values(c.id,r.merchant_id,case when p_apply then 'web_apply_change' else 'web_reject_change' end);
  return jsonb_build_object('id',r.id,'status',case when p_apply then 'applied' else 'rejected' end);
end;
$$;
revoke all on function private.assert_mcp_web_user(),private.mcp_assert_business(uuid,boolean),private.mcp_assert_keys(jsonb,text[]),private.mcp_content_snapshot(uuid,uuid),private.mcp_validate_change(text,jsonb,jsonb,uuid),
  public.save_merchant_mcp_connection(uuid,uuid[],boolean,boolean),public.get_my_merchant_mcp_connections(),public.get_merchant_mcp_authorization(text),public.revoke_merchant_mcp_connection(uuid),
  public.get_my_merchant_mcp_changes(uuid),public.review_merchant_mcp_change(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_merchant_mcp_connection(uuid,uuid[],boolean,boolean),public.get_my_merchant_mcp_connections(),public.get_merchant_mcp_authorization(text),public.revoke_merchant_mcp_connection(uuid),
  public.get_my_merchant_mcp_changes(uuid),public.review_merchant_mcp_change(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
