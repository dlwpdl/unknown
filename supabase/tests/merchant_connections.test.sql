begin;
set local search_path=public,extensions;
set local storage.allow_delete_query='true';
select no_plan();
select has_function('public','connect_admin_merchant_account',array['uuid','uuid','text','text','boolean','text','timestamp with time zone','text','text'],'MFA admin supports direct and invited connections');
select has_function('public','get_my_merchant_connections',array[]::text[],'current account can read only its connections and invitations');

insert into auth.users(id,email,raw_app_meta_data) values
('14000000-0000-4000-8000-000000000001','owner-a@example.invalid','{"merchant_enabled":true}'),
('14000000-0000-4000-8000-000000000002','owner-b@example.invalid','{"merchant_enabled":true}'),
('14000000-0000-4000-8000-000000000003','operator@example.invalid','{}'),
('14000000-0000-4000-8000-000000000004','invitee@example.invalid','{}'),
('14000000-0000-4000-8000-000000000005','connection-admin@example.invalid','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('14000000-0000-4000-8000-000000000001','연결소유자A','vancouver',now(),now(),now(),'test'),
('14000000-0000-4000-8000-000000000002','연결소유자B','vancouver',now(),now(),now(),'test'),
('14000000-0000-4000-8000-000000000003','연결운영담당','vancouver',now(),now(),now(),'test'),
('14000000-0000-4000-8000-000000000004','연결초대회원','vancouver',now(),now(),now(),'test'),
('14000000-0000-4000-8000-000000000005','연결관리자','vancouver',now(),now(),now(),'test');
insert into auth.sessions(id,user_id,aal) values('14090000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000005','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,address,owner_id,owner_verified_at) values
('14010000-0000-4000-8000-000000000001','연결업체A','vancouver','A 비공개 연락처','paid','granted','테스트 동의','주소 A','14000000-0000-4000-8000-000000000001',now()),
('14010000-0000-4000-8000-000000000002','연결업체B','vancouver','B 비공개 연락처','paid','granted','테스트 동의','주소 B','14000000-0000-4000-8000-000000000002',now()),
('14010000-0000-4000-8000-000000000003','선등록업체','vancouver','선등록 비공개 연락처','lead','pending','','주소 C',null,null),
('14010000-0000-4000-8000-000000000004','초대업체','vancouver','초대 비공개 연락처','lead','pending','','주소 D',null,null);
insert into private.merchant_workspace_drafts(id,merchant_id,channel,title,body,tag_slug,kind,image_paths) values
('14040000-0000-4000-8000-000000000001','14010000-0000-4000-8000-000000000001','gling','A 원고','A 비공개 원고','life','story',array['14000000-0000-4000-8000-000000000001/business-a.webp']),
('14040000-0000-4000-8000-000000000002','14010000-0000-4000-8000-000000000002','gling','B 원고','B 비공개 원고','life','story',array['14000000-0000-4000-8000-000000000002/business-b.webp']);
insert into storage.objects(bucket_id,name,owner_id) values
('post-images','14000000-0000-4000-8000-000000000001/business-a.webp','14000000-0000-4000-8000-000000000001'),
('post-images','14000000-0000-4000-8000-000000000002/business-b.webp','14000000-0000-4000-8000-000000000002');
insert into private.merchant_items(id,merchant_id,name,unit,unit_cost,quantity) values('14030000-0000-4000-8000-000000000001','14010000-0000-4000-8000-000000000001','비공개 재고','개',123,456);

select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1","session_id":"14090000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000003','owner','direct',true,'사업장 소유 직접 확인',now(),'연결운영담당','operator@example.invalid')$$,'P0001','ADMIN_REQUIRED','AAL1 admin cannot connect any account');
reset role;
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14090000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000003','owner','direct',true,'사업장 소유 직접 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000003')->>'updated_at')::timestamptz,'연결운영담당','operator@example.invalid')$$,'MFA admin connects a prepared profile directly without acceptance');
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','owner','direct',true,'사업장 소유 직접 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz,'연결운영담당','operator@example.invalid')$$,'P0001','MERCHANT_OWNER_TRANSFER_REQUIRED','direct mode never overwrites another owner');
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','operator','direct',false,'사업장 운영 직접 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz,'연결운영담당','operator@example.invalid')$$,'P0001','MERCHANT_CONNECTION_CONFIRMATION_REQUIRED','direct mode requires explicit verification and a record');
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','operator','direct',true,'사업장 운영 직접 확인','2000-01-01','연결운영담당','operator@example.invalid')$$,'P0001','MERCHANT_CONNECTION_CHANGED','stale business revisions cannot connect');
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','operator','direct',true,'사업장 운영 직접 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz,'연결소유자B','owner-b@example.invalid')$$,'P0001','MERCHANT_ACCOUNT_CHANGED','substituting a user ID cannot reuse another reviewed account identity');
select lives_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','operator','direct',true,'사업장 운영 직접 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz,'연결운영담당','operator@example.invalid')$$,'admin grants a separate content operator connection');
select lives_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000004','14000000-0000-4000-8000-000000000004','owner','invite',true,'사업장 소유 초대 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000004')->>'updated_at')::timestamptz,'연결초대회원','invitee@example.invalid')$$,'admin can choose an invitation instead');
reset role;
select is((select owner_id from private.merchants where id='14010000-0000-4000-8000-000000000004'),null::uuid,'pending invitation grants no ownership');
select set_config('test.invitation_id',(select id::text from private.merchant_account_invitations where merchant_id='14010000-0000-4000-8000-000000000004' and revoked_at is null),true);
insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','14000000-0000-4000-8000-000000000003/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000001.webp','14000000-0000-4000-8000-000000000003','{"mimetype":"image/webp","size":100}');
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_connections()->'merchants'),2,'one account can switch between its own company and an operated company');
select is(public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')->'metrics','null'::jsonb,'operator receives no private metrics');
select is(public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')->'items','[]'::jsonb,'operator receives no costs or inventory');
select is(public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')->'reports','[]'::jsonb,'operator receives no contracts or reports');
select ok(not (public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')::text like '%A 비공개 연락처%'),'operator response excludes private contact');
select is(public.get_my_merchant_profile('14010000-0000-4000-8000-000000000001')->>'can_edit','true','operator can edit only the linked profile');
select lives_ok($$select public.save_my_merchant_profile('14010000-0000-4000-8000-000000000001',null,'14000000-0000-4000-8000-000000000003/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000001.webp',(public.get_my_merchant_profile('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'operator saves a private company banner');
select is((select count(*) from storage.objects where bucket_id='merchant-profile-images' and name='14000000-0000-4000-8000-000000000003/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000001.webp'),1::bigint,'operator previews saved private profile images');
select throws_ok($$select public.accept_merchant_account_invitation(current_setting('test.invitation_id')::uuid)$$,'P0001','MERCHANT_INVITATION_NOT_AVAILABLE','another account cannot accept the recipient-bound invitation');
select lives_ok($$select public.save_merchant_workspace_draft('14010000-0000-4000-8000-000000000001','14040000-0000-4000-8000-000000000001','gling','A 수정 원고','담당자가 수정한 A 정보',null,'life','story')$$,'operator can edit its own business draft');
select lives_ok($$select public.save_merchant_workspace_draft('14010000-0000-4000-8000-000000000001','14040000-0000-4000-8000-000000000001','gling','A 수정 원고','담당자가 수정한 A 정보',null,'life','story',array['14000000-0000-4000-8000-000000000001/business-a.webp'])$$,'operator retains owner-uploaded saved draft photos');
select throws_ok($$select public.save_merchant_workspace_draft('14010000-0000-4000-8000-000000000001','14040000-0000-4000-8000-000000000001','gling','A 수정 원고','담당자가 수정한 A 정보',null,'life','story',array['14000000-0000-4000-8000-000000000002/business-b.webp'])$$,'P0001','INVALID_IMAGE_PATH','foreign draft photos cannot be attached by knowing their path');
select lives_ok($$select public.approve_merchant_workspace_drafts('14010000-0000-4000-8000-000000000001',array['14040000-0000-4000-8000-000000000001'::uuid],true,jsonb_build_object('14040000-0000-4000-8000-000000000001',public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')->'drafts'->0->>'updated_at'))$$,'operator approves the reviewed content revision');
select lives_ok($$select public.publish_merchant_workspace_draft('14010000-0000-4000-8000-000000000001','14040000-0000-4000-8000-000000000001',(public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')->'drafts'->0->>'updated_at')::timestamptz)$$,'operator publishes retained photos through the existing safety and quota path');
select throws_ok($$select public.save_merchant_workspace_item('14010000-0000-4000-8000-000000000001','14030000-0000-4000-8000-000000000001','변조','개',1,1)$$,'P0001','MERCHANT_ACCESS_REQUIRED','operator cannot bypass the financial API');
select throws_ok($$select public.get_merchant_workspace('14010000-0000-4000-8000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','changing business UUID exposes no foreign workspace');
select throws_ok($$select public.get_my_merchant_profile('14010000-0000-4000-8000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','changing business UUID exposes no foreign profile editor');
select throws_ok($$select public.save_merchant_workspace_draft('14010000-0000-4000-8000-000000000001','14040000-0000-4000-8000-000000000002','gling','변조','다른 업체 원고 변경',null,'life','story')$$,'P0001','MERCHANT_DRAFT_NOT_FOUND','foreign draft UUID cannot move a draft into an authorized company');
select is((select count(*) from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000001/business-a.webp'),1::bigint,'operator can read assigned private draft photos');
select is((select count(*) from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000002/business-b.webp'),0::bigint,'knowing a foreign private photo path grants no access');
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000003','operator','direct',true,'스스로 추가하는 시도',now(),'연결운영담당','operator@example.invalid')$$,'P0001','ADMIN_REQUIRED','operator cannot promote itself into another company');
select throws_ok($$select public.get_merchant_account_connections('14010000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','content operators cannot inspect other account connections');
reset role;
insert into storage.objects(bucket_id,name,owner_id) values('post-images','14000000-0000-4000-8000-000000000001/unpublished-a.webp','14000000-0000-4000-8000-000000000001');
insert into private.merchant_workspace_drafts(id,merchant_id,channel,title,body,tag_slug,kind,image_paths) values
('14040000-0000-4000-8000-000000000003','14010000-0000-4000-8000-000000000001','gling','아직 공개하지 않은 원고','비공개 업체 사진','life','story',array['14000000-0000-4000-8000-000000000001/unpublished-a.webp']);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000001/unpublished-a.webp'),1::bigint,'connected operator can read an unpublished assigned company photo');
reset role;

select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_connections()->'merchants'),0,'invitee gets no company switch before acceptance');
select is(jsonb_array_length(public.get_my_merchant_connections()->'invitations'),1,'only the intended account sees its pending invitation');
select throws_ok($$select public.get_merchant_workspace('14010000-0000-4000-8000-000000000004')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','pending invite does not expose private information');
reset role;
update private.merchant_account_invitations set created_at=now()-interval '9 days',expires_at=now()-interval '1 day' where id=current_setting('test.invitation_id')::uuid;
set local role authenticated;
select throws_ok($$select public.accept_merchant_account_invitation(current_setting('test.invitation_id')::uuid)$$,'P0001','MERCHANT_INVITATION_NOT_AVAILABLE','expired invitation grants no access');
reset role;
update private.merchant_account_invitations set expires_at=now()+interval '7 days' where id=current_setting('test.invitation_id')::uuid;
update private.merchants set name='바뀐 업체' where id='14010000-0000-4000-8000-000000000004';
set local role authenticated;
select is(public.get_my_merchant_connections()->'invitations'->0->>'can_accept','false','changed business identity is visible before accepting');
select throws_ok($$select public.accept_merchant_account_invitation(current_setting('test.invitation_id')::uuid)$$,'P0001','MERCHANT_CONNECTION_CHANGED','old invitation cannot bind a changed business');
reset role;
update private.merchants set name='초대업체' where id='14010000-0000-4000-8000-000000000004';
update auth.users set raw_app_meta_data='{}' where id='14000000-0000-4000-8000-000000000005';
set local role authenticated;
select throws_ok($$select public.accept_merchant_account_invitation(current_setting('test.invitation_id')::uuid)$$,'P0001','MERCHANT_INVITATION_NOT_AVAILABLE','revoked inviting admin cannot leave usable invitations');
reset role;
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='14000000-0000-4000-8000-000000000005';
set local role authenticated;
select lives_ok($$select public.accept_merchant_account_invitation((public.get_my_merchant_connections()->'invitations'->0->>'id')::uuid)$$,'recipient can accept its invitation while business access is initially NO');
select throws_ok($$select public.accept_merchant_account_invitation(current_setting('test.invitation_id')::uuid)$$,'P0001','MERCHANT_INVITATION_NOT_AVAILABLE','accepted invitation cannot be replayed');
select is(jsonb_array_length(public.get_my_merchant_connections()->'merchants'),1,'accepted connection appears without changing administrator role');
select is(jsonb_array_length(public.get_my_merchant_connections()->'invitations'),0,'accepted invitation is no longer pending');
reset role;
select ok((select raw_app_meta_data->>'role' is null from auth.users where id='14000000-0000-4000-8000-000000000004'),'acceptance never grants global administrator role');
select is((select body from private.merchant_workspace_drafts where id='14040000-0000-4000-8000-000000000002'),'B 비공개 원고','foreign draft is unchanged');

insert into public.posts(id,author_id,city_id,tag_id,title,body,status,kind,posted_on,created_at,expires_at,listing_status,image_paths) values
('14050000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','vancouver',(select id from public.tags where slug='life'),'업체 판매 안내','연결된 업체의 안내','published','listing',current_date,now()-interval '10 days',now()+interval '3 days','open',array['14000000-0000-4000-8000-000000000003/operated.webp']);
insert into private.merchant_posts(post_id,merchant_id,creation_request_id) values('14050000-0000-4000-8000-000000000001','14010000-0000-4000-8000-000000000001',gen_random_uuid());
insert into storage.objects(bucket_id,name,owner_id) values('post-images','14000000-0000-4000-8000-000000000003/operated.webp','14000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.disconnect_merchant_account('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000003','operator',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz,'운영 담당 계약 종료')$$,'owner can revoke only its own operator connection');
reset role;
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"merchant_enabled":true}}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_connections()->'merchants'),1,'revoking one company keeps an unrelated owned company');
select throws_ok($$select public.get_merchant_workspace('14010000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','revocation immediately blocks stale-token API requests');
select is((select count(*) from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000001/unpublished-a.webp'),0::bigint,'revocation blocks the previously readable unpublished company photo');
select is((select count(*) from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000002/business-b.webp'),0::bigint,'revocation grants no foreign private photo reads');
with changed as (update public.posts set body='해제 뒤 변조' where id='14050000-0000-4000-8000-000000000001' returning id) select is((select count(*) from changed),0::bigint,'revoked business author cannot edit through the personal post API');
select throws_ok($$select public.set_listing_status('14050000-0000-4000-8000-000000000001','closed')$$,'P0001','MERCHANT_ACCESS_REQUIRED','revoked business author cannot change listing status');
select throws_ok($$select public.bump_post('14050000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','revoked business author cannot bump a listing');
with changed as (delete from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000003/operated.webp' returning id) select is((select count(*) from changed),0::bigint,'former uploader cannot delete a referenced business photo');
with changed as (update storage.objects set metadata='{"size":999}' where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000003/operated.webp' returning id) select is((select count(*) from changed),0::bigint,'former uploader cannot overwrite a referenced business photo');
select lives_ok($$select public.disconnect_merchant_account('14010000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000003','owner',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000003')->>'updated_at')::timestamptz,'소유자 연결 직접 해제')$$,'owner can disconnect itself without deleting the business');
select is(jsonb_array_length(public.get_my_merchant_connections()->'merchants'),0,'last connection removal hides the switch list');
reset role;
select is((select count(*) from private.merchants where id='14010000-0000-4000-8000-000000000003'),1::bigint,'disconnection preserves prepared business profile');
select is((select count(*) from private.merchant_items where merchant_id='14010000-0000-4000-8000-000000000001'),1::bigint,'operator revocation preserves private inventory');
select ok((select count(*)>=5 from private.merchant_connection_audit),'connection changes retain actor, method and scope audit records');
select ok(not has_table_privilege('authenticated','private.merchant_operators','select,insert,update,delete'),'membership table cannot be bypassed directly');
select ok(not has_function_privilege('anon','public.connect_admin_merchant_account(uuid,uuid,text,text,boolean,text,timestamp with time zone,text,text)','execute'),'anonymous cannot call the connection API');
select is(public.account_image_cleanup_paths('14000000-0000-4000-8000-000000000003','post-images',array['14000000-0000-4000-8000-000000000003/operated.webp']),'{}'::text[],'account cleanup retains referenced company photos');
select is((select owner_id from storage.objects where bucket_id='post-images' and name='14000000-0000-4000-8000-000000000003/operated.webp'),null::text,'retained assets no longer block uploader account deletion');
select is(public.account_image_cleanup_paths('14000000-0000-4000-8000-000000000003','merchant-profile-images',array['14000000-0000-4000-8000-000000000003/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000001.webp']),'{}'::text[],'account cleanup retains another owner company banner');
update public.profiles set account_status='deleted' where id='14000000-0000-4000-8000-000000000003';
select ok((select banner_path is not null from private.merchants where id='14010000-0000-4000-8000-000000000001'),'uploader account deletion preserves another owner company profile');
insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','14000000-0000-4000-8000-000000000001/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000002.webp','14000000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":100}');
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.save_my_merchant_profile('14010000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000002.webp','14000000-0000-4000-8000-000000000003/14010000-0000-4000-8000-000000000001_14080000-0000-4000-8000-000000000001.webp',(public.get_my_merchant_profile('14010000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz)$$,'owner retains a detached-ownership business image during later profile edits');
select throws_ok($$select public.account_image_cleanup_paths('14000000-0000-4000-8000-000000000003','post-images','{}')$$,'42501',null,'account cleanup RPC is service-only');
reset role;
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14090000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000004','owner','invite',true,'사업장 소유 초대 확인',(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000003')->>'updated_at')::timestamptz,'연결초대회원','invitee@example.invalid')$$,'admin can prepare another pending connection');
select is(public.set_admin_merchant_access('14000000-0000-4000-8000-000000000004',false),false,'NO access revokes old invitations too');
select is(jsonb_array_length(public.get_merchant_account_connections('14010000-0000-4000-8000-000000000003')->'invitations'),0,'NO leaves no pending invitation that can re-enable the account');
reset role;
select set_config('request.jwt.claims','{"sub":"14000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"merchant_enabled":true,"role":"admin"}}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_connections()->'merchants'),0,'forged stale YES metadata grants no business switch');
select throws_ok($$select public.connect_admin_merchant_account('14010000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000004','owner','direct',true,'위조 관리자 직접 연결',now(),'연결초대회원','invitee@example.invalid')$$,'P0001','ADMIN_REQUIRED','forged admin metadata cannot use direct connection');
reset role;
select * from finish();
rollback;
