begin;
select no_plan();
select has_function('public','respond_direct_conversation',array['uuid','text'],'direct conversations require recipient consent');
select has_function('public','end_conversation',array['uuid'],'either participant can leave immediately');
insert into auth.users(id,email)
select ('81000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'relationship-'||n||'@example.com' from generate_series(1,12)n;
insert into public.profiles(id,nickname,city_id)
select ('81000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'관계검증'||n,'vancouver' from generate_series(1,12)n;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.start_conversation('81000000-0000-0000-0000-000000000002') as request_id \gset
select is((public.get_membership()->>'conversationsUsed')::integer,0,'pending requests consume no slot');
select throws_ok(format('select public.send_message(%L,''수락 전 대화 우회'')',:'request_id'),'P0001','CONVERSATION_NOT_ACTIVE','requester cannot send before acceptance');

select throws_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'request_id'),'P0001','RECIPIENT_REQUIRED','requester cannot accept their own request');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'request_id'),'P0001','CONVERSATION_NOT_FOUND','outsider cannot accept a request');
select throws_ok(format('select public.end_conversation(%L)',:'request_id'),'P0001','CONVERSATION_NOT_FOUND','outsider cannot end a room');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.respond_direct_conversation(:'request_id','accepted'),:'request_id'::uuid,'recipient accepts');
select is(public.respond_direct_conversation(:'request_id','accepted'),:'request_id'::uuid,'accept retry does not consume twice');
select is((public.get_membership()->>'conversationsUsed')::integer,1,'recipient uses one slot');
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,2,'recipient retains other two slots');
select public.send_message(:'request_id','수락한 뒤에만 대화해요.') as message_id \gset
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='message' and target_id=:'message_id'),1,'new direct messages enter safety monitoring');
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationsUsed')::integer,1,'requester also uses exactly one slot');
select is((select count(*)::integer from public.messages where id=:'message_id'),1,'accepted peer reads message');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.end_conversation(:'request_id');
select public.end_conversation(:'request_id');
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,3,'recipient exit frees recipient slot immediately');
select is((public.get_membership()->>'conversationSlotsLocked')::integer,0,'recipient bears no cooldown');
select throws_ok(format('select public.send_message(%L,''종료 후 전송'')',:'request_id'),'P0001','CONVERSATION_NOT_ACTIVE','ended rooms cannot receive messages');
select is((select count(*)::integer from public.messages where id=:'message_id'),1,'ending preserves existing history');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationSlotsLocked')::integer,1,'only original requester locks one slot');
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,2,'unused slots remain available');
select is((public.get_membership()->'conversationUnlocksAt'->>0)::timestamptz,now()+interval '24 hours','cooldown is exactly 24 hours');
reset role;
update private.action_rate_events set created_at=now()-interval '2 minutes' where action='conversation_request';
set local role authenticated;
select public.start_conversation('81000000-0000-0000-0000-000000000003') as second_id \gset
select is((public.get_membership()->>'conversationSlotsLocked')::integer,1,'requesting another peer does not clear cooldown');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.respond_direct_conversation(:'second_id','accepted');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,1,'new acceptance consumes another slot, leaving locked one intact');
select public.end_conversation(:'second_id');
select is((public.get_membership()->>'conversationSlotsLocked')::integer,2,'requester exit also locks requester only');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,3,'passive recipient is immediately free');
reset role;
-- Fill recipient's three slots; acceptance must fail atomically without consuming requester capacity.
insert into public.conversations(user_low_id,user_high_id)
select '81000000-0000-0000-0000-000000000004',('81000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(5,7)n;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select public.start_conversation('81000000-0000-0000-0000-000000000004') as capped_id \gset
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'capped_id'),'P0001','CONVERSATION_LIMIT_REACHED','recipient cap checked at acceptance');
reset role;
select is((select status from public.conversations where id=:'capped_id'),'pending','failed acceptance leaves request pending');
select is(private.direct_slot_count('81000000-0000-0000-0000-000000000008'),0,'failed acceptance consumes neither side');
-- Pending cancellation/rejection never locks a slot.
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select public.respond_direct_conversation(:'capped_id','cancelled');
select is((public.get_membership()->>'conversationSlotsLocked')::integer,0,'pending cancel has no slot cooldown');
select throws_ok($$select public.start_conversation('81000000-0000-0000-0000-000000000004')$$,'P0001','REQUEST_COOLDOWN','same-pair request spam is paced independently');
reset role;
-- Fresh block ends both peers' connection while preserving the original requester responsibility.
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000009","role":"authenticated"}',true);
set local role authenticated;
select public.start_conversation('81000000-0000-0000-0000-000000000010') as blocked_id \gset
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000010","role":"authenticated"}',true);
set local role authenticated;
select public.respond_direct_conversation(:'blocked_id','accepted');
insert into public.blocks(blocker_id,blocked_id) values('81000000-0000-0000-0000-000000000010','81000000-0000-0000-0000-000000000009');
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,3,'blocking frees accepting member immediately');
reset role;
select is((select status from public.conversations where id=:'blocked_id'),'ended','blocking terminates active room');
select is(private.relationship_locked_count('81000000-0000-0000-0000-000000000009','direct'),1,'blocked requester has one cooldown');
-- Group approval uses ONE shared room and a separate group pool.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000011','vancouver',5,'같이 걷는 모임','모임 대화와 승인을 검증합니다.',current_date,'{"capacity":8}');
select id as group_id from public.conversations where group_post_id='82000000-0000-0000-0000-000000000001' \gset
insert into public.messages(conversation_id,sender_id,body,created_at) values(:'group_id','81000000-0000-0000-0000-000000000011','가입 전 대화 기록',now()-interval '1 hour') returning id as before_join_message \gset
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.request_meetup_join('82000000-0000-0000-0000-000000000001','함께 걷고 싶어요.') as group_request1 \gset
select is((public.get_membership()->>'meetupsUsed')::integer,0,'pending meetup request reserves no slot');
select is((select count(*)::integer from public.conversations where id=:'group_id'),0,'pending member cannot read group room');
select throws_ok(format('select public.send_message(%L,''승인 우회'')',:'group_id'),'P0001','CONVERSATION_NOT_FOUND','pending member cannot send group message');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.request_meetup_join('82000000-0000-0000-0000-000000000001','저도 참여할게요.') as group_request2 \gset
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000011","role":"authenticated"}',true);
set local role authenticated;
select is(public.respond_meetup_request(:'group_request1','approved'),:'group_id'::uuid,'first approval joins shared group room');
select is(public.respond_meetup_request(:'group_request2','approved'),:'group_id'::uuid,'second approval joins same room');
select is((public.get_membership()->>'conversationsUsed')::integer,0,'host group approvals do not use direct slots');
select is((public.get_membership()->>'meetupsUsed')::integer,1,'host consumes one group slot');
select public.send_message(:'group_id','모임방에 오신 걸 환영해요.') as group_message \gset
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='message' and target_id=:'group_message'),1,'group messages enter the same safety monitoring pipeline');
select is((select count(*)::integer from public.notifications where target_id=:'group_message' and kind='message'),2,'group message notifies both other approved members');
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where id=:'group_message'),1,'approved group member reads shared message');
select is((select count(*)::integer from public.messages where id=:'before_join_message'),0,'new group member cannot read messages from before approval');
select lives_ok(format('select public.create_report(''message'',%L,''other'',''모임 신고 검증'')',:'group_message'),'group participant can report actual message sender');
select public.end_conversation(:'group_id');
select is((public.get_membership()->>'meetupSlotsLocked')::integer,1,'voluntary group leave locks one group slot');
select is((public.get_membership()->>'meetupSlotsAvailable')::integer,2,'group cooldown does not lock other slots');
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,3,'group exit leaves direct pool unchanged');
select is((select count(*)::integer from public.messages where id=:'group_message'),0,'former member cannot keep reading group messages');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupSlotsLocked')::integer,0,'other group members receive no penalty');
select is((public.get_membership()->>'meetupsUsed')::integer,1,'other group member stays joined');
insert into public.blocks(blocker_id,blocked_id) values('81000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000011');
select is((select count(*)::integer from public.messages where id=:'group_message'),0,'blocked group sender messages are hidden');
select lives_ok(format('select public.create_report(''message'',%L,''harassment'',''차단 후에도 신고 가능'')',:'group_message'),'blocking never prevents reporting a message from the approved membership period');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000011","role":"authenticated"}',true);
set local role authenticated;
select public.leave_meetup('82000000-0000-0000-0000-000000000001');
select is((public.get_membership()->>'meetupSlotsLocked')::integer,1,'host voluntary closure locks host one slot');
select public.leave_meetup('82000000-0000-0000-0000-000000000001');
select is((public.get_membership()->>'meetupSlotsLocked')::integer,1,'duplicate closure does not add another lock');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupSlotsAvailable')::integer,3,'passive members freed when host closes group');
select is((public.get_membership()->>'meetupSlotsLocked')::integer,0,'host closure never penalizes passive members');
reset role;
-- Expiry frees capacity without a scheduled task; plans never erase existing locks.
update private.relationship_cooldowns set unlocks_at=now()-interval '1 second' where user_id='81000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,3,'cooldowns expire by server time without cron');
reset role;
select public.apply_membership_snapshot('81000000-0000-0000-0000-000000000009',jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','plus','store','app_store','will_renew',true)),now());
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000009","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,4,'upgrade adds capacity but retains cooldown');
select is((public.get_membership()->>'conversationSlotsLocked')::integer,1,'payment cannot erase existing cooldown');
select throws_ok($$select * from private.relationship_cooldowns$$,'42501',null,'clients cannot read or manipulate private cooldown ledger');
select throws_ok($$select public.get_admin_user_conversations('81000000-0000-0000-0000-000000000002')$$,'P0001','ADMIN_REQUIRED','nonadmins cannot enumerate another member history');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000012","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where id=:'group_message'),1,'authorized admin retains unreported and closed group visibility');
select lives_ok($$select * from public.get_admin_user_conversations('81000000-0000-0000-0000-000000000002')$$,'admin can inspect former group member history');
reset role;
select is((select count(*)::integer from public.admin_access_logs where subject_user_id='81000000-0000-0000-0000-000000000002' and scope='conversations'),1,'admin group history read is audited');
-- One multi-row statement cannot overfill the host's free group pool.
select throws_ok($$insert into public.posts(author_id,city_id,tag_id,title,body,posted_on,room_preview)
select '81000000-0000-0000-0000-000000000012','vancouver',5,'일괄 모임 '||n,'동시에 만들어도 세 자리 한도를 지켜요.',current_date-n,'{"capacity":8}'::jsonb from generate_series(1,4)n$$,'P0001','MEETUP_LIMIT_REACHED','batch insert cannot bypass group cap');
insert into public.conversations(user_low_id,user_high_id,requester_id,status,created_at) values
('81000000-0000-0000-0000-000000000007','81000000-0000-0000-0000-000000000008','81000000-0000-0000-0000-000000000007','pending',now()-interval '8 days') returning id as expired_id \gset
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'expired_id'),'P0001','REQUEST_EXPIRED','old pending requests cannot be accepted');
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select isnt(public.start_conversation('81000000-0000-0000-0000-000000000008'),:'expired_id'::uuid,'expired request can be replaced with fresh consent');
reset role;
select * from finish();
rollback;
