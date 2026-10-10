begin;
set local search_path=public,extensions;
set local storage.allow_delete_query='true';
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
('14500000-0000-4000-8000-000000000001','convenience-owner@example.invalid','{"merchant_enabled":true}'),
('14500000-0000-4000-8000-000000000002','convenience-customer@example.invalid','{}'),
('14500000-0000-4000-8000-000000000003','convenience-publisher@example.invalid','{}'),
('14500000-0000-4000-8000-000000000004','convenience-operator@example.invalid','{"merchant_enabled":true}'),
('14500000-0000-4000-8000-000000000005','convenience-admin@example.invalid','{"role":"admin"}'),
('14500000-0000-4000-8000-000000000006','convenience-other@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('14500000-0000-4000-8000-000000000001','편의업체소유자','vancouver',now(),now(),now(),'test'),
('14500000-0000-4000-8000-000000000002','편의후기작성자','vancouver',now(),now(),now(),'test'),
('14500000-0000-4000-8000-000000000003','편의글링게시자','vancouver',now(),now(),now(),'test'),
('14500000-0000-4000-8000-000000000004','편의업체운영자','vancouver',now(),now(),now(),'test'),
('14500000-0000-4000-8000-000000000005','편의검사관리자','vancouver',now(),now(),now(),'test'),
('14500000-0000-4000-8000-000000000006','편의다른고객','vancouver',now(),now(),now(),'test');
insert into auth.sessions(id,user_id,aal) values
('14590000-0000-4000-8000-000000000002','14500000-0000-4000-8000-000000000002','aal1'),
('14590000-0000-4000-8000-000000000005','14500000-0000-4000-8000-000000000005','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at) values
('14510000-0000-4000-8000-000000000001','편의 검사 업체','vancouver','비공개 개인 연락 메모','paid','granted','비공개 허가 메모','14500000-0000-4000-8000-000000000001',now()),
('14510000-0000-4000-8000-000000000002','편의 담당 미연결 업체','vancouver','절대 공개할 수 없는 연락처','paid','granted','비공개 허가 메모',null,null);
insert into private.merchant_operators(merchant_id,user_id) values
('14510000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000004');
insert into public.posts(id,city_id,author_id,tag_id,title,body,status) values
('14520000-0000-4000-8000-000000000001','vancouver','14500000-0000-4000-8000-000000000003',1,'편의 소개 검사','실제 고객 자료가 아닌 검사 본문','published'),
('14520000-0000-4000-8000-000000000002','vancouver','14500000-0000-4000-8000-000000000003',1,'편의 미연결 소개 검사','실제 고객 자료가 아닌 검사 본문','published');
insert into private.merchant_posts(post_id,merchant_id,original_url) values
('14520000-0000-4000-8000-000000000001','14510000-0000-4000-8000-000000000001','https://example.invalid/source'),
('14520000-0000-4000-8000-000000000002','14510000-0000-4000-8000-000000000002',null);

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'public_phone','',
  'registered internal contact is never copied into the explicit public phone');
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'business_hours','',
  'business hours start empty rather than guessed');
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'can_message','true',
  'guest sees a real inquiry destination before the login prompt');
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'saved','false',
  'guest profile does not borrow an authenticated account save');
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->'source_urls'->>0,'https://example.invalid/source',
  'public profile retains the existing verified source URL');
