begin;
set local search_path=public,extensions;
select no_plan();

insert into public.cities(id,name,province,timezone) values('host-transfer-test','Host transfer','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'host-transfer-test','Host transfer','meetup') on conflict do nothing;
-- 1 host, 2 receiver, 3 other member, 4 outsider, 5 premium receiver, 6 second receiver
insert into auth.users(id,email)
select ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'host-transfer-'||n||'@example.invalid' from generate_series(1,6)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Transfer'||right(id::text,2),'host-transfer-test',now(),now(),now(),'test' from auth.users where id::text like 'd1000000-%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"함께 걸어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}' from public.profiles where id::text like 'd1000000-%';
insert into private.membership_accounts(user_id,entitlements,observed_at)
select u,jsonb_build_array(jsonb_build_object('tier','premium','kind','general','plan_version','2','expires_at',now()+interval '30 days')),now()
from unnest(array['d1000000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-000000000001']::uuid[])u;

-- Meetup A: capacity 6 (fits a free receiver). Meetup B: capacity 20 (needs more than the free seat cap).
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','host-transfer-test',31997,'함께 산책','합성 로컬 테스트 모임',current_date,'{"eventKind":"group","cadence":"weekly","capacity":6,"memberCount":3}'),
 ('d1100000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','host-transfer-test',31997,'큰 모임','합성 로컬 테스트 모임',current_date,'{"eventKind":"group","cadence":"weekly","capacity":20,"memberCount":1}');
delete from private.membership_accounts where user_id='d1000000-0000-4000-8000-000000000001';
insert into public.meetup_requests(id,post_id,host_id,requester_id,status,message) values
 ('d1200000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','approved','받는 사람의 답'),
 ('d1200000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','approved',''),
 ('d1200000-0000-4000-8000-000000000012','d1100000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','approved',''),
 ('d1200000-0000-4000-8000-000000000015','d1100000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','approved','');
insert into private.chilling_host_profiles(post_id,author_id,profile,consent_version)
values('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','{"displayName":"예전 호스트","intro":"호스트 소개"}','chilling-v1');
insert into private.chilling_applications(id,author_id,profile,answer,question,consent_version)
values('d1200000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002','{"displayName":"받는 사람"}','비밀 답변','무슨 질문?','chilling-v1');
insert into private.meetup_cohosts(post_id,user_id,status,accepted_at) values('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','accepted',now());
insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at) values
 ('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',now()-interval '8 days',now()-interval '8 days'+interval '1 hour'),
 ('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',now()+interval '3 days',now()+interval '3 days'+interval '1 hour');
insert into private.meetup_announcements(post_id,host_id,body,audience,send_at) values
 ('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','내일 봐요','members',now()+interval '1 day');
