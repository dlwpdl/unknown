begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('merchant-profile-test','업체프로필검사','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
('12600000-0000-0000-0000-000000000001','merchant-profile-admin@example.com','{"role":"admin"}'),
('12600000-0000-0000-0000-000000000002','merchant-profile-member@example.com','{}');
insert into auth.sessions(id,user_id,aal) values('12660000-0000-0000-0000-000000000001','12600000-0000-0000-0000-000000000001','aal2');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('12600000-0000-0000-0000-000000000001','업체프로필관리검사','merchant-profile-test',now(),now(),now(),'test'),
('12600000-0000-0000-0000-000000000002','업체프로필회원검사','merchant-profile-test',now(),now(),now(),'test');
select set_config('request.jwt.claims','{"sub":"12600000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"12660000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.save_admin_merchant('12620000-0000-0000-0000-000000000001','프로필 카페','merchant-profile-test','','trial','pending','',null,' 카페 ',' 커피 · 브런치 ',' 123 Main St #2 '),'12620000-0000-0000-0000-000000000001'::uuid,'new profile saves with existing MFA RPC');
select is(public.get_admin_merchants('프로필 카페')->'merchants'->0->>'industry','카페','list includes trimmed industry');
select is(public.get_admin_merchant('12620000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date)->'merchant'->>'services','커피 · 브런치','detail includes services');
select lives_ok($$select public.save_admin_merchant('12620000-0000-0000-0000-000000000001','프로필 카페','merchant-profile-test','연락 변경','paid','pending','')$$,'legacy seven-argument call still works');
select is(public.get_admin_merchants('프로필 카페')->'merchants'->0->>'address','123 Main St #2','legacy update preserves address');
select is(public.get_admin_merchants('프로필 카페')->'merchants'->0->>'services','커피 · 브런치','legacy update preserves services');
select throws_ok($$select public.save_admin_merchant(null,'길이검사','merchant-profile-test','','lead','pending','',null,repeat('가',81))$$,'P0001','INVALID_MERCHANT','industry limit enforced by server');
select throws_ok($$select public.save_admin_merchant(null,'길이검사','merchant-profile-test','','lead','pending','',null,null,repeat('가',1501))$$,'P0001','INVALID_MERCHANT','services limit enforced by server');
select throws_ok($$select public.save_admin_merchant(null,'길이검사','merchant-profile-test','','lead','pending','',null,null,null,repeat('가',301))$$,'P0001','INVALID_MERCHANT','address limit enforced by server');
select lives_ok($$select public.save_admin_merchant('12620000-0000-0000-0000-000000000001','프로필 카페','merchant-profile-test','','lead','pending','',p_address=>'')$$,'explicit empty value clears only address');
select is(public.get_admin_merchants('프로필 카페')->'merchants'->0->>'address','','address cleared');
select is(public.get_admin_merchants('프로필 카페')->'merchants'->0->>'industry','카페','omitted industry retained');
reset role;
select set_config('request.jwt.claims','{"sub":"12600000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_admin_merchant(null,'회원 등록','merchant-profile-test','','lead','pending','',p_address=>'123 Main St')$$,'P0001','ADMIN_REQUIRED','new detail parameters do not bypass admin MFA');
select throws_ok($$select address from private.merchants$$,'42501',null,'profile addresses stay private');
reset role;
select * from finish();
rollback;
