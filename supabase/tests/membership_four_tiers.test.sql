begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data)
select ('14900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'tier149-'||n||'@example.com','{"merchant_enabled":true}'::jsonb from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select ('14900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'등급검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,4)n;
select set_config('request.jwt.claims','{"sub":"14900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupLimit')::int,3,'Basic allows three concurrent meetups');
select is(public.get_membership()->'conversationLimit','null'::jsonb,'chat stays unlimited');
select throws_ok($$select public.apply_membership_snapshot('14900000-0000-0000-0000-000000000001','[]',now())$$,'42501',null,'client cannot grant tiers');
reset role;
select lives_ok($$select public.apply_membership_snapshot('14900000-0000-0000-0000-000000000001',jsonb_build_array(
 jsonb_build_object('kind','general','plan_version',2,'tier','pro','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.general.pro.monthly.v2','store','app_store','will_renew',true),
 jsonb_build_object('kind','business','plan_version',2,'tier','premium','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.premium.monthly.v2','store','app_store','will_renew',true)),now()-interval '10 seconds')$$,'separate family receipts coexist');
set local role authenticated;
select is(public.get_membership()->>'tier','pro','business Premium cannot upgrade general Pro');
select is((public.get_membership()->>'meetupLimit')::int,10,'Pro allows ten meetups');
select is((public.get_membership()->>'bumpCooldownHours')::int,30,'Pro bump is thirty hours');
reset role;
select throws_ok($$select public.apply_membership_snapshot('14900000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('kind','general','plan_version',2,'tier','premium','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.business.premium.monthly.v2','store','app_store','will_renew',true)),now())$$,'P0001','INVALID_MEMBERSHIP','misattached cross-family product is rejected at database boundary');
insert into private.merchants(id,name,city_id,owner_id,owner_verified_at,status,consent,consent_note) values
 ('14910000-0000-0000-0000-000000000001','등급검사 업체 하나','vancouver','14900000-0000-0000-0000-000000000001',now(),'lead','granted','검사동의'),
 ('14910000-0000-0000-0000-000000000002','등급검사 업체 둘','vancouver','14900000-0000-0000-0000-000000000002',now(),'lead','granted','검사동의'),
 ('14910000-0000-0000-0000-000000000003','등급검사 업체 셋','vancouver','14900000-0000-0000-0000-000000000001',now(),'lead','granted','검사동의');
set local role authenticated;
select lives_ok($$select public.bind_business_membership('14910000-0000-0000-0000-000000000001')$$,'verified owner binds own canonical business');
select is((public.get_business_membership('14910000-0000-0000-0000-000000000001')->>'postLimit')::int,30,'Premium has thirty new posts');
select is((public.get_business_membership('14910000-0000-0000-0000-000000000001')->>'bumpLimit')::int,24,'Premium has twenty-four bumps');
select is((public.get_business_membership('14910000-0000-0000-0000-000000000001')->>'bumpCooldownHours')::int,48,'business Premium returns its forty-eight-hour same-post wait');
select is((public.get_business_membership('14910000-0000-0000-0000-000000000001')->>'managedPostLimit')::int,4,'managed new posts are part of thirty');
select throws_ok($$select public.bind_business_membership('14910000-0000-0000-0000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','another business cannot be bound');
select throws_ok($$select public.bind_business_membership('14910000-0000-0000-0000-000000000003')$$,'P0001','BUSINESS_SUBSCRIPTION_BOUND','one active subscription cannot cover multiple companies');
reset role;
update private.merchants set owner_verified_at=null where id='14910000-0000-0000-0000-000000000001';
select is(private.business_membership_details('14910000-0000-0000-0000-000000000001')->>'tier','free','revoked verification removes business benefits');
update private.merchants set owner_verified_at=now() where id='14910000-0000-0000-0000-000000000001';
select public.apply_membership_snapshot('14900000-0000-0000-0000-000000000001','[]',now()-interval '20 seconds');
select is(private.membership_details('14900000-0000-0000-0000-000000000001')->>'tier','pro','older delivery cannot replace a newer purchase');
select public.apply_membership_snapshot('14900000-0000-0000-0000-000000000004',jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.plus.monthly','store','app_store','will_renew',true)),now()-interval '5 seconds');
select is(private.bump_cooldown('14900000-0000-0000-0000-000000000004'),interval '18 hours','legacy Plus keeps its faster per-post cooldown');
select public.apply_membership_snapshot('14900000-0000-0000-0000-000000000004',jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.premium.monthly','store','app_store','will_renew',true)),now());
select is(private.bump_cooldown('14900000-0000-0000-0000-000000000004'),interval '12 hours','legacy Premium keeps its faster per-post cooldown');
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='14900000-0000-0000-0000-000000000004';
insert into auth.sessions(id,user_id,aal) values('14906000-0000-0000-0000-000000000004','14900000-0000-0000-0000-000000000004','aal2');
select set_config('request.jwt.claims','{"sub":"14900000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2","session_id":"14906000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.get_admin_analytics(30,null,'pro',false,0)$$,'Pro is supported by the existing admin analytics entry point');
select lives_ok($$select public.get_admin_behavior(30,null,'pro',false)$$,'Pro is also supported by the companion behavior query');
reset role;
select set_config('request.jwt.claims','{"sub":"14900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_analytics(30,null,'pro',false,0)$$,'P0001','ADMIN_REQUIRED','new tier filter retains the ordinary-user security boundary');
reset role;
select * from finish();
rollback;
