begin;
select no_plan();
insert into auth.users(id,email)
select ('9d000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'free-direct-'||n||'@example.test' from generate_series(1,15)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select ('9d000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'바로대화'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,15)n;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_membership()->'conversationLimit','null'::jsonb,'free direct conversations have no capacity limit');
select is((public.get_membership()->>'meetupLimit')::integer,3,'free meetup capacity follows the reviewed group policy');
select public.start_conversation('9d000000-0000-0000-0000-000000000002') as room_id \gset
select is((select status from public.conversations where id=:'room_id'),'active','starting creates an immediately active room');
select lives_ok(format('select public.send_message(%L,''첫 메시지'')',:'room_id'),'first message needs no recipient acceptance');
select is(public.start_conversation('9d000000-0000-0000-0000-000000000002'),:'room_id'::uuid,'retry reuses the same active room');
select throws_ok($$select public.start_conversation('9d000000-0000-0000-0000-000000000003')$$,'P0001','RATE_LIMITED','new-pair burst pacing still applies');
select throws_ok($$select public.start_conversation('9d000000-0000-0000-0000-000000000001')$$,'P0001','INVALID_RECIPIENT','self contact remains invalid');
reset role;
select is((select count(*)::integer from public.notifications where user_id='9d000000-0000-0000-0000-000000000002' and target_type='user'),0,'no empty-room request notification');
select is((select count(*)::integer from public.notifications where user_id='9d000000-0000-0000-0000-000000000002' and target_type='message'),1,'real message creates the normal notification');
select is((select count(*)::integer from public.safety_review_queue where target_type='message' and target_id in (select id from public.messages where conversation_id=:'room_id')),1,'first message enters the existing safety queue');
-- Both parties already have many rooms, including a historical slot lock.
insert into public.conversations(user_low_id,user_high_id,status,requester_id)
select '9d000000-0000-0000-0000-000000000001',('9d000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'active','9d000000-0000-0000-0000-000000000001' from generate_series(4,11)n;
insert into private.relationship_cooldowns values ('9d000000-0000-0000-0000-000000000001','direct',:'room_id',now()+interval '24 hours');
update private.action_rate_events set created_at=now()-interval '2 minutes' where user_id='9d000000-0000-0000-0000-000000000001';
set local role authenticated;
select public.start_conversation('9d000000-0000-0000-0000-000000000003') as extra_room \gset
select is((select status from public.conversations where id=:'extra_room'),'active','many active rooms and historical locks do not gate new contact');
select is(public.get_membership()->'conversationSlotsAvailable','null'::jsonb,'unlimited availability is represented as null');
select is((public.get_membership()->>'conversationSlotsLocked')::integer,0,'historical locks are excluded from membership');
select is(public.get_membership()->'conversationUnlocksAt','[]'::jsonb,'no direct capacity waiting list');
select public.end_conversation(:'extra_room');
reset role;
select is((select count(*)::integer from private.relationship_cooldowns where relationship_id=:'extra_room'),0,'ending creates no slot lock');
set local role authenticated;
select public.end_conversation(:'room_id');
select is((select count(*)::integer from public.messages where conversation_id=:'room_id'),1,'ending retains messages');
reset role;
update private.action_rate_events set created_at=now()-interval '2 minutes' where user_id='9d000000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok($$select public.start_conversation('9d000000-0000-0000-0000-000000000002')$$,'ended contact restarts without a slot cooldown');
reset role;
-- Blocking still ends and seals the pair, including alternate profile/listing entry points.
insert into public.blocks(blocker_id,blocked_id) values('9d000000-0000-0000-0000-000000000002','9d000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$select public.start_conversation('9d000000-0000-0000-0000-000000000002')$$,'P0001','BLOCKED','blocked pair cannot open another room');
select throws_ok(format('select public.send_message(%L,''차단 우회'')',:'room_id'),'P0001','CONVERSATION_NOT_ACTIVE','blocked history cannot be used to bypass a block');
reset role;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000015","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.send_message(%L,''타인 대화'')',:'extra_room'),'P0001','CONVERSATION_NOT_FOUND','third party cannot send into another pair');
reset role;
select public.apply_membership_snapshot('9d000000-0000-0000-0000-000000000015',jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','premium','store','app_store','will_renew',true)),now());
set local role authenticated;
select is(public.get_membership()->'conversationLimit','null'::jsonb,'paid direct conversations use the same unlimited policy');
select is((public.get_membership()->>'meetupLimit')::integer,20,'paid meetup benefit follows the reviewed group policy');
reset role;
select public.apply_membership_snapshot('9d000000-0000-0000-0000-000000000015','[]'::jsonb,now()+interval '1 second');
set local role authenticated;
select is(public.get_membership()->'conversationLimit','null'::jsonb,'subscription expiry never gates direct conversations');
reset role;
set local role anon;
select throws_ok($$select public.start_conversation('9d000000-0000-0000-0000-000000000001')$$,'42501',null,'anonymous RPC access remains denied');
reset role;
select * from finish();
rollback;
