-- Remove vendors from active use while preserving accounts, content and operating history.
alter table private.merchants add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;
drop index private.merchants_name_city_idx;
create unique index merchants_name_city_idx on private.merchants(city_id,lower(name)) where deleted_at is null;

create function public.delete_admin_merchants(p_merchants jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; requested integer; unique_ids integer;
begin
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_merchants is null or jsonb_typeof(p_merchants)<>'array' then raise exception 'INVALID_MERCHANT_SELECTION'; end if;
  requested:=jsonb_array_length(p_merchants);
  if requested not between 1 and 50 or exists(select 1 from jsonb_array_elements(p_merchants) value where jsonb_typeof(value) is distinct from 'object') then
    raise exception 'INVALID_MERCHANT_SELECTION';
  end if;
  begin
    select array_agg(id),count(distinct id) into ids,unique_ids from jsonb_to_recordset(p_merchants) as r(id uuid,updated_at timestamptz);
    if unique_ids<>requested or array_position(ids,null) is not null
      or exists(select 1 from jsonb_to_recordset(p_merchants) as r(id uuid,updated_at timestamptz) where updated_at is null) then
      raise exception 'INVALID_MERCHANT_SELECTION';
    end if;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'INVALID_MERCHANT_SELECTION';
  end;
  -- SHARE protects the actor while remaining compatible with workspace readers' audit FK locks.
  perform 1 from public.profiles where id=auth.uid() and account_status='active' for share;
  perform 1 from auth.users where id=auth.uid() for share;
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  perform 1 from private.merchants where id=any(ids) order by id for update;
  if not private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if (select count(*) from private.merchants m join jsonb_to_recordset(p_merchants) as r(id uuid,updated_at timestamptz)
    on m.id=r.id where m.deleted_at is null and m.updated_at=r.updated_at)<>requested then
    raise exception 'MERCHANT_SELECTION_CHANGED';
  end if;
  if exists(select 1 from private.merchant_naver_requests where merchant_id=any(ids) and status in ('in_flight','uncertain')) then
    raise exception 'MERCHANT_PUBLISHING_IN_PROGRESS';
  end if;
  perform public.log_admin_access('analytics');
  update private.merchants set deleted_at=clock_timestamp(),deleted_by=auth.uid(),status='paused',consent='revoked',updated_at=clock_timestamp()
    where id=any(ids);
  update private.merchant_account_invitations set revoked_at=clock_timestamp()
    where merchant_id=any(ids) and accepted_at is null and revoked_at is null;
  return requested;
end;
$$;
revoke all on function public.delete_admin_merchants(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.delete_admin_merchants(jsonb) to authenticated;

-- Keep the current authorization, auditing and visibility logic in the canonical functions.
do $$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('public.get_admin_merchants(text,integer)',
      'where p_search='''' or position(lower(p_search) in lower(m.name||'' ''||m.contact))>0',
      'where m.deleted_at is null and (p_search='''' or position(lower(p_search) in lower(m.name||'' ''||m.contact))>0)'),
    ('public.get_my_merchants()',
      'where m.owner_id=auth.uid() or private.is_admin()'||chr(10)||'      or m.owner_verified_at is not null and exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=auth.uid())',
      'where m.deleted_at is null and (m.owner_id=auth.uid() or private.is_admin()'||chr(10)||'      or m.owner_verified_at is not null and exists(select 1 from private.merchant_operators o where o.merchant_id=m.id and o.user_id=auth.uid()))'),
    ('private.assert_merchant_content_access(uuid,boolean,boolean)',
      'if m.id is null then raise exception ''MERCHANT_ACCESS_REQUIRED'';',
      'if m.id is null or m.deleted_at is not null then raise exception ''MERCHANT_ACCESS_REQUIRED'';'),
    ('private.assert_merchant_workspace(uuid,boolean)',
      'if m.id is null or (not private.is_admin() and m.owner_id is distinct from uid) then',
      'if m.id is null or m.deleted_at is not null or (not private.is_admin() and m.owner_id is distinct from uid) then'),
    ('public.get_admin_merchant(uuid,date,date)',
      'd:=private.merchant_period_data(p_merchant_id,p_start,p_end);',
      'if not exists(select 1 from private.merchants where id=p_merchant_id and deleted_at is null) then raise exception ''MERCHANT_NOT_FOUND''; end if;'||chr(10)||'  d:=private.merchant_period_data(p_merchant_id,p_start,p_end);'),
    ('public.save_admin_merchant(uuid,text,text,text,text,text,text,date,text,text,text)',
      'if p_name is null',
      'perform 1 from private.merchants where id=mid for update;'||chr(10)||'  if exists(select 1 from private.merchants where id=mid and deleted_at is not null) then raise exception ''MERCHANT_NOT_FOUND''; end if;'||chr(10)||'  if p_name is null'),
    ('public.set_admin_merchant_workspace_owner(uuid,uuid,boolean,date)',
      'if m.id is null then raise exception ''MERCHANT_NOT_FOUND'';',
      'if m.id is null or m.deleted_at is not null then raise exception ''MERCHANT_NOT_FOUND'';'),
    ('private.apply_merchant_account_connection(uuid,uuid,text,text,text,uuid)',
      'select * into m from private.merchants where id=p_merchant_id for update;',
      'select * into m from private.merchants where id=p_merchant_id for update;'||chr(10)||'  if m.id is null or m.deleted_at is not null then raise exception ''MERCHANT_NOT_FOUND''; end if;')
  ) p(signature,anchor,replacement) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if (length(definition)-length(replace(definition,patch.anchor,'')))/length(patch.anchor)<>1 then
      raise exception 'merchant deletion anchor changed: %',patch.signature;
    end if;
    execute replace(definition,patch.anchor,patch.replacement);
  end loop;
end;
$$;
notify pgrst,'reload schema';
