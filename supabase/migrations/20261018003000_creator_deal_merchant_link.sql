-- Collaboration dates can be planned dates; neither field proves a visit or payment.
alter table private.creator_deals
  add column collaboration_on date check(isfinite(collaboration_on) and collaboration_on>='1900-01-01'),
  add column updated_at timestamptz not null default clock_timestamp();

create or replace function public.record_admin_creator_deal(p_record jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare d private.creator_deals; old private.creator_deals; field record; today date;
begin
  perform private.lock_partnership_actor();
  if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>16000
    or p_record-array['id','creator_id','merchant_id','collaboration_on','agreed_on','currency','ad_fee_cents','meal_support_cents','deliverables','source_url','notes']<>'{}'::jsonb then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  for field in select * from jsonb_each(p_record) loop
    if field.value='null'::jsonb then
      if field.key not in ('merchant_id','collaboration_on','ad_fee_cents','meal_support_cents') then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif field.key in ('ad_fee_cents','meal_support_cents') then
      if jsonb_typeof(field.value)<>'number' or field.value::text !~ '^[0-9]+$' then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif jsonb_typeof(field.value)<>'string' then raise exception 'INVALID_PARTNERSHIP'; end if;
  end loop;
  if coalesce(p_record->>'agreed_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_PARTNERSHIP'; end if;
  if p_record->>'collaboration_on' is not null and p_record->>'collaboration_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_PARTNERSHIP'; end if;
  d:=jsonb_populate_record(null::private.creator_deals,'{"merchant_id":null,"ad_fee_cents":null,"meal_support_cents":null,"source_url":""}'::jsonb||p_record);
  if d.id is null or d.creator_id is null then raise exception 'INVALID_PARTNERSHIP'; end if;
  -- Match the existing campaign/participation merchant -> creator lock order.
  if d.merchant_id is not null then
    perform 1 from private.merchants where id=d.merchant_id and record_kind='business' and deleted_at is null for key share;
    if not found then raise exception 'INVALID_PARTNERSHIP'; end if;
  end if;
  perform 1 from private.partnership_creators where id=d.creator_id for update;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  select (clock_timestamp() at time zone c.timezone)::date into today from public.cities c
    join private.partnership_creators r on r.city_id=c.id where r.id=d.creator_id;
  if d.agreed_on>today then raise exception 'INVALID_PARTNERSHIP'; end if;
  d.deliverables:=btrim(d.deliverables); d.notes:=btrim(d.notes); d.source_url:=btrim(d.source_url);
  select * into old from private.creator_deals where id=d.id;
  if found then
    if (to_jsonb(old)-array['created_at','created_by','updated_at']) is distinct from (to_jsonb(d)-array['created_at','created_by','updated_at']) then
      raise exception 'PARTNERSHIP_CHANGED';
    end if;
    perform private.assert_partnership_admin();
    return d.id;
  end if;
  perform private.assert_partnership_admin();
  insert into private.creator_deals(id,creator_id,merchant_id,collaboration_on,agreed_on,currency,ad_fee_cents,meal_support_cents,deliverables,source_url,notes,created_by)
    values(d.id,d.creator_id,d.merchant_id,d.collaboration_on,d.agreed_on,d.currency,d.ad_fee_cents,d.meal_support_cents,d.deliverables,d.source_url,d.notes,auth.uid());
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(auth.uid(),d.id,'creator_deal_recorded',jsonb_build_object('creator_id',d.creator_id,'merchant_id',d.merchant_id));
  perform public.log_admin_access('analytics',null,d.creator_id);
  return d.id;
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then raise exception 'INVALID_PARTNERSHIP';
  when unique_violation then raise exception 'PARTNERSHIP_CHANGED';
end $$;

-- Vendor/date corrections do not change agreed costs or create another collaboration.
create function public.link_admin_creator_deal_merchant(p_id uuid,p_merchant_id uuid,p_collaboration_on date,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare old private.creator_deals; creator uuid;
begin
  perform private.lock_partnership_actor();
  if p_id is null or p_merchant_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or (p_collaboration_on is not null and (not isfinite(p_collaboration_on) or p_collaboration_on<'1900-01-01')) then raise exception 'INVALID_PARTNERSHIP'; end if;
  perform 1 from private.merchants where id=p_merchant_id and record_kind='business' and deleted_at is null for key share;
  if not found then raise exception 'INVALID_PARTNERSHIP'; end if;
  select creator_id into creator from private.creator_deals where id=p_id;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform 1 from private.partnership_creators where id=creator for update;
  select * into old from private.creator_deals where id=p_id for update;
  perform private.assert_partnership_admin();
  if old.merchant_id=p_merchant_id and old.collaboration_on is not distinct from p_collaboration_on then return p_id; end if;
  if old.updated_at<>p_expected_updated_at then raise exception 'PARTNERSHIP_CHANGED'; end if;
  update private.creator_deals set merchant_id=p_merchant_id,collaboration_on=p_collaboration_on,updated_at=clock_timestamp() where id=p_id;
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(auth.uid(),p_id,'creator_deal_merchant_linked',jsonb_build_object('creator_id',creator,'before',jsonb_build_object('merchant_id',old.merchant_id,'collaboration_on',old.collaboration_on),'after',jsonb_build_object('merchant_id',p_merchant_id,'collaboration_on',p_collaboration_on)));
  perform public.log_admin_access('analytics',null,creator);
  return p_id;
end $$;
alter function public.link_admin_creator_deal_merchant(uuid,uuid,date,timestamptz) owner to postgres;
revoke all on function public.link_admin_creator_deal_merchant(uuid,uuid,date,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.link_admin_creator_deal_merchant(uuid,uuid,date,timestamptz) to authenticated;
notify pgrst,'reload schema';
