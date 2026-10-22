begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('workspace-test','업체도구검사','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
('11900000-0000-0000-0000-000000000001','workspace-owner@example.com','{"merchant_enabled":true}'),
('11900000-0000-0000-0000-000000000002','workspace-other@example.com','{"merchant_enabled":true}'),
('11900000-0000-0000-0000-000000000003','workspace-admin@example.com','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('11900000-0000-0000-0000-000000000001','도구소유검사','workspace-test',now(),now(),now(),'test'),
('11900000-0000-0000-0000-000000000002','도구다른검사','workspace-test',now(),now(),now(),'test'),
('11900000-0000-0000-0000-000000000003','도구관리검사','workspace-test',now(),now(),now(),'test');
insert into auth.sessions(id,user_id,aal) values('11990000-0000-0000-0000-000000000003','11900000-0000-0000-0000-000000000003','aal2');
select set_config('request.jwt.claims','{"sub":"11900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.register_my_merchant('11910000-0000-0000-0000-000000000001','도구 검사 업체','workspace-test','실제 연락처 아님'),'11910000-0000-0000-0000-000000000001'::uuid,'authenticated user registers own business');
select is(jsonb_array_length(public.get_my_merchants()),1,'owner reads only own business');
select is(public.get_my_merchants()->0->>'plan','trial','new business has bounded trial');
select is(public.get_my_merchants()->0->>'owner_verified_at',null::text,'registration does not claim verified ownership');
select is(public.save_merchant_workspace_item('11910000-0000-0000-0000-000000000001','11920000-0000-0000-0000-000000000001','검사 원두','봉',12,2),'11920000-0000-0000-0000-000000000001'::uuid,'save product');
select is((public.adjust_merchant_inventory('11910000-0000-0000-0000-000000000001','11930000-0000-0000-0000-000000000001','[{"item_id":"11920000-0000-0000-0000-000000000001","delta":10,"note":"입고 검사"}]')->>'applied')::int,1,'stock added through ledger');
select lives_ok($$select public.adjust_merchant_inventory('11910000-0000-0000-0000-000000000001','11930000-0000-0000-0000-000000000001','[{"item_id":"11920000-0000-0000-0000-000000000001","delta":10,"note":"입고 검사"}]')$$,'retry idempotent');
select throws_ok($$select public.adjust_merchant_inventory('11910000-0000-0000-0000-000000000001','11930000-0000-0000-0000-000000000001','[{"item_id":"11920000-0000-0000-0000-000000000001","delta":9,"note":"다른 요청"}]')$$,'P0001','MERCHANT_REQUEST_CONFLICT','same request cannot change quantity');
select is((public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')->'items'->0->>'quantity')::numeric,10::numeric,'one addition after retry');
select throws_ok($$select public.adjust_merchant_inventory('11910000-0000-0000-0000-000000000001','11930000-0000-0000-0000-000000000002','[{"item_id":"11920000-0000-0000-0000-000000000001","delta":-11,"note":"출고 검사"}]')$$,'P0001','MERCHANT_STOCK_NEGATIVE','negative stock refused');
select throws_ok($$select public.adjust_merchant_inventory('11910000-0000-0000-0000-000000000001','11930000-0000-0000-0000-000000000002','[{"item_id":"11920000-0000-0000-0000-000000000001","delta":-1,"note":"정상"},{"item_id":"11920000-0000-0000-0000-000000000002","delta":1,"note":"없는 품목"}]')$$,'P0001','MERCHANT_ITEM_NOT_FOUND','whole batch fails if any item missing');
select is((public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')->'items'->0->>'quantity')::numeric,10::numeric,'failed batch changes no stock');
select is(public.save_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001','gling','검사 안내','실제 행사나 업체 홍보가 아닌 테스트 원고입니다.',null,'life','story'),'11940000-0000-0000-0000-000000000001'::uuid,'draft saved');
select is((public.approve_merchant_workspace_drafts('11910000-0000-0000-0000-000000000001',array['11940000-0000-0000-0000-000000000001']::uuid[],true,jsonb_build_object('11940000-0000-0000-0000-000000000001',public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')->'drafts'->0->>'updated_at'))->>'approved')::int,1,'owner approves a draft');
select throws_ok($$select public.publish_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_OWNER_VERIFICATION_REQUIRED','unverified businesses cannot self publish merchant posts');
select lives_ok($$select public.save_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001','gling','검사 안내','내용을 수정한 테스트 원고입니다.',null,'life','story')$$,'draft edited');
select is(public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')->'drafts'->0->>'approved_at',null::text,'editing invalidates prior approval');
reset role;
select set_config('request.jwt.claims','{"sub":"11900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchants()),0,'another member has no businesses');
select throws_ok($$select public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','other merchant data isolated');
select throws_ok($$select public.register_my_merchant('11910000-0000-0000-0000-000000000001','가로채기','workspace-test','')$$,'P0001','MERCHANT_ACCESS_REQUIRED','stable UUID cannot take ownership');
select throws_ok($$select public.save_merchant_workspace_item('11910000-0000-0000-0000-000000000001','11920000-0000-0000-0000-000000000001','타 업체 수정','개',0,0)$$,'P0001','MERCHANT_ACCESS_REQUIRED','other user cannot modify products');
select throws_ok($$select * from private.merchant_items$$,'42501',null,'private inventory inaccessible directly');
reset role;
select set_config('request.jwt.claims','{"sub":"11900000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_my_merchants()$$,'P0001','ADMIN_REQUIRED','admin business entry still needs real MFA');
select throws_ok($$select public.set_admin_merchant_workspace_owner('11910000-0000-0000-0000-000000000001','11900000-0000-0000-0000-000000000001',true,current_date+30)$$,'P0001','ADMIN_REQUIRED','admin cannot verify owner at AAL1');
reset role;
select set_config('request.jwt.claims','{"sub":"11900000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"11990000-0000-0000-0000-000000000003","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select provolatile::text from pg_proc where oid='public.get_my_merchants()'::regprocedure),'v','PostgREST permits audited admin business lists in a write transaction');
select lives_ok($$select public.get_my_merchants()$$,'MFA admin can list businesses while recording access');
select lives_ok($$select public.set_admin_merchant_workspace_owner('11910000-0000-0000-0000-000000000001','11900000-0000-0000-0000-000000000001',true,current_date+30)$$,'verified admin confirms existing owner');
reset role;
select is((select count(*) from public.admin_access_logs where actor_id='11900000-0000-0000-0000-000000000003' and scope='analytics'),2::bigint,'admin list and ownership confirmation both retain audit records');
select set_config('request.jwt.claims','{"sub":"11900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.approve_merchant_workspace_drafts('11910000-0000-0000-0000-000000000001',array['11940000-0000-0000-0000-000000000001']::uuid[],true,jsonb_build_object('11940000-0000-0000-0000-000000000001',now()-interval '1 second'))$$,'P0001','MERCHANT_DRAFT_CHANGED','stale reviewed version cannot approve a changed draft');
select lives_ok($$select public.approve_merchant_workspace_drafts('11910000-0000-0000-0000-000000000001',array['11940000-0000-0000-0000-000000000001']::uuid[],true,jsonb_build_object('11940000-0000-0000-0000-000000000001',public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')->'drafts'->0->>'updated_at'))$$,'latest copy approved');
select throws_ok($$select public.publish_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_DRAFT_CHANGED','new publications require the reviewed revision');
select throws_ok($$select public.publish_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001',now()-interval '1 second')$$,'P0001','MERCHANT_DRAFT_CHANGED','stale reviewed version cannot publish the current draft');
select lives_ok($$select public.publish_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001',(public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')->'drafts'->0->>'updated_at')::timestamptz)$$,'owner publishes through normal post path');
select lives_ok($$select public.publish_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000001')$$,'publish retry returns same post');
select public.save_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000004','casmo','카페 검사','직접 게시한 원고 기록 검사입니다.',null,'life','story');
select public.approve_merchant_workspace_drafts('11910000-0000-0000-0000-000000000001',array['11940000-0000-0000-0000-000000000004']::uuid[],true,jsonb_build_object('11940000-0000-0000-0000-000000000004',now()));
select throws_ok($$select public.record_merchant_external_post('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000004','https://cafe.naver.com/example/1',now()-interval '1 second')$$,'P0001','MERCHANT_DRAFT_CHANGED','external URL cannot be attached to a different reviewed version');
select lives_ok($$select public.record_merchant_external_post('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000004','https://cafe.naver.com/example/1',now())$$,'current approved cafe revision records owner supplied URL');
reset role;
select is((select count(*) from private.merchant_posts where merchant_id='11910000-0000-0000-0000-000000000001'),1::bigint,'no duplicate publication');
update private.merchants set trial_ends_at=(now() at time zone 'America/Vancouver')::date-1,status='trial' where id='11910000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"11900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_merchants()->0->>'plan','basic','expired trial does not remain paid');
select lives_ok($$select public.get_merchant_workspace('11910000-0000-0000-0000-000000000001')$$,'expired trial retains readable business data');
-- Valid products and unpublished drafts isolate the membership guard from data validation.
select public.save_merchant_workspace_item('11910000-0000-0000-0000-000000000001','11920000-0000-0000-0000-000000000002','검사 차','봉',8,2);
select public.save_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000002','gling','일괄 검사 둘','실제 홍보가 아닌 검사 원고입니다.',null,'life','story');
select public.save_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000003','gling','일괄 검사 셋','실제 홍보가 아닌 검사 원고입니다.',null,'life','story');
select throws_ok($$select public.adjust_merchant_inventory('11910000-0000-0000-0000-000000000001','11930000-0000-0000-0000-000000000003','[{"item_id":"11920000-0000-0000-0000-000000000001","delta":1,"note":"일괄 검사"},{"item_id":"11920000-0000-0000-0000-000000000002","delta":1,"note":"일괄 검사"}]')$$,'P0001','MERCHANT_PLAN_REQUIRED','expired trial refuses bulk stock on server');
select throws_ok($$select public.approve_merchant_workspace_drafts('11910000-0000-0000-0000-000000000001',array['11940000-0000-0000-0000-000000000002','11940000-0000-0000-0000-000000000003']::uuid[],true)$$,'P0001','MERCHANT_PLAN_REQUIRED','expired trial refuses bulk approval on server');
reset role;
select public.apply_membership_snapshot('11900000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','com.dlwpdl.gling.premium.monthly','store','app_store','will_renew',true)),now());
set local role authenticated;
select is(public.get_membership()->>'tier','premium','personal premium is active in isolated fixture');
select is(public.get_my_merchants()->0->>'plan','basic','personal premium cannot unlock expired business membership');
reset role;
update private.merchants set status='paid',workspace_until=(now() at time zone 'America/Vancouver')::date where id='11910000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.get_my_merchants()->0->>'plan','pro','paid business period grants pro through its city date');
reset role;
update private.merchants set workspace_until=(now() at time zone 'America/Vancouver')::date-1 where id='11910000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(public.get_my_merchants()->0->>'plan'='basic' and public.get_membership()->>'tier'='premium','expired paid business period revokes pro without affecting personal premium');
reset role;
insert into private.merchant_workspace_drafts(id,merchant_id,channel,title,body,tag_slug,kind,approved_at,approved_by)
  values('11940000-0000-0000-0000-000000000099','11910000-0000-0000-0000-000000000001','gling','중단된 업체 검사','테스트 원고','life','story',now(),'11900000-0000-0000-0000-000000000001');
update private.merchants set status='paused' where id='11910000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.publish_merchant_workspace_draft('11910000-0000-0000-0000-000000000001','11940000-0000-0000-0000-000000000099')$$,'P0001','MERCHANT_OPERATIONS_PAUSED','paused business cannot publish new approved posts');
reset role;
update public.profiles set account_status='deleted' where id='11900000-0000-0000-0000-000000000001';
select is((select count(*) from private.merchant_items where merchant_id='11910000-0000-0000-0000-000000000001'),0::bigint,'account erasure removes private item data');
select is((select count(*) from private.merchant_workspace_drafts where merchant_id='11910000-0000-0000-0000-000000000001'),0::bigint,'account erasure removes private drafts');
select ok(not has_function_privilege('anon','public.approve_merchant_workspace_drafts(uuid,uuid[],boolean,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.publish_merchant_workspace_draft(uuid,uuid,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.record_merchant_external_post(uuid,uuid,text,timestamptz)','EXECUTE'),'revision API retains guest access denial');
select * from finish();
rollback;
