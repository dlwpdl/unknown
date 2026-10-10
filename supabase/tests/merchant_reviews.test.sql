begin;
set local search_path=public,extensions;
select no_plan();
select has_table('private','merchant_reviews','merchant reviews have a private canonical table');
select has_function('public','get_merchant_reviews',array['uuid','integer'],'public review reader is installed');
select has_function('public','write_merchant_review',array['uuid','numeric','text','text'],'receipt-aware review writer is installed');

insert into auth.users(id,email,raw_app_meta_data) values
('13100000-0000-4000-8000-000000000001','review-post-author@example.invalid','{"merchant_enabled":true}'),
('13100000-0000-4000-8000-000000000002','review-member@example.invalid','{}'),
('13100000-0000-4000-8000-000000000003','review-other@example.invalid','{}'),
('13100000-0000-4000-8000-000000000004','review-admin@example.invalid','{"role":"admin"}'),
('13100000-0000-4000-8000-000000000005','review-inactive@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('13100000-0000-4000-8000-000000000001','후기글작성검사','vancouver',now(),now(),now(),'test'),
('13100000-0000-4000-8000-000000000002','후기회원검사','vancouver',now(),now(),now(),'test'),
('13100000-0000-4000-8000-000000000003','후기다른검사','vancouver',now(),now(),now(),'test'),
('13100000-0000-4000-8000-000000000004','후기관리검사','vancouver',now(),now(),now(),'test'),
('13100000-0000-4000-8000-000000000005','후기비활성검사','vancouver',now(),now(),now(),'test');
update public.profiles set account_status='suspended' where id='13100000-0000-4000-8000-000000000005';
insert into auth.sessions(id,user_id,aal) values
('13190000-0000-4000-8000-000000000004','13100000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,status,consent,consent_note) values
('13110000-0000-4000-8000-000000000001','후기 검증 업체 하나','vancouver','trial','granted','테스트 허가'),
('13110000-0000-4000-8000-000000000002','후기 검증 업체 둘','vancouver','paid','granted','테스트 허가'),
('13110000-0000-4000-8000-000000000003','중단 업체 검사','vancouver','trial','granted','테스트 허가'),
('13110000-0000-4000-8000-000000000004','철회 업체 검사','vancouver','trial','granted','테스트 철회');
update private.merchants set owner_id='13100000-0000-4000-8000-000000000001',owner_verified_at=now() where id='13110000-0000-4000-8000-000000000001';
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
('merchant-review-receipts','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp','13100000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":2000}'),
('merchant-review-receipts','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp','13100000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":2000}'),
('merchant-review-receipts','13100000-0000-4000-8000-000000000003/13140000-0000-4000-8000-000000000001.webp','13100000-0000-4000-8000-000000000003','13100000-0000-4000-8000-000000000003','{"mimetype":"image/webp","size":2000}'),
('merchant-review-receipts','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000004.webp','13100000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000002','{"mimetype":"image/png","size":2000}'),
('merchant-review-receipts','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000005.webp','13100000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":2097153}');
insert into public.posts(id,city_id,author_id,tag_id,title,body,status) values
('13120000-0000-4000-8000-000000000001','vancouver','13100000-0000-4000-8000-000000000001',1,'후기 업체 안내 하나','실제 업체 소개가 아닌 검사 본문 1','published'),
('13120000-0000-4000-8000-000000000002','vancouver','13100000-0000-4000-8000-000000000001',1,'같은 업체 두번째 글','실제 업체 소개가 아닌 검사 본문 2','published'),
('13120000-0000-4000-8000-000000000003','vancouver','13100000-0000-4000-8000-000000000001',1,'다른 업체 글','실제 업체 소개가 아닌 검사 본문 3','published'),
('13120000-0000-4000-8000-000000000004','vancouver','13100000-0000-4000-8000-000000000001',1,'비공개 검사 글','실제 업체 소개가 아닌 검사 본문 4','removed'),
('13120000-0000-4000-8000-000000000005','vancouver','13100000-0000-4000-8000-000000000001',1,'미등록 업체 글','실제 업체 소개가 아닌 검사 본문 5','published'),
('13120000-0000-4000-8000-000000000006','vancouver','13100000-0000-4000-8000-000000000001',1,'중단 업체 글','실제 업체 소개가 아닌 검사 본문 6','published'),
('13120000-0000-4000-8000-000000000007','vancouver','13100000-0000-4000-8000-000000000001',1,'철회 업체 글','실제 업체 소개가 아닌 검사 본문 7','published'),
('13120000-0000-4000-8000-000000000008','vancouver','13100000-0000-4000-8000-000000000005',1,'비활성 작성 글','실제 업체 소개가 아닌 검사 본문 8','published');
insert into private.merchant_posts(post_id,merchant_id,original_url) values
('13120000-0000-4000-8000-000000000001','13110000-0000-4000-8000-000000000001',null),
('13120000-0000-4000-8000-000000000002','13110000-0000-4000-8000-000000000001','https://example.com'),
('13120000-0000-4000-8000-000000000003','13110000-0000-4000-8000-000000000002','https://example.org'),
('13120000-0000-4000-8000-000000000004','13110000-0000-4000-8000-000000000001',null),
('13120000-0000-4000-8000-000000000006','13110000-0000-4000-8000-000000000003',null),
('13120000-0000-4000-8000-000000000007','13110000-0000-4000-8000-000000000004',null),
('13120000-0000-4000-8000-000000000008','13110000-0000-4000-8000-000000000001',null);

-- Link while operational, then retain the paused/revoked visibility tests.
update private.merchants set status='paused' where id='13110000-0000-4000-8000-000000000003';
update private.merchants set consent='revoked' where id='13110000-0000-4000-8000-000000000004';

select ok(not has_table_privilege('anon','private.merchant_reviews','SELECT')
  and not has_table_privilege('authenticated','private.merchant_reviews','SELECT,INSERT,UPDATE,DELETE'),
  'private reviews cannot be read or changed directly');
select ok((select relrowsecurity from pg_class where oid='private.merchant_reviews'::regclass),'reviews retain RLS');
select is((select atttypmod from pg_attribute where attrelid='private.merchant_reviews'::regclass and attname='score'),-1,'numeric has no rounding scale');
select ok(not has_function_privilege('anon','public.write_merchant_review(uuid,numeric,text,text)','EXECUTE'),'guest cannot execute writer');
select is((select public from storage.buckets where id='merchant-review-receipts'),false,'receipt bucket has no public delivery');
select ok(not has_function_privilege('authenticated','public.get_merchant_review_safety_content(uuid)','EXECUTE'),'client cannot execute service safety getter');
select ok(has_function_privilege('service_role','public.get_merchant_review_safety_content(uuid)','EXECUTE'),'service worker can execute safety getter');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'merchant_name','후기 검증 업체 하나','native linked post supports reviews without an external URL');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'can_review','false','guest cannot review');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'rating_average',null::text,'empty mean is null');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000004'),null::jsonb,'removed post does not expose reviews');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000005'),null::jsonb,'unlinked post does not expose reviews');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000006'),null::jsonb,'paused merchant is unavailable');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000007'),null::jsonb,'revoked merchant is unavailable');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000008'),null::jsonb,'inactive post author is unavailable');
select throws_ok($$select public.get_merchant_reviews('13120000-0000-4000-8000-000000000001',-1)$$,'P0001','INVALID_REVIEW_OFFSET','negative offset rejected');
select throws_ok($$select public.get_merchant_reviews('13120000-0000-4000-8000-000000000001',null)$$,'P0001','INVALID_REVIEW_OFFSET','null offset rejected');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,null)$$,'42501',null,'guest writer denied');
reset role;