select ok(not(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')::text like '%비공개%'),
  'public profile does not expose private registration or approval details');
reset role;

select ok(not has_table_privilege('authenticated','private.saved_merchants','SELECT,INSERT,UPDATE,DELETE'),
  'saved companies have no direct client table access');
select ok(not has_table_privilege('authenticated','private.merchant_review_replies','SELECT,INSERT,UPDATE,DELETE'),
  'reply table is private and RPC-only');
select ok(not has_function_privilege('anon','public.start_merchant_conversation(uuid)','EXECUTE'),
  'anonymous viewers cannot start inquiries');
select ok(not has_function_privilege('anon','public.reply_to_merchant_review(uuid,uuid,text,timestamptz)','EXECUTE'),
  'anonymous viewers cannot impersonate the company');
select ok(not has_function_privilege('authenticated','public.get_merchant_review_reply_safety_content(uuid)','EXECUTE'),
  'clients cannot read private reply monitoring content');
select ok(has_function_privilege('service_role','public.get_merchant_review_reply_safety_content(uuid)','EXECUTE'),
  'existing service worker can inspect replies');

select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'can_message','true',
  'current verified active company owner can receive an inquiry');
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000002')->>'can_message','false',
  'a visible company with no actual recipient has no message capability');
select throws_ok($$select public.start_merchant_conversation('14510000-0000-4000-8000-000000000002')$$,
  'P0001','MERCHANT_CONTACT_UNAVAILABLE','missing business recipient does not fall back to the post publisher');
select set_config('test.merchant_conversation',public.start_merchant_conversation('14510000-0000-4000-8000-000000000001')::text,true);
select is(public.start_merchant_conversation('14510000-0000-4000-8000-000000000001'),current_setting('test.merchant_conversation')::uuid,
  'an uncertain inquiry retry reuses the existing pending conversation');
select is(public.set_saved_merchant('14510000-0000-4000-8000-000000000001',true),true,'customer saves the actual company');
select is(public.set_saved_merchant('14510000-0000-4000-8000-000000000001',true),true,'duplicate save is idempotent');
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'saved','true','profile reports only this account save');
select is(public.get_saved_merchants()->'merchants'->0->>'id','14510000-0000-4000-8000-000000000001','saved list returns a public profile');
select is(public.get_saved_merchants()->>'has_more','false','one saved company has no next page');
select throws_ok($$select public.set_saved_merchant(null,true)$$,'P0001','INVALID_SAVED_MERCHANT','null company cannot be saved');
select throws_ok($$select public.set_saved_merchant('14510000-0000-4000-8000-000000000001',null)$$,'P0001','INVALID_SAVED_MERCHANT','null desired state is refused');
select throws_ok($$select public.get_saved_merchants(-1)$$,'P0001','INVALID_MERCHANT_OFFSET','saved offset must be nonnegative');
select throws_ok($$select public.get_saved_merchants(null)$$,'P0001','INVALID_MERCHANT_OFFSET','null offset does not disable pagination');
select throws_ok($$select public.get_saved_merchants(10001)$$,'P0001','INVALID_MERCHANT_OFFSET','offset cannot exceed the accepted ten-thousand bound');
select is(jsonb_array_length(public.get_saved_merchants(10000)->'merchants'),0,'accepted maximum offset remains valid and bounded');
reset role;
select is((select count(*) from public.conversations where id=current_setting('test.merchant_conversation')::uuid
  and '14500000-0000-4000-8000-000000000001'::uuid in(user_low_id,user_high_id)
  and '14500000-0000-4000-8000-000000000003'::uuid not in(user_low_id,user_high_id)),1::bigint,
  'the server resolves the owner, even when Gling published the introduction');
select is((select count(*) from private.saved_merchants where user_id='14500000-0000-4000-8000-000000000002'),1::bigint,
  'duplicate save preserves a single account/company row');
update private.merchants set owner_verified_at=null where id='14510000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'can_message','false','lost verification removes inquiry capability');
select throws_ok($$select public.start_merchant_conversation('14510000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_CONTACT_UNAVAILABLE',
  'current verification is checked before reusing a conversation');
reset role;
update private.merchants set owner_verified_at=now() where id='14510000-0000-4000-8000-000000000001';
update auth.users set raw_app_meta_data='{"merchant_enabled":false}' where id='14500000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.start_merchant_conversation('14510000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_CONTACT_UNAVAILABLE',
  'revoked current business capability blocks inquiries despite an existing chat');
