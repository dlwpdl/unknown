begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
('41111111-1111-1111-1111-111111111111','push-owner@example.test','{}'),
('41222222-2222-2222-2222-222222222222','push-actor@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
('41111111-1111-1111-1111-111111111111','푸시수신회원','vancouver'),
('41222222-2222-2222-2222-222222222222','푸시작성회원','vancouver');
insert into auth.sessions(id,user_id,created_at) values
('41333333-3333-3333-3333-333333333333','41111111-1111-1111-1111-111111111111',now()),
('41444444-4444-4444-4444-444444444444','41222222-2222-2222-2222-222222222222',now());
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
('41555555-5555-5555-5555-555555555555','41111111-1111-1111-1111-111111111111','vancouver',1,'푸시 테스트','공개 내용');
create function pg_temp.notify_push() returns uuid language sql as $$
  select private.create_notification('41111111-1111-1111-1111-111111111111','comment',
    '41222222-2222-2222-2222-222222222222','post','41555555-5555-5555-5555-555555555555',
    '새 댓글이 도착했어요.','/post/41555555-5555-5555-5555-555555555555');
$$;
select set_config('request.jwt.claims','{"sub":"41111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid())$$,'P0001','INVALID_PUSH_SESSION','a valid JWT without a current session cannot register');
select set_config('request.jwt.claims','{"sub":"41111111-1111-1111-1111-111111111111","session_id":"41333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
select throws_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]','41222222-2222-2222-2222-222222222222')$$,'P0001','AUTH_CONTEXT_CHANGED','expected owner must match authenticated user');
select throws_ok($$select public.register_push_device('https://evil.test/token',auth.uid())$$,'P0001','INVALID_PUSH_TOKEN','arbitrary addresses cannot be registered');
select lives_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid())$$,'valid Expo token registers');
select lives_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid())$$,'unchanged registration is idempotent');
select throws_ok($$select * from private.push_devices$$,'42501',null,'clients cannot read private tokens');
select throws_ok($$select * from private.push_delivery_queue$$,'42501',null,'clients cannot choose queued recipients');
select throws_ok($$select * from public.claim_push_notifications()$$,'42501',null,'clients cannot claim tokens');
select throws_ok($$select public.complete_push_notification(gen_random_uuid(),gen_random_uuid(),'failed')$$,'42501',null,'clients cannot complete jobs');
reset role;
select is((select count(*)::int from private.push_devices),1,'same token has exactly one binding');
insert into private.action_rate_events(user_id,action)
  select '41111111-1111-1111-1111-111111111111','push_registration' from generate_series(1,20);
set local role authenticated;
select throws_ok($$select public.register_push_device('ExpoPushToken[anothernewtoken123]',auth.uid())$$,'P0001','RATE_LIMITED','new token registrations are rate limited');
select lives_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid())$$,'idempotent sync does not consume registration quota');
reset role;
delete from private.action_rate_events where action='push_registration';
select pg_temp.notify_push();
select is((select count(*)::int from private.push_delivery_queue),0,'push defaults off even with a registered device');
set local role authenticated;
select public.update_notification_preferences('{"push_enabled":true}');
reset role;
select pg_temp.notify_push();
select is((select count(*)::int from private.push_delivery_queue),1,'new opted-in notifications enqueue once');
create temporary table push_claim as select * from public.claim_push_notifications('send',100);
select is((select count(*)::int from push_claim),1,'eligible alert is claimed');
select is((select count(*)::int from public.claim_push_notifications('send',100)),0,'a live lease cannot be claimed twice');
select throws_ok($$select public.complete_push_notification((select id from push_claim),gen_random_uuid(),'failed')$$,
  'P0001','PUSH_LEASE_EXPIRED','a stale worker cannot overwrite another lease');
select throws_ok($$select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'provider_accepted')$$,
  'P0001','INVALID_PUSH_RESULT','a ticketless send cannot claim provider acceptance');
