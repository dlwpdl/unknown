begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('d5700000-0000-4000-8000-000000000001','mcp-admin@example.test','{"role":"admin","merchant_enabled":true}'),
 ('d5700000-0000-4000-8000-000000000002','mcp-plain-admin@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'관리연결'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like 'd5700000-%';
insert into private.admin_ids(user_id) values('d5700000-0000-4000-8000-000000000001');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('d5710000-0000-4000-8000-000000000001','Admin AI business','vancouver','c','lead','granted','Synthetic rollback-only test','d5700000-0000-4000-8000-000000000001',now(),'business');
insert into auth.oauth_clients(id,client_name,redirect_uris,grant_types,registration_type,client_type,token_endpoint_auth_method) values
 ('d5730000-0000-4000-8000-000000000001','Claude','https://claude.ai/api/mcp/auth_callback','authorization_code,refresh_token','dynamic','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values('d5750000-0000-4000-8000-000000000001','d5700000-0000-4000-8000-000000000001','d5730000-0000-4000-8000-000000000001','offline_access');
insert into auth.sessions(id,user_id,oauth_client_id,scopes,created_at,updated_at) values('d5770000-0000-4000-8000-000000000001','d5700000-0000-4000-8000-000000000001','d5730000-0000-4000-8000-000000000001','offline_access',now(),now());

select set_config('request.jwt.claims','{"sub":"d5700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select lives_ok($$select public.save_merchant_mcp_connection('d5700000-0000-4000-8000-000000000001','d5730000-0000-4000-8000-000000000001',array['d5710000-0000-4000-8000-000000000001'::uuid],true,true)$$,'the admin owner can grant its own business, including publishing to Claude');
reset role;
select ok(public.gling_access_token_hook(jsonb_build_object('user_id','d5700000-0000-4000-8000-000000000001','authentication_method','oauth_provider/authorization_code',
  'client_id','d5730000-0000-4000-8000-000000000001','claims',jsonb_build_object('iss','http://127.0.0.1:54321/auth/v1','scope','offline_access','session_id','d5770000-0000-4000-8000-000000000001')))->'claims'->>'role'='gling_mcp',
  'the token hook issues a business-only AI token for the admin owner');
select set_config('request.jwt.claims','{"sub":"d5700000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.save_merchant_mcp_connection('d5700000-0000-4000-8000-000000000002','d5730000-0000-4000-8000-000000000001',array['d5710000-0000-4000-8000-000000000001'::uuid],true,false)$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','an admin without business approval is still refused');
reset role;
select * from finish();
rollback;