reset role;
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='14500000-0000-4000-8000-000000000001';
insert into public.blocks(blocker_id,blocked_id) values('14500000-0000-4000-8000-000000000002','14500000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_merchant_profile('14510000-0000-4000-8000-000000000001')->>'can_message','false','owner block removes inquiry capability');
select throws_ok($$select public.start_merchant_conversation('14510000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_CONTACT_UNAVAILABLE','owner block is checked on inquiry retry');
reset role;
delete from public.blocks where blocker_id='14500000-0000-4000-8000-000000000002';
delete from public.reports where reporter_id='14500000-0000-4000-8000-000000000002' and target_type='user'
  and target_id='14500000-0000-4000-8000-000000000001';
update private.merchants set consent='revoked' where id='14510000-0000-4000-8000-000000000001';
set local role authenticated;
select is(jsonb_array_length(public.get_saved_merchants()->'merchants'),0,'withdrawn public consent excludes saved company');
select throws_ok($$select public.set_saved_merchant('14510000-0000-4000-8000-000000000001',true)$$,'P0001','MERCHANT_UNAVAILABLE','withdrawn company cannot be newly saved');
select is(public.set_saved_merchant('14510000-0000-4000-8000-000000000001',false),false,'withdrawn company can still be unsaved');
select is(public.set_saved_merchant('14510000-0000-4000-8000-000000000001',false),false,'duplicate cancellation is idempotent');
reset role;
update private.merchants set consent='granted' where id='14510000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.contact_before',public.get_my_merchant_profile('14510000-0000-4000-8000-000000000001')->>'updated_at',true);
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','tel:6045550101','',current_setting('test.contact_before')::timestamptz)$$,
  'P0001','INVALID_MERCHANT_CONTACT','public phone cannot contain a scheme');
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','6045550101#999','',current_setting('test.contact_before')::timestamptz)$$,
  'P0001','INVALID_MERCHANT_CONTACT','public phone cannot contain dialing controls');
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','123456','',current_setting('test.contact_before')::timestamptz)$$,
  'P0001','INVALID_MERCHANT_CONTACT','short phone is refused');
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','1234567890123456','',current_setting('test.contact_before')::timestamptz)$$,
  'P0001','INVALID_MERCHANT_CONTACT','more than fifteen digits is refused');
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','6045550101',repeat('가',501),current_setting('test.contact_before')::timestamptz)$$,
  'P0001','INVALID_MERCHANT_CONTACT','hours retain a bounded text contract');
select is(public.save_merchant_contact('14510000-0000-4000-8000-000000000001',' +1 (604) 555-0101 ',' 월–금 09:00–18:00 ',current_setting('test.contact_before')::timestamptz)->>'public_phone',
  '+1 (604) 555-0101','verified owner explicitly saves the public phone');
select is(public.get_my_merchant_profile('14510000-0000-4000-8000-000000000001')->>'business_hours','월–금 09:00–18:00','business hours are exactly the entered text');
select set_config('test.contact_saved',public.get_my_merchant_profile('14510000-0000-4000-8000-000000000001')->>'updated_at',true);
select lives_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','+1 (604) 555-0101','월–금 09:00–18:00',current_setting('test.contact_before')::timestamptz)$$,
  'uncertain exact contact retry succeeds even after revision advanced');
select is(public.get_my_merchant_profile('14510000-0000-4000-8000-000000000001')->>'updated_at',current_setting('test.contact_saved'),
  'unchanged retry leaves saved contact revision alone');
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','6045550102','다른 시간',current_setting('test.contact_before')::timestamptz)$$,
  'P0001','MERCHANT_PROFILE_CHANGED','changed content must use the current contact revision');
reset role;
select is((select contact from private.merchants where id='14510000-0000-4000-8000-000000000001'),'비공개 개인 연락 메모','public editor leaves private registration contact intact');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','+1 (604) 555-0101','토 10:00–16:00',current_setting('test.contact_saved')::timestamptz)$$,
  'currently connected verified content operator can save company contact');
