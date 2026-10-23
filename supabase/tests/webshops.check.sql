-- Run only against an isolated local schema with this migration; everything rolls back.
begin;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
select is((select count(*) from private.behavior_targets where id in (
  'webshop.retry','company.location','webshop.offer','webshop.order-preview','webshop.close-backdrop','webshop.close','webshop.comparison','webshop.copy-code','webshop.order',
  'chat.open-map','chat.search-toggle','chat.search-close','chat.meetup-manage','chat.manage-dismiss','chat.meetup-summary')),15::bigint,'webshop and existing chat controls are allowlisted without recording events');
insert into public.cities values('webshop-test','Webshop test','BC','America/Vancouver',true),('webshop-other','Other test','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('c2300000-0000-4000-8000-000000000001','webshop-admin@example.test','{"role":"admin"}'),
 ('c2300000-0000-4000-8000-000000000002','webshop-owner@example.test','{"merchant_enabled":true}'),
 ('c2300000-0000-4000-8000-000000000003','webshop-reader@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('c2300000-0000-4000-8000-000000000001','WebshopAdmin','webshop-test'),
 ('c2300000-0000-4000-8000-000000000002','WebshopOwner','webshop-test'),
 ('c2300000-0000-4000-8000-000000000003','WebshopReader','webshop-test');
insert into auth.sessions(id,user_id,aal) values('c2300000-0000-4000-8000-000000000010','c2300000-0000-4000-8000-000000000001','aal2');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('c2310000-0000-4000-8000-000000000001','Webshop branch one','webshop-test','trial','granted','Synthetic rollback fixture','business','c2300000-0000-4000-8000-000000000002',now()),
 ('c2310000-0000-4000-8000-000000000002','Webshop branch two','webshop-test','trial','granted','Synthetic rollback fixture','business','c2300000-0000-4000-8000-000000000002',now());
create function pg_temp.save_webshop(mid uuid,patch jsonb) returns jsonb language sql security definer set search_path='' as $$
  select public.save_admin_webshop(mid,private.webshop_store(mid)||patch)
$$;
create function pg_temp.webshop_orders() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('externalOrderId','test-complete','orderedAt',now()-interval '1 hour','currency','CAD','foodSubtotalCents',1000,'refundCents',0,'status','completed','attribution','provider_report'),
    jsonb_build_object('externalOrderId','test-partial','orderedAt',now()-interval '1 hour','currency','CAD','foodSubtotalCents',2000,'refundCents',500,'status','partial_refund','attribution','unattributed'),
    jsonb_build_object('externalOrderId','test-cancelled','orderedAt',now()-interval '1 hour','currency','CAD','foodSubtotalCents',3000,'refundCents',0,'status','cancelled','attribution','provider_report'),
    jsonb_build_object('externalOrderId','test-refunded','orderedAt',now()-interval '1 hour','currency','CAD','foodSubtotalCents',4000,'refundCents',4000,'status','refunded','attribution','promo_code'))
$$;
create function pg_temp.import_webshop(report uuid,orders jsonb) returns jsonb language sql as $$
  select public.import_admin_webshop_orders('c2310000-0000-4000-8000-000000000001',report,now()-interval '1 day',now()+interval '1 minute','Synthetic provider report - no customer data',orders)
$$;
select ok(private.valid_webshop_url('https://www.order.store/ca/store/jimoco-cafe-%26-pasta-austin/ZFgz2GjZSAuhlUYeO1fupA'),'observed URL allowed');
select ok(not private.valid_webshop_url(url),'malicious or unobserved destination refused') from (values
 ('http://www.order.store/ca/store/test/ZFgz2GjZSAuhlUYeO1fupA'),
 ('https://www.order.store.evil.test/ca/store/test/ZFgz2GjZSAuhlUYeO1fupA'),
 ('https://user:password@www.order.store/ca/store/test/ZFgz2GjZSAuhlUYeO1fupA'),
 ('https://www.order.store/ca/store/test/ZFgz2GjZSAuhlUYeO1fupA?destination=https://evil.test'),
 ('https://www.order.store/ca/store/test%2fbranch/ZFgz2GjZSAuhlUYeO1fupA'),
 ('https://www.ubereats.com/ca/store/test/ZFgz2GjZSAuhlUYeO1fupA'))bad(url);
select ok(private.valid_webshop_checkout(null),'unknown checkout remains null');
select ok(not private.valid_webshop_checkout('{}'),'incomplete quote refused');
select ok(not private.valid_webshop_checkout('{"verifiedAt":"2026-10-23T00:00:00Z","fulfillment":"delivery","basketLabel":"Three menus","sameConditionsConfirmed":null,"uber":{},"webshop":{}}'),'null confirmation refused');
select set_config('test.webshop.quote',jsonb_build_object('verifiedAt',now(),'fulfillment','delivery','basketLabel','Three menus','sameConditionsConfirmed',true,
  'uber','{"itemsCents":7100,"deliveryCents":200,"serviceCents":100,"discountCents":0,"taxCents":300,"tipCents":0,"totalCents":7700}'::jsonb,
  'webshop','{"itemsCents":5800,"deliveryCents":200,"serviceCents":100,"discountCents":0,"taxCents":300,"tipCents":0,"totalCents":6400}'::jsonb)::text,true);
select ok(private.valid_webshop_checkout(current_setting('test.webshop.quote')::jsonb),'explicit observed zero components and matching totals accepted');
select ok(not private.valid_webshop_checkout(current_setting('test.webshop.quote')::jsonb #- '{uber,deliveryCents}'),'missing fee is not treated as zero');
select ok(not private.valid_webshop_checkout(jsonb_set(current_setting('test.webshop.quote')::jsonb,'{uber,totalCents}','1')),'inconsistent checkout total refused');
select ok(not private.valid_webshop_checkout(jsonb_set(current_setting('test.webshop.quote')::jsonb,'{webshop,taxCents}','1.5')),'fractional cents refused');
select ok(not private.valid_webshop_checkout(jsonb_set(current_setting('test.webshop.quote')::jsonb,'{webshop,address}','"private address"')),'unexpected checkout customer data refused');
select ok(not has_function_privilege('anon','public.resolve_webshop_redirect(uuid,uuid,text,text,text)','EXECUTE'),'anonymous cannot directly log outbound clicks');
select ok(not has_function_privilege('authenticated','public.resolve_webshop_redirect(uuid,uuid,text,text,text)','EXECUTE'),'member cannot directly log outbound clicks');
select ok(has_function_privilege('service_role','public.resolve_webshop_redirect(uuid,uuid,text,text,text)','EXECUTE'),'redirect service can resolve');
select ok(not has_table_privilege('authenticated','private.webshop_orders','SELECT'),'order ledger is not directly readable');

select set_config('request.jwt.claims','{"sub":"c2300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"c2300000-0000-4000-8000-000000000010","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_webshops()$$,'P0001','ADMIN_REQUIRED','AAL1 cannot read performance');
select throws_ok($$select public.save_admin_webshop('c2310000-0000-4000-8000-000000000001','{}')$$,'P0001','ADMIN_REQUIRED','AAL1 cannot save registry');
select throws_ok($$select pg_temp.import_webshop(gen_random_uuid(),'[]')$$,'P0001','ADMIN_REQUIRED','AAL1 cannot import financial report');
reset role;
select set_config('request.jwt.claims','{"sub":"c2300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c2300000-0000-4000-8000-000000000010","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*) from jsonb_array_elements(public.get_admin_webshops()->'stores') value where value->>'merchantId' in ('c2310000-0000-4000-8000-000000000001','c2310000-0000-4000-8000-000000000002')),2::bigint,'all fixture businesses available before configuration');
select is(public.get_admin_webshops()->'totals'->'verifiedOrders','null'::jsonb,'missing provider report remains unavailable');
select is(public.get_admin_webshops()->'totals'->>'orderDataAvailable','false','report availability is explicit');
select throws_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"cityId":"webshop-other"}')$$,'P0001','WEBSHOP_BRANCH_MISMATCH','another city cannot be linked');
select throws_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"placeKeys":["osm:node:1","osm:node:1"]}')$$,'P0001','INVALID_WEBSHOP_PLACE','duplicate place keys refused');
select throws_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"comparisons":[{"id":"x","name":"Menu","uberCents":1.5,"webCents":1}]}')$$,'P0001','INVALID_WEBSHOP_COMPARISON','integer menu cents enforced');
select lives_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001',jsonb_build_object('enabled',true,'url','https://www.order.store/ca/store/test-branch/ZFgz2GjZSAuhlUYeO1fupA','placeKeys',jsonb_build_array('osm:node:123456789'),
  'comparisons',jsonb_build_array(jsonb_build_object('id','rose','name','Rose Forno','uberCents',2400,'webCents',1900)),'verifiedAt',now()))$$,'enabled registry and exact branch link saved');
