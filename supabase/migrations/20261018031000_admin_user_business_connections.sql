-- Reuse reviewed owner/operator connection semantics from either admin direction.
create function public.get_admin_user_businesses(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') into rows from (
    select m.id,m.name,c.name city_name,case when m.owner_id=p_user_id then 'owner' else 'operator' end role
    from private.merchants m join public.cities c on c.id=m.city_id
    where m.record_kind='business' and m.deleted_at is null
      and (m.owner_id=p_user_id or exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=p_user_id))
    order by m.name,m.id limit 50
  )x;
  perform public.log_admin_access('users',p_user_id,null);
  return jsonb_build_object('user_id',p_user_id,'businesses',rows);
end $$;
alter function public.get_admin_user_businesses(uuid) owner to postgres;
revoke all on function public.get_admin_user_businesses(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_user_businesses(uuid) to authenticated;

-- Source/curation records can never acquire a business owner through either entry.
do $$
declare definition text; signature text; anchor text; checks text;
begin
  foreach signature in array array[
    'public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamptz,text,text)',
    'private.apply_merchant_account_connection(uuid,uuid,text,text,text,uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='select * into m from private.merchants where id=p_merchant_id for update;';
    if position(anchor in definition)=0 then raise exception 'business connection lock anchor changed: %',signature; end if;
    checks:=anchor;
    if signature like 'public.%' then
      checks:=checks||E'\n  if not private.is_admin() or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>''session_id'' and (not_after is null or not_after>clock_timestamp())) then raise exception ''ADMIN_REQUIRED''; end if;';
    end if;
    execute replace(definition,anchor,checks||E'\n  if m.id is null or m.record_kind<>''business'' or m.deleted_at is not null then raise exception ''MERCHANT_NOT_FOUND''; end if;');
  end loop;
end $$;
notify pgrst,'reload schema';
