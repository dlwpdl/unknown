-- Free businesses write by hand: 1 new post and 2 bumps a month (5 days apart), no AI drafts or AI connections.
-- Paid businesses (plus/pro/premium, or an active legacy paid/trial workspace) can also invite co-managers by link.

create or replace function private.business_membership_details(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with selected as(
    select m,(now() at time zone c.timezone)::date local_today,case when m.owner_verified_at is not null and b.user_id=m.owner_id and private.is_active_account(b.user_id)
      then private.membership_entitlement(b.user_id,'business') end e
    from private.merchants m join public.cities c on c.id=m.city_id left join private.business_membership_bindings b on b.merchant_id=m.id where m.id=p_merchant_id
  ), usage as(
    select count(*) filter(where action='post')posts,count(*) filter(where action='bump')bumps,
      count(*) filter(where action='post' and managed)managed_posts,count(*) filter(where action='bump' and managed)managed_bumps,
      count(*) filter(where action='report')reports
    from private.merchant_membership_usage where merchant_id=p_merchant_id and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
  ) select jsonb_build_object('merchantId',p_merchant_id,'tier',coalesce(e->>'tier','free'),
    'expiresAt',e->>'expires_at','productId',e->>'product_id','store',e->>'store','willRenew',e->'will_renew',
    'canPurchase',auth.uid()=(m).owner_id and (m).owner_verified_at is not null,
    'postLimit',case when e is null and (((m).status='paid' and (m).workspace_until>=local_today) or ((m).status='trial' and (m).trial_ends_at>=local_today)) then null
      else case e->>'tier' when 'premium' then 30 when 'pro' then 30 when 'plus' then 12 else 1 end end,
    'bumpLimit',case e->>'tier' when 'premium' then 24 when 'pro' then 16 when 'plus' then 8 else 2 end,
    'bumpCooldownHours',case e->>'tier' when 'premium' then 48 when 'pro' then 60 when 'plus' then 72 else 120 end,
    'managedPostLimit',case e->>'tier' when 'premium' then 4 else 0 end,
    'managedBumpLimit',case e->>'tier' when 'premium' then 8 else 0 end,
    'reportLimit',case e->>'tier' when 'premium' then 1 else 0 end,
    'postsUsed',posts,'bumpsUsed',bumps,'managedPostsUsed',managed_posts,'managedBumpsUsed',managed_bumps,'reportsUsed',reports,
    'resetsAt',(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+interval '1 month',
    'nextBumpAt',(select max(created_at)+interval '24 hours' from private.merchant_membership_usage where merchant_id=p_merchant_id and action='bump'))
    from selected cross join usage;
$$;
revoke all on function private.business_membership_details(uuid) from public,anon,authenticated;

-- Co-manager seats per tier; an active legacy paid or trial workspace keeps one seat.
create function private.business_operator_limit(p_merchant_id uuid) returns int
language sql stable security definer set search_path='' as $$
  select case private.business_membership_details(p_merchant_id)->>'tier' when 'premium' then 5 when 'pro' then 3 when 'plus' then 1
    else case when private.merchant_workspace_plan(p_merchant_id)<>'basic' then 1 else 0 end end;
$$;
revoke all on function private.business_operator_limit(uuid) from public,anon,authenticated,service_role;

create function public.business_paid_features(p_merchant_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from private.merchants m where m.id=p_merchant_id and (m.owner_id=auth.uid() or private.is_admin()
    or exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=auth.uid()))) then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  return private.merchant_workspace_plan(p_merchant_id)<>'basic';
end;
$$;
revoke all on function public.business_paid_features(uuid) from public,anon,authenticated,service_role;
grant execute on function public.business_paid_features(uuid) to authenticated;

-- AI connections are a paid feature: refuse new grants and live tool calls for free businesses.
create or replace function public.save_merchant_mcp_connection(p_expected_actor_id uuid,p_client_id uuid,p_merchant_ids uuid[],p_allow_drafts boolean,p_allow_publish boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cid uuid; mid uuid;
begin
  perform private.assert_mcp_web_user();
  if p_expected_actor_id is distinct from auth.uid() then raise exception 'ACCOUNT_CHANGED'; end if;
  if p_merchant_ids is null or cardinality(p_merchant_ids) not between 1 and 50 or array_position(p_merchant_ids,null) is not null
    or (select count(distinct id) from unnest(p_merchant_ids)id)<>cardinality(p_merchant_ids)
    or p_allow_drafts is null or p_allow_publish is null then raise exception 'INVALID_MCP_INPUT'; end if;
  if not exists(select 1 from auth.oauth_clients where id=p_client_id and deleted_at is null) then raise exception 'MCP_CLIENT_NOT_FOUND'; end if;
  if p_allow_publish and not exists(select 1 from auth.oauth_clients where id=p_client_id and deleted_at is null
    and private.mcp_trusted_redirect_uris(redirect_uris)) then raise exception 'MCP_PUBLISH_CLIENT_UNVERIFIED'; end if;
  perform 1 from private.merchant_mcp_connections where actor_id=auth.uid() and client_id=p_client_id and revoked_at is null for update;
  for mid in select id from unnest(p_merchant_ids)id order by id loop
    perform private.mcp_assert_business(mid);
    if private.merchant_workspace_plan(mid)='basic' then raise exception 'MCP_PLAN_REQUIRED'; end if;
  end loop;
  perform private.enforce_rate_limit('merchant-mcp-connect',20,interval '1 day');
  -- A changed scope creates a new ID; reconnecting never revives an older token.
  update private.merchant_mcp_connections set revoked_at=clock_timestamp() where actor_id=auth.uid() and client_id=p_client_id and revoked_at is null;
  insert into private.merchant_mcp_connections(actor_id,client_id,merchant_ids,allow_drafts,allow_publish)
    values(auth.uid(),p_client_id,p_merchant_ids,p_allow_drafts,p_allow_publish) returning id into cid;
  return jsonb_build_object('id',cid,'client_id',p_client_id,'merchant_ids',p_merchant_ids,'allow_drafts',p_allow_drafts,'allow_publish',p_allow_publish);
end;
$$;
revoke all on function public.save_merchant_mcp_connection(uuid,uuid,uuid[],boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_merchant_mcp_connection(uuid,uuid,uuid[],boolean,boolean) to authenticated;

do $$
declare definition text:=pg_get_functiondef('public.dispatch_merchant_mcp(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
  anchor text:='    perform private.mcp_assert_business(mid,p_tool in (''save_business_draft'',''propose_business_change'',''publish_business_draft''));';
begin
  if position(anchor in definition)=0 then raise exception 'MCP_DISPATCH_DEFINITION_CHANGED'; end if;
  -- A business that drops to free loses AI access on its next call, not when the 30-day connection expires.
  execute replace(definition,anchor,anchor||E'\n    if private.merchant_workspace_plan(mid)=''basic'' then raise exception ''MCP_PLAN_REQUIRED''; end if;');
end;
$$;

-- Owner-made invite links: one-time, 7 days, only the hash is stored, seats checked when made and when used.
create table private.merchant_operator_links (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references private.merchants(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
  used_at timestamptz, used_by uuid references public.profiles(id) on delete set null, revoked_at timestamptz,
  check(expires_at>created_at)
);
create index merchant_operator_links_open on private.merchant_operator_links(merchant_id) where used_at is null and revoked_at is null;
alter table private.merchant_operator_links enable row level security;
revoke all on private.merchant_operator_links from public,anon,authenticated,service_role;

create function private.assert_business_owner(p_merchant_id uuid) returns private.merchants
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  -- AI connection tokens carry a client id and must never manage people.
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.lock_merchant_connection_account();
  select * into m from private.merchants where id=p_merchant_id for update;
  if m.id is null or m.owner_id is distinct from auth.uid() then raise exception 'MERCHANT_ACCESS_REQUIRED'; end if;
  if m.owner_verified_at is null then raise exception 'MERCHANT_OWNER_VERIFICATION_REQUIRED'; end if;
  return m;
end;
$$;
revoke all on function private.assert_business_owner(uuid) from public,anon,authenticated,service_role;

create function private.merchant_operator_link_hash(p_token text) returns text
language plpgsql immutable set search_path='' as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32}$' then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  return encode(extensions.digest(convert_to(p_token,'UTF8'),'sha256'),'hex');
end;
$$;
revoke all on function private.merchant_operator_link_hash(text) from public,anon,authenticated,service_role;

create function public.get_merchant_operator_links(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants;
begin
  m:=private.assert_business_owner(p_merchant_id);
  return jsonb_build_object('limit',private.business_operator_limit(m.id),
    'operators',(select count(*) from private.merchant_operators where merchant_id=m.id),
    'links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'expires_at',expires_at) order by created_at desc)
      from private.merchant_operator_links where merchant_id=m.id and used_at is null and revoked_at is null and expires_at>now()),'[]'::jsonb));
end;
$$;

create function public.create_merchant_operator_link(p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; seats int; taken int; token text; link private.merchant_operator_links;
begin
  m:=private.assert_business_owner(p_merchant_id);
  seats:=private.business_operator_limit(m.id);
  if seats<1 then raise exception 'MERCHANT_OPERATOR_PLAN_REQUIRED'; end if;
  taken:=(select count(*) from private.merchant_operators where merchant_id=m.id)
    +(select count(*) from private.merchant_operator_links where merchant_id=m.id and used_at is null and revoked_at is null and expires_at>now());
  if taken>=seats then raise exception 'MERCHANT_OPERATOR_LIMIT'; end if;
  perform private.enforce_rate_limit('merchant-operator-link',20,interval '1 day');
  token:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');
  insert into private.merchant_operator_links(merchant_id,token_hash,created_by) values(m.id,private.merchant_operator_link_hash(token),auth.uid()) returning * into link;
  return jsonb_build_object('id',link.id,'token',token,'expires_at',link.expires_at);
end;
$$;

create function public.revoke_merchant_operator_link(p_link_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  select merchant_id into mid from private.merchant_operator_links where id=p_link_id;
  if mid is null then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  perform private.assert_business_owner(mid);
  update private.merchant_operator_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_link_id and used_at is null;
  return true;
end;
$$;

-- The invitee sees only the business name and city before choosing to join.
create function public.preview_merchant_operator_link(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.enforce_rate_limit('merchant-operator-link-preview',30,interval '1 hour');
  select jsonb_build_object('merchant_name',m.name,'city_name',c.name,'expires_at',l.expires_at) into result
    from private.merchant_operator_links l join private.merchants m on m.id=l.merchant_id join public.cities c on c.id=m.city_id
    where l.token_hash=private.merchant_operator_link_hash(p_token) and l.used_at is null and l.revoked_at is null and l.expires_at>now()
      and m.owner_id=l.created_by and m.owner_verified_at is not null and m.deleted_at is null;
  if result is null then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

create function public.accept_merchant_operator_link(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare link private.merchant_operator_links; m private.merchants; v_hash text:=private.merchant_operator_link_hash(p_token);
begin
  if auth.uid() is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'client_id' is not null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.enforce_rate_limit('merchant-operator-link-accept',20,interval '1 hour');
  perform private.lock_merchant_connection_account();
  select * into link from private.merchant_operator_links l where l.token_hash=v_hash;
  if link.id is null then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  select * into m from private.merchants where id=link.merchant_id for update;
  select * into link from private.merchant_operator_links where id=link.id for update;
  if link.used_at is not null or link.revoked_at is not null or link.expires_at<=now() or m.deleted_at is not null
    or m.owner_id is distinct from link.created_by or m.owner_verified_at is null then raise exception 'MERCHANT_INVITATION_NOT_AVAILABLE'; end if;
  if m.owner_id=auth.uid() or exists(select 1 from private.merchant_operators where merchant_id=m.id and user_id=auth.uid()) then raise exception 'MERCHANT_ALREADY_CONNECTED'; end if;
  -- The plan may have dropped since the link was made; existing co-managers keep their seats.
  if (select count(*) from private.merchant_operators where merchant_id=m.id)>=private.business_operator_limit(m.id) then raise exception 'MERCHANT_OPERATOR_LIMIT'; end if;
  perform private.apply_merchant_account_connection(m.id,auth.uid(),'operator','invitation','사장님 초대 링크로 공동 관리자 연결');
  update private.merchant_operator_links set used_at=clock_timestamp(),used_by=auth.uid() where id=link.id;
  return m.id;
end;
$$;

revoke all on function public.get_merchant_operator_links(uuid),public.create_merchant_operator_link(uuid),public.revoke_merchant_operator_link(uuid),
  public.preview_merchant_operator_link(text),public.accept_merchant_operator_link(text) from public,anon,authenticated,service_role;
grant execute on function public.get_merchant_operator_links(uuid),public.create_merchant_operator_link(uuid),public.revoke_merchant_operator_link(uuid),
  public.preview_merchant_operator_link(text),public.accept_merchant_operator_link(text) to authenticated;
notify pgrst,'reload schema';