reset role;
delete from private.merchant_operators where user_id='14500000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select public.save_merchant_contact('14510000-0000-4000-8000-000000000001','','',current_setting('test.contact_saved')::timestamptz)$$,
  'P0001','MERCHANT_ACCESS_REQUIRED','revoked operator cannot exploit a stale contact editor');
reset role;
insert into private.merchant_operators(merchant_id,user_id) values('14510000-0000-4000-8000-000000000001','14500000-0000-4000-8000-000000000004');

-- Twenty-one real visible profiles exercise page size, account isolation and hidden-row filtering.
insert into private.merchants(id,name,city_id,status,consent,consent_note)
select md5('merchant-conveniences-page-'||s)::uuid,'페이지 검사 '||s,'vancouver','paid','granted','테스트 허가' from generate_series(1,21)s;
insert into public.posts(id,city_id,author_id,tag_id,title,body)
select md5('merchant-conveniences-post-'||s)::uuid,'vancouver','14500000-0000-4000-8000-000000000003',1,'페이지 안내 '||s,'검사 본문' from generate_series(1,21)s;
insert into private.merchant_posts(merchant_id,post_id)
select md5('merchant-conveniences-page-'||s)::uuid,md5('merchant-conveniences-post-'||s)::uuid from generate_series(1,21)s;
insert into private.saved_merchants(user_id,merchant_id)
select '14500000-0000-4000-8000-000000000002',md5('merchant-conveniences-page-'||s)::uuid from generate_series(1,21)s;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_saved_merchants()->'merchants'),20,'saved company page is bounded at twenty');
select is(public.get_saved_merchants()->>'has_more','true','twenty-first visible company enables next page');
select is(jsonb_array_length(public.get_saved_merchants(20)->'merchants'),1,'second page carries the remaining company');
select is(public.get_saved_merchants(20)->>'has_more','false','last page has no phantom next page');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is(jsonb_array_length(public.get_saved_merchants()->'merchants'),0,'another account does not receive somebody else saved list');
reset role;
delete from private.saved_merchants where user_id='14500000-0000-4000-8000-000000000002';

insert into storage.objects(bucket_id,name,owner_id,metadata) values
('merchant-review-receipts','14500000-0000-4000-8000-000000000002/14540000-0000-4000-8000-000000000001.webp','14500000-0000-4000-8000-000000000002','{"mimetype":"image/webp","size":100}');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_notification_preferences()->>'merchant_reviews','true','review notification category defaults on');
select is(public.get_notification_preferences()->>'message_preview','false','merchant category leaves message preview default off');
select throws_ok($$select public.update_notification_preferences('{"merchant_reviews":"true"}')$$,'P0001','INVALID_PREFERENCES','review preference is a strict boolean');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated","session_id":"14590000-0000-4000-8000-000000000002"}',true);
select public.register_push_device('ExpoPushToken[merchantreviewfixture145]',auth.uid());
select public.update_notification_preferences('{"push_enabled":true}');
select set_config('test.usage',public.write_merchant_review('14520000-0000-4000-8000-000000000001',8,'비공개 이용 후기 내용')::text,true);
select set_config('test.employment',public.write_merchant_review('14520000-0000-4000-8000-000000000001',7,'비공개 재직 후기 내용',
  '14500000-0000-4000-8000-000000000002/14540000-0000-4000-8000-000000000001.webp','employment')::text,true);
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,'고객의 사칭 답변',null)$$,
  'P0001','MERCHANT_ACCOUNT_REQUIRED','customer cannot impersonate a company reply');
