begin;
set local search_path=public,extensions;
select no_plan();
-- The disposable check DB is schema-only; the shared rows these checks need are idempotent here.
insert into public.cities values('vancouver','밴쿠버','BC','America/Vancouver',true) on conflict do nothing;
insert into private.behavior_targets(id) values('screen') on conflict do nothing;

-- 1. Anonymous behavior: each session has its own 200/minute under the shared 6,000/minute ceiling.
delete from private.behavior_events where user_id is null and created_at>now()-interval '1 minute';
insert into private.behavior_events(session_id,seq,user_id,platform,screen,kind,target,value)
  select 'seclow-flooding-session-000001',g,null,'web','feed','press','screen',1 from generate_series(1,200) g;
set local role anon;
select throws_ok($$select public.record_behavior_events('seclow-flooding-session-000001','web','[{"seq":201,"screen":"feed","kind":"view","target":"screen","value":1}]')$$,
  'P0001','RATE_LIMITED','one anonymous session stops at 200 events a minute');
select throws_ok($$select public.record_behavior_events('seclow-flooding-session-000001','web','[{"seq":201,"screen":"feed","kind":"view","target":"screen","value":1}]','direct')$$,
  'P0001','RATE_LIMITED','the source-tagged entry point has the same per-session limit');
select lives_ok($$select public.record_behavior_events('seclow-visitor-session-0000001','web','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1}]','threads')$$,
  'another visitor is still counted while one session is throttled');
reset role;
select is((select source from private.behavior_events where session_id='seclow-visitor-session-0000001' and seq=1),'threads','the real visitor event is stored with its source');
insert into private.behavior_events(session_id,seq,user_id,platform,screen,kind,target,value)
  select 'seclow-spread-session-'||lpad(g::text,8,'0'),1,null,'web','feed','view','screen',1
  from generate_series(1,6000-(select count(*)::int from private.behavior_events where user_id is null and created_at>now()-interval '1 minute')) g;
set local role anon;
select throws_ok($$select public.record_behavior_events('seclow-fresh-session-00000001','web','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1}]')$$,
  'P0001','RATE_LIMITED','the shared 6,000 a minute ceiling still holds across sessions');
reset role;

