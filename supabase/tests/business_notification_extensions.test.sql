begin;
set local search_path=public,extensions;
set local storage.allow_delete_query='true';
select no_plan();
update private.trending_config set enabled=true,quiet_start_hour=0,quiet_end_hour=0 where id;

insert into auth.users(id,email,raw_app_meta_data) values
('15200000-0000-4000-8000-000000000001','convenience-owner@example.invalid','{"merchant_enabled":true}'),
('15200000-0000-4000-8000-000000000002','convenience-customer@example.invalid','{}'),
('15200000-0000-4000-8000-000000000003','convenience-publisher@example.invalid','{}'),
('15200000-0000-4000-8000-000000000004','convenience-operator@example.invalid','{"merchant_enabled":true}'),
('15200000-0000-4000-8000-000000000005','convenience-admin@example.invalid','{"role":"admin"}'),
('15200000-0000-4000-8000-000000000006','convenience-other@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
('15200000-0000-4000-8000-000000000001','편의업체소유자','vancouver',now(),now(),now(),'test'),
('15200000-0000-4000-8000-000000000002','편의후기작성자','vancouver',now(),now(),now(),'test'),
('15200000-0000-4000-8000-000000000003','편의글링게시자','vancouver',now(),now(),now(),'test'),
('15200000-0000-4000-8000-000000000004','편의업체운영자','vancouver',now(),now(),now(),'test'),
('15200000-0000-4000-8000-000000000005','편의검사관리자','vancouver',now(),now(),now(),'test'),
('15200000-0000-4000-8000-000000000006','편의다른고객','vancouver',now(),now(),now(),'test');
insert into auth.sessions(id,user_id,aal) values
('15290000-0000-4000-8000-000000000002','15200000-0000-4000-8000-000000000002','aal1'),
('15290000-0000-4000-8000-000000000005','15200000-0000-4000-8000-000000000005','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at) values
('15210000-0000-4000-8000-000000000001','편의 검사 업체','vancouver','비공개 개인 연락 메모','paid','granted','비공개 허가 메모','15200000-0000-4000-8000-000000000001',now()),
('15210000-0000-4000-8000-000000000002','편의 담당 미연결 업체','vancouver','절대 공개할 수 없는 연락처','paid','granted','비공개 허가 메모',null,null);
insert into private.merchant_operators(merchant_id,user_id) values
('15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000004');
insert into public.posts(id,city_id,author_id,tag_id,title,body,status) values
('15220000-0000-4000-8000-000000000001','vancouver','15200000-0000-4000-8000-000000000003',1,'편의 소개 검사','실제 고객 자료가 아닌 검사 본문','published'),
('15220000-0000-4000-8000-000000000002','vancouver','15200000-0000-4000-8000-000000000003',1,'편의 미연결 소개 검사','실제 고객 자료가 아닌 검사 본문','published');
insert into private.merchant_posts(post_id,merchant_id,original_url) values
('15220000-0000-4000-8000-000000000001','15210000-0000-4000-8000-000000000001','https://example.invalid/source'),
('15220000-0000-4000-8000-000000000002','15210000-0000-4000-8000-000000000002',null);


select ok(to_regprocedure('public.set_saved_merchant_notifications(uuid,boolean)') is not null,'explicit business opt-in RPC exists');
select ok(to_regprocedure('public.mark_merchant_naver_connection_unusable(uuid,uuid,uuid)') is not null,'trusted generation-bound connection failure RPC exists');

select is((select pg_get_userbyid(proowner)::text from pg_proc where oid='private.notification_target_visible(uuid,text,uuid)'::regprocedure),'postgres','patched visibility executes as trusted owner able to call private helpers');
select set_config('request.jwt.claims','{"sub":"15200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select ok(not has_function_privilege('anon','public.set_saved_merchant_notifications(uuid,boolean)','EXECUTE'),'anonymous users cannot change business opt-in');
select is(public.set_saved_merchant('15210000-0000-4000-8000-000000000001',true),true,'business is already saved');
select is(public.get_merchant_profile('15210000-0000-4000-8000-000000000001')->>'notifications_enabled','false','saved alerts initially off');
select is(public.set_saved_merchant_notifications('15210000-0000-4000-8000-000000000001',true),true,'explicit opt-in persists');
select throws_ok($$select public.set_saved_merchant_notifications('15210000-0000-4000-8000-000000000002',true)$$,'P0001','SAVED_MERCHANT_REQUIRED','unsaved business cannot opt in');
reset role;
insert into public.posts(id,city_id,author_id,tag_id,title,body,status,created_at) values
('15220000-0000-4000-8000-000000000003','vancouver','15200000-0000-4000-8000-000000000003',1,'새 소식 검사','private body must never enter push','published',clock_timestamp());
insert into private.merchant_posts(post_id,merchant_id) values
('15220000-0000-4000-8000-000000000003','15210000-0000-4000-8000-000000000001');
select is((select count(*) from public.notifications where kind='saved_merchant_post' and target_id='15220000-0000-4000-8000-000000000003'),1::bigint,'linked actual publication reaches opted-in saver once');
select ok(private.saved_merchant_post_visible('15200000-0000-4000-8000-000000000002','15220000-0000-4000-8000-000000000003'),'saved post initially eligible');
select set_config('request.jwt.claims','{"sub":"15200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.update_notification_preferences('{"push_enabled":true}');
insert into private.push_devices(user_id,session_id,token) values('15200000-0000-4000-8000-000000000002','15290000-0000-4000-8000-000000000002','ExpoPushToken[business_extension_fixture]');
-- Queue the existing real notice through its unchanged enqueue trigger by replacing this test row.
delete from public.notifications where kind='saved_merchant_post' and target_id='15220000-0000-4000-8000-000000000003';
select private.notify_saved_merchant_post('15220000-0000-4000-8000-000000000003',true);
select is((select count(*) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='saved_merchant_post'),1::bigint,'saved company notice uses real push queue');
create temporary table business_claim as select * from public.claim_push_notifications() where category='merchant_updates';
select is((select count(*) from business_claim),1::bigint,'current saved opt-in can claim phone delivery');

select set_config('request.jwt.claims','{"sub":"15200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.update_notification_preferences('{"merchant_updates":false}');
select ok(not private.can_read_notification('15200000-0000-4000-8000-000000000002','merchant_updates',null,'post','15220000-0000-4000-8000-000000000003'),'global business preference pauses existing saved-post notice');
select public.update_notification_preferences('{"merchant_updates":true}');
select ok(private.can_read_notification('15200000-0000-4000-8000-000000000002','merchant_updates',null,'post','15220000-0000-4000-8000-000000000003'),'global business preference resumes still opted-in notice');
update private.saved_merchants set notifications_enabled=false;
select ok(not private.saved_merchant_post_visible('15200000-0000-4000-8000-000000000002','15220000-0000-4000-8000-000000000003'),'revoked opt-in rejects queued delivery');
select public.complete_push_notification(id,lease_id,'retry',null,'EXPO_UNAVAILABLE') from business_claim;
update private.push_delivery_queue set next_attempt_at=now() where notification_id in(select notification_id from business_claim);
select is((select count(*) from public.claim_push_notifications() where category='merchant_updates'),0::bigint,'worker claim rejects saved opt-in revoked after queueing');
insert into private.merchant_reviews(id,merchant_id,author_id,score,body,review_kind) values
('15230000-0000-4000-8000-000000000001','15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000002',8,'SECRET_REVIEW_BODY','usage');
select is((select count(*) from public.notifications where kind='merchant_review_received'),1::bigint,'unverified usage review reaches current owner');
select ok(not exists(select 1 from public.notifications where body like '%SECRET_REVIEW_BODY%'),'review body excluded from notification');
select ok(private.notification_target_visible('15200000-0000-4000-8000-000000000001','merchant_review','15230000-0000-4000-8000-000000000001'),'private owner review target visible');
select ok(not private.notification_target_visible('15200000-0000-4000-8000-000000000006','merchant_review','15230000-0000-4000-8000-000000000001'),'unverified review target hidden from outsiders');
update private.merchants set owner_id='15200000-0000-4000-8000-000000000004' where id='15210000-0000-4000-8000-000000000001';
select ok(not private.merchant_review_owner_visible('15200000-0000-4000-8000-000000000001','15230000-0000-4000-8000-000000000001'),'former owner cannot claim incoming review');
update private.merchants set owner_id='15200000-0000-4000-8000-000000000001' where id='15210000-0000-4000-8000-000000000001';
select ok(not has_function_privilege('authenticated','public.mark_merchant_naver_connection_unusable(uuid,uuid,uuid)','EXECUTE'),'clients cannot manufacture connection failures');
insert into private.merchant_naver_connections(merchant_id,user_id,generation,encrypted_tokens,expires_at) values
('15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000001','15240000-0000-4000-8000-000000000001',repeat('x',40),now()+interval '1 hour');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.mark_merchant_naver_connection_unusable('15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000001','15240000-0000-4000-8000-000000000002'),false,'stale generation cannot revoke replacement connection');
select is(public.mark_merchant_naver_connection_unusable('15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000001','15240000-0000-4000-8000-000000000001'),true,'trusted current unusable connection persists');
select is(public.mark_merchant_naver_connection_unusable('15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000001','15240000-0000-4000-8000-000000000001'),false,'repeated connection failure does not notify twice');
select is((select count(*) from public.notifications where kind='merchant_operation'),1::bigint,'connection issue reaches owner once');
select ok(not exists(select 1 from public.notifications where kind='merchant_operation' and (body like '%https:%' or body like '%xxxx%')),'operation payload contains no URL or token');

insert into private.merchant_naver_requests(id,merchant_id,user_id,draft_revision,board_url,club_id,menu_id,connection_generation,snapshot,status) values
('15250000-0000-4000-8000-000000000001','15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000001',now(),'https://cafe.naver.com/f-e/cafes/1/menus/1','1','1','15240000-0000-4000-8000-000000000001','{}','in_flight'),
('15250000-0000-4000-8000-000000000002','15210000-0000-4000-8000-000000000001','15200000-0000-4000-8000-000000000001',now(),'https://cafe.naver.com/f-e/cafes/1/menus/1','1','1','15240000-0000-4000-8000-000000000001','{}','prepared');
select public.complete_merchant_naver_publish('15250000-0000-4000-8000-000000000001','uncertain',null,'SECRET_RAW_PROVIDER_ERROR');
select is((select count(*) from public.notifications where kind='merchant_operation'),2::bigint,'uncertain provider receipt creates one verification notice');
update private.merchant_naver_requests set status='failed',error_code='NAVER_PREPARATION_CANCELLED' where id='15250000-0000-4000-8000-000000000002';
select is((select count(*) from public.notifications where kind='merchant_operation'),2::bigint,'normal cancellation creates no failure alert');
update private.merchant_naver_requests set error_code='OTHER_ERROR' where id='15250000-0000-4000-8000-000000000001';
select is((select count(*) from public.notifications where kind='merchant_operation'),2::bigint,'receipt metadata edit does not duplicate uncertain alert');
select ok(not exists(select 1 from public.notifications where body like '%SECRET_RAW_PROVIDER_ERROR%'),'provider error text excluded from push');
update private.merchants set consent='revoked' where id='15210000-0000-4000-8000-000000000001';
select ok(not exists(select 1 from private.merchant_operation_events e where private.notification_target_visible(e.owner_id,'merchant_operation',e.id)),'revoked merchant denies all queued operation targets');

-- Shared recommendation cap applies to the inbox before queueing, including city categories.
update private.merchants set consent='granted' where id='15210000-0000-4000-8000-000000000001';
update private.saved_merchants set notifications_enabled=true;
delete from public.notifications where user_id='15200000-0000-4000-8000-000000000002';
alter table public.notifications disable trigger notifications_preferences;
insert into public.notifications(user_id,kind,category,target_type,target_id,body,created_at)
select '15200000-0000-4000-8000-000000000002','city_food','city_food','post','15220000-0000-4000-8000-000000000003','shared city budget',(now() at time zone 'America/Vancouver')::date::timestamp at time zone 'America/Vancouver'
from generate_series(1,6);
alter table public.notifications enable trigger notifications_preferences;
select is((select count(*) from public.notifications where user_id='15200000-0000-4000-8000-000000000002' and category='city_food'),6::bigint,'fixture has six prior city inbox notices');
insert into public.posts(id,city_id,author_id,tag_id,title,body,status,created_at)
select ('15260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'vancouver','15200000-0000-4000-8000-000000000003',1,'budget publication','test','published',clock_timestamp()
from generate_series(1,7) n;
insert into private.merchant_posts(post_id,merchant_id)
select id,'15210000-0000-4000-8000-000000000001' from public.posts where id::text like '15260000-%';
select is((select count(*) from public.notifications where user_id='15200000-0000-4000-8000-000000000002' and kind='saved_merchant_post'),0::bigint,'six city notices prevent all seven saved company inbox alerts');
delete from public.notifications where user_id='15200000-0000-4000-8000-000000000002';
update private.trending_config set quiet_start_hour=extract(hour from now() at time zone 'America/Vancouver')::integer,
 quiet_end_hour=(extract(hour from now() at time zone 'America/Vancouver')::integer+1)%24 where id;
select private.notify_saved_merchant_post('15260000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.notifications where user_id='15200000-0000-4000-8000-000000000002' and kind='saved_merchant_post'),0::bigint,'configured quiet hours suppress saved company inbox insertion');
update private.trending_config set quiet_start_hour=0,quiet_end_hour=0 where id;
select private.notify_saved_merchant_post('15260000-0000-4000-8000-000000000001',true);
select private.notify_saved_merchant_post('15260000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.notifications where user_id='15200000-0000-4000-8000-000000000002' and kind='saved_merchant_post'),1::bigint,'thirty-minute spacing prevents second inbox notice');

-- A current opt-in does not override city sends that consumed the shared delivery budget after enqueue.
alter table public.notifications disable trigger notifications_preferences;
insert into public.notifications(id,user_id,kind,category,target_type,target_id,body,created_at)
select ('15270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'15200000-0000-4000-8000-000000000002','city_food','city_food','post',
 '15220000-0000-4000-8000-000000000003','earlier city delivery',(now() at time zone 'America/Vancouver')::date::timestamp at time zone 'America/Vancouver'
from generate_series(1,6) n;
alter table public.notifications enable trigger notifications_preferences;
insert into private.push_delivery_queue(notification_id,device_id,status,first_attempt_at,finished_at)
select n.id,d.id,'provider_accepted',(now() at time zone 'America/Vancouver')::date::timestamp at time zone 'America/Vancouver',now()
from public.notifications n join private.push_devices d on d.user_id=n.user_id where n.id::text like '15270000-%'
on conflict(notification_id,device_id) do update set status='provider_accepted',first_attempt_at=excluded.first_attempt_at,finished_at=excluded.finished_at;
select is((select count(*) from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.id::text like '15270000-%' and q.first_attempt_at is not null),6::bigint,'fixture has six prior city delivery claims');
select is((select count(*) from public.claim_push_notifications() where category='merchant_updates'),0::bigint,'latest worker claim respects six city deliveries consumed after saved alert queued');
select ok((select bool_and(q.status='cancelled') from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.kind='saved_merchant_post' and n.user_id='15200000-0000-4000-8000-000000000002'),'shared cap cancels saved queue row without provider send');
select finish();
rollback;
