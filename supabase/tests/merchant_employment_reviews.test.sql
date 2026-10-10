begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
('13700000-0000-4000-8000-000000000001','work-owner@example.invalid','{"merchant_enabled":true}'),
('13700000-0000-4000-8000-000000000002','work-member@example.invalid','{}'),
('13700000-0000-4000-8000-000000000003','work-other-owner@example.invalid','{"merchant_enabled":true}'),
('13700000-0000-4000-8000-000000000004','work-admin@example.invalid','{"role":"admin"}'),
('13700000-0000-4000-8000-000000000005','work-inactive@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('13700000-0000-4000-8000-000000000001','근무업체소유검사','vancouver',now(),now(),now(),'test'),
('13700000-0000-4000-8000-000000000002','근무회원검사','vancouver',now(),now(),now(),'test'),
('13700000-0000-4000-8000-000000000003','근무다른소유검사','vancouver',now(),now(),now(),'test'),
('13700000-0000-4000-8000-000000000004','근무관리자검사','vancouver',now(),now(),now(),'test'),
('13700000-0000-4000-8000-000000000005','근무비활성검사','vancouver',now(),now(),now(),'test');
update public.profiles set account_status='suspended' where id='13700000-0000-4000-8000-000000000005';
insert into auth.sessions(id,user_id,aal) values('13790000-0000-4000-8000-000000000004','13700000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,status,consent,consent_note,owner_id,owner_verified_at) values
('13710000-0000-4000-8000-000000000001','근무 검사 업체','vancouver','trial','granted','검사 승인','13700000-0000-4000-8000-000000000001',now()),
('13710000-0000-4000-8000-000000000002','근무 다른 업체','vancouver','paid','granted','검사 승인','13700000-0000-4000-8000-000000000003',now());
insert into public.posts(id,city_id,author_id,tag_id,title,body,status) values
('13720000-0000-4000-8000-000000000001','vancouver','13700000-0000-4000-8000-000000000001',1,'근무 업체 소개','실제 업체 소개가 아닌 검사 본문 1','published'),
('13720000-0000-4000-8000-000000000002','vancouver','13700000-0000-4000-8000-000000000001',1,'근무 동일 업체 소개','실제 업체 소개가 아닌 검사 본문 2','published'),
('13720000-0000-4000-8000-000000000003','vancouver','13700000-0000-4000-8000-000000000003',1,'근무 다른 업체 소개','실제 업체 소개가 아닌 검사 본문 3','published');
insert into private.merchant_posts(post_id,merchant_id,original_url) values
('13720000-0000-4000-8000-000000000001','13710000-0000-4000-8000-000000000001',null),
('13720000-0000-4000-8000-000000000002','13710000-0000-4000-8000-000000000001',null),
('13720000-0000-4000-8000-000000000003','13710000-0000-4000-8000-000000000002',null);
insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values
('merchant-review-receipts','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp','13700000-0000-4000-8000-000000000002','13700000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":2000}'),
('merchant-review-receipts','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp','13700000-0000-4000-8000-000000000002','13700000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":2000}'),
('merchant-review-receipts','13700000-0000-4000-8000-000000000003/13740000-0000-4000-8000-000000000001.webp','13700000-0000-4000-8000-000000000003','13700000-0000-4000-8000-000000000003','{"mimetype":"image/webp","size":2000}');

select has_column('private','merchant_reviews','review_kind','review kind is stored on the existing private review');
select has_function('public','get_merchant_reviews',array['uuid','integer','text'],'kind-specific public getter is installed');
select has_function('public','write_merchant_review',array['uuid','numeric','text','text','text'],'kind-specific writer is installed');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select lives_ok($$do $check$ begin
  if public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'review_kind' is distinct from 'employment' then raise exception 'wrong review kind'; end if;
end $check$;$$,'anonymous employment page is labeled without exposing pending content');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'can_review','false','legacy usage getter denies actual owning-company reviewers');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',8,null,null)$$,'P0001','MERCHANT_OWNER_REVIEW_FORBIDDEN','legacy usage writer denies owning-company review');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',8,null,null,'employment')$$,'P0001','MERCHANT_OWNER_REVIEW_FORBIDDEN','employment writer denies owning-company review');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$do $check$ declare usage_id uuid; work_id uuid; begin
  usage_id:=public.write_merchant_review('13720000-0000-4000-8000-000000000001',8,'기존 이용 후기',null);
  work_id:=public.write_merchant_review('13720000-0000-4000-8000-000000000002',4,null,null,'employment');
  if usage_id is null or work_id is null or usage_id=work_id then raise exception 'review kinds were mixed'; end if;
