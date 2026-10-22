begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('vendor-delete-test','삭제검사','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('15900000-0000-0000-0000-000000000001','vendor-delete-admin@example.test','{"role":"admin"}'),
 ('15900000-0000-0000-0000-000000000002','vendor-delete-reader@example.test','{}');
insert into auth.sessions(id,user_id,aal) values('15960000-0000-0000-0000-000000000001','15900000-0000-0000-0000-000000000001','aal2');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
 ('15900000-0000-0000-0000-000000000001','삭제관리검사','vendor-delete-test',now(),now(),now(),'test'),
 ('15900000-0000-0000-0000-000000000002','삭제회원검사','vendor-delete-test',now(),now(),now(),'test');
insert into private.merchants(id,name,city_id,status,consent,consent_note,owner_id,owner_verified_at,updated_at,record_kind) values
 ('15920000-0000-0000-0000-000000000001','삭제검사 업체 1','vendor-delete-test','trial','granted','게시 허락 기록','15900000-0000-0000-0000-000000000002',now(),'2026-10-11T00:00:00Z','business'),
 ('15920000-0000-0000-0000-000000000002','삭제검사 업체 2','vendor-delete-test','trial','granted','게시 허락 기록',null,null,'2026-10-11T00:00:00Z','business'),
 ('15920000-0000-0000-0000-000000000003','삭제검사 수정 충돌','vendor-delete-test','trial','granted','게시 허락 기록',null,null,'2026-10-11T00:00:00Z','business'),
 ('15920000-0000-0000-0000-000000000004','삭제검사 게시 확인','vendor-delete-test','trial','granted','게시 허락 기록',null,null,'2026-10-11T00:00:00Z','business');
create temp table vendor_delete_reviewed as select id,jsonb_build_object('id',id,'updated_at',updated_at) snapshot from private.merchants where city_id='vendor-delete-test';
grant select on vendor_delete_reviewed to authenticated,anon;
insert into public.posts(id,author_id,city_id,tag_id,title,body,status) values
 ('15910000-0000-0000-0000-000000000001','15900000-0000-0000-0000-000000000002','vendor-delete-test',(select id from public.tags where slug='life'),'보존할 소개 글','업체를 삭제해도 글은 보존합니다.','published');
insert into private.merchant_posts(post_id,merchant_id,original_url) values
 ('15910000-0000-0000-0000-000000000001','15920000-0000-0000-0000-000000000001','https://example.com/vendor');
insert into private.merchant_account_invitations(merchant_id,user_id,role,merchant_snapshot,note,created_by) values
 ('15920000-0000-0000-0000-000000000002','15900000-0000-0000-0000-000000000002','owner','{}','삭제 전 연결 초대','15900000-0000-0000-0000-000000000001');
insert into private.merchant_naver_requests(id,merchant_id,user_id,draft_revision,board_url,club_id,menu_id,connection_generation,snapshot,status) values
 ('15970000-0000-0000-0000-000000000001','15920000-0000-0000-0000-000000000004','15900000-0000-0000-0000-000000000002',now(),'https://cafe.naver.com/test','1','1',gen_random_uuid(),'{}','uncertain');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.delete_admin_merchants('[]')$$,'42501',null,'anonymous callers have no deletion grant');
