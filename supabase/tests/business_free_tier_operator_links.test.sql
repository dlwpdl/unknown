begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
 ('d3700000-0000-4000-8000-000000000001','tier-free-owner@example.test','{"merchant_enabled":true}'),
 ('d3700000-0000-4000-8000-000000000002','tier-paid-owner@example.test','{"merchant_enabled":true}'),
 ('d3700000-0000-4000-8000-000000000003','tier-invitee@example.test','{}'),
 ('d3700000-0000-4000-8000-000000000004','tier-second-invitee@example.test','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'등급검사'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like 'd3700000-%';
insert into private.merchants(id,name,city_id,contact,status,workspace_until,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('d3710000-0000-4000-8000-000000000001','Free business','vancouver','c','lead',null,'granted','Synthetic rollback-only test','d3700000-0000-4000-8000-000000000001',now(),'business'),
 ('d3710000-0000-4000-8000-000000000002','Paid business','vancouver','c','paid',current_date+30,'granted','Synthetic rollback-only test','d3700000-0000-4000-8000-000000000002',now(),'business');

select is((private.business_membership_details('d3710000-0000-4000-8000-000000000001')->>'postLimit')::int,1,'free businesses get one new post a month');
select is((private.business_membership_details('d3710000-0000-4000-8000-000000000001')->>'bumpLimit')::int,2,'free businesses get two bumps a month');
select is((private.business_membership_details('d3710000-0000-4000-8000-000000000001')->>'bumpCooldownHours')::int,120,'free bumps are five days apart');
select is(private.business_operator_limit('d3710000-0000-4000-8000-000000000001'),0,'free businesses have no co-manager seats');
select is(private.business_operator_limit('d3710000-0000-4000-8000-000000000002'),1,'an active legacy paid workspace keeps one seat');

select set_config('request.jwt.claims','{"sub":"d3700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(public.business_paid_features('d3710000-0000-4000-8000-000000000001'),false,'free businesses report no paid features');
select throws_ok($$select public.create_merchant_operator_link('d3710000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_OPERATOR_PLAN_REQUIRED','free owners cannot invite co-managers');
select throws_ok($$select public.create_merchant_operator_link('d3710000-0000-4000-8000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','only the owner can make links');
reset role;

select set_config('request.jwt.claims','{"sub":"d3700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(public.business_paid_features('d3710000-0000-4000-8000-000000000002'),true,'paid businesses report paid features');
select ok(public.create_merchant_operator_link('d3710000-0000-4000-8000-000000000002')->>'token' ~ '^[A-Za-z0-9_-]{32}$','a paid owner gets a one-time token');
select throws_ok($$select public.create_merchant_operator_link('d3710000-0000-4000-8000-000000000002')$$,'P0001','MERCHANT_OPERATOR_LIMIT','an open link holds the only seat');
select is(jsonb_array_length(public.get_merchant_operator_links('d3710000-0000-4000-8000-000000000002')->'links'),1,'the owner sees the open link without its token');
select ok(not (public.get_merchant_operator_links('d3710000-0000-4000-8000-000000000002')->'links'->0 ? 'token'),'tokens are never listed again');
select lives_ok($$select public.revoke_merchant_operator_link((public.get_merchant_operator_links('d3710000-0000-4000-8000-000000000002')->'links'->0->>'id')::uuid)$$,'the owner can cancel an open link');
select set_config('test.token',public.create_merchant_operator_link('d3710000-0000-4000-8000-000000000002')->>'token',true);
reset role;
select ok(not exists(select 1 from private.merchant_operator_links where token_hash=current_setting('test.token')),'only the hash is stored');

select set_config('request.jwt.claims','{"sub":"d3700000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(public.preview_merchant_operator_link(current_setting('test.token'))->>'merchant_name','Paid business','the invitee sees the business before joining');
select throws_ok($$select public.preview_merchant_operator_link('not-a-real-token-not-a-real-tok!')$$,'P0001','MERCHANT_INVITATION_NOT_AVAILABLE','malformed tokens reveal nothing');
select is(public.accept_merchant_operator_link(current_setting('test.token')),'d3710000-0000-4000-8000-000000000002'::uuid,'the invitee joins as co-manager');
reset role;
select ok(exists(select 1 from private.merchant_operators where merchant_id='d3710000-0000-4000-8000-000000000002' and user_id='d3700000-0000-4000-8000-000000000003'),'the co-manager row exists');
select is((select raw_app_meta_data->>'merchant_enabled' from auth.users where id='d3700000-0000-4000-8000-000000000003'),'true','the co-manager can open the business workspace');

select set_config('request.jwt.claims','{"sub":"d3700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.accept_merchant_operator_link(current_setting('test.token'))$$,'P0001','MERCHANT_INVITATION_NOT_AVAILABLE','a used link cannot be reused');
reset role;

select set_config('request.jwt.claims','{"sub":"d3700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","client_id":"d3790000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$select public.create_merchant_operator_link('d3710000-0000-4000-8000-000000000002')$$,'P0001','AUTH_REQUIRED','AI connection tokens cannot invite people');
reset role;

select ok(has_function_privilege('authenticated','public.accept_merchant_operator_link(text)','EXECUTE') and not has_function_privilege('anon','public.accept_merchant_operator_link(text)','EXECUTE'),'only signed-in members can accept');
select * from finish();
rollback;