end $check$;$$,'one account keeps independent usage and employment rows across canonical company posts');
reset role;

create temporary table work_review_ids as select id,review_kind,created_at,updated_at from private.merchant_reviews
  where merchant_id='13710000-0000-4000-8000-000000000001' and author_id='13700000-0000-4000-8000-000000000002';
grant select on work_review_ids to authenticated,service_role;
select is((select count(*) from work_review_ids),2::bigint,'canonical company has exactly one review per kind for the account');
select ok(not has_table_privilege('authenticated','private.merchant_reviews','SELECT,INSERT,UPDATE,DELETE'),'client cannot set review kind or certify proofs directly');
select ok(not has_function_privilege('anon','public.write_merchant_review(uuid,numeric,text,text,text)','EXECUTE'),'anonymous cannot execute employment writer');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'review_kind','usage','old read overload defaults to usage');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'review_count')::integer,0,'unverified score-only employment is not public');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review','null'::jsonb,'anonymous has no private employment state');
select throws_ok(format($query$select public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,%L)$query$,kind),'P0001','INVALID_REVIEW_KIND','invalid reader kind is rejected: '||coalesce(kind,'NULL'))
from(values(null::text),('work'),('Employment'),(' employment '),(''))v(kind);
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,null,null,'employment')$$,'42501',null,'anonymous employment write denied');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts'),0::bigint,'proof photos never have anonymous signing access');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format($query$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,null,null,%L)$query$,kind),'P0001','INVALID_REVIEW_KIND','invalid writer kind is rejected: '||coalesce(kind,'NULL'))
from(values(null::text),('work'),('Employment'),(' employment '),(''))v(kind);
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000002')->'my_review'->>'review_kind','usage','legacy author state stays usage');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000002',0,'employment')->'my_review'->>'review_kind','employment','author receives only requested-kind private state');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000002',0,'employment')->'my_review'->>'score','4','employment score cannot be overwritten by usage state');
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000002',4,null,null,'employment')$$,'exact cross-post employment retry keeps its canonical item');
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',8,'기존 이용 후기','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp')$$,'usage proof binding retains the legacy writer contract');
reset role;
select is((select count(*) from private.merchant_reviews where merchant_id='13710000-0000-4000-8000-000000000001'),2::bigint,'cross-post retry does not duplicate either kind');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,review_kind,score) values('13710000-0000-4000-8000-000000000001','13700000-0000-4000-8000-000000000002','employment',5)$$,'23505',null,'unique constraint rejects same employment account-company duplicate');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,score) values('13710000-0000-4000-8000-000000000001','13700000-0000-4000-8000-000000000002',5)$$,'23505',null,'default usage uniqueness remains intact');
select throws_ok($$insert into private.merchant_reviews(merchant_id,author_id,review_kind,score) values('13710000-0000-4000-8000-000000000001','13700000-0000-4000-8000-000000000003','work',5)$$,'23514',null,'stored kind constraint rejects unsupported values');
select ok(exists(select 1 from public.safety_review_queue where target_type='merchant_review' and target_id=(select id from work_review_ids where review_kind='employment')),'score-only unverified employment enters existing safety queue');

