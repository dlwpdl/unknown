begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','save_merchant_mcp_connection',array['uuid','uuid[]','boolean','boolean'],'web saves explicit owner scope');
select has_function('public','dispatch_merchant_mcp',array['uuid','uuid','uuid','uuid','text','jsonb'],'server has one bounded business dispatch');
select has_function('public','review_merchant_mcp_change',array['uuid','boolean'],'business owner reviews exact public changes');

insert into auth.users(id,email,raw_app_meta_data) values
('14000000-0000-4000-8000-000000000001','mcp-owner@example.com','{"provider":"kakao","merchant_enabled":true}'),
('14000000-0000-4000-8000-000000000002','mcp-other@example.com','{"provider":"kakao","merchant_enabled":true}'),
('14000000-0000-4000-8000-000000000003','mcp-no@example.com','{"provider":"kakao"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('14000000-0000-4000-8000-000000000001','MCP업체검사','vancouver',now(),now(),now(),'test'),
('14000000-0000-4000-8000-000000000002','MCP타인검사','vancouver',now(),now(),now(),'test'),
('14000000-0000-4000-8000-000000000003','MCP권한검사','vancouver',now(),now(),now(),'test');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at) values
('14010000-0000-4000-8000-000000000001','MCP내업체','vancouver','private contact sentinel','trial','granted','검사만','14000000-0000-4000-8000-000000000001',now()),
('14010000-0000-4000-8000-000000000002','MCP타인업체','vancouver','','trial','granted','검사만','14000000-0000-4000-8000-000000000002',now()),
('14010000-0000-4000-8000-000000000003','MCP허용안한업체','vancouver','','trial','granted','검사만','14000000-0000-4000-8000-000000000001',now());
insert into auth.oauth_clients(id,client_name,redirect_uris,grant_types,registration_type,client_type,token_endpoint_auth_method) values
('14030000-0000-4000-8000-000000000001','MCP 검사 도구','http://127.0.0.1/callback','authorization_code,refresh_token','dynamic','public','none');
insert into auth.oauth_consents(id,user_id,client_id,scopes) values
('14050000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001','offline_access');
insert into auth.sessions(id,user_id,oauth_client_id,scopes,created_at,updated_at) values ('14070000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001','offline_access',now(),now());
select set_config('test.mcp_session_id','14070000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_merchant_mcp_connection('14030000-0000-4000-8000-000000000001',array['14010000-0000-4000-8000-000000000002'::uuid],true,false)$$,'P0001','MERCHANT_ACCESS_REQUIRED','cannot connect somebody else business');
select set_config('test.mcp_connection_id',public.save_merchant_mcp_connection('14030000-0000-4000-8000-000000000001',array['14010000-0000-4000-8000-000000000001'::uuid],true,false)->>'id',true);
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'42501',null,'ordinary browser cannot invoke service dispatch');
reset role;
select ok(not exists(select 1 from pg_roles where rolname='gling_mcp'),'AI token role has no database identity');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth","claims":{"role":"authenticated","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","iss":"https://example.supabase.co/auth/v1"}}')->'claims'->>'role','authenticated','normal social login hook is unchanged');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","iss":"https://example.supabase.co/auth/v1","role":"authenticated","app_metadata":{"role":"admin"}}}')->'claims'->>'role','gling_mcp','OAuth receives an app-ineligible role');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","iss":"https://example.supabase.co/auth/v1","role":"authenticated"}}')->'claims'->>'aud','https://example.supabase.co/functions/v1/merchant-mcp','OAuth is bound to the MCP resource');
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","iss":"https://example.supabase.co/auth/v1","app_metadata":{"role":"admin"}}}')->'claims'->'app_metadata'->>'role' is null,'AI never gets admin claims');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'claims'->>'sub','mcp:'||current_setting('test.mcp_connection_id'),'review: MCP subject cannot be parsed as native account UUID');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'claims'->>'gling_actor_id','14000000-0000-4000-8000-000000000001','review: signed actor remains explicit');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'claims'->>'email','','review: email is removed from client credential');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'claims'->>'phone','','review: phone is removed from client credential');
select is(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'claims'->'user_metadata','{}'::jsonb,'review: private user metadata is removed');
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"openid","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'error' is not null,'review: openid cannot issue bypassing ID token');
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access openid","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'error' is not null,'review: mixed identity scopes are rejected');
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000099","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'error' is not null,'review: missing native session cannot issue credentials');
update auth.sessions set not_after=now()-interval '1 second' where id='14070000-0000-4000-8000-000000000001';
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'error' is not null,'review: expired native session cannot issue credentials');
update auth.sessions set not_after=null where id='14070000-0000-4000-8000-000000000001';
update auth.sessions set user_id='14000000-0000-4000-8000-000000000002' where id='14070000-0000-4000-8000-000000000001';
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","sub":"14000000-0000-4000-8000-000000000001","email":"fixture@example.com","phone":"+15555550100","app_metadata":{"role":"admin"},"user_metadata":{"private":"sentinel"}}}'::jsonb)->'error' is not null,'review: another native actor cannot bind this connection');
update auth.sessions set user_id='14000000-0000-4000-8000-000000000001' where id='14070000-0000-4000-8000-000000000001';
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,'14070000-0000-4000-8000-000000000099','list_my_businesses','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','review: service dispatch also rejects unbound sessions');

