begin;
select no_plan();
insert into auth.users(id,email)
select ('65000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'limits65-'||n||'@example.test' from generate_series(1,8)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'제한검증'||right(id::text,2),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '65000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('65000000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid,
 ('65000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'vancouver',1,'테스트 모임','모임 내용',current_date,'{"capacity":8}' from generate_series(1,6)n;
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select id,author_id,'65000000-0000-0000-0000-000000000008','approved' from public.posts where id::text like '65000000-0000-0000-0001-%' and right(id::text,1)::int<=3;
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select public.leave_meetup('65000000-0000-0000-0001-000000000001');
select is((public.get_membership()->>'meetupSlotsLocked')::int,0,'first voluntary exit no longer locks a group slot');
select public.leave_meetup('65000000-0000-0000-0001-000000000001');
select public.leave_meetup('65000000-0000-0000-0001-000000000002');
select is((public.get_meetup_policy()->>'leaves24h')::int,2,'retry does not double count the same event');
select is(public.get_meetup_policy()->>'joinBlockedUntil',null,'two exits do not restrict participation');
select public.leave_meetup('65000000-0000-0000-0001-000000000003');
select is((public.get_meetup_policy()->>'joinBlockedUntil')::timestamptz,now()+interval '12 hours','third distinct exit starts exactly 12 hours');
select lives_ok($$select public.create_report('user','65000000-0000-0000-0000-000000000004','other','제한 중에도 신고 가능')$$,'restricted participant can still report');
insert into public.blocks(blocker_id,blocked_id) values('65000000-0000-0000-0000-000000000008','65000000-0000-0000-0000-000000000005');
select is((public.get_meetup_policy()->>'joinBlockedUntil')::timestamptz,now()+interval '12 hours','reporting and blocking do not reset restriction');
select throws_ok($$select public.request_meetup_join('65000000-0000-0000-0001-000000000004')$$,'P0001','MEETUP_JOIN_RESTRICTED','new requests blocked after third exit');
reset role;
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('65000000-0000-0000-0001-000000000004','65000000-0000-0000-0000-000000000004','65000000-0000-0000-0000-000000000008','approved')$$,'P0001','MEETUP_JOIN_RESTRICTED','approval cannot bypass participation restriction');
select ok(not has_table_privilege('authenticated','private.meetup_activity','SELECT,INSERT,UPDATE,DELETE'),'activity ledger is not client accessible');
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_meetup_policy()->>'leaves24h')::int,0,'status is self scoped');
reset role;
-- Age records, not the database clock, to exercise rolling-window boundaries.
update private.meetup_activity set occurred_at=now()-interval '24 hours',blocked_until=now() where user_id='65000000-0000-0000-0000-000000000008';
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_meetup_policy()->>'leaves24h')::int,0,'24h boundary is released');
select lives_ok($$select public.request_meetup_join('65000000-0000-0000-0001-000000000004')$$,'participation resumes at exact restriction boundary');
select lives_ok($$select public.leave_meetup('65000000-0000-0000-0001-000000000004')$$,'pending cancellation always allowed');
select is((public.get_meetup_policy()->>'leaves24h')::int,0,'pending cancellation does not count');
reset role;
-- Host closures count only when there are accepted participants.
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select public.save_chilling_profile('{"intro":"호스트","interests":["산책"],"promptOne":"바다","promptTwo":"주말"}');
select public.create_chilling_event('vancouver','첫 칠링','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문') as event1 \gset
select public.leave_meetup(:'event1');
select is((public.get_meetup_policy()->>'closures7d')::int,0,'empty cancellation is not early closure');
select public.create_chilling_event('vancouver','두 번째 칠링','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문') as event2 \gset
reset role;
insert into public.meetup_requests(post_id,host_id,requester_id,status) values(:'event2','65000000-0000-0000-0000-000000000007','65000000-0000-0000-0000-000000000008','approved');
set local role authenticated;
select public.leave_meetup(:'event2');
select is((public.get_meetup_policy()->>'closures7d')::int,1,'host early closure recorded once');
select is(public.get_meetup_policy()->>'hostBlockedUntil',null,'first closure does not restrict hosting');
select public.create_chilling_event('vancouver','세 번째 칠링','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문') as event3 \gset
select is((public.get_meetup_policy()->>'creates24h')::int,3,'cancelled events still count against creation quota');
select throws_ok($$select public.create_chilling_event('vancouver','네 번째 칠링','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문')$$,'P0001','CHILLING_CREATE_LIMIT','fourth one-off creation denied');
reset role;
insert into public.meetup_requests(post_id,host_id,requester_id,status) values(:'event3','65000000-0000-0000-0000-000000000007','65000000-0000-0000-0000-000000000008','approved');
set local role authenticated;
select public.configure_chilling_event(:'event3','once',now()+interval '1 day',now()+interval '25 hours','America/Vancouver');
select is((public.get_meetup_policy()->>'hostBlockedUntil')::timestamptz,now()+interval '24 hours','shortening with participants counts as second early closure');
select public.leave_meetup(:'event3');
select is((public.get_meetup_policy()->>'closures7d')::int,2,'shortening then closing same event counts only once');
select throws_ok($$select public.create_chilling_event('vancouver','정기모임 우회','소개','{"eventKind":"group","cadence":"매주","capacity":8}','질문')$$,'P0001','MEETUP_HOST_RESTRICTED','host restriction also covers recurring groups');
reset role;
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_meetup_policy()->>'leaves24h')::int,0,'host closures do not penalize participants');
reset role;
-- Convert an empty fixture to a one-off then simulate time passing.
select set_config('request.jwt.claims','{}',true);
update public.posts set room_preview=room_preview||jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver') where id='65000000-0000-0000-0001-000000000005';
insert into public.meetup_requests(post_id,host_id,requester_id,status) values('65000000-0000-0000-0001-000000000005','65000000-0000-0000-0000-000000000005','65000000-0000-0000-0000-000000000008','approved');
insert into public.meetup_requests(post_id,host_id,requester_id,status) values('65000000-0000-0000-0001-000000000005','65000000-0000-0000-0000-000000000005','65000000-0000-0000-0000-000000000007','pending');
alter table public.posts disable trigger posts_chilling_event_details;
alter table public.posts disable trigger posts_meetup_abuse;
alter table public.posts disable trigger posts_group_conversation;
update public.posts set room_preview=room_preview||jsonb_build_object('startsAt',now()-interval '2 days','endsAt',now()) where id='65000000-0000-0000-0001-000000000005';
alter table public.posts enable trigger posts_meetup_abuse;
alter table public.posts enable trigger posts_chilling_event_details;
alter table public.posts enable trigger posts_group_conversation;
select is(private.membership_meetup_count('65000000-0000-0000-0000-000000000008'),0,'expired event releases slot before scheduled cleanup');
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_conversation_inbox()->'items'),0,'current inbox hides natural expiry even before cron');
select is(public.get_conversation_inbox(p_conversation_id=>(select id from public.conversations where group_post_id='65000000-0000-0000-0001-000000000005'))->'selected'->>'status','ended','expired deep link remains read-only for reporting before cron');
reset role;
select lives_ok($$select private.expire_chilling_events()$$,'scheduled natural closure succeeds');
select is((select status from public.meetup_requests where post_id='65000000-0000-0000-0001-000000000005' and requester_id='65000000-0000-0000-0000-000000000007'),'cancelled','natural expiry clears pending applications');
select is((select status from public.meetup_requests where post_id='65000000-0000-0000-0001-000000000005' and requester_id='65000000-0000-0000-0000-000000000008'),'approved','natural expiry retains approved history for evidence access');
select is((select status from public.conversations where group_post_id='65000000-0000-0000-0001-000000000005'),'ended','natural expiry closes conversation');
select is((select count(*)::int from private.meetup_activity where post_id='65000000-0000-0000-0001-000000000005' and action in ('leave','close')),0,'natural expiry never adds penalties');
select ok(exists(select 1 from public.posts where id='65000000-0000-0000-0001-000000000005'),'expiry retains evidence');
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.get_conversation_previews() where group_post_id='65000000-0000-0000-0001-000000000005'),0,'expired room is removed from the participant inbox');
reset role;
select ok(not has_function_privilege('authenticated','private.expire_chilling_events()','EXECUTE'),'clients cannot invoke global expiry');
select ok(not has_function_privilege('anon','public.get_meetup_policy()','EXECUTE'),'guests cannot read policy status');
select set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_membership()->>'postsUsed')::int,0,'meetup creations do not consume daily story allowance');
reset role;
update private.meetup_activity set occurred_at=now()-interval '2 days',blocked_until=null where user_id='65000000-0000-0000-0000-000000000007';
insert into private.meetup_activity(user_id,post_id,action,occurred_at)
select '65000000-0000-0000-0000-000000000007',gen_random_uuid(),'create',now()-interval '2 days' from generate_series(1,7);
set local role authenticated;
select is((public.get_meetup_policy()->>'creates24h')::int,0,'daily window expires independently of weekly window');
select is((public.get_meetup_policy()->>'createBlockedUntil')::timestamptz,now()+interval '5 days','weekly release timestamp is exact');
select throws_ok($$select public.create_chilling_event('vancouver','주간 한도','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문')$$,'P0001','CHILLING_CREATE_LIMIT','eleventh weekly event is blocked');
reset role;
select public.apply_membership_snapshot('65000000-0000-0000-0000-000000000007',jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','premium','store','app_store','will_renew',true)),now());
set local role authenticated;
select throws_ok($$select public.create_chilling_event('vancouver','유료 우회','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문')$$,'P0001','CHILLING_CREATE_LIMIT','premium does not bypass abuse limits');
reset role;
update private.meetup_activity set occurred_at=now()-interval '7 days' where user_id='65000000-0000-0000-0000-000000000007';
set local role authenticated;
select is(public.get_meetup_policy()->>'createBlockedUntil',null,'weekly limit releases at exact seven-day boundary');
select lives_ok($$select public.create_chilling_event('vancouver','다시 개최','소개',jsonb_build_object('eventKind','once','startsAt',now()+interval '1 day','endsAt',now()+interval '2 days','timezone','America/Vancouver','capacity',8),'질문')$$,'creation resumes after weekly boundary');
reset role;
select * from finish();
rollback;