reset role;
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed))$$,'P0001','ADMIN_REQUIRED','a forged admin claim cannot delete vendors');
reset role;
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"15960000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed))$$,'P0001','ADMIN_REQUIRED','admin deletion requires MFA');
reset role;
select set_config('request.jwt.claims','{"sub":"15900000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"15960000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.delete_admin_merchants(null)$$,'P0001','INVALID_MERCHANT_SELECTION','null selection rejected');
select throws_ok($$select public.delete_admin_merchants('{}')$$,'P0001','INVALID_MERCHANT_SELECTION','selection must be an array');
select throws_ok($$select public.delete_admin_merchants('[]')$$,'P0001','INVALID_MERCHANT_SELECTION','empty selection rejected');
select throws_ok($$select public.delete_admin_merchants('[{}]')$$,'P0001','INVALID_MERCHANT_SELECTION','missing identity and timestamp rejected');
select throws_ok($$select public.delete_admin_merchants('[null]')$$,'P0001','INVALID_MERCHANT_SELECTION','non-object selection rejected');
select throws_ok($$select public.delete_admin_merchants('[{"id":"bad-id","updated_at":"bad-time"}]')$$,'P0001','INVALID_MERCHANT_SELECTION','malformed identity rejected');
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed where id='15920000-0000-0000-0000-000000000001')||(select jsonb_agg(snapshot) from vendor_delete_reviewed where id='15920000-0000-0000-0000-000000000001'))$$,'P0001','INVALID_MERCHANT_SELECTION','duplicate vendors rejected');
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(r.snapshot) from vendor_delete_reviewed r cross join generate_series(1,51) where r.id='15920000-0000-0000-0000-000000000001'))$$,'P0001','INVALID_MERCHANT_SELECTION','one page bounds each mutation');
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed where id='15920000-0000-0000-0000-000000000001')||'[{"id":"15929999-0000-0000-0000-000000000001","updated_at":"2026-10-11T00:00:00Z"}]')$$,'P0001','MERCHANT_SELECTION_CHANGED','missing vendor prevents partial deletion');
reset role;
update private.merchants set name='관리자가 먼저 수정한 업체',updated_at=clock_timestamp() where id='15920000-0000-0000-0000-000000000003';
set local role authenticated;
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed where id in ('15920000-0000-0000-0000-000000000001','15920000-0000-0000-0000-000000000003')))$$,'P0001','MERCHANT_SELECTION_CHANGED','a newer edit prevents deletion of the entire selection');
select throws_ok($$select public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed where id='15920000-0000-0000-0000-000000000004'))$$,'P0001','MERCHANT_PUBLISHING_IN_PROGRESS','unresolved external submissions are protected');
reset role;
select is((select count(*) from private.merchants where city_id='vendor-delete-test' and deleted_at is not null),0::bigint,'failed requests archived no vendor');
set local role authenticated;
select lives_ok($$select public.save_admin_merchant_report('15940000-0000-0000-0000-000000000001','15920000-0000-0000-0000-000000000001',(now() at time zone 'America/Vancouver')::date,(now() at time zone 'America/Vancouver')::date,'보존할 보고서','운영 기록','후속 운영','month',null,'세금 별도')$$,'create a saved history fixture');
select is(public.delete_admin_merchants((select jsonb_agg(snapshot) from vendor_delete_reviewed where id in ('15920000-0000-0000-0000-000000000001','15920000-0000-0000-0000-000000000002'))),2,'selected vendors deleted together');
select is(jsonb_array_length(public.get_admin_merchants('삭제검사')->'merchants'),1,'deleted vendors disappear from searched admin lists');
select ok(not exists(select 1 from jsonb_array_elements(public.get_my_merchants()) m where m->>'id' in ('15920000-0000-0000-0000-000000000001','15920000-0000-0000-0000-000000000002')),'deleted vendors disappear from workspace choices');
select throws_ok($$select public.get_admin_merchant('15920000-0000-0000-0000-000000000001',current_date,current_date)$$,'P0001','MERCHANT_NOT_FOUND','deleted details cannot be edited');
select throws_ok($$select public.save_admin_merchant('15920000-0000-0000-0000-000000000001','복원 시도','vendor-delete-test','','trial','granted','기존 창의 수정 내용')$$,'P0001','MERCHANT_NOT_FOUND','a stale editor cannot resurrect a deleted vendor');
select throws_ok($$select public.get_merchant_workspace('15920000-0000-0000-0000-000000000001')$$,'P0001','MERCHANT_ACCESS_REQUIRED','deleted vendor tools reject existing accounts');
select lives_ok($$select public.save_admin_merchant_record('business','15920000-0000-0000-0000-000000000005','삭제검사 업체 1','vendor-delete-test','','lead','pending','')$$,'an archived name can be reused by a new active vendor');
reset role;
select is((select count(*) from private.merchants where deleted_by='15900000-0000-0000-0000-000000000001' and city_id='vendor-delete-test'),2::bigint,'deleting admin attribution retained');
select is((select count(*) from public.posts where id='15910000-0000-0000-0000-000000000001' and status='published'),1::bigint,'published content preserved');
select is((select count(*) from private.merchant_posts where merchant_id='15920000-0000-0000-0000-000000000001'),1::bigint,'post relationship history preserved');
select is((select count(*) from private.merchant_reports where id='15940000-0000-0000-0000-000000000001'),1::bigint,'saved reporting history preserved');
select is((select count(*) from public.profiles where id='15900000-0000-0000-0000-000000000002' and account_status='active'),1::bigint,'member account preserved');
select is((select owner_id from private.merchants where id='15920000-0000-0000-0000-000000000001'),'15900000-0000-0000-0000-000000000002'::uuid,'owner relationship history preserved');
select ok(exists(select 1 from private.merchant_account_invitations where merchant_id='15920000-0000-0000-0000-000000000002' and revoked_at is not null),'pending invitations become inactive');
select ok(exists(select 1 from public.admin_access_logs where actor_id='15900000-0000-0000-0000-000000000001' and scope='analytics'),'admin mutation audited');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('15920000-0000-0000-0000-000000000001'),null::jsonb,'public vendor profile unavailable after deletion');
select is(public.get_merchant_post_source('15910000-0000-0000-0000-000000000001'),null::jsonb,'deleted vendor promotion link unavailable');
reset role;
select * from finish();
rollback;
