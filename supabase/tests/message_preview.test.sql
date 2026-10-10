begin;
select no_plan();

select has_column('public','notification_preferences','message_preview','message preview has a private opt-in preference');
insert into auth.users(id,email) values
  ('71440000-0000-0000-0000-000000000001','preview-sender@example.test'),
  ('71440000-0000-0000-0000-000000000002','preview-recipient@example.test');
insert into public.profiles(id,nickname,city_id) values
  ('71440000-0000-0000-0000-000000000001','채팅친구','vancouver'),
  ('71440000-0000-0000-0000-000000000002','미리보기수신','vancouver');
insert into auth.sessions(id,user_id,created_at) values
  ('71440000-0000-0000-0001-000000000002','71440000-0000-0000-0000-000000000002',now());
insert into public.conversations(id,user_low_id,user_high_id,status) values
  ('71440000-0000-0000-0002-000000000001','71440000-0000-0000-0000-000000000001','71440000-0000-0000-0000-000000000002','active');

select set_config('request.jwt.claims','{"sub":"71440000-0000-0000-0000-000000000002","session_id":"71440000-0000-0000-0001-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_notification_preferences()->'message_preview','false'::jsonb,'an account without saved preferences defaults to OFF');
select lives_ok($$select public.update_notification_preferences('{"push_enabled":true,"message_preview":false}')$$,'push and preview are independent valid choices');
select is(public.get_notification_preferences()->'message_preview','false'::jsonb,'OFF survives the preference readback');
select is(public.get_notification_preferences()->'messages','true'::jsonb,'saving preview preserves the new message category');
select is(public.get_notification_preferences()->'weekly_ranking','true'::jsonb,'existing weekly ranking settings remain available');
select throws_ok($$select public.update_notification_preferences('{"message_preview":"true"}')$$,'P0001','INVALID_PREFERENCES','a string cannot enable a preview');
select throws_ok($$select public.update_notification_preferences('{"message_preview":null}')$$,'P0001','INVALID_PREFERENCES','null cannot reset the opt-in');
select throws_ok($$select public.update_notification_preferences('{"message_preview":1}')$$,'P0001','INVALID_PREFERENCES','numbers cannot enable a preview');
select throws_ok($$select public.update_notification_preferences('{"message_preview":true,"user_id":"71440000-0000-0000-0000-000000000001"}')$$,'P0001','INVALID_PREFERENCES','callers cannot select another recipient');
select public.register_push_device('ExpoPushToken[previewRecipient1234]',auth.uid());
select throws_ok($$select * from public.claim_push_notifications()$$,'42501',null,'a client cannot claim private preview content');
select throws_ok($$update public.notification_preferences set message_preview=true$$,'42501',null,'clients must use the validated preference RPC');
reset role;
insert into public.notification_preferences(user_id,message_preview) values('71440000-0000-0000-0000-000000000001',true);
select is((select message_preview from public.notification_preferences where user_id='71440000-0000-0000-0000-000000000001'),true,'the sender can choose a different preview setting');

-- Every helper and fixture disappears with this transaction.
create function pg_temp.preview_message(p_body text default '내일 만나요',p_kind text default 'text')
returns uuid language plpgsql as $$
declare message_id uuid:=gen_random_uuid();
begin
  insert into public.messages(id,conversation_id,sender_id,body,kind,image_path,latitude,longitude)
  values(message_id,'71440000-0000-0000-0002-000000000001','71440000-0000-0000-0000-000000000001',p_body,p_kind,
    case when p_kind='image' then '71440000-0000-0000-0000-000000000001/'||message_id||'.webp' end,
    case when p_kind='location' then 49.282729 end,case when p_kind='location' then -123.120738 end);
  return message_id;
end;
$$;
create temporary table preview_claim as select * from public.claim_push_notifications('send',100) with no data;

select pg_temp.preview_message() as message_id \gset
select is((select body from public.notifications where target_id=:'message_id'),'메시지가 도착했습니다','the notification list stores no raw message or sender preview');
select ok(exists(select 1 from public.safety_review_queue where target_type='message' and target_id=:'message_id'),'all-message safety monitoring still receives the original message');
update public.notifications set body='이전 발신자: 오래된 비공개 본문' where target_id=:'message_id';
insert into preview_claim select * from public.claim_push_notifications() where user_id='71440000-0000-0000-0000-000000000002';
select is((select count(*)::int from preview_claim),1,'an eligible OFF message is still sent');
select is((select body from preview_claim),'메시지가 도착했습니다','OFF sends only the generic message text');
update public.notifications set body='메시지가 도착했습니다' where target_id=:'message_id';
select is((select route from preview_claim),'/chat?conversationId=71440000-0000-0000-0002-000000000001','generic pushes retain the actual accessible conversation');
select is((select count(*)::int from public.claim_push_notifications()),0,'the existing lease still prevents a duplicate send');

select public.complete_push_notification(id,lease_id,'retry',null,'EXPO_UNAVAILABLE') from preview_claim;
update private.push_delivery_queue set next_attempt_at=now() where notification_id in (select notification_id from preview_claim);
set local role authenticated;
select public.update_notification_preferences('{"message_preview":true}');
reset role;
update public.messages set body='지금 바뀐 실제 본문' where id=:'message_id';
update public.notifications set route='/chat?conversationId=00000000-0000-0000-0000-000000000000' where target_id=:'message_id';
truncate preview_claim;
insert into preview_claim select * from public.claim_push_notifications() where user_id='71440000-0000-0000-0000-000000000002';
select is((select body from preview_claim),'채팅친구: 지금 바뀐 실제 본문','ON reads the current actual message at claim time');
select is((select route from preview_claim),'/chat?conversationId=71440000-0000-0000-0002-000000000001','the conversation route comes from the message, not a queued route');
select is((select body from public.notifications where target_id=:'message_id'),'메시지가 도착했습니다','a successful preview never persists raw text in notifications');

select public.complete_push_notification(id,lease_id,'retry',null,'EXPO_UNAVAILABLE') from preview_claim;
update private.push_delivery_queue set next_attempt_at=now() where notification_id in (select notification_id from preview_claim);
set local role authenticated;
select public.update_notification_preferences('{"message_preview":false}');
reset role;
truncate preview_claim;
insert into preview_claim select * from public.claim_push_notifications() where user_id='71440000-0000-0000-0000-000000000002';
select is((select body from preview_claim),'메시지가 도착했습니다','withdrawing preview before a retry suppresses the actual body');
select public.complete_push_notification(id,lease_id,'failed') from preview_claim;

set local role authenticated;
select public.update_notification_preferences('{"message_preview":true}');
reset role;
select pg_temp.preview_message('이 사진의 원문은 보내면 안 돼요','image') as photo_id \gset
truncate preview_claim;
insert into preview_claim select * from public.claim_push_notifications() where user_id='71440000-0000-0000-0000-000000000002';
select is((select body from preview_claim),'채팅친구: 사진을 보냈습니다','photos use a generic image label');
select ok(not exists(select 1 from preview_claim where body like '%원문%' or to_jsonb(preview_claim)::text like '%.webp%'),'photo bodies and storage paths never enter a claim');
select public.complete_push_notification(id,lease_id,'ticket','71440000-0000-4000-8000-000000000001') from preview_claim;
update private.push_delivery_queue set next_attempt_at=now() where notification_id in (select notification_id from preview_claim);
truncate preview_claim;
insert into preview_claim select * from public.claim_push_notifications('receipt') where user_id='71440000-0000-0000-0000-000000000002';
select is((select token from preview_claim),null::text,'receipts keep the existing no-token contract');
select is((select body from preview_claim),'메시지가 도착했습니다','receipt claims never reconstruct private previews');
select public.complete_push_notification(id,lease_id,'provider_accepted') from preview_claim;

select pg_temp.preview_message('위치 원문은 보내지 않아요','location');
truncate preview_claim;
insert into preview_claim select * from public.claim_push_notifications() where user_id='71440000-0000-0000-0000-000000000002';
select is((select body from preview_claim),'채팅친구: 위치를 보냈습니다','location attachments disclose neither coordinates nor raw body');
select public.complete_push_notification(id,lease_id,'failed') from preview_claim;

select pg_temp.preview_message(E'첫 줄\n\t둘째 줄 '||repeat('가',110));
truncate preview_claim;
insert into preview_claim select * from public.claim_push_notifications() where user_id='71440000-0000-0000-0000-000000000002';
select is((select body from preview_claim),'채팅친구: '||left('첫 줄 둘째 줄 '||repeat('가',110),100)||'…','text previews normalize whitespace and limit Unicode characters');
select public.complete_push_notification(id,lease_id,'failed') from preview_claim;

select pg_temp.preview_message('발송 전 대화 접근을 검사해요') as inaccessible_id \gset
update public.conversations set status='pending' where id='71440000-0000-0000-0002-000000000001';
select is((select count(*)::int from public.claim_push_notifications()),0,'a conversation that is no longer readable cannot expose a queued message');
update public.conversations set status='active' where id='71440000-0000-0000-0002-000000000001';

select pg_temp.preview_message('숨김 증거 원문') as hidden_id \gset
update public.messages set hidden_at=now() where id=:'hidden_id';
select is((select count(*)::int from public.claim_push_notifications()),0,'a message hidden after enqueue cannot be sent');
select is((select body from public.messages where id=:'hidden_id'),'숨김 증거 원문','hidden message evidence is preserved for authorized review');
select is((select status from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.target_id=:'hidden_id'),'cancelled','suppressed hidden work is terminal');

select pg_temp.preview_message('삭제될 메시지') as deleted_id \gset
delete from public.messages where id=:'deleted_id';
select is((select count(*)::int from public.claim_push_notifications()),0,'a deleted message cannot expose a stale preview');

select pg_temp.preview_message('차단 후 보내지 않아요');
insert into public.blocks(blocker_id,blocked_id) values('71440000-0000-0000-0000-000000000002','71440000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.claim_push_notifications()),0,'a new block suppresses queued previews');
delete from public.blocks where blocker_id='71440000-0000-0000-0000-000000000002' and blocked_id='71440000-0000-0000-0000-000000000001';
update public.conversations set status='active' where id='71440000-0000-0000-0002-000000000001';

select pg_temp.preview_message('새 메시지 설정을 검사해요');
set local role authenticated;
select public.update_notification_preferences('{"messages":false}');
reset role;
select is((select count(*)::int from public.claim_push_notifications()),0,'the new message category is rechecked at claim time');
set local role authenticated;
select public.update_notification_preferences('{"messages":true}');
reset role;

select pg_temp.preview_message('푸시 설정을 검사해요');
set local role authenticated;
select public.update_notification_preferences('{"push_enabled":false}');
reset role;
select is((select count(*)::int from public.claim_push_notifications()),0,'global push OFF remains authoritative');
set local role authenticated;
select public.update_notification_preferences('{"push_enabled":true}');
reset role;

select pg_temp.preview_message('만료 후 보내지 않아요');
update auth.sessions set not_after=now()-interval '1 second' where id='71440000-0000-0000-0001-000000000002';
select is((select count(*)::int from public.claim_push_notifications()),0,'expired recipient sessions cannot receive a preview');
update auth.sessions set not_after=null where id='71440000-0000-0000-0001-000000000002';

select pg_temp.preview_message('수신자 본인이 이미 읽었어요') as read_id \gset
update public.notifications set read_at=now() where target_id=:'read_id';
select is((select count(*)::int from public.claim_push_notifications()),0,'already-read notifications are still suppressed');

select pg_temp.preview_message('발신자가 일치해야 해요') as rebound_id \gset
update public.notifications set actor_id=null where target_id=:'rebound_id';
select is((select count(*)::int from public.claim_push_notifications()),0,'a message notification must bind its actual sender');

select pg_temp.preview_message('너무 오래된 메시지') as expired_id \gset
update private.push_delivery_queue set created_at=now()-interval '25 hours' where notification_id in (select id from public.notifications where target_id=:'expired_id');
select is((select count(*)::int from public.claim_push_notifications()),0,'the existing pending notification expiry is preserved');
select is((select last_error from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.target_id=:'expired_id'),'RETRY_EXHAUSTED','expiry still records the existing bounded retry outcome');

select pg_temp.preview_message('중지된 발신자는 보내지 않아요');
update public.profiles set account_status='suspended' where id='71440000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.claim_push_notifications()),0,'inactive senders cannot leak queued previews');

set local role service_role;
select lives_ok($$select * from public.claim_push_notifications()$$,'the existing worker can still use the protected claim RPC');
select throws_ok($$select * from private.push_devices$$,'42501',null,'service role still cannot read tokens directly');
reset role;
set local role anon;
select throws_ok($$select public.update_notification_preferences('{"message_preview":true}')$$,'42501',null,'anonymous callers cannot enable message previews');
reset role;
select * from finish();
rollback;