set local role service_role;
select is(jsonb_array_length(public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')->'businesses'),1,'only chosen allocated business is returned');
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'get_business_profile','{"merchant_id":"14010000-0000-4000-8000-000000000003"}')$$,'P0001','MERCHANT_ACCESS_REQUIRED','even own ungranted business is blocked');
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000002','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','connection cannot be used by another actor');
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'approve_workspace_drafts','{}')$$,'P0001','MCP_TOOL_NOT_ALLOWED','AI cannot approve its own draft');
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'publish_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001","expected_updated_at":"2026-10-09T00:00:00Z"}')$$,'P0001','MCP_TOOL_NOT_ALLOWED','publishing must be explicitly enabled');
select lives_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'save_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001","title":"가게 소식 검사","body":"이 글은 로컬 보안 검사입니다."}')$$,'AI may save a bounded Gling draft');
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'save_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001","title":"덮어쓰기","body":"수정한 본문"}')$$,'P0001','MERCHANT_DRAFT_CHANGED','stale or missing revision cannot overwrite a draft');
select lives_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'save_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001","title":"가게 소식 검사","body":"이 글은 로컬 보안 검사입니다."}')$$,'an identical draft retry does not duplicate or erase approval');
reset role;
select ok((public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')::text not like '%private contact sentinel%'),'private owner contact is not sent to AI');
select set_config('test.mcp_profile_revision',public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'get_business_profile','{"merchant_id":"14010000-0000-4000-8000-000000000001"}')->>'revision',true);
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'propose_business_change',jsonb_build_object('merchant_id','14010000-0000-4000-8000-000000000001','request_id','14060000-0000-4000-8000-000000000009','kind','profile','expected_revision',current_setting('test.mcp_profile_revision'),'changes',jsonb_build_object('owner_id','14000000-0000-4000-8000-000000000002')))$$,'P0001','INVALID_MCP_INPUT','a profile proposal cannot change ownership');
select lives_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'propose_business_change',jsonb_build_object('merchant_id','14010000-0000-4000-8000-000000000001','request_id','14060000-0000-4000-8000-000000000001','kind','profile','expected_revision',current_setting('test.mcp_profile_revision'),'changes',jsonb_build_object('services','웹에서 검토할 제안')))$$,'AI can save an exact profile proposal');
select is((select services from private.merchants where id='14010000-0000-4000-8000-000000000001'),'','saving a proposal does not alter the public profile');
set local role service_role;
select throws_ok($$select public.review_merchant_mcp_change('14060000-0000-4000-8000-000000000001',true)$$,'42501',null,'the service dispatch cannot apply its own proposal');
reset role;
set local role authenticated;
select is(public.review_merchant_mcp_change('14060000-0000-4000-8000-000000000001',true)->>'status','applied','only the owner web session applies the reviewed proposal');
select is(public.review_merchant_mcp_change('14060000-0000-4000-8000-000000000001',true)->>'status','applied','a repeated web apply does not apply twice');
reset role;
select is((select services from private.merchants where id='14010000-0000-4000-8000-000000000001'),'웹에서 검토할 제안','the approved profile change is saved');
select set_config('test.mcp_old_connection_id',current_setting('test.mcp_connection_id'),true);
set local role authenticated;
select set_config('test.mcp_connection_id',public.save_merchant_mcp_connection('14030000-0000-4000-8000-000000000001',array['14010000-0000-4000-8000-000000000001'::uuid],true,true)->>'id',true);
reset role;
insert into auth.sessions(id,user_id,oauth_client_id,scopes,created_at,updated_at) values ('14070000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001','offline_access',now(),now());
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"token_refresh","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001"}}')->'error' is not null,'an old native refresh session cannot inherit a replacement connection');
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"oauth_provider/authorization_code","client_id":"14030000-0000-4000-8000-000000000001","claims":{"iss":"https://example.supabase.co/auth/v1","scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000002"}}')->'claims' is not null,'a fresh OAuth session binds to the new connection');
select set_config('test.mcp_session_id','14070000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_old_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','changing permissions never revives an older token');
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'publish_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001","expected_updated_at":"2026-10-09T00:00:00Z"}')$$,'P0001','MERCHANT_DRAFT_APPROVAL_REQUIRED','a publish grant cannot replace owner draft approval');
select set_config('test.mcp_draft_revision',public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'preview_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001"}')->>'updated_at',true);
set local role authenticated;
select lives_ok($$select public.approve_merchant_workspace_drafts('14010000-0000-4000-8000-000000000001',array['14020000-0000-4000-8000-000000000001'::uuid],true,jsonb_build_object('14020000-0000-4000-8000-000000000001',current_setting('test.mcp_draft_revision')))$$,'existing owner approval accepts the exact draft');
reset role;
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'publish_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001","expected_updated_at":"2000-01-01T00:00:00Z"}')$$,'P0001','MERCHANT_DRAFT_CHANGED','approved publishing still rejects an obsolete revision');
select set_config('test.mcp_draft_revision',public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'preview_business_draft','{"merchant_id":"14010000-0000-4000-8000-000000000001","draft_id":"14020000-0000-4000-8000-000000000001"}')->>'updated_at',true);
select lives_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'publish_business_draft',jsonb_build_object('merchant_id','14010000-0000-4000-8000-000000000001','draft_id','14020000-0000-4000-8000-000000000001','expected_updated_at',current_setting('test.mcp_draft_revision')))$$,'the exact owner-approved draft uses the existing safe publish path');
select lives_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'publish_business_draft',jsonb_build_object('merchant_id','14010000-0000-4000-8000-000000000001','draft_id','14020000-0000-4000-8000-000000000001','expected_updated_at',current_setting('test.mcp_draft_revision')))$$,'publish retry returns the same post');
select is((select count(*)::int from private.merchant_posts where merchant_id='14010000-0000-4000-8000-000000000001'),1,'publish retry created only one linked post');
update auth.oauth_consents set revoked_at=clock_timestamp() where user_id='14000000-0000-4000-8000-000000000001';
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','native OAuth consent revocation invalidates existing tokens');
update auth.oauth_consents set revoked_at=null where user_id='14000000-0000-4000-8000-000000000001';
update private.merchant_mcp_connections set expires_at=now()-interval '1 second' where id=current_setting('test.mcp_connection_id')::uuid;
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','connection expiry is independent of JWT expiry');
update private.merchant_mcp_connections set expires_at=now()+interval '30 days' where id=current_setting('test.mcp_connection_id')::uuid;
update auth.users set raw_app_meta_data='{"provider":"kakao","merchant_enabled":false}' where id='14000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.get_my_merchant_mcp_connections()$$,'owner can still find and revoke connections after business access is turned off');
reset role;
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','current NO blocks an old AI token');
update auth.users set raw_app_meta_data='{"provider":"kakao","merchant_enabled":true}' where id='14000000-0000-4000-8000-000000000001';
update private.merchants set owner_id='14000000-0000-4000-8000-000000000002' where id='14010000-0000-4000-8000-000000000001';
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'get_business_profile','{"merchant_id":"14010000-0000-4000-8000-000000000001"}')$$,'P0001','MERCHANT_ACCESS_REQUIRED','changed ownership blocks an old AI token');
update private.merchants set owner_id='14000000-0000-4000-8000-000000000001' where id='14010000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.revoke_merchant_mcp_connection(current_setting('test.mcp_connection_id')::uuid)$$,'business owner revokes its AI connection');
reset role;
select throws_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'list_my_businesses','{}')$$,'P0001','MCP_CONNECTION_REQUIRED','revoke immediately blocks even an unexpired AI token');
select ok(public.gling_access_token_hook('{"user_id":"14000000-0000-4000-8000-000000000001","authentication_method":"token_refresh","client_id":"14030000-0000-4000-8000-000000000001","claims":{"scope":"offline_access","session_id":"14070000-0000-4000-8000-000000000001","iss":"https://example.supabase.co/auth/v1"}}')->'error' is not null,'revoked grant cannot mint another token');
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at,updated_at) values ('14080000-0000-4000-8000-000000000099','14000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where slug='business'),'게시글 검사','본문 변경 경쟁 검사',now()-interval '1 day',now()-interval '1 day');
insert into private.merchant_posts(post_id,merchant_id) values ('14080000-0000-4000-8000-000000000099','14010000-0000-4000-8000-000000000001');
select set_config('test.review_revision',private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001','14080000-0000-4000-8000-000000000099')->>'revision',true);
update public.posts set view_count=view_count+1 where id='14080000-0000-4000-8000-000000000099';
select is(private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001','14080000-0000-4000-8000-000000000099')->>'revision',current_setting('test.review_revision'),'review: actual updated-at counter trigger preserves content revision');
update public.posts set body='새롭게 수정한 원본' where id='14080000-0000-4000-8000-000000000099';
select isnt(private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001','14080000-0000-4000-8000-000000000099')->>'revision',current_setting('test.review_revision'),'review: actual content edit invalidates revision');


-- Evidence only. Append immediately before finish() in the existing rollback-only
-- merchant_customer_mcp.test.sql fixture transaction. Do not apply independently.
-- Uses only the owned fake actor/client fixtures and does not change shared source.
insert into auth.oauth_authorizations(id,authorization_id,client_id,redirect_uri,scope,state,authorization_code,expires_at) values
('14090000-0000-4000-8000-000000000099','review-native-request-123','14030000-0000-4000-8000-000000000001','http://127.0.0.1/callback','offline_access','private-state-sentinel','private-code-sentinel',now()+interval '3 minutes');
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_mcp_authorization('review-native-request-123')->>'client_id','14030000-0000-4000-8000-000000000001','review metadata: pending request exposes verified client');
select ok(not (public.get_merchant_mcp_authorization('review-native-request-123') ?| array['state','authorization_code','nonce','user_id']),'review metadata: sensitive code and actor fields remain hidden');
select throws_ok($$select public.get_merchant_mcp_authorization('../injected')$$,'P0001','INVALID_MCP_INPUT','review metadata: request identifier is bounded');
reset role;
select ok((select user_id is null and status='pending' from auth.oauth_authorizations where authorization_id='review-native-request-123'),'review metadata: read cannot bind actor or approve');
update auth.oauth_authorizations set user_id='14000000-0000-4000-8000-000000000002' where authorization_id='review-native-request-123';
set local role authenticated;
select throws_ok($$select public.get_merchant_mcp_authorization('review-native-request-123')$$,'P0001','MCP_AUTHORIZATION_EXPIRED','review metadata: a different bound actor cannot read request');
reset role;
update auth.oauth_authorizations set user_id=null,scope='offline_access openid' where authorization_id='review-native-request-123';
set local role authenticated;
select throws_ok($$select public.get_merchant_mcp_authorization('review-native-request-123')$$,'P0001','MCP_SCOPE_NOT_ALLOWED','review metadata: identity scopes are rejected before approval');
reset role;
update auth.oauth_authorizations set scope='offline_access',created_at=now()-interval '5 minutes',expires_at=now()-interval '1 second' where authorization_id='review-native-request-123';
set local role authenticated;
select throws_ok($$select public.get_merchant_mcp_authorization('review-native-request-123')$$,'P0001','MCP_AUTHORIZATION_EXPIRED','review metadata: expired request cannot be presented');
reset role;
update auth.oauth_authorizations set expires_at=now()+interval '3 minutes',status='denied' where authorization_id='review-native-request-123';
set local role authenticated;
select throws_ok($$select public.get_merchant_mcp_authorization('review-native-request-123')$$,'P0001','MCP_AUTHORIZATION_EXPIRED','review metadata: denied request cannot be resumed');
reset role;
update auth.oauth_authorizations set status='pending' where authorization_id='review-native-request-123';
update auth.oauth_clients set deleted_at=now() where id='14030000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_merchant_mcp_authorization('review-native-request-123')$$,'P0001','MCP_AUTHORIZATION_EXPIRED','review metadata: deleted native client cannot be presented');
reset role;
update auth.oauth_clients set deleted_at=null where id='14030000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.get_merchant_mcp_authorization('review-native-request-123')$$,'42501',null,'review metadata: service tool cannot invoke web consent metadata');
reset role;

-- A reviewed page and expired requests must never hide the next pending page.
update private.merchant_mcp_connections set revoked_at=null where id=current_setting('test.mcp_connection_id')::uuid;
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into private.merchant_mcp_changes(id,connection_id,merchant_id,kind,expected_revision,before_value,changes)
 select ('14160000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,current_setting('test.mcp_connection_id')::uuid,'14010000-0000-4000-8000-000000000001','profile',
 private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001')->>'revision',private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001'),'{"services":"대기 제안"}' from generate_series(1,100)g;
set local role authenticated;
select is((select count(*) from jsonb_array_elements(public.get_my_merchant_mcp_changes('14010000-0000-4000-8000-000000000001')) r where r->>'status'='pending'),50::bigint,'pending review page is bounded to 50');
select public.review_merchant_mcp_change((r->>'id')::uuid,false) from jsonb_array_elements(public.get_my_merchant_mcp_changes('14010000-0000-4000-8000-000000000001'))r where r->>'status'='pending';
select is((select count(*) from jsonb_array_elements(public.get_my_merchant_mcp_changes('14010000-0000-4000-8000-000000000001')) r where r->>'status'='pending'),50::bigint,'reviewed newer page cannot hide older pending requests');
select public.review_merchant_mcp_change((r->>'id')::uuid,false) from jsonb_array_elements(public.get_my_merchant_mcp_changes('14010000-0000-4000-8000-000000000001'))r where r->>'status'='pending';
reset role;
insert into private.merchant_mcp_changes(id,connection_id,merchant_id,kind,expected_revision,before_value,changes,created_at,expires_at)
 select ('14170000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,current_setting('test.mcp_connection_id')::uuid,'14010000-0000-4000-8000-000000000001','profile',
 private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001')->>'revision',private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001'),'{"services":"만료된 제안"}',now()-interval '2 days',now()-interval '1 day' from generate_series(1,100)g;
select lives_ok($$select public.dispatch_merchant_mcp('14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',current_setting('test.mcp_connection_id')::uuid,current_setting('test.mcp_session_id')::uuid,'propose_business_change',jsonb_build_object('merchant_id','14010000-0000-4000-8000-000000000001','request_id','14180000-0000-4000-8000-000000000001','kind','profile','expected_revision',private.mcp_content_snapshot('14010000-0000-4000-8000-000000000001')->>'revision','changes',jsonb_build_object('services','실제 검토할 제안')))$$,'expired pending requests do not consume the live proposal cap');
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.get_my_merchant_mcp_changes('14010000-0000-4000-8000-000000000001'))r where r->>'status'='pending' and (r->>'expires_at')::timestamptz<=now()),'expired pending requests cannot crowd the review page');
reset role;

-- Revoked reconnect history must not hide a still-live connection.
update private.merchant_mcp_connections set created_at=now()-interval '1 day' where id=current_setting('test.mcp_connection_id')::uuid;
insert into private.merchant_mcp_connections(actor_id,client_id,merchant_ids,allow_drafts,created_at,revoked_at)
 select '14000000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001',array['14010000-0000-4000-8000-000000000001'::uuid],false,now(),now() from generate_series(1,100);
set local role authenticated;
select is((select count(*) from jsonb_array_elements(public.get_my_merchant_mcp_connections())c where c->>'id'=current_setting('test.mcp_connection_id')),1::bigint,'live connection remains visible past 100 revoked reconnects');
reset role;

select * from finish();
rollback;