select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_merchant_review_content((select id from work_review_ids where review_kind='employment'))->>'reviewKind','employment','audited admin source labels score-only employment correctly');
select ok(public.get_admin_merchant_review_content((select id from work_review_ids where review_kind='employment'))->>'text' like '%근무 후기%','safety text gives employment context without proof bytes');
select throws_ok(format($query$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='usage'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now(),true,%L)$query$,note),'P0001','INVALID_RECEIPT_REVIEW',label)
from(values(null::text,'NULL verification note rejected'),('   ','empty trimmed note rejected'),('확인','short verification note rejected'),(E'\t확인\n','trimmed Unicode note minimum is enforced'),(repeat(chr(65279),5),'invisible Unicode whitespace cannot be a verification memo'),(repeat('가',1001),'oversized verification note rejected'))v(note,label);
select lives_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='usage'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now(),true,'  검증 확인  ')$$,'five-character trimmed usage note allows manual approval');
reset role;
select is((select receipt_review_note from private.merchant_reviews where id=(select id from work_review_ids where review_kind='usage')),'검증 확인','audit note is stored after trimming');

select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무 비공개 의견','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp','employment')$$,'employment can submit own proof without inheriting usage approval of the same image');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_status','pending','submitted employment proof remains pending');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_path','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp','author alone receives own pending proof binding');
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now(),true,'셀프 인증함')$$,'P0001','ADMIN_REQUIRED','employment author cannot self-certify a proof');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,null,'https://evil.example/proof.webp','employment')$$,'P0001','INVALID_REVIEW_RECEIPT','employment refuses an external proof URL');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,null,'13700000-0000-4000-8000-000000000003/13740000-0000-4000-8000-000000000001.webp','employment')$$,'P0001','INVALID_REVIEW_RECEIPT','employment cannot use another account proof');
select is(private.can_delete_merchant_review_receipt('13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp'),false,'either review kind binding protects shared proof from cleanup');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_reviews('13710000-0000-4000-8000-000000000001')->'reviews'),1,'owner inbox excludes pending employment from rows and count');
select is(public.get_my_merchant_reviews('13710000-0000-4000-8000-000000000001')->'reviews'->0->>'review_kind','usage','owner inbox labels retained usage feedback');
select ok(position('근무 비공개 의견' in public.get_my_merchant_reviews('13710000-0000-4000-8000-000000000001')::text)=0,'pending employment text cannot leak to the company owner');
select throws_ok($$select public.create_report('merchant_review',(select id from work_review_ids where review_kind='employment'),'other','비공개 근무 신고 추측')$$,'P0001','TARGET_NOT_FOUND','owner cannot discover pending employment through report evidence');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts'),0::bigint,'owner cannot sign either customer proof kind');
reset role;
select is((select count(*) from public.reports where reporter_id='13700000-0000-4000-8000-000000000001' and target_id=(select id from work_review_ids where review_kind='employment')),0::bigint,'denied private employment report leaves no captured evidence');
delete from public.reports where reporter_id='13700000-0000-4000-8000-000000000001';
delete from private.action_rate_events where user_id='13700000-0000-4000-8000-000000000001' and action='report';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'rating_average')::numeric,8::numeric,'usage average remains independent of employment');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'rating_average',null::text,'pending employment has no public average');
select is(jsonb_array_length(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'reviews'),0,'pending employment body and author are not public');
reset role;

