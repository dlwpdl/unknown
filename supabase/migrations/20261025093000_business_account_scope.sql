-- Business approval is independent of the separate, MFA-protected admin role.
create or replace function private.assert_merchant_access() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  perform 1 from auth.users where id=auth.uid() for share;
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then return; end if;
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  else raise exception 'MERCHANT_ACCOUNT_REQUIRED'; end if;
end;
$$;

create or replace function public.get_my_merchant_access() returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(auth.uid());
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->'merchant_enabled'='true'::jsonb) then return true; end if;
  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin') then
    if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
    return true;
  end if;
  return false;
end;
$$;

create function public.get_my_business_workspace_access() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); enabled boolean; businesses jsonb;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_active_account(uid);
  select coalesce(raw_app_meta_data->'merchant_enabled'='true'::jsonb,false) into enabled from auth.users where id=uid;
  if not coalesce(enabled,false) then return jsonb_build_object('actor_id',uid,'enabled',false,'merchants','[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]'::jsonb) into businesses from (
    select m.id,m.name,m.city_id,c.name city_name,
      case when m.owner_id=uid then m.contact else '' end contact,
      m.status,m.owner_id,m.owner_verified_at,m.trial_ends_at,m.workspace_until,
      (now() at time zone c.timezone)::date today,private.merchant_workspace_plan(m.id) plan,
      case when m.owner_id=uid then 'owner' else 'operator' end role
    from private.merchants m join public.cities c on c.id=m.city_id
    where m.record_kind='business' and m.deleted_at is null and (m.owner_id=uid
      or m.owner_verified_at is not null and exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=uid))
    order by m.name,m.id limit 50
  )x;
  return jsonb_build_object('actor_id',uid,'enabled',true,'merchants',businesses);
end;
$$;
alter function public.get_my_business_workspace_access() owner to postgres;
revoke all on function public.get_my_business_workspace_access() from public,anon,authenticated,service_role;
grant execute on function public.get_my_business_workspace_access() to authenticated;

-- Registration already checks approval and creates a business owned by auth.uid().
do $$
declare definition text:=pg_get_functiondef('public.register_my_merchant(uuid,text,text,text)'::regprocedure);
  redundant_check text:='  if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>''role''=''admin'') and not private.is_admin() then raise exception ''ADMIN_REQUIRED''; end if;';
begin
  if position(redundant_check in definition)=0 then raise exception 'MERCHANT_REGISTRATION_DEFINITION_CHANGED'; end if;
  execute replace(definition,redundant_check,'');
end;
$$;
notify pgrst,'reload schema';
