-- Bind the reviewed human account before any business AI connection is saved.
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
drop function if exists public.save_merchant_mcp_connection(uuid,uuid[],boolean,boolean);
revoke all on function public.save_merchant_mcp_connection(uuid,uuid,uuid[],boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_merchant_mcp_connection(uuid,uuid,uuid[],boolean,boolean) to authenticated;
notify pgrst,'reload schema';