select lives_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000002','{"placeKeys":["partner:test-existing-branch"]}')$$,'business without a webshop keeps a place link');
select throws_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000002','{"placeKeys":["osm:node:123456789"]}')$$,'P0001','WEBSHOP_PLACE_ALREADY_LINKED','one physical place cannot map to two businesses');
select throws_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"updatedAt":"2020-01-01T00:00:00Z"}')$$,'P0001','WEBSHOP_CHANGED','stale administrator cannot overwrite configuration');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.get_city_business_links('webshop-test')),2,'public place links include no-webshop business');
select is(jsonb_array_length(public.get_city_webshops('webshop-test')),1,'city descriptor batch excludes no-webshop businesses');
select is(public.get_city_webshops('webshop-other'),'[]'::jsonb,'city descriptor batch never crosses city boundaries');
select ok(public.get_city_webshops('webshop-test')::text !~ 'commission|report|owner|contact','city descriptor batch contains public data only');
select ok(public.get_public_webshop('c2310000-0000-4000-8000-000000000001') is not null,'visible registered webshop is public');
select is(public.get_public_webshop('c2310000-0000-4000-8000-000000000002'),null::jsonb,'no-webshop business has no order claim');
select ok(public.get_public_webshop('c2310000-0000-4000-8000-000000000001')::text !~ 'commission|report|owner|contact','public descriptor exposes no private configuration');
select throws_ok($$select public.record_webshop_event('c2310000-0000-4000-8000-000000000001',gen_random_uuid(),'random-webshop-session-123','web','comparison_sheet','outbound_click')$$,'P0001','INVALID_WEBSHOP_EVENT','view endpoint cannot manufacture a click');
select lives_ok($$select public.record_webshop_event('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000001','random-webshop-session-123','web','business_profile','sheet_view')$$,'sheet view logs separately');
select lives_ok($$select public.record_webshop_event('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000001','random-webshop-session-123','web','business_profile','sheet_view')$$,'sheet retry is idempotent');
select throws_ok($$select public.record_webshop_event('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000001','different-webshop-session-123','web','business_profile','sheet_view')$$,'P0001','WEBSHOP_EVENT_CONFLICT','conflicting event reuse fails');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select matches(public.resolve_webshop_redirect('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000002','random-webshop-session-123','web','comparison_sheet')->>'url','^https://www.order.store/ca/store/.*[?]utm_source=gling&','server appends tracking to registry destination');
select lives_ok($$select public.resolve_webshop_redirect('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000002','random-webshop-session-123','web','comparison_sheet')$$,'click retry idempotent');
reset role;
select set_config('request.jwt.claims','{"sub":"c2300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.record_webshop_event('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000003','owner-webshop-session-123','ios','business_profile','sheet_view')$$,'owner view identifiable as internal');
select throws_ok($$select public.get_admin_webshops()$$,'P0001','ADMIN_REQUIRED','business owner cannot read admin financial ledger');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.resolve_webshop_redirect('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000004','owner-webshop-session-123','ios','comparison_sheet')$$,'internal owner session inherited by browser redirect');
select lives_ok($$select public.resolve_webshop_redirect('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000005','late-owner-session-12345','ios','comparison_sheet')$$,'browser can arrive before owner view RPC');
reset role;
select set_config('request.jwt.claims','{"sub":"c2300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.record_webshop_event('c2310000-0000-4000-8000-000000000001','c2320000-0000-4000-8000-000000000006','late-owner-session-12345','ios','business_profile','sheet_view')$$,'late authenticated view identifies earlier internal click');
reset role;
select is((select count(*) from private.webshop_events where internal),4::bigint,'early and late owner sessions excluded from external metrics');
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.resolve_webshop_redirect('c2310000-0000-4000-8000-000000000001',gen_random_uuid(),'random-webshop-session-123','web','comparison_sheet')$$,'P0001','SERVICE_REQUIRED','resolver checks service identity even for privileged database invocation');
select set_config('request.jwt.claims','{"sub":"c2300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c2300000-0000-4000-8000-000000000010","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_webshops()->'totals'->>'sheetViews','1','deduplicated external view count');
select is(public.get_admin_webshops()->'totals'->>'clicks','1','deduplicated external click count');
select is(public.get_admin_webshops()->'totals'->>'sessions','1','outbound session measured separately');
select is(public.get_admin_webshops()->'totals'->'verifiedOrders','null'::jsonb,'click never becomes a purchase');
select is(pg_temp.import_webshop('c2330000-0000-4000-8000-000000000001',pg_temp.webshop_orders())->>'imported','4','verified provider report imports financial rows');
select is(pg_temp.import_webshop('c2330000-0000-4000-8000-000000000001',pg_temp.webshop_orders())->>'duplicates','4','identical report retry deduplicates');
select is(pg_temp.import_webshop('c2330000-0000-4000-8000-000000000002',pg_temp.webshop_orders())->>'imported','0','new report cannot double-count same external orders');
select throws_ok($$select pg_temp.import_webshop('c2330000-0000-4000-8000-000000000001','[]')$$,'P0001','WEBSHOP_REPORT_CONFLICT','conflicting report retry rejected');
select throws_ok($$select pg_temp.import_webshop(gen_random_uuid(),jsonb_set(pg_temp.webshop_orders(),'{0,foodSubtotalCents}','999'))$$,'P0001','WEBSHOP_ORDER_CONFLICT','conflicting external order reimport rejected');
select throws_ok($$select pg_temp.import_webshop(gen_random_uuid(),pg_temp.webshop_orders()||pg_temp.webshop_orders())$$,'P0001','WEBSHOP_ORDER_DUPLICATE','duplicate external IDs in one file rejected');
select throws_ok($$select pg_temp.import_webshop(gen_random_uuid(),jsonb_set(pg_temp.webshop_orders(),'{0,currency}','"USD"'))$$,'P0001','INVALID_WEBSHOP_ORDER','unsupported or mixed currency rejected');
select throws_ok($$select pg_temp.import_webshop(gen_random_uuid(),jsonb_set(pg_temp.webshop_orders(),'{1,refundCents}','2001'))$$,'P0001','INVALID_WEBSHOP_ORDER','refund cannot exceed food subtotal');
select throws_ok($$select pg_temp.import_webshop(gen_random_uuid(),jsonb_set(pg_temp.webshop_orders(),'{0,email}','"customer@example.test"'))$$,'P0001','INVALID_WEBSHOP_ORDER','customer data fields cannot enter report ledger');
select is(public.get_admin_webshops()->'totals'->>'verifiedOrders','3','cancelled orders excluded from conversion count');
select is(public.get_admin_webshops()->'totals'->>'netRevenueCents','2500','refunds reduce food-only revenue and cancellation contributes zero');
select is(public.get_admin_webshops()->'totals'->>'attributedVerifiedOrders','2','unattributed revenue not silently counted as attributed conversion');
select is(public.get_admin_webshops()->'totals'->>'attributedNetRevenueCents','1000','attributed revenue remains distinguishable');
select is(public.get_admin_webshops()->'totals'->'estimatedCommissionCents','null'::jsonb,'unconfirmed commission basis is unknown');
select lives_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"commissionBasisConfirmed":true}')$$,'basis confirmation independent of scope');
select is(public.get_admin_webshops()->'totals'->'estimatedCommissionCents','null'::jsonb,'missing commission scope stays unknown');
select lives_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"commissionScope":"attributed"}')$$,'attributed scope explicitly saved');
select is(public.get_admin_webshops()->'totals'->>'estimatedCommissionCents','250','25 percent attributed net food subtotal estimated');
select lives_ok($$select pg_temp.save_webshop('c2310000-0000-4000-8000-000000000001','{"commissionScope":"all_webshop"}')$$,'all-webshop scope explicitly saved');
select is(public.get_admin_webshops()->'totals'->>'estimatedCommissionCents','625','all-webshop scope includes unattributed net subtotal');
select lives_ok($$select public.import_admin_webshop_orders('c2310000-0000-4000-8000-000000000002',gen_random_uuid(),now()-interval '1 day',now(),'Synthetic verified empty report','[]')$$,'verified empty report supported');
select is(public.get_admin_webshops(30,'c2310000-0000-4000-8000-000000000002')->'totals'->>'verifiedOrders','0','verified empty period is measured zero');
reset role;
select ok((select count(*)>0 from private.webshop_audit),'configuration and report mutations audited');
select ok((select count(*)>0 from public.admin_access_logs where actor_id='c2300000-0000-4000-8000-000000000001' and scope='analytics'),'admin reads and writes preserve shared audit boundary');
update private.merchants set consent='revoked' where id='c2310000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_public_webshop('c2310000-0000-4000-8000-000000000001'),null::jsonb,'revoked consent hides webshop immediately');
select is(jsonb_array_length(public.get_city_business_links('webshop-test')),1,'revoked business place links stay private');
select is(public.get_city_webshops('webshop-test'),'[]'::jsonb,'city descriptor batch enforces revoked consent');
reset role;
select * from finish();
rollback;