select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'can_review','true','regular active account can review without business capability or purchase proof');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000005',8,null)$$,'P0001','MERCHANT_REVIEW_UNAVAILABLE','unlinked target cannot create a review');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',null,null)$$,'P0001','INVALID_REVIEW_SCORE','null score rejected');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',0.5,null)$$,'P0001','INVALID_REVIEW_SCORE','score below one rejected');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',10.5,null)$$,'P0001','INVALID_REVIEW_SCORE','score above ten rejected');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.51,null)$$,'P0001','INVALID_REVIEW_SCORE','precision is not rounded to an accepted step');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001','NaN'::numeric,null)$$,'P0001','INVALID_REVIEW_SCORE','NaN rejected');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001','Infinity'::numeric,null)$$,'P0001','INVALID_REVIEW_SCORE','infinity rejected');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,repeat('가',301))$$,'P0001','INVALID_REVIEW_BODY','301 Unicode characters rejected');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,repeat('가',300))$$,'300 Unicode characters accepted');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000002',8,repeat('가',300))$$,'same company cross-post retry succeeds');
reset role;
select is((select count(*) from private.merchant_reviews where merchant_id='13110000-0000-4000-8000-000000000001'),1::bigint,'cross-post requests produce only one canonical row');
select is((select count(*) from private.action_rate_events where user_id='13100000-0000-4000-8000-000000000002' and action in ('merchant_review_new','merchant_review_edit')),1::bigint,'exact retry does not consume a rate event');
create temporary table review_identity as select id,created_at from private.merchant_reviews where author_id='13100000-0000-4000-8000-000000000002';
grant select on review_identity to authenticated,service_role;
alter table private.merchant_reviews disable trigger merchant_reviews_updated_at;
update private.merchant_reviews set updated_at=now()-interval '1 minute' where author_id='13100000-0000-4000-8000-000000000002';
alter table private.merchant_reviews enable trigger merchant_reviews_updated_at;
update public.safety_review_queue set status='reviewed',attempts=1 where target_type='merchant_review' and target_id=(select id from review_identity);
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,repeat('가',300))$$,'uncertain saved request can be retried without edit');
reset role;
select is((select updated_at from private.merchant_reviews where id=(select id from review_identity)),now()-interval '1 minute','same content retry preserves timestamp');
select is((select status from public.safety_review_queue where target_type='merchant_review' and target_id=(select id from review_identity)),'reviewed','same retry does not requeue AI');
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000002',7.5,'  수정 후기  ')$$,'own review edits the same company item');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'body','수정 후기','body is normalized for saved retries');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000002')->'my_review'->>'status','published','own state carries status');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000003',10,null)$$,'different company has an independent score-only review');
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,0,'unverified review is absent from public count');
select is(jsonb_array_length(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'reviews'),0,'unverified review body is absent from public rows');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'receipt_status','none','author retains own unverified state');
select throws_ok($$select public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','regular author cannot read merchant-private feedback');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','https://evil.example/receipt.webp')$$,'P0001','INVALID_REVIEW_RECEIPT','external receipt URL refused');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000003/13140000-0000-4000-8000-000000000001.webp')$$,'P0001','INVALID_REVIEW_RECEIPT','another author receipt refused');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000099.webp')$$,'P0001','INVALID_REVIEW_RECEIPT','missing own receipt refused');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000004.webp')$$,'P0001','INVALID_REVIEW_RECEIPT','mismatched receipt MIME refused');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000005.webp')$$,'P0001','INVALID_REVIEW_RECEIPT','oversized receipt refused');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp')$$,'own immutable upload enters pending verification');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'receipt_status','pending','upload does not self-verify');
select throws_ok($$select public.set_admin_merchant_review_receipt((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'id')::uuid,'13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp',now(),true,'셀프 인증')$$,'P0001','ADMIN_REQUIRED','author cannot self-certify');
reset role;
select is((select id from private.merchant_reviews where merchant_id='13110000-0000-4000-8000-000000000001' and author_id='13100000-0000-4000-8000-000000000002'),(select id from review_identity),'edit preserves row UUID');
select is((select created_at from private.merchant_reviews where id=(select id from review_identity)),(select created_at from review_identity),'edit preserves creation time');
select is((select status from public.safety_review_queue where target_type='merchant_review' and target_id=(select id from review_identity)),'pending','changed review requeues AI');
select ok(exists(select 1 from public.safety_review_queue q join private.merchant_reviews r on r.id=q.target_id where q.target_type='merchant_review' and r.merchant_id='13110000-0000-4000-8000-000000000002' and r.body is null),'score-only review enters safety queue');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,score) values('13110000-0000-4000-8000-000000000001','13100000-0000-4000-8000-000000000003',7.51)$$,'23514',null,'direct writes also reject fractional scores');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,score) values('13110000-0000-4000-8000-000000000001','13100000-0000-4000-8000-000000000003',0)$$,'23514',null,'direct score range constraint');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,score,body) values('13110000-0000-4000-8000-000000000001','13100000-0000-4000-8000-000000000003',8,repeat('가',301))$$,'23514',null,'direct body bound constraint');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,score,body) values('13110000-0000-4000-8000-000000000001','13100000-0000-4000-8000-000000000003',8,' '||repeat('가',300))$$,'23514',null,'stored body bound counts whitespace too');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,score) values('13110000-0000-4000-8000-000000000001','13100000-0000-4000-8000-000000000002',8)$$,'23505',null,'unique company-account prevents duplicates independently of RPC');

