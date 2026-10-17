-- Agreed costs are reference terms, never evidence of payment or completed content.
create table private.creator_deals (
  id uuid primary key,
  creator_id uuid not null references private.partnership_creators(id),
  merchant_id uuid references private.merchants(id),
  agreed_on date not null check(isfinite(agreed_on) and agreed_on>='1900-01-01'),
  currency text not null check(currency in ('CAD','USD')),
  ad_fee_cents integer check(ad_fee_cents between 0 and 99999999),
  meal_support_cents integer check(meal_support_cents between 0 and 99999999),
  deliverables text not null check(length(btrim(deliverables)) between 1 and 300),
  source_url text not null default '' check(source_url='' or private.valid_merchant_original(source_url)),
  notes text not null check(length(btrim(notes)) between 1 and 3000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index creator_deals_latest_currency on private.creator_deals(creator_id,currency,agreed_on desc,created_at desc,id desc);
create index creator_deals_history on private.creator_deals(creator_id,agreed_on desc,created_at desc,id desc);
create index creator_deals_merchant on private.creator_deals(merchant_id);
create index creator_deals_actor on private.creator_deals(created_by);
alter table private.creator_deals owner to postgres;
alter table private.creator_deals enable row level security;
revoke all on private.creator_deals from public,anon,authenticated,service_role;

create function private.creator_deal_record(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(d)||jsonb_build_object('merchant_name',m.name,'recorded_by_name',p.nickname)
  from private.creator_deals d left join private.merchants m on m.id=d.merchant_id
  left join public.profiles p on p.id=d.created_by where d.id=p_id
$$;
alter function private.creator_deal_record(uuid) owner to postgres;
revoke all on function private.creator_deal_record(uuid) from public,anon,authenticated,service_role;

create function public.record_admin_creator_deal(p_record jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare d private.creator_deals; old private.creator_deals; field record; today date;
begin
  perform private.lock_partnership_actor();
  if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>16000
    or p_record-array['id','creator_id','merchant_id','agreed_on','currency','ad_fee_cents','meal_support_cents','deliverables','source_url','notes']<>'{}'::jsonb then
    raise exception 'INVALID_PARTNERSHIP';
  end if;
  for field in select * from jsonb_each(p_record) loop
    if field.value='null'::jsonb then
      if field.key not in ('merchant_id','ad_fee_cents','meal_support_cents') then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif field.key in ('ad_fee_cents','meal_support_cents') then
      if jsonb_typeof(field.value)<>'number' or field.value::text !~ '^[0-9]+$' then raise exception 'INVALID_PARTNERSHIP'; end if;
    elsif jsonb_typeof(field.value)<>'string' then raise exception 'INVALID_PARTNERSHIP'; end if;
  end loop;
  if coalesce(p_record->>'agreed_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_PARTNERSHIP'; end if;
  d:=jsonb_populate_record(null::private.creator_deals,'{"merchant_id":null,"ad_fee_cents":null,"meal_support_cents":null,"source_url":""}'::jsonb||p_record);
  if d.id is null or d.creator_id is null then raise exception 'INVALID_PARTNERSHIP'; end if;
  -- Match the existing campaign/participation merchant -> creator lock order.
  if d.merchant_id is not null then
    perform 1 from private.merchants where id=d.merchant_id for key share;
    if not found then raise exception 'INVALID_PARTNERSHIP'; end if;
  end if;
  perform 1 from private.partnership_creators where id=d.creator_id for update;
  if not found then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  select (clock_timestamp() at time zone c.timezone)::date into today from public.cities c
    join private.partnership_creators r on r.city_id=c.id where r.id=d.creator_id;
  if d.agreed_on>today then raise exception 'INVALID_PARTNERSHIP'; end if;
  d.deliverables:=btrim(d.deliverables); d.notes:=btrim(d.notes); d.source_url:=btrim(d.source_url);
  select * into old from private.creator_deals where id=d.id;
  if found then
    if (to_jsonb(old)-array['created_at','created_by']) is distinct from (to_jsonb(d)-array['created_at','created_by']) then
      raise exception 'PARTNERSHIP_CHANGED';
    end if;
    perform private.assert_partnership_admin();
    return d.id;
  end if;
  perform private.assert_partnership_admin();
  insert into private.creator_deals(id,creator_id,merchant_id,agreed_on,currency,ad_fee_cents,meal_support_cents,deliverables,source_url,notes,created_by)
    values(d.id,d.creator_id,d.merchant_id,d.agreed_on,d.currency,d.ad_fee_cents,d.meal_support_cents,d.deliverables,d.source_url,d.notes,auth.uid());
  insert into private.partnership_events(actor_id,resource_id,action,details)
    values(auth.uid(),d.id,'creator_deal_recorded',jsonb_build_object('creator_id',d.creator_id,'merchant_id',d.merchant_id));
  perform public.log_admin_access('analytics',null,d.creator_id);
  return d.id;
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then raise exception 'INVALID_PARTNERSHIP';
  when unique_violation then raise exception 'PARTNERSHIP_CHANGED';
end $$;

create function public.get_admin_creator_deal(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
  perform private.lock_partnership_actor();
  item:=private.creator_deal_record(p_id);
  if item is null then raise exception 'PARTNERSHIP_NOT_FOUND'; end if;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,(item->>'creator_id')::uuid);
  return item;
end $$;

create function public.get_admin_creator_directory(p_search text default '',p_offset integer default 0,p_id uuid default null,
  p_child_offset integer default 0,p_sort text default 'date_desc',p_currency text default 'CAD') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; rows jsonb; history jsonb:='[]'; more boolean; history_more boolean:=false; latest uuid;
begin
  perform private.lock_partnership_actor();
  if p_sort is null or p_sort not in ('date_desc','date_asc','fee_asc','fee_desc','support_asc','support_desc','updated_desc')
    or p_currency is null or p_currency not in ('CAD','USD') then raise exception 'INVALID_PARTNERSHIP'; end if;
  -- Preserve existing record, participation, audit and paging contracts for other callers.
  result:=public.get_admin_partnerships('creators',p_search,p_offset,p_id,p_child_offset);
  with matches as (
    select r.id,r.updated_at,r.display_name,d.id deal_id,d.agreed_on,d.ad_fee_cents,d.meal_support_cents
    from private.partnership_creators r join public.cities city on city.id=r.city_id
    left join public.profiles p on p.id=r.member_id
    left join lateral (select x.* from private.creator_deals x where x.creator_id=r.id and x.currency=p_currency
      order by x.agreed_on desc,x.created_at desc,x.id desc limit 1)d on true
    where p_search='' or position(lower(p_search) in lower(concat_ws(' ',r.display_name,p.nickname,city.name,r.city_id,r.profile_url,r.category,r.contact_name,r.contact,r.content_summary,r.activity_regions,r.platforms::text)))>0
      or exists(select 1 from private.partnership_participations x join private.partnership_campaigns c on c.id=x.campaign_id
        join private.merchants m on m.id=c.merchant_id where x.creator_id=r.id and position(lower(p_search) in lower(c.title||' '||m.name))>0)
  ), ranked as (
    select *,row_number() over(order by
      case when p_sort='date_desc' then agreed_on end desc nulls last,
      case when p_sort='date_asc' then agreed_on end asc nulls last,
      case when p_sort='fee_asc' then ad_fee_cents end asc nulls last,
      case when p_sort='fee_desc' then ad_fee_cents end desc nulls last,
      case when p_sort='support_asc' then meal_support_cents end asc nulls last,
      case when p_sort='support_desc' then meal_support_cents end desc nulls last,
      case when p_sort='updated_desc' then updated_at end desc,
      display_name,id) position from matches
  ), page as materialized (select * from ranked order by position limit 51 offset p_offset)
  select coalesce((select jsonb_agg(private.partnership_record('creators',p.id)||jsonb_build_object('latest_deal',private.creator_deal_record(p.deal_id),
    'deal_count',(select count(*) from private.creator_deals d where d.creator_id=p.id)) order by p.position)
    from (select * from page order by position limit 50)p),'[]'),(select count(*)>50 from page) into rows,more;
  if p_id is not null then
    select id into latest from private.creator_deals where creator_id=p_id and currency=p_currency order by agreed_on desc,created_at desc,id desc limit 1;
    result:=jsonb_set(result,'{record}',(result->'record')||jsonb_build_object('latest_deal',private.creator_deal_record(latest),
      'deal_count',(select count(*) from private.creator_deals where creator_id=p_id)));
    with page as materialized (select * from private.creator_deals where creator_id=p_id order by agreed_on desc,created_at desc,id desc limit 51 offset p_child_offset)
    select coalesce((select jsonb_agg(private.creator_deal_record(p.id) order by p.agreed_on desc,p.created_at desc,p.id desc)
      from (select * from page order by agreed_on desc,created_at desc,id desc limit 50)p),'[]'),(select count(*)>50 from page) into history,history_more;
  end if;
  perform private.assert_partnership_admin();
  return result||jsonb_build_object('rows',rows,'more',more,'deals',history,'children_more',(result->>'children_more')::boolean or history_more);
end $$;

alter function public.record_admin_creator_deal(jsonb) owner to postgres;
alter function public.get_admin_creator_deal(uuid) owner to postgres;
alter function public.get_admin_creator_directory(text,integer,uuid,integer,text,text) owner to postgres;
revoke all on function public.record_admin_creator_deal(jsonb),public.get_admin_creator_deal(uuid),public.get_admin_creator_directory(text,integer,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_admin_creator_deal(jsonb),public.get_admin_creator_deal(uuid),public.get_admin_creator_directory(text,integer,uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';
