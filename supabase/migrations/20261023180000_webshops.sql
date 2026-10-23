-- Additive registry and report ledger; no merchant, purchase, or fee is fabricated.
create function private.valid_webshop_url(p_url text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(length(p_url)<=2048 and p_url ~ '^https://(www[.])?order[.]store/ca/store/[a-z0-9-]+(%26[a-z0-9-]+)*/[A-Za-z0-9_-]{20,80}$',false);
$$;

create function private.webshop_money(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='number' and p_value::text ~ '^[0-9]{1,8}$',false);
$$;

create function private.valid_webshop_checkout(p_value jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare quote jsonb; field text; stamp timestamptz;
begin
  if p_value is null or p_value='null'::jsonb then return true; end if;
  if jsonb_typeof(p_value)<>'object' or not (p_value ?& array['verifiedAt','fulfillment','basketLabel','sameConditionsConfirmed','uber','webshop'])
    or p_value-array['verifiedAt','fulfillment','basketLabel','sameConditionsConfirmed','uber','webshop']<>'{}'::jsonb
    or p_value->'sameConditionsConfirmed' is distinct from 'true'::jsonb or jsonb_typeof(p_value->'fulfillment') is distinct from 'string'
    or p_value->>'fulfillment' not in ('delivery','pickup')
    or jsonb_typeof(p_value->'basketLabel') is distinct from 'string' or length(btrim(p_value->>'basketLabel')) not between 1 and 200
    or jsonb_typeof(p_value->'verifiedAt') is distinct from 'string'
    or p_value->>'verifiedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
  stamp:=(p_value->>'verifiedAt')::timestamptz;
  if stamp is null or not isfinite(stamp) or stamp>clock_timestamp()+interval '5 minutes' then return false; end if;
  foreach field in array array['uber','webshop'] loop
    quote:=p_value->field;
    if jsonb_typeof(quote)<>'object' or not (quote ?& array['itemsCents','deliveryCents','serviceCents','discountCents','taxCents','tipCents','totalCents'])
      or quote-array['itemsCents','deliveryCents','serviceCents','discountCents','taxCents','tipCents','totalCents']<>'{}'::jsonb then return false; end if;
    if exists(select 1 from jsonb_each(quote) value where not private.webshop_money(value.value)) then return false; end if;
    if (quote->>'totalCents')::bigint<>(quote->>'itemsCents')::bigint+(quote->>'deliveryCents')::bigint+(quote->>'serviceCents')::bigint
      +(quote->>'taxCents')::bigint+(quote->>'tipCents')::bigint-(quote->>'discountCents')::bigint then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;

create table private.webshops (
  merchant_id uuid primary key references private.merchants(id),
  enabled boolean not null default false,
  url text check(url is null or private.valid_webshop_url(url)),
  provider text not null default 'uber' check(provider='uber'),
  comparisons jsonb not null default '[]' check(jsonb_typeof(comparisons)='array' and jsonb_array_length(comparisons)<=30),
  verified_at timestamptz check(verified_at is null or isfinite(verified_at)),
  promo_code text check(promo_code is null or promo_code ~ '^[A-Za-z0-9_-]{1,40}$'),
  checkout_comparison jsonb,
  commission_bps integer not null default 2500 check(commission_bps between 0 and 10000),
  commission_basis_confirmed boolean not null default false,
  commission_scope text check(commission_scope in ('attributed','all_webshop')),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(not enabled or url is not null),
  check(jsonb_array_length(comparisons)=0 or verified_at is not null)
);
create unique index webshops_destination on private.webshops(replace(url,'https://www.order.store/','https://order.store/')) where url is not null;
create table private.webshop_place_links (
  place_key text primary key check(place_key ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or place_key ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$'),
  merchant_id uuid not null references private.merchants(id),
  city_id text not null references public.cities(id),
  created_at timestamptz not null default clock_timestamp()
);
create index webshop_place_links_merchant on private.webshop_place_links(merchant_id);
create index webshop_place_links_city on private.webshop_place_links(city_id,place_key);
create table private.webshop_events (
  event_id uuid primary key,
  merchant_id uuid not null references private.merchants(id),
  session_id text not null check(session_id ~ '^[A-Za-z0-9_-]{20,80}$'),
  platform text not null check(platform in ('ios','android','web')),
  source text not null check(source in ('business_profile','comparison_sheet','map','place_detail')),
  kind text not null check(kind in ('sheet_view','outbound_click')),
  internal boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index webshop_events_merchant_period on private.webshop_events(merchant_id,created_at);
create index webshop_events_period on private.webshop_events(created_at) where not internal;
create index webshop_events_session on private.webshop_events(merchant_id,session_id);
create table private.webshop_reports (
  id uuid primary key,
  merchant_id uuid not null references private.merchants(id),
  period_start timestamptz not null, period_end timestamptz not null,
  evidence text not null check(length(btrim(evidence)) between 1 and 2000),
  orders_snapshot jsonb not null check(jsonb_typeof(orders_snapshot)='array'),
  imported_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  check(isfinite(period_start) and isfinite(period_end) and period_end>period_start and period_end-period_start<=interval '366 days')
);
create index webshop_reports_merchant_period on private.webshop_reports(merchant_id,period_start,period_end);
create index webshop_reports_actor on private.webshop_reports(imported_by) where imported_by is not null;
create table private.webshop_orders (
  merchant_id uuid not null references private.merchants(id),
  external_order_id text not null check(external_order_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  report_id uuid not null references private.webshop_reports(id),
  ordered_at timestamptz not null check(isfinite(ordered_at)),
  currency text not null check(currency='CAD'),
  food_subtotal_cents integer not null check(food_subtotal_cents between 0 and 99999999),
  refund_cents integer not null check(refund_cents between 0 and food_subtotal_cents),
  status text not null check(status in ('completed','cancelled','refunded','partial_refund')),
  attribution text not null check(attribution in ('provider_report','promo_code','unattributed')),
  primary key(merchant_id,external_order_id),
  check((status<>'completed' or refund_cents=0) and (status<>'refunded' or refund_cents=food_subtotal_cents)
    and (status<>'partial_refund' or refund_cents>0 and refund_cents<food_subtotal_cents))
);
create index webshop_orders_period on private.webshop_orders(merchant_id,ordered_at);
create index webshop_orders_report on private.webshop_orders(report_id);
create table private.webshop_audit (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references private.merchants(id),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check(action in ('config_saved','report_imported')),
  details jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index webshop_audit_merchant on private.webshop_audit(merchant_id,created_at);
create index webshop_audit_actor on private.webshop_audit(actor_id) where actor_id is not null;
do $$ declare name text; begin
  foreach name in array array['webshops','webshop_place_links','webshop_events','webshop_reports','webshop_orders','webshop_audit'] loop
    execute format('alter table private.%I owner to postgres',name);
    execute format('alter table private.%I enable row level security',name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
  end loop;
end $$;
revoke all on sequence private.webshop_audit_id_seq from public,anon,authenticated,service_role;

create function private.webshop_store(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('merchantId',m.id,'name',m.name,'cityId',m.city_id,'enabled',coalesce(w.enabled,false),
    'url',w.url,'provider',coalesce(w.provider,'uber'),'placeKeys',coalesce((select jsonb_agg(l.place_key order by l.place_key)
      from private.webshop_place_links l where l.merchant_id=m.id),'[]'::jsonb),'comparisons',coalesce(w.comparisons,'[]'::jsonb),
    'verifiedAt',w.verified_at,'promoCode',w.promo_code,'checkoutComparison',w.checkout_comparison,
    'commissionBps',coalesce(w.commission_bps,2500),'commissionBasisConfirmed',coalesce(w.commission_basis_confirmed,false),
    'commissionScope',w.commission_scope,'updatedAt',w.updated_at)
  from private.merchants m left join private.webshops w on w.merchant_id=m.id where m.id=p_merchant_id and m.record_kind='business' and m.deleted_at is null;
$$;
create function public.get_public_webshop(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('merchantId',w.merchant_id,'url',w.url,'provider',w.provider,'cityId',m.city_id,
    'placeKeys',coalesce((select jsonb_agg(l.place_key order by l.place_key) from private.webshop_place_links l where l.merchant_id=w.merchant_id and l.city_id=m.city_id),'[]'::jsonb),
    'comparisons',w.comparisons,'verifiedAt',w.verified_at,'promoCode',w.promo_code,'checkoutComparison',w.checkout_comparison)
  from private.webshops w join private.merchants m on m.id=w.merchant_id
  where w.merchant_id=p_merchant_id and w.enabled and private.valid_webshop_url(w.url) and public.get_merchant_profile(w.merchant_id) is not null;
$$;
create function public.get_city_business_links(p_city_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('placeKey',l.place_key,'merchantId',l.merchant_id) order by l.place_key),'[]'::jsonb)
  from (select l.place_key,l.merchant_id from private.webshop_place_links l join private.merchants m on m.id=l.merchant_id and m.city_id=l.city_id
    where l.city_id=p_city_id and public.get_merchant_profile(l.merchant_id) is not null order by l.place_key limit 1000) l;
$$;
create function public.get_city_webshops(p_city_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  with descriptors as materialized (
    select w.merchant_id,public.get_public_webshop(w.merchant_id) descriptor
    from private.webshops w join private.merchants m on m.id=w.merchant_id where m.city_id=p_city_id and w.enabled
  ) select coalesce(jsonb_agg(d.descriptor order by d.merchant_id),'[]'::jsonb)
    from (select merchant_id,descriptor from descriptors where descriptor is not null order by merchant_id limit 1000) d;
$$;

create function public.save_admin_webshop(p_merchant_id uuid,p_config jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; old private.webshops; before_state jsonb; item jsonb; key text; stamp timestamptz; verified timestamptz;
  destination text; enabled boolean; comparisons jsonb; keys jsonb; commission integer; basis boolean; scope text;
begin
  perform private.lock_partnership_actor();
  if p_merchant_id is null or jsonb_typeof(p_config) is distinct from 'object' or octet_length(p_config::text)>50000
    or p_config-array['merchantId','name','cityId','enabled','url','provider','placeKeys','comparisons','verifiedAt','promoCode','checkoutComparison',
      'commissionBps','commissionBasisConfirmed','commissionScope','updatedAt']<>'{}'::jsonb then raise exception 'INVALID_WEBSHOP'; end if;
  -- Serialize changes even when the first registry row does not exist yet.
  perform pg_advisory_xact_lock(hashtextextended('webshop:merchant:'||p_merchant_id,0));
  select * into m from private.merchants where id=p_merchant_id for share;
  if m.id is null or m.record_kind<>'business' or m.deleted_at is not null then raise exception 'WEBSHOP_NOT_FOUND'; end if;
  if jsonb_typeof(p_config->'cityId') is distinct from 'string' or p_config->>'cityId'<>m.city_id
    or (p_config ? 'merchantId' and p_config->>'merchantId' is distinct from m.id::text)
    or (p_config ? 'name' and p_config->>'name' is distinct from m.name) then raise exception 'WEBSHOP_BRANCH_MISMATCH'; end if;
  select * into old from private.webshops where merchant_id=p_merchant_id for update;
  before_state:=case when old.merchant_id is not null then private.webshop_store(p_merchant_id) end;
  if old.merchant_id is not null and (jsonb_typeof(p_config->'updatedAt') is distinct from 'string'
    or (p_config->>'updatedAt')::timestamptz is distinct from old.updated_at) then raise exception 'WEBSHOP_CHANGED'; end if;
  if old.merchant_id is null and p_config->>'updatedAt' is not null then raise exception 'WEBSHOP_CHANGED'; end if;
  if jsonb_typeof(p_config->'enabled') not in ('boolean','null') or not p_config ? 'enabled'
    or jsonb_typeof(p_config->'url') not in ('string','null') or not p_config ? 'url'
    or p_config->>'provider' is distinct from 'uber' then raise exception 'INVALID_WEBSHOP'; end if;
  enabled:=coalesce((p_config->>'enabled')::boolean,false); destination:=p_config->>'url';
  if destination is not null and not private.valid_webshop_url(destination) or enabled and destination is null then raise exception 'INVALID_WEBSHOP_URL'; end if;
  if enabled and (m.consent<>'granted' or m.status='paused') then raise exception 'WEBSHOP_UNAVAILABLE'; end if;
  keys:=p_config->'placeKeys'; comparisons:=p_config->'comparisons';
  if jsonb_typeof(keys) is distinct from 'array' or jsonb_array_length(keys)>50
    or jsonb_typeof(comparisons) is distinct from 'array' or jsonb_array_length(comparisons)>30 then raise exception 'INVALID_WEBSHOP'; end if;
  if exists(select 1 from jsonb_array_elements(keys) value where jsonb_typeof(value) is distinct from 'string'
    or length(value#>>'{}')>120 or not (value#>>'{}' ~ '^osm:(node|way|relation):[1-9][0-9]{0,19}$' or value#>>'{}' ~ '^partner:[a-z0-9]+(-[a-z0-9]+)*$'))
    or (select count(*) from jsonb_array_elements(keys))<>(select count(distinct value) from jsonb_array_elements(keys)) then raise exception 'INVALID_WEBSHOP_PLACE'; end if;
  for item in select value from jsonb_array_elements(comparisons) loop
    if jsonb_typeof(item) is distinct from 'object' or not item ?& array['id','name','uberCents','webCents']
      or item-array['id','name','uberCents','webCents']<>'{}'::jsonb
      or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
      or jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 120
      or not private.webshop_money(item->'uberCents') or not private.webshop_money(item->'webCents')
      or (item->>'uberCents')::bigint=0 then raise exception 'INVALID_WEBSHOP_COMPARISON'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(comparisons))<>(select count(distinct value->>'id') from jsonb_array_elements(comparisons)) then raise exception 'INVALID_WEBSHOP_COMPARISON'; end if;
  if not p_config ? 'verifiedAt' or jsonb_typeof(p_config->'verifiedAt') not in ('string','null')
    or p_config->>'verifiedAt' is not null and p_config->>'verifiedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'INVALID_WEBSHOP'; end if;
  verified:=(p_config->>'verifiedAt')::timestamptz;
  if verified is not null and (not isfinite(verified) or verified>clock_timestamp()+interval '5 minutes')
    or jsonb_array_length(comparisons)>0 and verified is null then raise exception 'INVALID_WEBSHOP_COMPARISON'; end if;
  if not p_config ? 'promoCode' or jsonb_typeof(p_config->'promoCode') not in ('string','null')
    or p_config->>'promoCode' is not null and p_config->>'promoCode' !~ '^[A-Za-z0-9_-]{1,40}$'
    or not p_config ? 'checkoutComparison' or not private.valid_webshop_checkout(p_config->'checkoutComparison') then raise exception 'INVALID_WEBSHOP_CHECKOUT'; end if;
  if not private.webshop_money(p_config->'commissionBps') or (p_config->>'commissionBps')::bigint>10000
    or jsonb_typeof(p_config->'commissionBasisConfirmed') is distinct from 'boolean'
    or not p_config ? 'commissionScope' or jsonb_typeof(p_config->'commissionScope') not in ('string','null')
    or p_config->>'commissionScope' is not null and p_config->>'commissionScope' not in ('attributed','all_webshop') then raise exception 'INVALID_WEBSHOP_COMMISSION'; end if;
  commission:=(p_config->>'commissionBps')::integer; basis:=(p_config->>'commissionBasisConfirmed')::boolean; scope:=p_config->>'commissionScope';
  stamp:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  insert into private.webshops(merchant_id,enabled,url,provider,comparisons,verified_at,promo_code,checkout_comparison,
    commission_bps,commission_basis_confirmed,commission_scope,updated_at)
    values(p_merchant_id,enabled,destination,'uber',comparisons,verified,p_config->>'promoCode',nullif(p_config->'checkoutComparison','null'::jsonb),commission,basis,scope,stamp)
    on conflict(merchant_id) do update set enabled=excluded.enabled,url=excluded.url,comparisons=excluded.comparisons,
      verified_at=excluded.verified_at,promo_code=excluded.promo_code,checkout_comparison=excluded.checkout_comparison,
      commission_bps=excluded.commission_bps,commission_basis_confirmed=excluded.commission_basis_confirmed,commission_scope=excluded.commission_scope,updated_at=excluded.updated_at;
  delete from private.webshop_place_links where merchant_id=p_merchant_id and not (place_key in (select value#>>'{}' from jsonb_array_elements(keys)));
  for key in select value#>>'{}' from jsonb_array_elements(keys) order by value#>>'{}' loop
    insert into private.webshop_place_links(place_key,merchant_id,city_id) values(key,p_merchant_id,m.city_id)
      on conflict(place_key) do update set city_id=excluded.city_id where private.webshop_place_links.merchant_id=excluded.merchant_id;
    if not found then raise exception 'WEBSHOP_PLACE_ALREADY_LINKED'; end if;
  end loop;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_merchant_id);
  insert into private.webshop_audit(merchant_id,actor_id,action,details)
    values(p_merchant_id,auth.uid(),'config_saved',jsonb_build_object('before',before_state,'after',private.webshop_store(p_merchant_id)));
  return private.webshop_store(p_merchant_id);
exception when unique_violation then raise exception 'WEBSHOP_DUPLICATE';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
    or check_violation or not_null_violation or foreign_key_violation then raise exception 'INVALID_WEBSHOP';
end $$;

create function private.record_webshop_event(p_merchant_id uuid,p_event_id uuid,p_session text,p_platform text,p_source text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare previous private.webshop_events; internal_actor boolean;
begin
  if p_merchant_id is null or p_event_id is null or p_session is null or p_session !~ '^[A-Za-z0-9_-]{20,80}$'
    or p_platform is null or p_platform not in ('ios','android','web') or p_source is null or p_source not in ('business_profile','comparison_sheet','map','place_detail')
    or p_kind is null or p_kind not in ('sheet_view','outbound_click') then raise exception 'INVALID_WEBSHOP_EVENT'; end if;
  if public.get_public_webshop(p_merchant_id) is null then raise exception 'WEBSHOP_UNAVAILABLE'; end if;
  -- Sheet and browser requests may arrive in either order for the same random session.
  perform pg_advisory_xact_lock(hashtextextended('webshop:session:'||p_merchant_id||':'||p_session,0));
  perform pg_advisory_xact_lock(hashtextextended('webshop:event:'||p_event_id,0));
  internal_actor:=exists(select 1 from auth.users u where u.id=auth.uid() and (u.raw_app_meta_data->>'role'='admin' or u.raw_app_meta_data->'review_access'='true'::jsonb))
    or exists(select 1 from private.merchants where id=p_merchant_id and owner_id=auth.uid())
    or exists(select 1 from private.merchant_operators where merchant_id=p_merchant_id and user_id=auth.uid())
    or exists(select 1 from private.webshop_events where merchant_id=p_merchant_id and session_id=p_session and internal);
  if internal_actor then
    update private.webshop_events set internal=true where merchant_id=p_merchant_id and session_id=p_session and not internal;
  end if;
  select * into previous from private.webshop_events where event_id=p_event_id;
  if previous.event_id is not null then
    if previous.merchant_id<>p_merchant_id or previous.session_id<>p_session or previous.platform<>p_platform or previous.source<>p_source or previous.kind<>p_kind then raise exception 'WEBSHOP_EVENT_CONFLICT'; end if;
    if internal_actor and not previous.internal then update private.webshop_events set internal=true where event_id=p_event_id; end if;
    return;
  end if;
  insert into private.webshop_events(event_id,merchant_id,session_id,platform,source,kind,internal)
    values(p_event_id,p_merchant_id,p_session,p_platform,p_source,p_kind,internal_actor);
end $$;
create function public.record_webshop_event(p_merchant_id uuid,p_event_id uuid,p_session text,p_platform text,p_source text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_kind is distinct from 'sheet_view' then raise exception 'INVALID_WEBSHOP_EVENT'; end if;
  perform private.record_webshop_event(p_merchant_id,p_event_id,p_session,p_platform,p_source,p_kind);
end $$;
create function public.resolve_webshop_redirect(p_merchant_id uuid,p_event_id uuid,p_session text,p_platform text,p_source text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare destination text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_REQUIRED'; end if;
  select w.url into destination from private.webshops w where w.merchant_id=p_merchant_id and w.enabled and private.valid_webshop_url(w.url)
    and public.get_merchant_profile(w.merchant_id) is not null for share;
  if destination is null then raise exception 'WEBSHOP_UNAVAILABLE'; end if;
  perform private.record_webshop_event(p_merchant_id,p_event_id,p_session,p_platform,p_source,'outbound_click');
  return jsonb_build_object('url',destination||'?utm_source=gling&utm_medium=referral&utm_campaign=webshop&utm_content='||p_merchant_id::text);
end $$;

create function public.import_admin_webshop_orders(p_merchant_id uuid,p_report_id uuid,p_period_start timestamptz,p_period_end timestamptz,p_evidence text,p_orders jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m private.merchants; report private.webshop_reports; previous private.webshop_orders; item jsonb; ordered timestamptz;
  subtotal integer; refund integer; imported integer:=0; duplicates integer:=0; snapshot jsonb;
begin
  perform private.lock_partnership_actor();
  if p_merchant_id is null or p_report_id is null or p_period_start is null or p_period_end is null or not isfinite(p_period_start) or not isfinite(p_period_end)
    or p_period_end<=p_period_start or p_period_end-p_period_start>interval '366 days' or p_period_end>clock_timestamp()+interval '5 minutes'
    or p_evidence is null or length(btrim(p_evidence)) not between 1 and 2000 or p_evidence ~ '[[:cntrl:]@]' or p_evidence ~ '[0-9]{13,19}'
    or jsonb_typeof(p_orders) is distinct from 'array' or jsonb_array_length(p_orders)>5000 or octet_length(p_orders::text)>2000000 then raise exception 'INVALID_WEBSHOP_REPORT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('webshop:merchant:'||p_merchant_id,0));
  perform pg_advisory_xact_lock(hashtextextended('webshop:report:'||p_report_id,0));
  select * into m from private.merchants where id=p_merchant_id for share;
  if m.id is null or m.record_kind<>'business' or m.deleted_at is not null then raise exception 'WEBSHOP_NOT_FOUND'; end if;
  if not exists(select 1 from private.webshops where merchant_id=p_merchant_id) then raise exception 'WEBSHOP_NOT_FOUND'; end if;
  for item in select value from jsonb_array_elements(p_orders) loop
    if jsonb_typeof(item) is distinct from 'object' or not item ?& array['externalOrderId','orderedAt','currency','foodSubtotalCents','refundCents','status','attribution']
      or item-array['externalOrderId','orderedAt','currency','foodSubtotalCents','refundCents','status','attribution']<>'{}'::jsonb
      or jsonb_typeof(item->'externalOrderId') is distinct from 'string' or item->>'externalOrderId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
      or jsonb_typeof(item->'orderedAt') is distinct from 'string'
      or item->>'orderedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' or item->>'currency' is distinct from 'CAD'
      or not private.webshop_money(item->'foodSubtotalCents') or not private.webshop_money(item->'refundCents')
      or item->>'status' is null or item->>'status' not in ('completed','cancelled','refunded','partial_refund')
      or item->>'attribution' is null or item->>'attribution' not in ('provider_report','promo_code','unattributed') then raise exception 'INVALID_WEBSHOP_ORDER'; end if;
    ordered:=(item->>'orderedAt')::timestamptz; subtotal:=(item->>'foodSubtotalCents')::integer; refund:=(item->>'refundCents')::integer;
    if ordered is null or not isfinite(ordered) or ordered<p_period_start or ordered>=p_period_end or refund>subtotal
      or item->>'status'='completed' and refund<>0 or item->>'status'='refunded' and refund<>subtotal
      or item->>'status'='partial_refund' and (refund=0 or refund>=subtotal) then raise exception 'INVALID_WEBSHOP_ORDER'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_orders))<>(select count(distinct value->>'externalOrderId') from jsonb_array_elements(p_orders)) then raise exception 'WEBSHOP_ORDER_DUPLICATE'; end if;
  select coalesce(jsonb_agg(value order by value->>'externalOrderId'),'[]'::jsonb) into snapshot from jsonb_array_elements(p_orders);
  select * into report from private.webshop_reports where id=p_report_id for update;
  if report.id is not null then
    if report.merchant_id<>p_merchant_id or report.period_start<>p_period_start or report.period_end<>p_period_end or report.evidence<>btrim(p_evidence) or report.orders_snapshot<>snapshot then raise exception 'WEBSHOP_REPORT_CONFLICT'; end if;
    perform private.assert_partnership_admin();
    perform public.log_admin_access('analytics',null,p_merchant_id);
    return jsonb_build_object('reportId',p_report_id,'imported',0,'duplicates',jsonb_array_length(snapshot));
  end if;
  insert into private.webshop_reports(id,merchant_id,period_start,period_end,evidence,orders_snapshot,imported_by)
    values(p_report_id,p_merchant_id,p_period_start,p_period_end,btrim(p_evidence),snapshot,auth.uid());
  for item in select value from jsonb_array_elements(snapshot) loop
    select * into previous from private.webshop_orders where merchant_id=p_merchant_id and external_order_id=item->>'externalOrderId';
    if previous.external_order_id is not null then
      if previous.ordered_at<>(item->>'orderedAt')::timestamptz or previous.currency<>item->>'currency'
        or previous.food_subtotal_cents<>(item->>'foodSubtotalCents')::integer or previous.refund_cents<>(item->>'refundCents')::integer
        or previous.status<>item->>'status' or previous.attribution<>item->>'attribution' then raise exception 'WEBSHOP_ORDER_CONFLICT'; end if;
      duplicates:=duplicates+1;
    else
      insert into private.webshop_orders(merchant_id,external_order_id,report_id,ordered_at,currency,food_subtotal_cents,refund_cents,status,attribution)
        values(p_merchant_id,item->>'externalOrderId',p_report_id,(item->>'orderedAt')::timestamptz,item->>'currency',
          (item->>'foodSubtotalCents')::integer,(item->>'refundCents')::integer,item->>'status',item->>'attribution');
      imported:=imported+1;
    end if;
  end loop;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_merchant_id);
  insert into private.webshop_audit(merchant_id,actor_id,action,details)
    values(p_merchant_id,auth.uid(),'report_imported',jsonb_build_object('reportId',p_report_id,'periodStart',p_period_start,'periodEnd',p_period_end,'imported',imported,'duplicates',duplicates));
  return jsonb_build_object('reportId',p_report_id,'imported',imported,'duplicates',duplicates);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
  or check_violation or not_null_violation or foreign_key_violation then raise exception 'INVALID_WEBSHOP_REPORT';
end $$;

create function public.get_admin_webshops(p_days integer default 30,p_merchant_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); start_at timestamptz; result jsonb;
begin
  perform private.lock_partnership_actor();
  if p_days is null or p_days not between 1 and 366 then raise exception 'INVALID_WEBSHOP_PERIOD'; end if;
  start_at:=((stamp at time zone 'UTC')::date-(p_days-1))::timestamp at time zone 'UTC';
  if p_merchant_id is not null and not exists(select 1 from private.merchants where id=p_merchant_id and record_kind='business' and deleted_at is null) then raise exception 'WEBSHOP_NOT_FOUND'; end if;
  with stores as materialized (
    select m.id,m.name,w.commission_bps,w.commission_basis_confirmed,w.commission_scope,
      exists(select 1 from private.webshop_reports r where r.merchant_id=m.id and r.period_start<stamp and r.period_end>start_at) available
    from private.merchants m left join private.webshops w on w.merchant_id=m.id
    where m.record_kind='business' and m.deleted_at is null and (p_merchant_id is null or m.id=p_merchant_id)
  ), events as materialized (
    select e.* from private.webshop_events e join stores s on s.id=e.merchant_id where e.created_at>=start_at and e.created_at<=stamp and not e.internal
  ), orders as materialized (
    select o.*,case when o.status='cancelled' then 0 else o.food_subtotal_cents-o.refund_cents end net
    from private.webshop_orders o join stores s on s.id=o.merchant_id where o.ordered_at>=start_at and o.ordered_at<=stamp
  ), metrics as (
    select s.*,
      (select count(*) from events e where e.merchant_id=s.id and e.kind='sheet_view') sheet_views,
      (select count(*) from events e where e.merchant_id=s.id and e.kind='outbound_click') clicks,
      (select count(distinct session_id) from events e where e.merchant_id=s.id and e.kind='outbound_click') sessions,
      case when available then (select count(*) from orders o where o.merchant_id=s.id and o.status<>'cancelled') end verified_orders,
      case when available then (select coalesce(sum(net),0) from orders o where o.merchant_id=s.id) end net_revenue,
      case when available then (select count(*) from orders o where o.merchant_id=s.id and o.status<>'cancelled' and o.attribution<>'unattributed') end attributed_orders,
      case when available then (select coalesce(sum(net),0) from orders o where o.merchant_id=s.id and o.attribution<>'unattributed') end attributed_revenue,
      case when available and s.commission_basis_confirmed and s.commission_scope is not null then
        round((select coalesce(sum(net),0) from orders o where o.merchant_id=s.id and (s.commission_scope='all_webshop' or o.attribution<>'unattributed'))*s.commission_bps::numeric/10000)::bigint end commission
    from stores s
  ) select jsonb_build_object('generatedAt',stamp,
    'stores',coalesce((select jsonb_agg(private.webshop_store(id) order by name,id) from stores),'[]'::jsonb),
    'totals',(select jsonb_build_object('sheetViews',coalesce(sum(sheet_views),0),'clicks',coalesce(sum(clicks),0),
      'sessions',(select count(distinct session_id) from events where kind='outbound_click'),
      'orderDataAvailable',coalesce(bool_or(available),false),'verifiedOrders',sum(verified_orders),'netRevenueCents',sum(net_revenue),
      'attributedVerifiedOrders',sum(attributed_orders),'attributedNetRevenueCents',sum(attributed_revenue),
      'estimatedCommissionCents',case when count(*) filter(where available)>0 and bool_and(commission is not null) filter(where available) then sum(commission) end,
      'currency',case when bool_or(available) then 'CAD' end) from metrics),
    'breakdown',coalesce((select jsonb_agg(jsonb_build_object('merchantId',id,'name',name,'sheetViews',sheet_views,'clicks',clicks,'sessions',sessions,
      'orderDataAvailable',available,'verifiedOrders',verified_orders,'netRevenueCents',net_revenue,'attributedVerifiedOrders',attributed_orders,
      'attributedNetRevenueCents',attributed_revenue,'estimatedCommissionCents',commission,'currency',case when available then 'CAD' end) order by name,id) from metrics),'[]'::jsonb),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('day',d.day::date,'sheetViews',(select count(*) from events e where e.kind='sheet_view' and (e.created_at at time zone 'UTC')::date=d.day::date),
      'clicks',(select count(*) from events e where e.kind='outbound_click' and (e.created_at at time zone 'UTC')::date=d.day::date),
      'verifiedOrders',case when exists(select 1 from private.webshop_reports r join stores s on s.id=r.merchant_id where r.period_start<(d.day+interval '1 day') at time zone 'UTC' and r.period_end>d.day at time zone 'UTC')
        then (select count(*) from orders o where o.status<>'cancelled' and (o.ordered_at at time zone 'UTC')::date=d.day::date) end,
      'netRevenueCents',case when exists(select 1 from private.webshop_reports r join stores s on s.id=r.merchant_id where r.period_start<(d.day+interval '1 day') at time zone 'UTC' and r.period_end>d.day at time zone 'UTC')
        then (select coalesce(sum(net),0) from orders o where (o.ordered_at at time zone 'UTC')::date=d.day::date) end) order by d.day)
      from generate_series(start_at at time zone 'UTC',(stamp at time zone 'UTC')::date::timestamp,interval '1 day') d(day)),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(jsonb_build_object('reportId',o.report_id,'merchantId',o.merchant_id,'externalOrderId',o.external_order_id,
      'orderedAt',o.ordered_at,'currency',o.currency,'foodSubtotalCents',o.food_subtotal_cents,'refundCents',o.refund_cents,'status',o.status,'attribution',o.attribution,'evidence',r.evidence)
      order by o.ordered_at desc,o.merchant_id,o.external_order_id) from orders o join private.webshop_reports r on r.id=o.report_id),'[]'::jsonb)) into result;
  perform private.assert_partnership_admin();
  perform public.log_admin_access('analytics',null,p_merchant_id);
  return result;
end $$;

do $$ declare proc record; begin
  for proc in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('valid_webshop_url','webshop_money','valid_webshop_checkout','webshop_store','record_webshop_event'))
      or (n.nspname='public' and p.proname in ('get_public_webshop','get_city_business_links','get_city_webshops','save_admin_webshop','record_webshop_event','resolve_webshop_redirect','import_admin_webshop_orders','get_admin_webshops')) loop
    execute format('alter function %s owner to postgres',proc.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',proc.signature);
  end loop;
end $$;
grant execute on function public.get_public_webshop(uuid),public.get_city_business_links(text),public.get_city_webshops(text),public.record_webshop_event(uuid,uuid,text,text,text,text) to anon,authenticated;
grant execute on function public.get_public_webshop(uuid) to service_role;
grant execute on function public.resolve_webshop_redirect(uuid,uuid,text,text,text) to service_role;
grant execute on function public.save_admin_webshop(uuid,jsonb),public.import_admin_webshop_orders(uuid,uuid,timestamptz,timestamptz,text,jsonb),public.get_admin_webshops(integer,uuid) to authenticated;
-- A missing target rejects its entire analytics batch, including older chat controls.
insert into private.behavior_targets(id) values
  ('webshop.retry'),('company.location'),('webshop.offer'),('webshop.order-preview'),
  ('webshop.close-backdrop'),('webshop.close'),('webshop.comparison'),('webshop.copy-code'),('webshop.order'),
  ('chat.open-map'),('chat.search-toggle'),('chat.search-close'),('chat.meetup-manage'),('chat.manage-dismiss'),('chat.meetup-summary')
on conflict (id) do nothing;
notify pgrst,'reload schema';