-- Every exact half-step also reaches the writer. Rate fixtures are cleared between
-- validation cases; the rate boundary itself is asserted separately below.
select lives_ok(format('do $case$ begin delete from private.action_rate_events where user_id=%L::uuid and action=%L; perform public.write_merchant_review(%L::uuid,%s,null); end $case$',
  '13100000-0000-4000-8000-000000000002','merchant_review_edit','13120000-0000-4000-8000-000000000001',step),'writer accepts exact score '||step::text)
from generate_series(1::numeric,10::numeric,0.5::numeric) step;

select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into private.action_rate_events(user_id,action) select '13100000-0000-4000-8000-000000000003'::uuid,'merchant_review_new' from generate_series(1,20);
set local role authenticated;
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',9.5,'다른 회원 후기')$$,'P0001','RATE_LIMITED','new company reviews have a bounded daily server budget');
reset role;
delete from private.action_rate_events where user_id='13100000-0000-4000-8000-000000000003' and action='merchant_review_new';
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',9.5,'다른 회원 후기')$$,'another account creates one review');
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,0,'other unverified content remains private');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',9.5,'다른 회원 후기','13100000-0000-4000-8000-000000000003/13140000-0000-4000-8000-000000000001.webp')$$,'second author uploads own proof');
select throws_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','비공개 경로 추측')$$,'P0001','TARGET_NOT_FOUND','unverified review cannot be discovered through report RPC');
reset role;
-- Isolate the scoring validation loop above from the mean assertion.
update private.merchant_reviews set score=7.5,body='수정 후기' where id=(select id from review_identity);
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000001')->'reviews'),2,'actual enabled verified owner can read private feedback');
select ok(position('receipt_path' in public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000001')::text)=0,'merchant does not receive private receipt paths');
select throws_ok($$select public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000002')$$,'P0001','MERCHANT_ACCESS_REQUIRED','other business is isolated');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts'),0::bigint,'merchant owner cannot read customer receipt photos');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":false}' where id='13100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"merchant_enabled":true}}',true);
set local role authenticated;
select throws_ok($$select public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_ACCOUNT_REQUIRED','current NO immediately revokes private owner read despite stale YES JWT');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='13100000-0000-4000-8000-000000000001';
update private.merchants set owner_verified_at=null where id='13110000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_OWNER_VERIFICATION_REQUIRED','unverified claimant cannot read private feedback');
reset role;
update private.merchants set owner_verified_at=now() where id='13110000-0000-4000-8000-000000000001';
-- The merchant inbox already exposes private feedback to its genuine owner.
-- That same owner must be able to report it without making the review public.
update private.merchants set owner_verified_at=null where id='13110000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','권한 검사')$$,'P0001','TARGET_NOT_FOUND','unverified merchant claimant cannot report private feedback');
reset role;
update private.merchants set owner_verified_at=now(),owner_id='13100000-0000-4000-8000-000000000003' where id='13110000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','권한 검사')$$,'P0001','TARGET_NOT_FOUND','former merchant owner cannot report private feedback');
reset role;
update private.merchants set owner_id='13100000-0000-4000-8000-000000000001' where id='13110000-0000-4000-8000-000000000001';
update auth.users set raw_app_meta_data='{"merchant_enabled":false}' where id='13100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','권한 검사')$$,'P0001','TARGET_NOT_FOUND','current NO denies private review reports despite stale YES JWT');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='13100000-0000-4000-8000-000000000001';
update public.profiles set account_status='suspended' where id='13100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','권한 검사')$$,'P0001','ACCOUNT_LOCKED','inactive merchant owner cannot report');
reset role;
update public.profiles set account_status='active' where id='13100000-0000-4000-8000-000000000001';
update private.merchants set owner_id='13100000-0000-4000-8000-000000000003',owner_verified_at=now() where id='13110000-0000-4000-8000-000000000002';
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='13100000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','타업체 권한 검사')$$,'P0001','TARGET_NOT_FOUND','another genuine merchant owner cannot report private feedback');
reset role;
update auth.users set raw_app_meta_data='{}' where id='13100000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.create_report('merchant_review','13130000-0000-4000-8000-000000000001','other','익명 검사')$$,'42501',null,'anonymous report access is denied');
reset role;
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_report('merchant_review',(select id from review_identity),'other','업체 비공개 의견 신고 검사')$$,'actual enabled verified owner can report private feedback');
select is(jsonb_array_length(public.get_my_merchant_reviews('13110000-0000-4000-8000-000000000001')->'reviews'),1,'reported private review is hidden from its merchant reporter');
reset role;
select is((select evidence->>'body' from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000001'),'수정 후기','private owner report captures authorized feedback');
select ok(not ((select evidence from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000001') ? 'receipt_path'),'private owner report never reveals customer receipt path');
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13190000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_admin_merchant_receipt_reviews()->'reviews'),2,'manual pending inbox discovers low-risk receipts without a report');
select lives_ok($$select public.set_admin_merchant_review_receipt((select (r->>'id')::uuid from jsonb_array_elements(public.get_admin_merchant_receipt_reviews()->'reviews') r where r->>'authorId'='13100000-0000-4000-8000-000000000002'),'13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp',now(),true,'모의 영수증 확인')$$,'MFA admin certifies exact submitted receipt');
select lives_ok($$select public.set_admin_merchant_review_receipt((select (r->>'id')::uuid from jsonb_array_elements(public.get_admin_merchant_receipt_reviews()->'reviews') r where r->>'authorId'='13100000-0000-4000-8000-000000000003'),'13100000-0000-4000-8000-000000000003/13140000-0000-4000-8000-000000000001.webp',now(),true,'모의 영수증 확인')$$,'second actual receipt is verified separately');
reset role;
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,2,'only independently verified reviews contribute');
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000002')->>'rating_average')::numeric,8.5::numeric,'mean uses canonical company scores');
select ok(not (public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')::text like '%example.invalid%'),'public reader reveals no email or merchant contact');
select ok(position('receipt_path' in (public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'reviews')::text)=0,'verified public rows do not expose receipt paths');
reset role;

-- Receipt replacement is a new manual decision, never inherited certification.
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts' and name='13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp'),1::bigint,'author can authorize own private signed image');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts' and name like '13100000-0000-4000-8000-000000000003/%'),0::bigint,'author cannot authorize another customer receipt');
with changed as (update storage.objects set metadata='{"mimetype":"image/webp","size":3}' where bucket_id='merchant-review-receipts' and name='13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp' returning id)
select is((select count(*) from changed),0::bigint,'receipt overwrite denied even to author');
select is(private.can_delete_merchant_review_receipt('13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp'),false,'saved or uncertain-bound receipt cannot be removed');
select is(private.can_delete_merchant_review_receipt('13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp'),true,'unused own upload can be cleaned');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-review-receipts','13100000-0000-4000-8000-000000000003/13140000-0000-4000-8000-000000000009.webp','13100000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":20}')$$,'42501',null,'receipt upload cannot choose another account folder');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp')$$,'author replaces immutable receipt binding');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'receipt_status','pending','replacement clears prior certification');
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,1,'pending replacement is withdrawn from public summary');
reset role;
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13190000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from review_identity),'13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000001.webp',now(),true,'오래된 사진')$$,'P0001','MERCHANT_REVIEW_CHANGED','stale original photo cannot certify a replaced receipt');
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from review_identity),'13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp',now()-interval '1 second',true,'오래된 수정시각')$$,'P0001','MERCHANT_REVIEW_CHANGED','stale reviewed revision is rejected');
select lives_ok($$select public.set_admin_merchant_review_receipt((select id from review_identity),'13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp',now(),false,'영수증 확인 불가')$$,'admin can reject with retained review context');
reset role;
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'receipt_status','rejected','author sees truthful rejected state');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','')$$,'explicit empty path removes receipt binding');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'receipt_status','none','removed receipt cannot retain certification');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기','13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp')$$,'receipt can be submitted for a new decision');
reset role;
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13190000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_merchant_review_receipt((select id from review_identity),'13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp',now(),true,'새 사진 수동 검증')$$,'new receipt is independently verified');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts' and name='13100000-0000-4000-8000-000000000002/13140000-0000-4000-8000-000000000003.webp'),1::bigint,'actual MFA admin can authorize linked receipt preview');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='13100000-0000-4000-8000-000000000004' and scope='evidence' and resource_id=(select id from review_identity)),'admin receipt image authorization is audited');
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,'점수 수정')$$,'author may edit feedback while keeping the same certified visit proof');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'receipt_status','verified','unchanged immutable receipt keeps certification after score/body edit');
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7.5,'수정 후기')$$,'restore scoring fixture through real writer');
reset role;
insert into private.action_rate_events(user_id,action) select '13100000-0000-4000-8000-000000000002'::uuid,'merchant_review_edit' from generate_series(1,10);
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000002',7.5,'수정 후기')$$,'exact saved retry succeeds even after rate budget is exhausted');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',7,'새 수정')$$,'P0001','RATE_LIMITED','changed edit is bounded by a real server rate limit');
select throws_ok($$select public.get_admin_merchant_review_content((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'my_review'->>'id')::uuid)$$,'P0001','ADMIN_REQUIRED','regular user cannot read admin content');
select throws_ok($$select * from private.merchant_reviews$$,'42501',null,'direct client table read denied');
reset role;
delete from private.action_rate_events where user_id='13100000-0000-4000-8000-000000000002' and action='merchant_review_edit';