select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1","session_id":"13790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_merchant_receipt_reviews()$$,'P0001','ADMIN_REQUIRED','AAL1 cannot discover employment proofs in admin queue');
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now(),true,'검증 확인')$$,'P0001','ADMIN_REQUIRED','AAL1 cannot approve employment proof');
select is((select count(*) from storage.objects where bucket_id='merchant-review-receipts'),0::bigint,'AAL1 cannot sign private employment proof');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_merchant_receipt_reviews()->'reviews'->0->>'reviewKind','employment','existing pending queue discovers employment with an explicit purpose');
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now()-interval '1 second',true,'검증 확인')$$,'P0001','MERCHANT_REVIEW_CHANGED','stale reviewed employment revision cannot be approved');
select lives_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now(),true,repeat('가',1000))$$,'actual MFA admin may manually approve exact work proof with a bounded note');
select is(public.get_admin_merchant_review_content((select id from work_review_ids where review_kind='employment'))->>'receiptStatus','verified','admin readback confirms work proof verification');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='13700000-0000-4000-8000-000000000004' and resource_id=(select id from work_review_ids where review_kind='employment') and scope='evidence'),'employment manual decision has an evidence audit');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000002',0,'employment')->>'rating_average')::numeric,4::numeric,'public employment mean contains only verified employment');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000002',0,'employment')->'reviews'->0->>'review_kind','employment','public full employment row carries its kind');
select ok(position('receipt_path' in public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')::text)=0,'public verified employment never includes its proof image path');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'rating_average')::numeric,8::numeric,'employment approval leaves the legacy usage average unchanged');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_reviews('13710000-0000-4000-8000-000000000001')->'reviews'),2,'owner may read verified employment alongside usage feedback');
select ok(position('receipt_path' in public.get_my_merchant_reviews('13710000-0000-4000-8000-000000000001')::text)=0,'verified owner employment view still excludes all proof paths');
reset role;

-- Every permitted half step passes the authenticated employment writer. These
-- independent accounts keep the real per-account rate limits enabled.
insert into auth.users(id,email,raw_app_meta_data)
select ('13750000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'work-step-'||n||'@example.invalid','{}'::jsonb from generate_series(1,19)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select ('13750000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'근무반칸검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,19)n;
set local role authenticated;
select lives_ok(format($query$do $check$ begin
  perform set_config('request.jwt.claims',%L,true);
  perform public.write_merchant_review('13720000-0000-4000-8000-000000000003',%s,null,null,'employment');
  if (public.get_merchant_reviews('13720000-0000-4000-8000-000000000003',0,'employment')->'my_review'->>'score')::numeric<>%s then raise exception 'score was rounded'; end if;
end $check$;$query$,jsonb_build_object('sub','13750000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated')::text,1+(n-1)*0.5,1+(n-1)*0.5),'employment half step '||(1+(n-1)*0.5)::text)
from generate_series(1,19)n;
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format($query$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',%s,null,null,'employment')$query$,score),'P0001','INVALID_REVIEW_SCORE','employment rejects score '||score)
from(values('null'),('0.5'),('10.5'),('7.51'),('''NaN''::numeric'),('''Infinity''::numeric'))v(score);
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,repeat('가',301),null,'employment')$$,'P0001','INVALID_REVIEW_BODY','employment body retains Unicode maximum');
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무 비공개 의견','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp','employment')$$,'replacing work proof changes its binding through the real writer');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_status','pending','replacement never inherits employment certification');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'id')::uuid,(select id from work_review_ids where review_kind='employment'),'proof replacement preserves review identity');
reset role;
select is((select created_at from private.merchant_reviews where id=(select id from work_review_ids where review_kind='employment')),(select created_at from work_review_ids where review_kind='employment'),'proof replacement preserves original creation time');
select ok((select receipt_reviewed_at is null and receipt_reviewed_by is null and receipt_review_note is null from private.merchant_reviews where id=(select id from work_review_ids where review_kind='employment')),'replacement clears the prior admin decision');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'review_count')::integer,0,'replacement immediately removes work from public count');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'review_count')::integer,1,'replacement leaves independent usage certification public');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp',now(),true,'원래 증빙 검토')$$,'P0001','MERCHANT_REVIEW_CHANGED','admin cannot certify a previously replaced work image');
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp',now()-interval '1 second',true,'새 증빙 검토')$$,'P0001','MERCHANT_REVIEW_CHANGED','replacement path alone cannot bypass revision check');
select throws_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp',now(),false,'불가')$$,'P0001','INVALID_RECEIPT_REVIEW','rejection requires a meaningful bounded memo too');
select lives_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp',now(),false,'근무 증빙 확인 불가')$$,'admin may reject an actual replaced work proof');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_merchant_reviews('13710000-0000-4000-8000-000000000001')->'reviews'),1,'rejected employment remains invisible to the company owner');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_status','rejected','author can understand a rejected proof without publication');
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무 비공개 의견','','employment')$$,'explicit empty path removes employment proof');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_status','none','removed work proof clears certification');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_path',null::text,'removed work proof clears its private binding');
select is(private.can_delete_merchant_review_receipt('13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000001.webp'),false,'usage binding still protects a proof after work removal');
select is(private.can_delete_merchant_review_receipt('13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp'),true,'unbound own replacement is eligible for existing cleanup');
with changed as(update storage.objects set metadata='{"mimetype":"image/webp","size":1}' where bucket_id='merchant-review-receipts' and name='13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp' returning id)
select is((select count(*) from changed),0::bigint,'a proof object remains immutable even while unbound');
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무 비공개 의견','13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp','employment')$$,'author may resubmit a retained immutable work proof');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_merchant_review_receipt((select id from work_review_ids where review_kind='employment'),'13700000-0000-4000-8000-000000000002/13740000-0000-4000-8000-000000000002.webp',now(),true,'새 근무 증빙 확인')$$,'resubmitted work proof requires a fresh human decision');
reset role;

