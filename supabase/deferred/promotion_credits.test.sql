begin;
select no_plan();
select has_function('public','get_promotion_wallet',array[]::text[],'wallet is read through an authenticated RPC');
insert into auth.users(id,email) values
 ('81111111-1111-4111-8111-111111111111','promotion-owner@example.com'),
 ('82222222-2222-4222-8222-222222222222','promotion-viewer@example.com');
insert into public.profiles(id,nickname,city_id) values
 ('81111111-1111-4111-8111-111111111111','홍보검증작성자','vancouver'),
 ('82222222-2222-4222-8222-222222222222','홍보검증독자','vancouver');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on) values
 ('83333333-3333-4333-8333-333333333333','81111111-1111-4111-8111-111111111111','vancouver',1,'이사 전 책상 판매','사용하던 책상을 판매합니다.',current_date-1);
create function pg_temp.purchase(eid text, typ text, txn text, env text default 'PRODUCTION') returns jsonb language sql as $$
 select jsonb_build_object('event_id',eid,'event_type',typ,'transaction_id',txn,'environment',env,
 'user_id','81111111-1111-4111-8111-111111111111','store','APP_STORE','product_id','com.dlwpdl.gling.credits.900',
 'credits',900,'occurred_at',now()+case typ when 'CANCELLATION' then interval '1 second' when 'REFUND_REVERSED' then interval '2 seconds' else interval '0 seconds' end);
$$;
create temporary table promo_state(campaign uuid,token uuid);
insert into promo_state default values;
grant all on promo_state to authenticated;

select set_config('request.jwt.claims','{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_promotion_wallet()->>'balance')::integer,0,'empty wallet has zero verified credit');
select is(public.get_promotion_wallet()->>'slotStatus','ready','wallet preflight reads actual active acceptance slots');
select throws_ok($$select public.record_promotion_purchase('{}')$$,'42501',null,'client cannot grant credit');
reset role;
select public.record_promotion_purchase(pg_temp.purchase('event-a','NON_RENEWING_PURCHASE','purchase-a'));
select public.record_promotion_purchase(pg_temp.purchase('event-a','NON_RENEWING_PURCHASE','purchase-a'));
select public.record_promotion_purchase(pg_temp.purchase('event-a-retry','NON_RENEWING_PURCHASE','purchase-a'));
select public.record_promotion_purchase(pg_temp.purchase('event-test','NON_RENEWING_PURCHASE','test-purchase','SANDBOX'));
select throws_ok($$select public.record_promotion_purchase(pg_temp.purchase('steal','NON_RENEWING_PURCHASE','purchase-a') || '{"user_id":"82222222-2222-4222-8222-222222222222"}')$$,'P0001','PURCHASE_IDENTITY_MISMATCH','same store purchase cannot credit a second account');
set local role authenticated;
select is((public.get_promotion_wallet()->>'balance')::integer,900,'same purchase grants once, sandbox excluded');
select is((public.get_promotion_wallet()->>'testBalance')::integer,900,'test balance is separate');
select throws_ok($$select public.start_promotion('83333333-3333-4333-8333-333333333333',900,'request-1',false)$$,'P0001','PROMOTIONS_NOT_READY','unlaunched service does not reserve credit');
reset role;
update private.promotion_config set enabled=true;
set local role authenticated;
update promo_state set campaign=public.start_promotion('83333333-3333-4333-8333-333333333333',900,'request-1',true);
select is(public.start_promotion('83333333-3333-4333-8333-333333333333',900,'request-1',true),(select campaign from promo_state),'lost-response retry returns the same campaign');
select throws_ok($$select public.start_promotion('83333333-3333-4333-8333-333333333333',1700,'request-1',true)$$,'P0001','REQUEST_ID_REUSED','retry identity cannot authorize a different budget');
select is((public.get_promotion_wallet()->>'balance')::integer,0,'campaign reserves credit once');
select throws_ok($$select public.start_promotion('83333333-3333-4333-8333-333333333333',900,'request-2',true)$$,'P0001',null,'no double spend when all credits are reserved');
select is(public.serve_promotion('vancouver',null),null::jsonb,'author never receives a paid self impression');
select public.pause_promotion((select campaign from promo_state));
select public.pause_promotion((select campaign from promo_state));
select is((public.get_promotion_wallet()->>'balance')::integer,900,'pause releases unused credit exactly once');
update promo_state set campaign=public.start_promotion('83333333-3333-4333-8333-333333333333',900,'request-3',true);
reset role;

select set_config('request.jwt.claims','{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_promotion_wallet()->>'balance')::integer,0,'another account cannot see the owner balance');
select throws_ok($$select public.pause_promotion((select campaign from promo_state))$$,'P0001','PROMOTION_NOT_FOUND','another account cannot pause a promotion');
select throws_ok($$select public.start_promotion('83333333-3333-4333-8333-333333333333',900,'request-other',true)$$,'P0001','POST_NOT_FOUND','another account cannot promote the post');
update promo_state set token=(public.serve_promotion('vancouver',null)->>'token')::uuid;
select isnt((select token from promo_state),null::uuid,'eligible viewer receives a server-issued placement');
select is(public.record_promotion_impression((select token from promo_state)),false,'preloaded placement does not immediately count');
reset role;
update private.promotion_placements set issued_at=clock_timestamp()-interval '2 seconds' where token=(select token from promo_state);
set local role authenticated;
select is(public.record_promotion_impression((select token from promo_state)),true,'valid visible placement records one promotion impression');
select is(public.record_promotion_impression((select token from promo_state)),false,'same impression report cannot spend twice');
select is(public.serve_promotion('vancouver',null),null::jsonb,'same viewer cannot be charged again for the campaign within 24 hours');
reset role;
select is((select view_count from public.posts where id='83333333-3333-4333-8333-333333333333'),0,'promotion count does not rewrite natural unique views');

select public.record_promotion_purchase(pg_temp.purchase('refund-a','CANCELLATION','purchase-a'));
select public.record_promotion_purchase(pg_temp.purchase('late-a','NON_RENEWING_PURCHASE','purchase-a'));
select set_config('request.jwt.claims','{"sub":"81111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_promotion_wallet()->>'balance')::integer,0,'refund revokes unused credits; late purchase does not regrant');
select is(public.get_promotion_wallet()->'campaigns'->0->>'status','refunded','refund stops an affected active campaign');
reset role;
select public.record_promotion_purchase(pg_temp.purchase('refund-b-first','CANCELLATION','purchase-b'));
select public.record_promotion_purchase(pg_temp.purchase('late-b','NON_RENEWING_PURCHASE','purchase-b'));
set local role authenticated;
select is((public.get_promotion_wallet()->>'balance')::integer,0,'refund delivered before purchase remains revoked');
reset role;
select public.record_promotion_purchase(pg_temp.purchase('reversed-b','REFUND_REVERSED','purchase-b'));
set local role authenticated;
select is((public.get_promotion_wallet()->>'balance')::integer,900,'explicit refund reversal restores the unspent lot');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select public.get_promotion_wallet()$$,'42501',null,'anonymous clients cannot read wallet');
select throws_ok($$select public.record_promotion_impression('84444444-4444-4444-8444-444444444444')$$,'42501',null,'anonymous traffic cannot consume paid exposure');
reset role;
select * from finish();
rollback;
