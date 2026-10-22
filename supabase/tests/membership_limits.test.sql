begin;
select no_plan();
insert into auth.users(id,email)
select ('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'membership-limit-'||n||'@example.com' from generate_series(1,8)n;
insert into public.profiles(id,nickname,city_id)
select ('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, '구독한도검증'||n, 'vancouver' from generate_series(1,8)n;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_post('vancouver',1::smallint,'무료 첫 번째 글','오늘의 동네 이야기입니다.')$$,'free can write once');
select lives_ok($$select public.create_post('vancouver',1::smallint,'무료 두 번째 글','오늘의 동네 이야기입니다.')$$,'free can write a second story today');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','plus','store','app_store','will_renew',true)),now());
set local role authenticated;
select lives_ok($$select public.create_post('vancouver',1::smallint,'구독 두 번째 글','오늘의 동네 이야기입니다.')$$,'verified plus immediately allows a second post');
select lives_ok($$select public.create_post('vancouver',1::smallint,'구독 세 번째 글','오늘의 동네 이야기입니다.')$$,'paid members use the same unlimited story policy');
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
-- Group exits never lock a slot (0065). The seat comes back at once and the anti-abuse rule is the
-- 12-hour participation block, which the meetup_abuse_limits suite covers.
select is((public.get_membership()->>'meetupSlotsAvailable')::integer,1,'leaving a meetup frees the seat at once');
select is((public.get_membership()->>'meetupSlotsLocked')::integer,0,'group exits leave no 24-hour slot lock');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok(format('select public.respond_meetup_request(%L,''approved'')',:'join_id'),'approval succeeds right after the applicant leaves a seat');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupsUsed')::integer,3,'two owned and one joined consume exactly three');
select throws_ok($$select public.leave_meetup('73000000-0000-0000-0000-000000000099')$$,'P0001','MEETUP_NOT_FOUND','unrelated group cannot be modified');
reset role;
-- Direct rooms are free and unlimited; membership changes preserve their history.
insert into public.conversations(user_low_id,user_high_id,created_at)
select '72000000-0000-0000-0000-000000000004',('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()-interval '2 days' from generate_series(5,6)n;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select public.start_conversation('72000000-0000-0000-0000-000000000008') as direct_id \gset
select is((public.get_membership()->>'conversationsUsed')::integer,3,'existing rooms and immediate new contact are reported without a quota');
select is(public.get_membership()->>'conversationPeriod','active','membership exposes concurrent period');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select lives_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'direct_id'),'legacy acceptance is an idempotent no-op without a capacity check');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000004',jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','plus','store','app_store','will_renew',true)),now());
set local role authenticated;
select lives_ok(format('select public.respond_direct_conversation(%L,''accepted'')',:'direct_id'),'legacy acceptance remains idempotent after a subscription change');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000004','[]',now()+interval '1 second');
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'conversationsUsed')::integer,3,'downgrade preserves all existing conversations');
select is(public.get_membership()->'conversationSlotsAvailable','null'::jsonb,'downgrade leaves direct contact unlimited');
select lives_ok(format('select public.send_message(%L,''기존 대화는 유지해요.'')',:'direct_id'),'downgrade does not block existing messages');
reset role;
select public.apply_membership_snapshot('72000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','premium','store','app_store','will_renew',true)),now()+interval '1 second');
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupLimit')::integer,20,'premium has twenty group slots');
select is(public.get_membership()->'conversationLimit','null'::jsonb,'premium uses the same unlimited direct policy');
select is((public.get_membership()->>'postLimit')::integer,3,'legacy post limit field remains for older clients');
reset role;
select * from finish();
rollback;
