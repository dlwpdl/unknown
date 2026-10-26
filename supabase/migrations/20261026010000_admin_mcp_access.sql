-- The operator account owns real businesses and has the unlimited admin tier, so it may connect its own AI.
-- An AI token still only reaches businesses this account owns: dispatch runs as an AAL1 business session,
-- so private.is_admin() stays false and no admin surface is reachable through the connection.
do $$
declare definition text:=pg_get_functiondef('private.assert_mcp_web_user()'::regprocedure);
  anchor text:='  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>''role''=''admin'') then raise exception ''MCP_BUSINESS_ACCOUNT_REQUIRED''; end if;';
begin
  if position(anchor in definition)=0 then raise exception 'MCP_WEB_USER_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor||E'\n','');
end;
$$;

do $$
declare definition text:=pg_get_functiondef('public.gling_access_token_hook(jsonb)'::regprocedure);
  anchor text:=E'\n    and u.raw_app_meta_data->''merchant_enabled''=''true''::jsonb and coalesce(u.raw_app_meta_data->>''role'','''')<>''admin'') then';
begin
  if position(anchor in definition)=0 then raise exception 'MCP_TOKEN_HOOK_DEFINITION_CHANGED'; end if;
  execute replace(definition,anchor,E'\n    and u.raw_app_meta_data->''merchant_enabled''=''true''::jsonb) then');
end;
$$;