reset role;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.employment')::uuid,'재직 답변',null)$$,
  'P0001','MERCHANT_REVIEW_REPLY_UNAVAILABLE','employment reviews cannot receive a business reply');
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,repeat('가',301),null)$$,
  'P0001','INVALID_MERCHANT_REVIEW_REPLY','reply has a three-hundred-character bound');
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,U&'\200B',null)$$,
  'P0001','INVALID_MERCHANT_REVIEW_REPLY','an invisible zero-width reply is not meaningful content');
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,'너는 진짜 개새끼야',null)$$,
  'P0001','CONTENT_NOT_ALLOWED','business reply uses the existing hard content filter');
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,'답변 감사합니다','2000-01-01')$$,
  'P0001','MERCHANT_REVIEW_REPLY_CHANGED','a first reply requires null expected revision');
select set_config('test.reply_saved',public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,
  '의견 감사합니다. 안내를 개선하겠습니다.',null)->>'updated_at',true);
select is(public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,
  '의견 감사합니다. 안내를 개선하겠습니다.',null)->>'updated_at',current_setting('test.reply_saved'),'uncertain first reply retry preserves the saved revision');
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,'다른 답변',null)$$,
  'P0001','MERCHANT_REVIEW_REPLY_CHANGED','changed reply cannot overwrite an unknown saved revision');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_merchant_reviews('14510000-0000-4000-8000-000000000001')->'reviews'->0->'reply')k),
  array['body','created_at','updated_at']::text[],'company reply DTO exposes only body and timestamps');
select is(jsonb_array_length(public.get_my_merchant_reviews('14510000-0000-4000-8000-000000000001')->'reviews'),1,
  'unverified employment remains absent from company inbox');
reset role;
select is((select count(*) from public.safety_review_queue where target_type='merchant_review_reply' and target_id=current_setting('test.usage')::uuid),1::bigint,
  'first business reply enters existing asynchronous safety queue');
select is((select count(*) from public.notifications where user_id='14500000-0000-4000-8000-000000000002' and kind='merchant_review_reply'),1::bigint,
  'first reply and duplicate retry create exactly one author notification');
select is((select category from public.notifications where user_id='14500000-0000-4000-8000-000000000002' and kind='merchant_review_reply'),'merchant_reviews',
  'reply uses the existing queue with a dedicated review category');
select is((select count(*) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
  where n.user_id='14500000-0000-4000-8000-000000000002' and n.kind='merchant_review_reply'),1::bigint,
  'one eligible reply enters the existing opted-in push queue');
select ok((select private.push_notification_eligible(q.device_id,q.notification_id) from private.push_delivery_queue q
  join public.notifications n on n.id=q.notification_id where n.user_id='14500000-0000-4000-8000-000000000002' and n.kind='merchant_review_reply'),
  'reply push is eligible before consent or visibility changes');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.update_notification_preferences('{"merchant_reviews":false}');
reset role;
select ok(not(select private.push_notification_eligible(q.device_id,q.notification_id) from private.push_delivery_queue q
  join public.notifications n on n.id=q.notification_id where n.user_id='14500000-0000-4000-8000-000000000002' and n.kind='merchant_review_reply'),
  'current category withdrawal suppresses an already queued reply before sending');
set local role authenticated;
select public.update_notification_preferences('{"merchant_reviews":true}');
reset role;
update private.merchants set consent='revoked' where id='14510000-0000-4000-8000-000000000001';
select ok(not(select private.push_notification_eligible(q.device_id,q.notification_id) from private.push_delivery_queue q
  join public.notifications n on n.id=q.notification_id where n.user_id='14500000-0000-4000-8000-000000000002' and n.kind='merchant_review_reply'),
  'withdrawn public company visibility suppresses an already queued reply');
update private.merchants set consent='granted' where id='14510000-0000-4000-8000-000000000001';
update auth.sessions set not_after=now()-interval '1 second' where id='14590000-0000-4000-8000-000000000002';
select ok(not(select private.push_notification_eligible(q.device_id,q.notification_id) from private.push_delivery_queue q
  join public.notifications n on n.id=q.notification_id where n.user_id='14500000-0000-4000-8000-000000000002' and n.kind='merchant_review_reply'),
  'expired device session suppresses an already queued reply');
