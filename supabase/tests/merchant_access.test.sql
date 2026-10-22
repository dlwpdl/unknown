begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_my_merchant_access',array[]::text[],'business capability has a private server reader');
select has_function('public','set_admin_merchant_access',array['uuid','boolean'],'admin can change business access');
insert into auth.users(id,email,raw_app_meta_data) values
('12900000-0000-0000-0000-000000000001','business-role-owner@example.com','{}'),
('12900000-0000-0000-0000-000000000002','business-role-other@example.com','{}'),
('12900000-0000-0000-0000-000000000003','business-role-admin@example.com','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('12900000-0000-0000-0000-000000000001','업체권한검사','vancouver',now(),now(),now(),'test'),
('12900000-0000-0000-0000-000000000002','다른업체권한검사','vancouver',now(),now(),now(),'test'),
('12900000-0000-0000-0000-000000000003','업체권한관리검사','vancouver',now(),now(),now(),'test');
insert into auth.sessions(id,user_id,aal) values('12990000-0000-0000-0000-000000000003','12900000-0000-0000-0000-000000000003','aal2');
select set_config('request.jwt.claims','{"sub":"12900000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"merchant_enabled":true}}',true);
set local role authenticated;
select is(public.get_my_merchant_access(),false,'a self supplied or stale JWT flag cannot grant access');
select throws_ok($$select public.register_my_merchant('12910000-0000-0000-0000-000000000001','권한검사업체','vancouver','test')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','NO refuses registration on server');
select throws_ok($$select public.set_admin_merchant_access('12900000-0000-0000-0000-000000000001',true)$$,'P0001','ADMIN_REQUIRED','member cannot promote itself');
reset role;
select set_config('request.jwt.claims','{"sub":"12900000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1","session_id":"12990000-0000-0000-0000-000000000003","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_merchant_access('12900000-0000-0000-0000-000000000001',true)$$,'P0001','ADMIN_REQUIRED','AAL1 admin cannot grant merchant access');
reset role;
select set_config('request.jwt.claims','{"sub":"12900000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"12990000-0000-0000-0000-000000000003","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.set_admin_merchant_access('12900000-0000-0000-0000-000000000001',true),true,'MFA admin enables capability');
select is(public.get_admin_merchant_access('12900000-0000-0000-0000-000000000001'),true,'actual saved value can be read back');
reset role;
select set_config('request.jwt.claims','{"sub":"12900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_merchant_access(),true,'database role works without token refresh');
select lives_ok($$select public.register_my_merchant('12910000-0000-0000-0000-000000000001','권한검사업체','vancouver','test')$$,'YES can register own business');
reset role;
update private.merchants set owner_verified_at=now() where id='12910000-0000-0000-0000-000000000001';
insert into public.posts(id,city_id,author_id,tag_id,title,body,status) values('12920000-0000-0000-0000-000000000001','vancouver','12900000-0000-0000-0000-000000000003',1,'대행 소개 검사','실제 홍보가 아닌 검증용 본문','published');
insert into private.merchant_posts(post_id,merchant_id,original_url) values('12920000-0000-0000-0000-000000000001','12910000-0000-0000-0000-000000000001','https://example.com');
set local role authenticated;
select lives_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','업체가 고친 제목','업체가 검토한 새 정보',array[]::text[])$$,'verified owner can edit linked delegated intro');
reset role;
select is((select author_id from public.posts where id='12920000-0000-0000-0000-000000000001'),'12900000-0000-0000-0000-000000000003'::uuid,'editing never impersonates or changes original author');
insert into storage.objects(bucket_id,name,owner) values
('post-images','12900000-0000-0000-0000-000000000001/first.webp','12900000-0000-0000-0000-000000000001'),
('post-images','12900000-0000-0000-0000-000000000001/second.webp','12900000-0000-0000-0000-000000000001'),
('post-images','12900000-0000-0000-0000-000000000002/private.webp','12900000-0000-0000-0000-000000000002');
update public.posts set image_paths=array['12900000-0000-0000-0000-000000000003/original.webp'],view_count=7 where id='12920000-0000-0000-0000-000000000001';
update public.safety_review_queue set status='reviewed' where target_type='post' and target_id='12920000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','사진 안내','검토한 사진 안내',array['12900000-0000-0000-0000-000000000001/second.webp','12900000-0000-0000-0000-000000000003/original.webp'])$$,'owner retains original author photos and adds their own in selected order');
select throws_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','사진 안내','검사',array['12900000-0000-0000-0000-000000000002/private.webp'])$$,'P0001','INVALID_IMAGE_PATH','other user storage is not attachable');
select throws_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','사진 안내','검사',array['12900000-0000-0000-0000-000000000001/missing.webp'])$$,'P0001','INVALID_IMAGE_PATH','missing upload cannot be attached');
select throws_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','사진 안내','검사',array['12900000-0000-0000-0000-000000000001/second.webp','12900000-0000-0000-0000-000000000001/second.webp'])$$,'P0001','INVALID_IMAGE_PATH','duplicate photos cannot bypass six photo limit');
select lives_ok($$select public.save_merchant_workspace_draft('12910000-0000-0000-0000-000000000001','12940000-0000-0000-0000-000000000001','gling','사진 초안','실제 안내가 아닌 검사 초안',null,'life','story',array['12900000-0000-0000-0000-000000000001/second.webp','12900000-0000-0000-0000-000000000001/first.webp'])$$,'draft accepts existing uploaded owner photos');
select is(public.get_merchant_workspace('12910000-0000-0000-0000-000000000001')->'drafts'->0->'image_paths','["12900000-0000-0000-0000-000000000001/second.webp","12900000-0000-0000-0000-000000000001/first.webp"]'::jsonb,'workspace returns saved draft photo order');
select lives_ok($$select public.save_merchant_workspace_draft('12910000-0000-0000-0000-000000000001','12940000-0000-0000-0000-000000000001','gling','사진 초안','텍스트 수정 검사',null,'life','story')$$,'older callers can still save text');
select is(jsonb_array_length(public.get_merchant_workspace('12910000-0000-0000-0000-000000000001')->'drafts'->0->'image_paths'),2,'omitted photos preserve stored paths');
select throws_ok($$select public.save_merchant_workspace_draft('12910000-0000-0000-0000-000000000001','12940000-0000-0000-0000-000000000001','gling','사진 초안','검사',null,'life','story',array['12900000-0000-0000-0000-000000000002/private.webp'])$$,'P0001','INVALID_IMAGE_PATH','draft cannot attach foreign storage');
select lives_ok($$select public.save_merchant_workspace_draft('12910000-0000-0000-0000-000000000001','12940000-0000-0000-0000-000000000001','gling','사진 초안','사진 제거 검사',null,'life','story',array[]::text[])$$,'explicit empty photos remove draft attachments');
select is(jsonb_array_length(public.get_merchant_workspace('12910000-0000-0000-0000-000000000001')->'drafts'->0->'image_paths'),0,'empty photos read back exactly');
reset role;
select is((select image_paths from public.posts where id='12920000-0000-0000-0000-000000000001'),array['12900000-0000-0000-0000-000000000001/second.webp','12900000-0000-0000-0000-000000000003/original.webp'],'saved linked intro photos retain selected order');
select is((select view_count from public.posts where id='12920000-0000-0000-0000-000000000001'),7,'editing leaves view count untouched');
select is((select status from public.safety_review_queue where target_type='post' and target_id='12920000-0000-0000-0000-000000000001'),'pending','merchant edit still requeues ordinary safety review');
update private.merchants set owner_verified_at=null where id='12910000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','안내','검사',null)$$,'P0001','MERCHANT_OWNER_VERIFICATION_REQUIRED','unverified owner cannot edit linked Gling intro');
reset role;
update private.merchants set owner_verified_at=now() where id='12910000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"12900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='12900000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.get_merchant_workspace('12910000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','YES grants no access to other business');
select throws_ok($$select public.edit_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001','bad','bad',null)$$,'P0001','MERCHANT_ACCESS_REQUIRED','other merchant cannot edit');
reset role;
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{merchant_enabled}','false') where id='12900000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"12900000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"merchant_enabled":true}}',true);
set local role authenticated;
select is(public.get_my_merchant_access(),false,'NO revokes even stale access token');
select throws_ok($$select public.get_merchant_workspace('12910000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','NO immediately revokes workspace access');
select throws_ok($$select public.remove_merchant_post('12910000-0000-0000-0000-000000000001','12920000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','NO revokes deletion');
reset role;
select is((select count(*) from private.merchants where owner_id='12900000-0000-0000-0000-000000000001'),1::bigint,'NO preserves linked business');
select is((select status from public.posts where id='12920000-0000-0000-0000-000000000001'),'published','NO preserves published content');
select ok(not has_function_privilege('anon','public.set_admin_merchant_access(uuid,boolean)','execute'),'guest cannot grant role');
select * from finish();
rollback;