select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'ticket','41666666-6666-4666-8666-666666666666');
select is((select status from private.push_delivery_queue),'ticket','Expo ticket does not mean delivered');
select is((select count(*)::int from public.claim_push_notifications('receipt',100)),0,'receipts wait 15 minutes before polling');
update private.push_delivery_queue set next_attempt_at=now();
truncate push_claim;
insert into push_claim select * from public.claim_push_notifications('receipt',100);
select is((select token from push_claim),null::text,'receipt polling does not disclose a device token');
select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'provider_accepted');
select is((select status from private.push_delivery_queue),'provider_accepted','only an ok receipt records provider acceptance');
delete from public.notifications where user_id='41111111-1111-1111-1111-111111111111';

select pg_temp.notify_push();
truncate push_claim;
insert into push_claim select * from public.claim_push_notifications();
select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'ticket','41666666-6666-4666-8666-666666666666');
update private.push_delivery_queue set ticket_at=now()-interval '25 hours',next_attempt_at=now();
select is((select count(*)::int from public.claim_push_notifications('receipt')),0,'expired receipt IDs are no longer polled');
select is((select last_error from private.push_delivery_queue),'RECEIPT_EXPIRED','missing receipts do not imply device delivery');
delete from public.notifications where user_id='41111111-1111-1111-1111-111111111111';

select pg_temp.notify_push();
update public.notification_preferences set replies=false where user_id='41111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.claim_push_notifications()),0,'withdrawing a category after enqueue suppresses delivery');
select is((select status from private.push_delivery_queue),'cancelled','suppressed work is terminal');
update public.notification_preferences set replies=true where user_id='41111111-1111-1111-1111-111111111111';
select pg_temp.notify_push();
insert into public.blocks(blocker_id,blocked_id) values ('41111111-1111-1111-1111-111111111111','41222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.claim_push_notifications()),0,'a new block suppresses queued activity');
delete from public.blocks where blocker_id='41111111-1111-1111-1111-111111111111';
select pg_temp.notify_push();
update public.posts set status='removed' where id='41555555-5555-5555-5555-555555555555';
select is((select count(*)::int from public.claim_push_notifications()),0,'hidden content cannot leak through a queued alert');
update public.posts set status='published' where id='41555555-5555-5555-5555-555555555555';
select pg_temp.notify_push();
update public.notification_preferences set push_enabled=false where user_id='41111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.claim_push_notifications()),0,'global push withdrawal is rechecked at send time');
update public.notification_preferences set push_enabled=true where user_id='41111111-1111-1111-1111-111111111111';
select pg_temp.notify_push();
update auth.sessions set not_after=now()-interval '1 second' where id='41333333-3333-3333-3333-333333333333';
select is((select count(*)::int from public.claim_push_notifications()),0,'expired sessions cannot receive alerts');
set local role authenticated;
select throws_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid())$$,'P0001','INVALID_PUSH_SESSION','expired sessions cannot refresh token registration');
reset role;
update auth.sessions set not_after=null where id='41333333-3333-3333-3333-333333333333';
delete from public.notifications where user_id='41111111-1111-1111-1111-111111111111';
select pg_temp.notify_push();
truncate push_claim;
insert into push_claim select * from public.claim_push_notifications();
update private.push_delivery_queue set lease_until=now()-interval '1 second';
select throws_ok($$select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'failed')$$,
  'P0001','PUSH_LEASE_EXPIRED','expired leases cannot complete');
truncate push_claim;
insert into push_claim select * from public.claim_push_notifications();
select is((select attempts from private.push_delivery_queue),2,'crashed workers are reclaimed with bounded attempts');
select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'retry',null,'EXPO_UNAVAILABLE');
select ok((select next_attempt_at > now() and status='pending' from private.push_delivery_queue),'temporary failures back off');
update private.push_delivery_queue set next_attempt_at=now(),attempts=5;
select is((select count(*)::int from public.claim_push_notifications()),0,'exhausted retries are not sent');
select is((select status from private.push_delivery_queue),'failed','exhausted retries become failed');
delete from public.notifications where user_id='41111111-1111-1111-1111-111111111111';
select pg_temp.notify_push();
truncate push_claim;
insert into push_claim select * from public.claim_push_notifications();
select public.complete_push_notification((select id from push_claim),(select lease_id from push_claim),'device_not_registered',null,'DeviceNotRegistered');
select ok((select disabled_at is not null from private.push_devices),'DeviceNotRegistered disables the token');
select pg_temp.notify_push();
select is((select count(*)::int from private.push_delivery_queue),1,'disabled token receives no new jobs');
set local role authenticated;
select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
select is((select count(*)::int from private.push_delivery_queue),0,'fresh registration discards a disabled binding and its jobs');