update auth.sessions set not_after=null where id='14590000-0000-4000-8000-000000000002';
set local role authenticated;
select public.update_notification_preferences('{"message_preview":true}');
reset role;
create temporary table merchant_reply_claim as select * from public.claim_push_notifications('send',100)
  where user_id='14500000-0000-4000-8000-000000000002';
select is((select category from merchant_reply_claim),'merchant_reviews','actual push claim retains the merchant review category');
select is((select body from merchant_reply_claim),'이용 후기에 업체 답변이 도착했습니다.',
  'enabling chat previews never exposes the private review or business reply at merchant push claim');
select is((select route from merchant_reply_claim),'/company/14510000-0000-4000-8000-000000000001?review=usage',
  'actual merchant push claim retains the safe company review route');
select public.complete_push_notification(id,lease_id,'retry',null,'ROLLBACK_TEST_ONLY') from merchant_reply_claim;
update private.push_delivery_queue set next_attempt_at=now() where notification_id in(select notification_id from merchant_reply_claim);
set local role authenticated;
select public.update_notification_preferences('{"merchant_reviews":false,"message_preview":false}');
reset role;
select is((select count(*) from public.claim_push_notifications('send',100) where user_id='14500000-0000-4000-8000-000000000002'),0::bigint,
  'actual send claim rechecks a merchant category withdrawal after its earlier lease');
set local role authenticated;
select public.update_notification_preferences('{"merchant_reviews":true}');
reset role;
select is((select route from public.notifications where user_id='14500000-0000-4000-8000-000000000002' and kind='merchant_review_reply'),
  '/company/14510000-0000-4000-8000-000000000001?review=usage','reply notification has a safe company review destination');
select ok(not exists(select 1 from public.notifications where user_id='14500000-0000-4000-8000-000000000002' and kind like 'merchant_review_%'
  and (body like '%비공개%' or body like '%개선%')),'notification contains no private review, proof or actual reply text');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'reviews'),0,'reply does not publish an unverified usage review');
select is(jsonb_array_length(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001',0,'employment')->'reviews'),0,'reply does not expose private employment proof or feedback');
reset role;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'my_review'->'reply'->>'body','의견 감사합니다. 안내를 개선하겠습니다.',
  'private usage author sees its own business reply');
select is(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001',0,'employment')->'my_review'->'reply','null'::jsonb,'employment has no reply field content');
select set_config('test.proof_revision',public.get_merchant_reviews('14520000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'updated_at',true);
reset role;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14590000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_merchant_review_receipt(current_setting('test.employment')::uuid,
  '14500000-0000-4000-8000-000000000002/14540000-0000-4000-8000-000000000001.webp',current_setting('test.proof_revision')::timestamptz,false,'재직 기간 확인 불가')$$,
  'authorized MFA admin rejects an actual immutable employment proof');
reset role;
select is((select count(*) from public.notifications where target_id=current_setting('test.employment')::uuid and kind='merchant_review_rejected'),1::bigint,
  'proof decision creates exactly one safe author notification');
select is((select route from public.notifications where target_id=current_setting('test.employment')::uuid and kind='merchant_review_rejected'),
  '/company/14510000-0000-4000-8000-000000000001?review=employment','proof result points to the correct company review kind');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001',0,'employment')->'my_review'->>'receipt_review_note','재직 기간 확인 불가',
  'rejected employment author can see the private explanation');
select public.write_merchant_review('14520000-0000-4000-8000-000000000001',8,'비공개 이용 후기 내용',
  '14500000-0000-4000-8000-000000000002/14540000-0000-4000-8000-000000000001.webp');
select set_config('test.usage_proof_revision',public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'my_review'->>'updated_at',true);
reset role;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14590000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_merchant_review_receipt(current_setting('test.usage')::uuid,
  '14500000-0000-4000-8000-000000000002/14540000-0000-4000-8000-000000000001.webp',current_setting('test.usage_proof_revision')::timestamptz,true,'이용 영수증 확인 완료')$$,
  'MFA approval emits the actual usage certification result');
select lives_ok($$select public.set_admin_merchant_review_receipt(current_setting('test.usage')::uuid,
  '14500000-0000-4000-8000-000000000002/14540000-0000-4000-8000-000000000001.webp',current_setting('test.usage_proof_revision')::timestamptz,true,'이용 영수증 확인 완료')$$,
  'repeat of the same saved certification decision does not emit twice');
reset role;
select is((select count(*) from public.notifications where target_id=current_setting('test.usage')::uuid and kind='merchant_review_verified'),1::bigint,
  'same proof approval generates one author notification');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_report('merchant_review_reply',current_setting('test.usage')::uuid,'other','이용 후기 업체 답변 검사 신고')$$,
  'private usage author can report the business reply through the existing report RPC');