-- 2. Business co-managers above the plan's seats are suspended, newest first, and come back on upgrade.
insert into auth.users(id,email,raw_app_meta_data) values
 ('5ec10000-0000-4000-8000-000000000001','seclow-owner@example.test','{"merchant_enabled":true}'),
 ('5ec10000-0000-4000-8000-000000000002','seclow-first@example.test','{"merchant_enabled":true}'),
 ('5ec10000-0000-4000-8000-000000000003','seclow-second@example.test','{"merchant_enabled":true}'),
 ('5ec10000-0000-4000-8000-000000000004','seclow-third@example.test','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'좌석검사'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '5ec10000-%';
insert into private.merchants(id,name,city_id,contact,status,workspace_until,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('5ec20000-0000-4000-8000-000000000001','Seat business','vancouver','c','lead',null,'granted','Synthetic rollback-only test','5ec10000-0000-4000-8000-000000000001',now(),'business');
insert into private.merchant_operators(merchant_id,user_id,created_at) values
 ('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000002',now()-interval '3 hours'),
 ('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000003',now()-interval '2 hours'),
 ('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000004',now()-interval '1 hour');
-- They joined through the owner's invite links, so they hold plan seats.
insert into private.merchant_operator_links(merchant_id,token_hash,created_by,used_at,used_by)
 select '5ec20000-0000-4000-8000-000000000001',md5(u::text)||md5('seat'||u::text),'5ec10000-0000-4000-8000-000000000001',now(),u
 from unnest(array['5ec10000-0000-4000-8000-000000000002','5ec10000-0000-4000-8000-000000000003','5ec10000-0000-4000-8000-000000000004']::uuid[]) u;
insert into private.business_membership_bindings(user_id,merchant_id) values('5ec10000-0000-4000-8000-000000000001','5ec20000-0000-4000-8000-000000000001');
insert into private.admin_membership_grants(kind,merchant_id,tier,expires_at,created_by)
 values('business','5ec20000-0000-4000-8000-000000000001','pro',now()+interval '30 days','5ec10000-0000-4000-8000-000000000001');

select is(private.business_operator_limit('5ec20000-0000-4000-8000-000000000001'),2,'pro has two co-manager seats');
select is(array(select private.merchant_operator_active('5ec20000-0000-4000-8000-000000000001',u) from unnest(array[
  '5ec10000-0000-4000-8000-000000000002','5ec10000-0000-4000-8000-000000000003','5ec10000-0000-4000-8000-000000000004']::uuid[]) u),
  array[true,true,false],'the most recently added co-manager is the one suspended');
select ok(private.business_chat_can_use('5ec10000-0000-4000-8000-000000000002','5ec20000-0000-4000-8000-000000000001')
  and not private.business_chat_can_use('5ec10000-0000-4000-8000-000000000004','5ec20000-0000-4000-8000-000000000001'),
  'a suspended co-manager cannot chat as the business');
select ok(private.business_chat_can_use('5ec10000-0000-4000-8000-000000000001','5ec20000-0000-4000-8000-000000000001'),'the owner still chats as the business');

select set_config('request.jwt.claims','{"sub":"5ec10000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchants()),0,'the suspended co-manager no longer lists the business');
select is(jsonb_array_length(public.get_my_business_workspace_access()->'merchants'),0,'nor sees it in the business workspace');
select throws_ok($$select public.get_merchant_workspace('5ec20000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','nor opens its content');
select throws_ok($$select public.business_paid_features('5ec20000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','nor reads its paid features');
reset role;

select set_config('request.jwt.claims','{"sub":"5ec10000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchants()),1,'a co-manager inside the seats keeps the business');
select lives_ok($$select public.get_merchant_workspace('5ec20000-0000-4000-8000-000000000001')$$,'and opens its content');
reset role;

-- Downgrade to plus: one seat, so the second co-manager is suspended as well.
insert into private.admin_membership_grants(kind,merchant_id,tier,expires_at,created_by)
 values('business','5ec20000-0000-4000-8000-000000000001','plus',now()+interval '30 days','5ec10000-0000-4000-8000-000000000001');
select is(array(select private.merchant_operator_active('5ec20000-0000-4000-8000-000000000001',u) from unnest(array[
  '5ec10000-0000-4000-8000-000000000002','5ec10000-0000-4000-8000-000000000003','5ec10000-0000-4000-8000-000000000004']::uuid[]) u),
  array[true,false,false],'plus keeps only the first co-manager');
select set_config('request.jwt.claims','{"sub":"5ec10000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.get_merchant_workspace('5ec20000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','the downgrade takes access away from the second co-manager');
reset role;

select set_config('request.jwt.claims','{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select lives_ok($$select public.get_merchant_workspace('5ec20000-0000-4000-8000-000000000001')$$,'the owner never loses access');
select is((select jsonb_object_agg(o->>'user_id',o->'suspended') from jsonb_array_elements(public.get_merchant_account_connections('5ec20000-0000-4000-8000-000000000001')->'operators') o),
  '{"5ec10000-0000-4000-8000-000000000002":false,"5ec10000-0000-4000-8000-000000000003":true,"5ec10000-0000-4000-8000-000000000004":true}'::jsonb,
  'the owner still sees every co-manager, with who is paused');
reset role;

-- Upgrade to premium: everyone is back without being invited again.
insert into private.admin_membership_grants(kind,merchant_id,tier,expires_at,created_by)
 values('business','5ec20000-0000-4000-8000-000000000001','premium',now()+interval '30 days','5ec10000-0000-4000-8000-000000000001');
select is(array(select private.merchant_operator_active('5ec20000-0000-4000-8000-000000000001',u) from unnest(array[
  '5ec10000-0000-4000-8000-000000000002','5ec10000-0000-4000-8000-000000000003','5ec10000-0000-4000-8000-000000000004']::uuid[]) u),
  array[true,true,true],'an upgrade restores suspended co-managers');

-- Free: no seats at all, the owner keeps the business.
insert into private.admin_membership_grants(kind,merchant_id,tier,expires_at,created_by)
 values('business','5ec20000-0000-4000-8000-000000000001',null,null,'5ec10000-0000-4000-8000-000000000001');
select is(private.business_operator_limit('5ec20000-0000-4000-8000-000000000001'),0,'free has no seats');
select ok(not private.merchant_operator_active('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000002'),'free suspends every invited co-manager');
insert into auth.users(id,email,raw_app_meta_data) values('5ec10000-0000-4000-8000-000000000005','seclow-admin-linked@example.test','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 values('5ec10000-0000-4000-8000-000000000005','좌석검사0005','vancouver',now(),now(),now(),'test');
insert into private.merchant_operators(merchant_id,user_id,created_by) values('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000005',null);
select ok(private.merchant_operator_active('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000005'),'a co-manager an admin connected holds no plan seat and keeps access');
select ok(not private.merchant_operator_active('5ec20000-0000-4000-8000-000000000001','5ec10000-0000-4000-8000-000000000001'),'only real co-manager rows count, not the owner');
select set_config('request.jwt.claims','{"sub":"5ec10000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchants()),1,'the free owner still lists the business');
reset role;

select ok(not has_function_privilege('anon','private.merchant_operator_active(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.merchant_operator_active(uuid,uuid)','EXECUTE'),'the seat check is internal only');

-- 3. The draft admin business membership grant system is gone; the 2026-10-30 one remains.
select ok(to_regclass('private.merchant_membership_grants') is null
  and to_regprocedure('public.set_admin_merchant_membership(uuid,text,date)') is null
  and to_regprocedure('public.get_admin_merchant_membership(uuid)') is null
  and to_regprocedure('public.clear_admin_merchant_membership(uuid)') is null,'the 2026-10-27 draft objects are dropped');
select ok(to_regclass('private.admin_membership_grants') is not null
  and to_regprocedure('public.set_admin_membership(uuid,uuid,text,date,text)') is not null,'the live 2026-10-30 grant system stays');
select ok(not exists(select 1 from pg_proc where prosrc ~ 'merchant_membership_grants'),'nothing still reads the draft table');

select * from finish();
rollback;