-- The receiver sits at the free slot limit (3): this meetup plus two others they joined.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('d1100000-0000-4000-8000-00000000001'||n)::uuid,'d1000000-0000-4000-8000-000000000006','host-transfer-test',31997,'다른 모임 '||n,'합성','2030-01-01'::date,'{"eventKind":"group","cadence":"weekly","capacity":6,"memberCount":2}'::jsonb from generate_series(1,2)n;
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select ('d1100000-0000-4000-8000-00000000001'||n)::uuid,'d1000000-0000-4000-8000-000000000006','d1000000-0000-4000-8000-000000000002','approved' from generate_series(1,2)n;
select is(private.membership_meetup_count('d1000000-0000-4000-8000-000000000002'),3,'fixture: receiver is exactly at the free slot limit');
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from private.meetup_host_transfers$$,'42501',null,'offers are private');
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004')$$,'P0001','APPROVED_MEMBER_REQUIRED','an outsider cannot receive an offer');
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001')$$,'P0001','APPROVED_MEMBER_REQUIRED','a host cannot offer to themselves');
select is((select count(*)::int from jsonb_array_elements(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')->'candidates')),2,'the host sees both approved members as candidates');

-- Seat cap: a free receiver cannot take a 20-seat meetup, and their cap is not raised.
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003')$$,'P0001','TRANSFER_CAPACITY_EXCEEDED','a meetup above the receiver seat cap cannot be offered');
select is((select c->>'blocker' from jsonb_array_elements(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000002')->'candidates') c where c->>'userId'='d1000000-0000-4000-8000-000000000003'),'TRANSFER_CAPACITY_EXCEEDED','the host screen shows why');
select lives_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000005')$$,'a premium receiver can take the same meetup');
reset role;
select is(private.meetup_capacity_limit('d1000000-0000-4000-8000-000000000003'),10,'the free seat cap is unchanged');

-- Offer, one pending, cancel.
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003')$$,'P0001','HOST_REQUIRED','only the host can offer');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002')$$,'the host offers the meetup to an approved member');
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003')$$,'P0001','TRANSFER_ALREADY_PENDING','only one offer can be pending');
select is(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')->'pending'->>'toUserId','d1000000-0000-4000-8000-000000000002','the host sees who the offer is for');
reset role;
select ok((select expires_at from private.meetup_host_transfers where post_id='d1100000-0000-4000-8000-000000000001' and status='pending') <= now()+interval '7 days 1 minute','a group offer lasts at most 7 days');
select is((select count(*)::int from public.notifications where user_id='d1000000-0000-4000-8000-000000000002' and kind='meetup_changed' and body like '%호스트를 넘기고 싶어 해요%'),1,'the receiver is notified');
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.cancel_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')$$,'the host can cancel');
select is(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')->'pending','null'::jsonb,'a cancelled offer is gone');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',true)$$,'P0001','TRANSFER_NOT_FOUND','a cancelled offer cannot be accepted');
reset role;

-- Decline.
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')->'offer','null'::jsonb,'another member does not see the offer');
select throws_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',true)$$,'P0001','TRANSFER_NOT_FOUND','another member cannot accept it');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')->'offer'->>'blocker',null,'the receiver sees an answerable offer');
select lives_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',false)$$,'the receiver declines');
reset role;
select is((select author_id from public.posts where id='d1100000-0000-4000-8000-000000000001'),'d1000000-0000-4000-8000-000000000001'::uuid,'declining changes nothing');
select is((select count(*)::int from public.notifications where user_id='d1000000-0000-4000-8000-000000000001' and body like '%호스트를 맡지 않기로 했어요%'),1,'the host is told about the decline');

-- Expired offers cannot be accepted and no longer block a new offer.
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002');
reset role;
update private.meetup_host_transfers set expires_at=now()-interval '1 minute' where post_id='d1100000-0000-4000-8000-000000000001' and status='pending';
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',true,'chilling-v1')$$,'P0001','TRANSFER_EXPIRED','an expired offer cannot be accepted');
select is(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000001')->'offer','null'::jsonb,'an expired offer is hidden');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002')$$,'an expired offer does not block a new one');
reset role;

-- Blocks, reports and suspended accounts are re-checked when the receiver answers.
insert into public.blocks(blocker_id,blocked_id) values('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',true,'chilling-v1')$$,'P0001','MEETUP_NOT_FOUND','a block placed after the offer stops the acceptance');
reset role;
delete from public.blocks where blocker_id='d1000000-0000-4000-8000-000000000001';
delete from public.reports where reporter_id='d1000000-0000-4000-8000-000000000001';
update public.profiles set account_status='suspended' where id='d1000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',true,'chilling-v1')$$,'P0001','ACCOUNT_LOCKED','a suspended receiver cannot accept');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003')$$,'P0001','TRANSFER_ALREADY_PENDING','the earlier offer is still the only one');
select public.cancel_meetup_host_transfer('d1100000-0000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002')$$,'P0001','APPROVED_MEMBER_REQUIRED','a suspended account cannot receive an offer');
reset role;
update public.profiles set account_status='active' where id='d1000000-0000-4000-8000-000000000002';
-- Suspending an account already closes its memberships; approve the receiver again for the next steps.
update public.meetup_requests set status='approved' where requester_id='d1000000-0000-4000-8000-000000000002' and post_id::text like 'd11%' and post_id<>'d1100000-0000-4000-8000-000000000002';