select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'can_review','false','locked account cannot review');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,null)$$,'P0001','ACCOUNT_LOCKED','locked account refused by writer');
reset role;

-- Personal reporting hides precisely that review from count, mean and list; its
-- original version remains available to audited admins after later author edits.
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_report('merchant_review',(select (r->>'id')::uuid from jsonb_array_elements(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'reviews') r where r->>'author_id'='13100000-0000-4000-8000-000000000002'),'other','테스트 신고')$$,'review report is supported');
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,1,'reported review excluded from count');
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'rating_average')::numeric,9.5::numeric,'reported review excluded from mean');
select is(jsonb_array_length(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->'reviews'),1,'reported review excluded from list');
reset role;
select is((select evidence->>'body' from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000003'),'수정 후기','report retains captured review body');
select is((select evidence->>'score' from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000003'),'7.5','report retains score');
select is((select evidence->>'merchant_name' from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000003'),'후기 검증 업체 하나','report retains company context');
select ok(not ((select evidence from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000003') ? 'receipt_path'),'reporter evidence cannot reveal private receipt path');
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,'신고 뒤 수정')$$,'author may edit published review without altering saved report evidence');
reset role;
select is((select evidence->>'body' from public.reports where target_type='merchant_review' and reporter_id='13100000-0000-4000-8000-000000000003'),'수정 후기','saved evidence survives subsequent edit');
insert into private.watch_terms(term,category,severity,active) values('후기감시검사어','fraud','high',true) on conflict do nothing;
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000001',8,'후기감시검사어 포함')$$,'watch-term review is accepted for existing human review pipeline');
reset role;
select ok(exists(select 1 from public.safety_alerts where target_type='merchant_review' and target_id=(select id from review_identity)),'keyword review raises the proper target alert');
select ok(exists(select 1 from public.notifications where target_type='merchant_review' and target_id=(select id from review_identity) and user_id='13100000-0000-4000-8000-000000000004'),'keyword/report signal notifies admins');

select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1","session_id":"13190000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_merchant_review_content((select target_id from public.reports where target_type='merchant_review' limit 1))$$,'P0001','ADMIN_REQUIRED','AAL1 admin cannot read private reviews');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts'),0::bigint,'AAL1 admin cannot authorize private receipt photos');
select throws_ok($$select public.get_admin_merchant_receipt_reviews()$$,'P0001','ADMIN_REQUIRED','AAL1 cannot read the manual receipt inbox');
reset role;
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13190000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_merchant_review_content((select target_id from public.reports where target_type='merchant_review' limit 1))->>'authorId','13100000-0000-4000-8000-000000000002','real MFA admin can read author context');
select ok((public.get_admin_merchant_review_content((select target_id from public.reports where target_type='merchant_review' limit 1))->>'text') like '%후기감시검사어%','admin content includes saved score/body');
select is(public.export_admin_safety_evidence((select id from public.safety_alerts where target_type='merchant_review' and author_id='13100000-0000-4000-8000-000000000002'))->'content'->>'body','후기감시검사어 포함','audited safety export resolves the private review');
select lives_ok($$select public.moderate_report((select id from public.reports where target_type='merchant_review' limit 1),'hidden','모의 숨김')$$,'admin moderation hides review through existing report action');
reset role;
select is((select status from private.merchant_reviews where id=(select id from review_identity)),'removed','hidden review has durable removed status');
select is((select count(*) from public.admin_access_logs where actor_id='13100000-0000-4000-8000-000000000004' and resource_id=(select id from review_identity) and scope='safety'),2::bigint,'every admin content getter read is audited');
select ok(exists(select 1 from public.admin_access_logs where actor_id='13100000-0000-4000-8000-000000000004' and scope='evidence' and resource_id=(select id from review_identity)),'evidence export is audited');
select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000002')->'my_review'->>'status','removed','author sees own removed status');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'can_review','false','removed review cannot be rewritten');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000002',8,'후기감시검사어 포함')$$,'P0001','MERCHANT_REVIEW_REMOVED','removed exact retry cannot restore review');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,1,'globally hidden review excluded for guests');
reset role;
update public.profiles set account_status='suspended' where id='13100000-0000-4000-8000-000000000003';
set local role anon;
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,0,'inactive review author excluded');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'rating_average',null::text,'mean also excludes inactive author');
reset role;
update public.profiles set account_status='active' where id='13100000-0000-4000-8000-000000000003';

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.get_merchant_review_safety_content((select id from review_identity))->>'authorId','13100000-0000-4000-8000-000000000002','service safety getter resolves review author');
select ok((public.get_merchant_review_safety_content((select id from review_identity))->>'text') like '%8/10%','service text includes numeric score even with no prose');
select is(public.get_merchant_review_safety_content('13130000-0000-4000-8000-000000000099'),null::jsonb,'missing safety target returns null');
reset role;

