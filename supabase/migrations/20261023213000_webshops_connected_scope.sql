-- List explicitly enrolled webshops; a selected business profile remains a setup candidate.
create or replace function public.get_admin_webshops(p_days integer default 30,p_merchant_id uuid default null) returns jsonb
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
      and (private.valid_webshop_url(w.url) or m.id=p_merchant_id)
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
