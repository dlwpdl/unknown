begin;
select plan(19);
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
-- A free host already operates three groups; a fourth must be blocked, even via direct writes.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('73000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'72000000-0000-0000-0000-000000000002','vancouver',5,'구독 한도 모임 '||n,'함께 산책할 사람을 구해요.',current_date-n,jsonb_build_object('id','quota-'||n,'title','모임','memberCount',1,'capacity',8) from generate_series(1,3)n;
select throws_ok($$insert into public.posts(author_id,city_id,tag_id,title,body,posted_on,room_preview) values('72000000-0000-0000-0000-000000000002','vancouver',5,'네 번째 모임','함께 산책할 사람을 구해요.',current_date,'{"id":"four","memberCount":1,"capacity":8}')$$,'P0001','MEETUP_LIMIT_REACHED','all group creation paths enforce active-group cap');
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('73000000-0000-0000-0000-000000000001')$$,'host can close a group without deleting its history');
select is((public.get_membership()->>'meetupsUsed')::integer,2,'closing frees a group slot');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.request_meetup_join('73000000-0000-0000-0000-000000000001')$$,'P0001','MEETUP_CLOSED','closed groups cannot be joined');
select public.start_conversation('72000000-0000-0000-0000-000000000004');
reset role;
update private.action_rate_events set created_at=now()-interval '2 minutes' where action='conversation' and user_id='72000000-0000-0000-0000-000000000003';
set local role authenticated;
select public.start_conversation('72000000-0000-0000-0000-000000000005');
reset role;
update private.action_rate_events set created_at=now()-interval '2 minutes' where action='conversation' and user_id='72000000-0000-0000-0000-000000000003';
set local role authenticated;
select public.start_conversation('72000000-0000-0000-0000-000000000006');
select throws_ok($$select public.start_conversation('72000000-0000-0000-0000-000000000007')$$,'P0001','DAILY_CONVERSATION_LIMIT_REACHED','free allows only three new conversations per local day');
select lives_ok($$select public.start_conversation('72000000-0000-0000-0000-000000000004')$$,'existing conversations remain available after the cap');
select is((public.get_membership()->>'conversationsUsed')::integer,3,'retrying an existing conversation does not consume quota');
select lives_ok($$select public.send_message(public.start_conversation('72000000-0000-0000-0000-000000000004'),'이어서 대화할 수 있어요.')$$,'messages are not blocked by the new-conversation cap');
reset role;
insert into public.meetup_requests(id,post_id,host_id,requester_id) values('74000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000008');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('73000000-0000-0000-0000-'||lpad((10+n)::text,12,'0'))::uuid,'72000000-0000-0000-0000-000000000008','vancouver',5,'참여 한도 모임 '||n,'함께 산책할 사람을 구해요.',current_date-n,jsonb_build_object('id','join-quota-'||n,'memberCount',1,'capacity',8) from generate_series(1,3)n;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.request_meetup_join('73000000-0000-0000-0000-000000000003')$$,'P0001','MEETUP_LIMIT_REACHED','owned and joined groups share the same allowance');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_request('74000000-0000-0000-0000-000000000001','approved')$$,'P0001','REQUESTER_MEETUP_LIMIT_REACHED','approval rechecks quota after a pending request');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select public.leave_meetup('73000000-0000-0000-0000-000000000011');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request('74000000-0000-0000-0000-000000000001','approved')$$,'approval succeeds once a slot is free');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'meetupsUsed')::integer,3,'approved membership consumes exactly one slot');
select public.leave_meetup('73000000-0000-0000-0000-000000000002');
select is((public.get_membership()->>'meetupsUsed')::integer,2,'leaving an approved meetup frees the slot');
select throws_ok($$select public.leave_meetup('73000000-0000-0000-0000-000000000003')$$,'P0001','REQUEST_NOT_FOUND','nonparticipants cannot close or change someone else’s group');
reset role;
insert into auth.users(id,email)
select ('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'membership-history-'||n||'@example.com' from generate_series(9,39)n;
insert into public.profiles(id,nickname,city_id)
select ('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, '이전대화검증'||n, 'vancouver' from generate_series(9,39)n;
insert into public.conversations(user_low_id,user_high_id)
select '72000000-0000-0000-0000-000000000007',('72000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(9,38)n;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.start_conversation('72000000-0000-0000-0000-000000000039')$$,'historical contacts do not permanently exhaust today’s allowance');
reset role;
select * from finish();
rollback;