-- Exhausted budget must still permit an uncertain retry without side effects.
alter table private.merchant_reviews disable trigger merchant_reviews_updated_at;
update private.merchant_reviews set updated_at=now()-interval '1 minute' where id=(select id from work_review_ids where review_kind='employment');
alter table private.merchant_reviews enable trigger merchant_reviews_updated_at;
update public.safety_review_queue set status='reviewed',attempts=1 where target_type='merchant_review' and target_id=(select id from work_review_ids where review_kind='employment');
delete from private.action_rate_events where user_id='13700000-0000-4000-8000-000000000002' and action='merchant_review_edit';
insert into private.action_rate_events(user_id,action) select '13700000-0000-4000-8000-000000000002'::uuid,'merchant_review_edit' from generate_series(1,10);
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.write_merchant_review('13720000-0000-4000-8000-000000000002',4,'근무 비공개 의견',null,'employment'),(select id from work_review_ids where review_kind='employment'),'exact work retry succeeds with an exhausted shared edit budget');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4.5,'새 근무 의견',null,'employment')$$,'P0001','RATE_LIMITED','changed work feedback consumes the real bounded edit budget');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',8.5,'새 이용 의견')$$,'P0001','RATE_LIMITED','usage cannot bypass the same account budget after employment edits');
reset role;
select is((select updated_at from private.merchant_reviews where id=(select id from work_review_ids where review_kind='employment')),now()-interval '1 minute','exact work retry does not mutate revision');
select is((select status from public.safety_review_queue where target_type='merchant_review' and target_id=(select id from work_review_ids where review_kind='employment')),'reviewed','exact work retry does not requeue safety');
select is((select count(*) from private.action_rate_events where user_id='13700000-0000-4000-8000-000000000002' and action='merchant_review_edit'),10::bigint,'exact retry and refused edits add no rate event');
delete from private.action_rate_events where user_id='13700000-0000-4000-8000-000000000002' and action='merchant_review_edit';
update private.merchants set owner_id='13700000-0000-4000-8000-000000000002' where id='13710000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'can_review','false','ownership change disables review eligibility even without a merchant role flag');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무 비공개 의견',null,'employment')$$,'P0001','MERCHANT_OWNER_REVIEW_FORBIDDEN','ownership change is checked before exact retry');
reset role;
update private.merchants set owner_id='13700000-0000-4000-8000-000000000001' where id='13710000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'can_review','false','inactive account is ineligible for work feedback');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,null,null,'employment')$$,'P0001','ACCOUNT_LOCKED','inactive account cannot submit employment feedback');
reset role;
update public.profiles set account_status='suspended' where id='13700000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'review_count')::integer,0,'public work count excludes an inactive verified author');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'rating_average',null::text,'public work mean excludes the same inactive author');
reset role;
update public.profiles set account_status='active' where id='13700000-0000-4000-8000-000000000002';

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.get_merchant_review_safety_content((select id from work_review_ids where review_kind='employment'))->>'reviewKind','employment','existing service-only safety getter preserves work context');
select ok(public.get_merchant_review_safety_content((select id from work_review_ids where review_kind='employment'))->>'text' like '%근무 후기%','safety worker receives explicit employment text');
reset role;
select ok(not has_function_privilege('authenticated','public.get_merchant_review_safety_content(uuid)','EXECUTE'),'client cannot use service evidence scope for private work');
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into public.blocks(blocker_id,blocked_id) values('13700000-0000-4000-8000-000000000003','13700000-0000-4000-8000-000000000002');
set local role authenticated;
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'review_count')::integer,0,'blocked employment author is excluded from count');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'rating_average',null::text,'blocked employment author is excluded from mean');
select is(jsonb_array_length(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'reviews'),0,'blocked employment author is excluded from rows');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'review_count')::integer,0,'blocking an account consistently covers both review kinds');
reset role;
delete from public.blocks where blocker_id='13700000-0000-4000-8000-000000000003' and blocked_id='13700000-0000-4000-8000-000000000002';
delete from public.reports where reporter_id='13700000-0000-4000-8000-000000000003' and target_type='user' and target_id='13700000-0000-4000-8000-000000000002';
delete from private.action_rate_events where user_id='13700000-0000-4000-8000-000000000003' and action='report';
set local role authenticated;
select lives_ok($$select public.create_report('merchant_review',(select id from work_review_ids where review_kind='employment'),'other','공개 근무 후기 신고')$$,'a verified public work review can be reported');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'review_count')::integer,0,'reported work is excluded from reporter count');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'rating_average',null::text,'reported work is excluded from reporter mean');
select is(jsonb_array_length(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'reviews'),0,'reported work is excluded from reporter rows');
select is((public.get_merchant_reviews('13720000-0000-4000-8000-000000000001')->>'review_count')::integer,1,'reporting one kind does not hide the other kind');
reset role;
select is((select evidence->>'review_kind' from public.reports where target_id=(select id from work_review_ids where review_kind='employment')),'employment','saved report evidence preserves its review purpose');
select ok(not((select evidence from public.reports where target_id=(select id from work_review_ids where review_kind='employment'))?'receipt_path'),'report evidence excludes private work proof path');
insert into private.watch_terms(term,category,severity,active) values('근무감시검사어','fraud','high',true) on conflict do nothing;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무감시검사어 포함',null,'employment')$$,'employment uses the established keyword monitoring path');
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_status','verified','editing feedback preserves the same certified immutable work evidence');
reset role;
select ok(exists(select 1 from public.safety_alerts where target_type='merchant_review' and target_id=(select id from work_review_ids where review_kind='employment')),'work keyword creates the correct safety target');
select is((select evidence->>'body' from public.reports where target_id=(select id from work_review_ids where review_kind='employment')),'근무 비공개 의견','work report evidence is immutable after author edit');
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"13790000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.export_admin_safety_evidence((select id from public.safety_alerts where target_type='merchant_review' and target_id=(select id from work_review_ids where review_kind='employment')))->'content'->>'review_kind','employment','audited safety export keeps work context');
select lives_ok($$select public.moderate_report((select id from public.reports where target_id=(select id from work_review_ids where review_kind='employment')),'hidden','근무 후기 모의 숨김')$$,'existing admin moderation removes reported employment');
reset role;
select set_config('request.jwt.claims','{"sub":"13700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('13720000-0000-4000-8000-000000000001',0,'employment')->>'can_review','false','removed employment cannot be rewritten');
select throws_ok($$select public.write_merchant_review('13720000-0000-4000-8000-000000000001',4,'근무감시검사어 포함',null,'employment')$$,'P0001','MERCHANT_REVIEW_REMOVED','even exact retry cannot resurrect removed employment');
reset role;
update public.profiles set account_status='deleted' where id='13700000-0000-4000-8000-000000000002';
select is((select count(*) from private.merchant_reviews where author_id='13700000-0000-4000-8000-000000000002'),2::bigint,'account erasure retains only the two removed review identities');
select ok(not exists(select 1 from private.merchant_reviews where author_id='13700000-0000-4000-8000-000000000002' and (body is not null or receipt_path is not null or status<>'removed')),'existing account erasure removes body and proof references across both kinds');

select * from finish();
rollback;