select pg_temp.notify_push();
select set_config('request.jwt.claims','{"sub":"41222222-2222-2222-2222-222222222222","session_id":"41444444-4444-4444-4444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
select is((select user_id from private.push_devices),'41222222-2222-2222-2222-222222222222'::uuid,'possession transfers token to the authenticated account');
select is((select count(*)::int from private.push_delivery_queue),0,'token transfer destroys previous account queued content');
select set_config('request.jwt.claims','{"sub":"41111111-1111-1111-1111-111111111111","session_id":"41333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select public.unregister_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
select is((select count(*)::int from private.push_devices),1,'old owner cannot unregister the new account');
set local role authenticated;
select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
insert into auth.sessions(id,user_id,created_at) values
  ('41777777-7777-7777-7777-777777777777','41111111-1111-1111-1111-111111111111',now());
insert into private.push_devices(user_id,session_id,token) values
  ('41111111-1111-1111-1111-111111111111','41333333-3333-3333-3333-333333333333','ExpoPushToken[currentSessionSecond]'),
  ('41111111-1111-1111-1111-111111111111','41777777-7777-7777-7777-777777777777','ExpoPushToken[anotherSessionDevice]'),
  ('41222222-2222-2222-2222-222222222222','41444444-4444-4444-4444-444444444444','ExpoPushToken[anotherAccountDevice]');
select pg_temp.notify_push();
set local role authenticated;
select throws_ok($$select public.unregister_push_device(null,'41222222-2222-2222-2222-222222222222')$$,
  'P0001','AUTH_CONTEXT_CHANGED','session-wide unregister still checks the expected account');
select public.unregister_push_device(null,auth.uid());
reset role;
select is((select count(*)::int from private.push_devices where session_id='41333333-3333-3333-3333-333333333333'),0,
  'null token unregisters every binding in the current session');
select is((select count(*)::int from private.push_devices where session_id='41777777-7777-7777-7777-777777777777'),1,
  'session-wide unregister preserves another session of the same account');
select is((select count(*)::int from private.push_devices where user_id='41222222-2222-2222-2222-222222222222'),1,
  'session-wide unregister preserves another account');
select is((select count(*)::int from private.push_delivery_queue q join private.push_devices d on d.id=q.device_id
  where d.session_id='41333333-3333-3333-3333-333333333333'),0,'session-wide unregister cascades pending content');
delete from private.push_devices;
set local role authenticated;
select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
select pg_temp.notify_push();
delete from auth.sessions where id='41333333-3333-3333-3333-333333333333';
select is((select count(*)::int from private.push_devices),0,'session revocation cascades token deletion');
select is((select count(*)::int from private.push_delivery_queue),0,'session revocation cascades queue deletion');
insert into auth.sessions(id,user_id,created_at) values ('41333333-3333-3333-3333-333333333333','41111111-1111-1111-1111-111111111111',now());
set local role authenticated;
select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
select pg_temp.notify_push();
update public.profiles set account_status='suspended' where id='41111111-1111-1111-1111-111111111111';
select is((select count(*)::int from private.push_devices),0,'account suspension removes push bindings');
select is((select count(*)::int from private.push_delivery_queue),0,'account suspension cancels pending pushes');
update public.profiles set account_status='active' where id='41111111-1111-1111-1111-111111111111';
set local role authenticated;
select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',auth.uid());
reset role;
select pg_temp.notify_push();
update public.profiles set account_status='deleted' where id='41111111-1111-1111-1111-111111111111';
select is((select count(*)::int from private.push_devices),0,'account deletion removes token addresses');
select is((select count(*)::int from private.push_delivery_queue),0,'account deletion removes pending content');
set local role service_role;
select lives_ok($$select * from public.claim_push_notifications()$$,'only the server can claim the queue');
select throws_ok($$select * from private.push_devices$$,'42501',null,'even service role uses limited RPCs rather than table reads');
reset role;
set local role anon;
select throws_ok($$select public.register_push_device('ExpoPushToken[abcdefghijklmnop]',null)$$,'42501',null,'anonymous device registration is denied');
reset role;
select * from finish();
rollback;