-- Accept.
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_host_transfer('d1100000-0000-4000-8000-000000000001',true,'chilling-v1')$$,'the receiver accepts even at their slot limit');
reset role;
select is((select author_id from public.posts where id='d1100000-0000-4000-8000-000000000001'),'d1000000-0000-4000-8000-000000000002'::uuid,'the host role moved');
select is((select status from public.meetup_requests where post_id='d1100000-0000-4000-8000-000000000001' and requester_id='d1000000-0000-4000-8000-000000000001'),'approved','the previous host is now an approved member');
select is((select count(*)::int from public.meetup_requests where post_id='d1100000-0000-4000-8000-000000000001' and requester_id='d1000000-0000-4000-8000-000000000002'),0,'the new host has no member row');
select is((select count(*)::int from public.meetup_requests where post_id='d1100000-0000-4000-8000-000000000001' and host_id='d1000000-0000-4000-8000-000000000002'),2,'every request row follows the new host');
select is((select message from public.meetup_requests where post_id='d1100000-0000-4000-8000-000000000001' and requester_id='d1000000-0000-4000-8000-000000000001'),'','the receiver application text does not carry over');
select is((select answer from private.chilling_applications where id='d1200000-0000-4000-8000-000000000002'),'','the receiver private answer is not kept on the previous host row');
select is((select author_id from private.chilling_applications where id='d1200000-0000-4000-8000-000000000002'),'d1000000-0000-4000-8000-000000000001'::uuid,'that row now belongs to the previous host');
select is((select profile->>'displayName' from private.chilling_applications where id='d1200000-0000-4000-8000-000000000002'),'예전 호스트','the previous host profile moved to their member row');
select is((select author_id from private.chilling_host_profiles where post_id='d1100000-0000-4000-8000-000000000001'),'d1000000-0000-4000-8000-000000000002'::uuid,'the public host profile is the new host');
select is((select status from private.meetup_cohosts where post_id='d1100000-0000-4000-8000-000000000001' and user_id='d1000000-0000-4000-8000-000000000002'),'revoked','the new host is no longer a co-host');
select is((select host_id from private.meetup_sessions where post_id='d1100000-0000-4000-8000-000000000001' and starts_at>now()),'d1000000-0000-4000-8000-000000000002'::uuid,'upcoming sessions follow the new host');
select is((select host_id from private.meetup_sessions where post_id='d1100000-0000-4000-8000-000000000001' and starts_at<now()),'d1000000-0000-4000-8000-000000000001'::uuid,'past sessions keep their host');
select ok((select cancelled_at is not null from private.meetup_announcements where post_id='d1100000-0000-4000-8000-000000000001'),'announcements the previous host scheduled are cancelled');
select is((select status from private.meetup_host_transfers where post_id='d1100000-0000-4000-8000-000000000001' order by created_at desc limit 1),'accepted','the offer is closed as accepted');
select is((select count(*)::int from public.notifications where user_id='d1000000-0000-4000-8000-000000000001' and body like '%호스트를 이어받았어요%'),1,'the previous host is told');
select is((select count(*)::int from public.notifications where user_id='d1000000-0000-4000-8000-000000000003' and body like '%호스트가%바뀌었어요%'),1,'members are told once');
select is((select count(*)::int from public.notifications where user_id='d1000000-0000-4000-8000-000000000002' and body like '%호스트가%바뀌었어요%'),0,'the new host is not sent a change notice');
select is(private.membership_meetup_count('d1000000-0000-4000-8000-000000000002'),3,'the new host slot count is unchanged');
select is(private.membership_meetup_count('d1000000-0000-4000-8000-000000000001'),2,'the previous host slot count is unchanged for this meetup');
select ok(private.can_read_conversation((select id from public.conversations where group_post_id='d1100000-0000-4000-8000-000000000001'),'d1000000-0000-4000-8000-000000000001'),'the previous host still reads the chat');
select cmp_ok((select count(*)::int from private.meetup_role_audit where post_id='d1100000-0000-4000-8000-000000000001' and action='transfer_accept'),'=',1,'the acceptance is audited');

-- The roles really swapped for the tools.
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003')$$,'P0001','HOST_REQUIRED','the previous host can no longer offer');
select throws_ok($$select public.invite_meetup_cohost('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003')$$,'P0001','HOST_REQUIRED','the previous host cannot invite co-hosts');
reset role;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_tools('d1100000-0000-4000-8000-000000000001')->>'isHost','true','the new host gets the host tools');
-- It can go back: the previous host is a member and can be offered the meetup.
select lives_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001')$$,'the new host can hand it back');
select public.cancel_meetup_host_transfer('d1100000-0000-4000-8000-000000000001');
reset role;

-- A one-time meetup offer ends when the meetup starts.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('d1100000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','host-transfer-test',31997,'한 번 모임','합성',current_date,
  jsonb_build_object('eventKind','once','timezone','America/Vancouver','capacity',4,'memberCount',2,'startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 2 hours'));
insert into public.meetup_requests(post_id,host_id,requester_id,status) values('d1100000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','approved');
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.offer_meetup_host_transfer('d1100000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000003')$$,'a one-time meetup can be offered');
reset role;
select ok((select expires_at from private.meetup_host_transfers where post_id='d1100000-0000-4000-8000-000000000003')<=now()+interval '2 days','a one-time offer ends at the start time');

-- Language exchange meetups are not transferable.
update public.posts set room_preview=room_preview||'{"languageExchange":{"languages":["ko","en"],"share":50}}' where id='d1100000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select c->>'blocker' from jsonb_array_elements(public.get_meetup_host_transfer('d1100000-0000-4000-8000-000000000003')->'candidates') c),'TRANSFER_NOT_AVAILABLE','a language exchange shows the transfer as unavailable');
reset role;

-- Deleting an account removes its offers.
select private.purge_meetup_tool_account_data('d1000000-0000-4000-8000-000000000003');
select is((select count(*)::int from private.meetup_host_transfers where to_user_id='d1000000-0000-4000-8000-000000000003'),0,'account deletion removes offers sent to that person');
select * from finish();
rollback;