select is(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'my_review'->'reply','null'::jsonb,'reported reply is hidden from reporter');
reset role;
select ok(not(select private.push_notification_eligible(q.device_id,q.notification_id) from private.push_delivery_queue q
  join public.notifications n on n.id=q.notification_id where n.user_id='14500000-0000-4000-8000-000000000002' and n.kind='merchant_review_reply'),
  'reporting a reply suppresses its pending push without exposing hidden content');
select is((select reported_user_id from public.reports where target_type='merchant_review_reply' and target_id=current_setting('test.usage')::uuid),
  '14500000-0000-4000-8000-000000000001'::uuid,'reply report attributes text to the business actor, never the customer');
select ok(not((select evidence from public.reports where target_type='merchant_review_reply' and target_id=current_setting('test.usage')::uuid)?'receipt_path'),
  'reply report snapshots no private proof paths');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14590000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_merchant_review_reply_content(current_setting('test.usage')::uuid)->>'authorId','14500000-0000-4000-8000-000000000001',
  'audited MFA admin inspection identifies the actual reply actor');
select lives_ok($$select public.moderate_report((select id from public.reports where target_type='merchant_review_reply' and target_id=current_setting('test.usage')::uuid),'hidden','검사 답변만 숨김')$$,
  'existing audited moderation hides the reply independently');
reset role;
select is((select status from private.merchant_reviews where id=current_setting('test.usage')::uuid),'published','reply moderation preserves the customer review');
select is((select status from private.merchant_review_replies where id=current_setting('test.usage')::uuid),'removed','reply moderation hides only the offending reply');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.usage')::uuid,
  '의견 감사합니다. 안내를 개선하겠습니다.',current_setting('test.reply_saved')::timestamptz)$$,'P0001','MERCHANT_REVIEW_REPLY_UNAVAILABLE',
  'idempotent retry cannot resurrect a moderated reply');
reset role;

-- A second usage author permits edit, monitoring, opt-out and deletion checks independently of moderation.
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select is(public.update_notification_preferences('{"merchant_reviews":false,"message_preview":true}')->>'message_preview','true',
  'review preference update preserves the independently selected chat preview');
select set_config('test.other_usage',public.write_merchant_review('14520000-0000-4000-8000-000000000001',9,'다른 고객 비공개 이용 후기')::text,true);
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) values
('merchant-review-receipts','14500000-0000-4000-8000-000000000006/14540000-0000-4000-8000-000000000006.webp','14500000-0000-4000-8000-000000000006','{"mimetype":"image/webp","size":100}');
set local role authenticated;
select public.write_merchant_review('14520000-0000-4000-8000-000000000001',9,'다른 고객 비공개 이용 후기',
  '14500000-0000-4000-8000-000000000006/14540000-0000-4000-8000-000000000006.webp');