select set_config('request.jwt.claims','{"sub":"13100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into public.blocks(blocker_id,blocked_id) values('13100000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000003');
set local role authenticated;
select is((public.get_merchant_reviews('13120000-0000-4000-8000-000000000001')->>'review_count')::integer,0,'blocked review author excluded from reader');
reset role;
delete from public.blocks where blocker_id='13100000-0000-4000-8000-000000000002' and blocked_id='13100000-0000-4000-8000-000000000003';
insert into public.blocks(blocker_id,blocked_id) values('13100000-0000-4000-8000-000000000002','13100000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000001'),null::jsonb,'blocked intro author makes relationship unavailable');
select throws_ok($$select public.write_merchant_review('13120000-0000-4000-8000-000000000003',9,null)$$,'P0001','MERCHANT_REVIEW_UNAVAILABLE','blocked intro cannot be used to write');
reset role;

-- Pagination and scoring use real independent account rows, never customer data.
insert into auth.users(id,email,raw_app_meta_data)
select ('13100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'review-page-'||n||'@example.invalid','{}'::jsonb from generate_series(20,40) n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select ('13100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'후기쪽검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(20,40) n;
insert into private.merchant_reviews(merchant_id,author_id,score,created_at,receipt_path,receipt_status,receipt_reviewed_at,receipt_reviewed_by)
select '13110000-0000-4000-8000-000000000002'::uuid,('13100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1+mod(n-20,19)*0.5,now()+(n||' seconds')::interval,
  '13100000-0000-4000-8000-'||lpad(n::text,12,'0')||'/13140000-0000-4000-8000-000000000001.webp','verified',now(),'13100000-0000-4000-8000-000000000004'::uuid from generate_series(20,40) n;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.get_merchant_reviews('13120000-0000-4000-8000-000000000003')->'reviews'),20,'page returns at most twenty reviews');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000003')->>'has_more','true','first page accurately exposes remainder');
select is(jsonb_array_length(public.get_merchant_reviews('13120000-0000-4000-8000-000000000003',20)->'reviews'),1,'second page returns exact remainder excluding unverified score-only review');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000003',20)->>'has_more','false','last page has no remainder');
select is(public.get_merchant_reviews('13120000-0000-4000-8000-000000000003')->'reviews'->0->>'author_id','13100000-0000-4000-8000-000000000040','newest creation is first with stable ordering');
reset role;
update public.profiles set account_status='deleted' where id='13100000-0000-4000-8000-000000000002';
select ok(not exists(select 1 from private.merchant_reviews where author_id='13100000-0000-4000-8000-000000000002'
  and (body is not null or receipt_path is not null or status<>'removed')),'account deletion erases private feedback and receipt references');
select * from finish();
rollback;
