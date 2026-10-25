begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_my_business_workspace_access',array[]::text[],'business access has a separately scoped reader');

insert into auth.users(id,email,raw_app_meta_data) values
 ('d2700000-0000-4000-8000-000000000001','scope-admin-owner@example.test','{"role":"admin","merchant_enabled":true}'),
 ('d2700000-0000-4000-8000-000000000002','scope-admin-operator@example.test','{"role":"admin","merchant_enabled":true}'),
 ('d2700000-0000-4000-8000-000000000003','scope-other-owner@example.test','{"merchant_enabled":true}'),
 ('d2700000-0000-4000-8000-000000000004','scope-unapproved-admin@example.test','{"role":"admin","merchant_enabled":false}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'범위검사'||right(id::text,4),'vancouver',now(),now(),now(),'test'
 from auth.users where id::text like 'd2700000-%';
insert into auth.sessions(id,user_id,aal) values
 ('d2790000-0000-4000-8000-000000000001','d2700000-0000-4000-8000-000000000001','aal2'),
 ('d2790000-0000-4000-8000-000000000004','d2700000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('d2710000-0000-4000-8000-000000000001','Scope owned business','vancouver','owner contact','lead','granted','Synthetic rollback-only test','d2700000-0000-4000-8000-000000000001',now(),'business'),
 ('d2710000-0000-4000-8000-000000000002','Scope operator business','vancouver','other owner contact','lead','granted','Synthetic rollback-only test','d2700000-0000-4000-8000-000000000003',now(),'business'),
 ('d2710000-0000-4000-8000-000000000003','Scope revoked business','vancouver','revoked owner contact','lead','granted','Synthetic rollback-only test','d2700000-0000-4000-8000-000000000004',now(),'business');
insert into private.merchant_operators(merchant_id,user_id) values
 ('d2710000-0000-4000-8000-000000000002','d2700000-0000-4000-8000-000000000002');

create function pg_temp.business_access() returns jsonb language plpgsql as $$
begin return public.get_my_business_workspace_access();
exception when undefined_function then return null; end;
$$;
create function pg_temp.merchant_capability() returns boolean language plpgsql as $$
begin return public.get_my_merchant_access();
exception when raise_exception then return null; end;
$$;

select set_config('request.jwt.claims','{"sub":"d2700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(pg_temp.merchant_capability(),true,'approved admin business owner has ordinary business access at AAL1');
select is(pg_temp.business_access()->'enabled','true'::jsonb,'business approval comes from the database');
select is(jsonb_array_length(pg_temp.business_access()->'merchants'),1,'admin business mode lists only actual assignments');
select is(pg_temp.business_access()->'merchants'->0->>'role','owner','admin-owned business retains the owner role');
select is(pg_temp.business_access()->'merchants'->0->>'id','d2710000-0000-4000-8000-000000000001','business mode selects the real owned business');
select lives_ok($$select public.get_merchant_workspace('d2710000-0000-4000-8000-000000000001')$$,'AAL1 admin owner can open its business workspace');
select throws_ok($$select public.get_merchant_workspace('d2710000-0000-4000-8000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','AAL1 business use never acquires global admin workspace access');
select throws_ok($$select public.get_admin_merchant_access('d2700000-0000-4000-8000-000000000003')$$,'P0001','ADMIN_REQUIRED','the admin surface still requires real MFA');
reset role;

select set_config('request.jwt.claims','{"sub":"d2700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.business_access()->'merchants'),1,'admin operator sees its actual business assignment');
select is(pg_temp.business_access()->'merchants'->0->>'role','operator','operator access is not promoted to owner');
select is(pg_temp.business_access()->'merchants'->0->>'contact','','operator cannot read the owner contact');
select lives_ok($$select public.get_merchant_workspace('d2710000-0000-4000-8000-000000000002')$$,'AAL1 admin operator can open assigned content');
select throws_ok($$select public.get_merchant_workspace('d2710000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','operator cannot open an unrelated business');
reset role;

select set_config('request.jwt.claims','{"sub":"d2700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"d2790000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(jsonb_array_length(pg_temp.business_access()->'merchants'),1,'business mode remains assignment-only after admin MFA');
select is(pg_temp.business_access()->'merchants'->0->>'role','owner','admin MFA does not replace the business role');
select lives_ok($$select public.get_admin_merchant_access('d2700000-0000-4000-8000-000000000003')$$,'verified MFA still unlocks the separate admin surface');
reset role;

select set_config('request.jwt.claims','{"sub":"d2700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"d2790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin","merchant_enabled":true}}',true);
set local role authenticated;
select is(pg_temp.business_access()->'enabled','false'::jsonb,'admin MFA and a stale JWT cannot grant business approval');
select is(pg_temp.business_access()->'merchants','[]'::jsonb,'revoked business approval returns no business data');
reset role;
update public.profiles set account_status='suspended' where id='d2700000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"d2700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_my_business_workspace_access()$$,'P0001','ACCOUNT_LOCKED','inactive accounts remain blocked in business mode');
reset role;
select ok(case when to_regprocedure('public.get_my_business_workspace_access()') is null then false else has_function_privilege('authenticated','public.get_my_business_workspace_access()','EXECUTE') and not has_function_privilege('anon','public.get_my_business_workspace_access()','EXECUTE') end,'business access reader is authenticated-only');
select * from finish();
rollback;