select set_config('test.other_proof_revision',public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'my_review'->>'updated_at',true);
reset role;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14590000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.set_admin_merchant_review_receipt(current_setting('test.other_usage')::uuid,
  '14500000-0000-4000-8000-000000000006/14540000-0000-4000-8000-000000000006.webp',current_setting('test.other_proof_revision')::timestamptz,true,'이용 영수증 확인 완료')$$,
  'human approval remains required before a usage reply can be public');
reset role;
insert into private.watch_terms(term,category,severity,active) values('업체답변감시검사어','fraud','high',true) on conflict do nothing;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.other_reply_before',public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.other_usage')::uuid,'다른 답변',null)->>'updated_at',true);
select set_config('test.other_reply_after',public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.other_usage')::uuid,
  '업체답변감시검사어 답변',current_setting('test.other_reply_before')::timestamptz)->>'updated_at',true);
select isnt(current_setting('test.other_reply_after'),current_setting('test.other_reply_before'),'changed reply receives a fresh precise revision');
select throws_ok($$select public.reply_to_merchant_review('14510000-0000-4000-8000-000000000001',current_setting('test.other_usage')::uuid,'덮어쓰기 답변',current_setting('test.other_reply_before')::timestamptz)$$,
  'P0001','MERCHANT_REVIEW_REPLY_CHANGED','competing edit with old reply revision cannot overwrite the saved reply');
reset role;
select is((select count(*) from public.notifications where user_id='14500000-0000-4000-8000-000000000006'
  and target_id=current_setting('test.other_usage')::uuid and category='merchant_reviews'),0::bigint,
  'current review notification opt-out suppresses creation');
select is((select author_id from public.safety_alerts where target_type='merchant_review_reply' and target_id=current_setting('test.other_usage')::uuid),
  '14500000-0000-4000-8000-000000000004'::uuid,'keyword monitoring attributes company reply to its operator actor');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select entry->'reply'->>'body' from jsonb_array_elements(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'reviews')entry
  where entry->>'id'=current_setting('test.other_usage')),'업체답변감시검사어 답변',
  'verified public usage displays its eligible business reply');
select ok(not(public.get_merchant_reviews('14520000-0000-4000-8000-000000000001')->'reviews'->0?'receipt_path'),
  'verified public usage still exposes no proof path');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.get_merchant_review_reply_safety_content(current_setting('test.other_usage')::uuid)->>'body','업체답변감시검사어 답변',
  'existing safety service receives changed business text through its protected getter');
reset role;
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"14590000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.export_admin_safety_evidence((select id from public.safety_alerts where target_type='merchant_review_reply' and target_id=current_setting('test.other_usage')::uuid))->'content'->>'body',
  '업체답변감시검사어 답변','audited safety export includes the independently attributed reply');
reset role;
update public.profiles set account_status='deleted' where id='14500000-0000-4000-8000-000000000004';
select ok(exists(select 1 from private.merchant_review_replies where id=current_setting('test.other_usage')::uuid and status='removed' and body is null),
  'reply actor account deletion erases its private text and visibility');
select set_config('request.jwt.claims','{"sub":"14500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.set_saved_merchant('14510000-0000-4000-8000-000000000001',true);
reset role;
update public.profiles set account_status='deleted' where id='14500000-0000-4000-8000-000000000002';
select is((select count(*) from private.saved_merchants where user_id='14500000-0000-4000-8000-000000000002'),0::bigint,
  'soft account deletion erases private saved companies');
select ok(exists(select 1 from private.merchant_review_replies where id=current_setting('test.usage')::uuid and status='removed' and body is null),
  'review author account deletion also erases the attached private reply');
set local role authenticated;
select throws_ok($$select public.get_saved_merchants()$$,'P0001','ACCOUNT_LOCKED','deleted account cannot read saved companies');
select throws_ok($$select public.set_saved_merchant('14510000-0000-4000-8000-000000000001',true)$$,'P0001','ACCOUNT_LOCKED','deleted account cannot recreate saved companies');
reset role;

select * from finish();
rollback;
