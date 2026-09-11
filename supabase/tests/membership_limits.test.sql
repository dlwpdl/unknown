begin;
select no_plan();
insert into auth.users(id,email)
select ('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'membership-limit-'||n||'@example.com' from generate_series(1,8)n;
insert into public.profiles(id,nickname,city_id)
select ('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, '구독한도검증'||n, 'vancouver' from generate_series(1,8)n;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_post('vancouver',1::smallint,'무료 첫 번째 글','오늘의 동네 이야기입니다.')$$,'free can write once');
select throws_ok($$select public.create_post('vancouver',1::smallint,'무료 두 번째 글','오늘의 동네 이야기입니다.')$$,'P0001','DAILY_POST_LIMIT_REACHED','free cannot bypass post quota');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','plus','store','app_store','will_renew',true)),now());
set local role authenticated;
select lives_ok($$select public.create_post('vancouver',1::smallint,'구독 두 번째 글','오늘의 동네 이야기입니다.')$$,'verified plus immediately allows a second post');
select throws_ok($$select public.create_post('vancouver',1::smallint,'구독 세 번째 글','오늘의 동네 이야기입니다.')$$,'P0001','DAILY_POST_LIMIT_REACHED','plus cannot exceed two posts');
reset role;
-- Owned and approved memberships share the same group pool; pending requests do not.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('73000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'72000000-0000-0000-0000-000000000002','vancouver',5,'구독 한도 모임 '||n,'함께 산책할 사람을 구해요.',current_date-n,'{"capacity":8}'::jsonb from generate_series(1,3)n;
select throws_ok($$insert into public.posts(author_id,city_id,tag_id,title,body,posted_on,room_preview) values('72000000-0000-0000-0000-000000000002','vancouver',5,'네 번째 모임','함께 산책할 사람을 구해요.',current_date,'{"capacity":8}')$$,'P0001','MEETUP_LIMIT_REACHED','direct inserts cannot bypass free group cap');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values('73000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000003','vancouver',5,'다른 모임','참여 승인을 기다립니다.',current_date,'{"capacity":8}');
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.request_meetup_join('73000000-0000-0000-0000-000000000004') as join_id \gset
select is((public.get_membership()->>'meetupsUsed')::integer,3,'pending request leaves occupied slots unchanged');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.respond_meetup_request(%L,''approved'')',:'join_id'),'P0001','REQUESTER_MEETUP_LIMIT_REACHED','approval rejects applicant with all slots occupied');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.leave_meetup('73000000-0000-0000-0000-000000000001');
select is((public.get_membership()->>'meetupSlotsAvailable')::integer,0,'leaving full pool does not immediately permit hopping');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.respond_meetup_request(%L,''approved'')',:'join_id'),'P0001','REQUESTER_MEETUP_LIMIT_REACHED','locked slot also prevents approval');
reset role;
update private.relationship_cooldowns set unlocks_at=now()-interval '1 second' where user_id='72000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok(format('select public.respond_meetup_request(%L,''approved'')',:'join_id'),'approval succeeds after the cooldown expires');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupsUsed')::integer,3,'two owned and one joined consume exactly three');
select throws_ok($$select public.leave_meetup('73000000-0000-0000-0000-000000000099')$$,'P0001','MEETUP_NOT_FOUND','unrelated group cannot be modified');
reset role;
-- Direct slots are concurrent; yesterday's active rooms still count and pending ones do not.
insert into public.conversations(user_low_id,user_high_id,created_at)
select '72000000-0000-0000-0000-000000000004',('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()-interval '2 days' from generate_series(5,7)n;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select public.start_conversation('72000000-0000-0000-0000-000000000008') as direct_id \gset
select is((public.get_membership()->>'conversationsUsed')::integer,3,'prior-day active rooms still consume slots');
select is(public.get_membership()->>'conversationPeriod','active','membership exposes concurrent period');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'direct_id'),'P0001','OTHER_CONVERSATION_LIMIT_REACHED','acceptance rechecks requester capacity too');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000004',jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','plus','store','app_store','will_renew',true)),now());
set local role authenticated;
select lives_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'direct_id'),'plus capacity permits a fourth concurrent room');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000004','[]',now()+interval '1 second');
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationsUsed')::integer,4,'downgrade preserves all existing conversations');
select is((public.get_membership()->>'conversationSlotsAvailable')::integer,0,'downgrade cannot add another over-limit slot');
select lives_ok(format('select public.send_message(%L,''기존 대화는 유지해요.'')',:'direct_id'),'downgrade does not block existing messages');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','premium','store','app_store','will_renew',true)),now()+interval '1 second');
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupLimit')::integer,10,'premium has ten group slots');
select is((public.get_membership()->>'conversationLimit')::integer,10,'premium separately has ten direct slots');
select is((public.get_membership()->>'postLimit')::integer,5,'premium daily posts remain five');
reset role;
select * from finish();
rollback;
