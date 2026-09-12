begin;
select plan(20);
select has_function('public','get_admin_analytics',array['integer','text','text','boolean','integer'],'admin analytics RPC exists');
insert into public.cities values ('analytics-test','분석검사','BC','UTC',true);
insert into auth.users(id,email,raw_app_meta_data) values
('77777777-1111-1111-1111-111111111111','analytics-user@example.com','{}'),
('77777777-2222-2222-2222-222222222222','analytics-seed@seed.gling.invalid','{}'),
('77777777-3333-3333-3333-333333333333','analytics-admin@example.com','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id) values
('77777777-1111-1111-1111-111111111111','분석일반회원','analytics-test'),
('77777777-2222-2222-2222-222222222222','분석목회원','analytics-test'),
('77777777-3333-3333-3333-333333333333','분석관리자','analytics-test');
select set_config('request.jwt.claims','{"sub":"77777777-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_analytics()$$,'P0001','ADMIN_REQUIRED','ordinary users cannot read analytics');
select throws_ok($$select * from private.analytics_visits$$,'42501',null,'raw access records are private');
select throws_ok($$select public.record_app_visit('ios','conversation/secret-id','1.0')$$,'P0001','INVALID_VISIT','raw paths cannot enter traffic logs');
select public.record_app_visit('ios','feed','1.0');
select public.record_app_visit('ios','feed','1.0');
reset role;
select is((select count(*) from private.analytics_visits where user_id='77777777-1111-1111-1111-111111111111'),1::bigint,'retries share the same access window');
select is((select sum(views)::bigint from private.analytics_visits where user_id='77777777-1111-1111-1111-111111111111'),1::bigint,'immediate repeated screen does not inflate views');
select public.apply_membership_snapshot('77777777-1111-1111-1111-111111111111',jsonb_build_array(jsonb_build_object('tier','premium','store','app_store','product_id','premium','will_renew',true,'expires_at',now()+interval '2 days')),now());
select set_config('request.jwt.claims','{"sub":"77777777-3333-3333-3333-333333333333","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((public.get_admin_analytics(7,'analytics-test')->'counts'->>'members')::integer,1,'marketing excludes seed and admin accounts');
select is((public.get_admin_analytics(7,'analytics-test','free')->'counts'->>'members')::integer,0,'membership filter uses actual current entitlement');
select is((public.get_admin_analytics(7,'analytics-test','premium')->'counts'->>'activeUsers')::integer,1,'activity is distinct accounts in period');
select is((public.get_admin_analytics(7,'analytics-test','all',true)->'counts'->>'members')::integer,3,'internal accounts can be included explicitly');
select throws_ok($$select public.get_admin_analytics(999)$$,'P0001','INVALID_ANALYTICS_FILTER','unbounded queries rejected');
select ok(exists(select 1 from public.admin_access_logs where scope='analytics' and actor_id=auth.uid()),'analytics reads are audited');
reset role;
select public.record_payment_event('{"id":"qa-purchase","type":"INITIAL_PURCHASE","app_user_id":"77777777-1111-1111-1111-111111111111","environment":"PRODUCTION","store":"APP_STORE","product_id":"com.dlwpdl.gling.premium.monthly","transaction_id":"qa-transaction","currency":"CAD","price_in_purchased_currency":14.99}'::jsonb || jsonb_build_object('event_timestamp_ms',extract(epoch from now())*1000));
select public.record_payment_event('{"id":"qa-purchase","type":"INITIAL_PURCHASE","app_user_id":"77777777-1111-1111-1111-111111111111","environment":"PRODUCTION","store":"APP_STORE","product_id":"com.dlwpdl.gling.premium.monthly","transaction_id":"qa-transaction","currency":"CAD","price_in_purchased_currency":14.99}'::jsonb || jsonb_build_object('event_timestamp_ms',extract(epoch from now())*1000));
select public.record_payment_event('{"id":"qa-sandbox","type":"INITIAL_PURCHASE","app_user_id":"77777777-1111-1111-1111-111111111111","environment":"SANDBOX","store":"APP_STORE","product_id":"com.dlwpdl.gling.premium.monthly","transaction_id":"qa-sandbox-transaction","currency":"CAD","price_in_purchased_currency":14.99}'::jsonb || jsonb_build_object('event_timestamp_ms',extract(epoch from now())*1000));
set local role authenticated;
select is((public.get_admin_analytics(7,'analytics-test')->'purchases'->0->>'amount')::numeric,14.99,'duplicate and sandbox events cannot inflate revenue');
select throws_ok($$select public.record_payment_event('{}')$$,'42501',null,'even admins cannot forge store purchases from a client');
reset role;
insert into public.cities values ('analytics-moved','이사지역','ON','UTC',true);
select set_config('request.jwt.claims','{"sub":"77777777-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$update public.profiles set city_id='analytics-moved',neighborhood=null where id=auth.uid()$$,'members can save their new preferred region');
with changed as (update public.profiles set city_id='analytics-moved' where id='77777777-2222-2222-2222-222222222222' returning id)
select is(count(*),0::bigint,'members cannot move another account') from changed;
select throws_ok($$update public.profiles set city_id='not-a-city' where id=auth.uid()$$,'23503',null,'unknown regions are rejected by the database');
reset role;
select set_config('request.jwt.claims','{"sub":"77777777-3333-3333-3333-333333333333","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((public.get_admin_analytics(7,'analytics-test')->'counts'->>'members')::integer,0,'previous region loses the moved member');
select is((public.get_admin_analytics(7,'analytics-moved')->'counts'->>'members')::integer,1,'new region gains the member without duplication');
select is(public.get_admin_analytics(7,'analytics-moved')->'members'->0->>'city','analytics-moved','admin member list uses the saved region');
select * from finish();
rollback;
