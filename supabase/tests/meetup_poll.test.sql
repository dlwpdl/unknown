begin;
select no_plan();

insert into public.cities(id,name,province,timezone) values('poll-test','Poll','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label) values(31998,'poll-test','Poll') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data)
select ('a1710000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'poll-'||n||'@example.invalid','{}' from generate_series(1,5)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select id,'polltest'||right(id::text,2),'poll-test',now(),now(),now() from auth.users where id::text like 'a1710000%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"함께 걸어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}' from public.profiles where id::text like 'a1710000%';
-- 1 host, 2 member, 3 cohost (also a member), 4 member who never votes, 5 stranger
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
('a1720000-0000-0000-0000-000000000001','a1710000-0000-0000-0000-000000000001','poll-test',31998,'한 번 모임','본문 첫 줄',current_date,
  jsonb_build_object('eventKind','once','capacity',8,'startsAt',now()+interval '5 days','endsAt',now()+interval '5 days 2 hours','timezone','America/Vancouver')),
('a1720000-0000-0000-0000-000000000002','a1710000-0000-0000-0000-000000000001','poll-test',31998,'정기 모임','본문',current_date,'{"eventKind":"group","capacity":8,"cadence":"매주"}');
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select p.id,'a1710000-0000-0000-0000-000000000001',('a1710000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'approved'
from public.posts p cross join generate_series(2,4)n where p.id::text like 'a1720000%';
-- Cohosts are a paid-host feature today (limit by the host's tier); the poll follows whoever the existing tool treats as a cohost.
insert into private.membership_accounts(user_id,entitlements,observed_at)
values('a1710000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('tier','pro','kind','general','plan_version','2','expires_at',now()+interval '30 days')),now());
insert into private.meetup_cohosts(post_id,user_id,status,accepted_at) select id,'a1710000-0000-0000-0000-000000000003','accepted',now() from public.posts where id::text like 'a1720000%';

select ok(not has_table_privilege('authenticated','private.meetup_polls','select'),'poll tables are closed to clients');
select ok(not has_table_privilege('authenticated','private.meetup_poll_votes','select'),'votes are closed to clients');

-- A member cannot open a poll; the host can.
select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001',array[now()+interval '6 days',now()+interval '7 days'],'{}')$$,'P0001','HOST_REQUIRED','members cannot open a poll');
select is(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001'),null,'no poll yet');
reset role;

select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001',array[now()+interval '6 days'],'{}')$$,'P0001','INVALID_POLL','one date alone is not a vote');
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001','{}','{}')$$,'P0001','INVALID_POLL','an empty poll is refused');
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001',array[now()-interval '1 day',now()+interval '2 days'],'{}')$$,'P0001','INVALID_POLL_DATE','past dates are refused');
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001','{}',array['카페','카페 '])$$,'P0001','INVALID_POLL_PLACE','duplicate places are refused');
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001','{}',array[repeat('가',61),'공원'])$$,'P0001','INVALID_POLL_PLACE','long places are refused');
select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001',array[now()+interval '6 days',now()+interval '7 days'],array['강가 공원','도서관 카페']) as poll1 \gset
select throws_ok($$select public.create_meetup_poll('a1720000-0000-0000-0000-000000000001','{}',array['가','나'])$$,'P0001','POLL_ALREADY_OPEN','only one open poll per meetup');
select is(jsonb_array_length(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->'options'),4,'host sees four options');
reset role;
select is((select count(*)::int from public.notifications where kind='meetup_changed' and body like '%날짜와 장소 투표가 열렸어요%'),3,'members and cohost hear about the poll once, the opener does not');

-- Voting: several picks, change, counts only.
select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select array_agg((o->>'id')::uuid order by o->>'kind',o->>'startsAt') as opts from jsonb_array_elements(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->'options') o \gset
select lives_ok(format($$select public.vote_meetup_poll(%L,%L::uuid[])$$,:'poll1',(:'opts'::uuid[])[1:2]),'a member picks two options');
select is((select sum((o->>'votes')::int)::int from jsonb_array_elements(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->'options') o),2,'two votes counted');
select lives_ok(format($$select public.vote_meetup_poll(%L,%L::uuid[])$$,:'poll1',(:'opts'::uuid[])[2:2]),'the member changes the vote');
select is((select sum((o->>'votes')::int)::int from jsonb_array_elements(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->'options') o),1,'changed vote replaces the old one');
select throws_ok(format($$select public.vote_meetup_poll(%L,array[gen_random_uuid()])$$,:'poll1'),'P0001','INVALID_POLL_VOTE','options must belong to the poll');
select ok(not (public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')::text like '%a1710000%'),'no voter identity is returned');
reset role;

select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001'),null,'strangers see nothing');
select throws_ok(format($$select public.vote_meetup_poll(%L,'{}')$$,:'poll1'),'P0001','MEETUP_NOT_FOUND','strangers cannot vote');
reset role;

-- Cohost decides a once-meetup: schedule moves, standard change notice fires, no second notice.
select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select (o->>'id')::uuid as date2 from jsonb_array_elements(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->'options') o where o->>'kind'='date' order by o->>'startsAt' desc limit 1 \gset
select (o->>'id')::uuid as place1 from jsonb_array_elements(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->'options') o where o->>'label'='도서관 카페' \gset
select throws_ok(format($$select public.decide_meetup_poll(%L,%L,null)$$,:'poll1',:'place1'),'P0001','POLL_OPTION_NOT_FOUND','a place cannot be picked as the date');
select lives_ok(format($$select public.decide_meetup_poll(%L,%L,%L)$$,:'poll1',:'date2',:'place1'),'cohost picks the winners');
reset role;
select is((select ((room_preview->>'startsAt')::timestamptz)=(select starts_at from private.meetup_poll_options where id=:'date2') from public.posts where id='a1720000-0000-0000-0000-000000000001'),true,'once-meetup start follows the poll');
select is((select (room_preview->>'endsAt')::timestamptz-(room_preview->>'startsAt')::timestamptz from public.posts where id='a1720000-0000-0000-0000-000000000001'),interval '2 hours','length is kept');
select ok((select body from public.posts where id='a1720000-0000-0000-0000-000000000001') like E'%\n\n장소: 도서관 카페','place line written');
select is((select count(*)::int from public.notifications where body like '%시간이나 장소가 바뀌었어요%' and user_id='a1710000-0000-0000-0000-000000000002'),1,'one standard change notice reaches members');
select is((select count(*)::int from public.notifications where body like '%투표 결과가 나왔어요%'),0,'no second notice when the change notice already went out');
select is((select status from private.meetup_polls where id=:'poll1'),'decided','poll is decided');
select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_poll('a1720000-0000-0000-0000-000000000001')->>'status','decided','members see the result');
select throws_ok(format($$select public.vote_meetup_poll(%L,'{}')$$,:'poll1'),'P0001','POLL_NOT_OPEN','a decided poll takes no votes');
reset role;

-- Recurring group: the winner becomes the next session; members are told.
select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_meetup_poll('a1720000-0000-0000-0000-000000000002',array[now()+interval '3 days',now()+interval '4 days'],'{}') as poll2 \gset
select (o->>'id')::uuid as gdate from jsonb_array_elements(public.get_meetup_poll('a1720000-0000-0000-0000-000000000002')->'options') o order by o->>'startsAt' limit 1 \gset
select lives_ok(format($$select public.decide_meetup_poll(%L,%L,null)$$,:'poll2',:'gdate'),'host decides the group poll');
reset role;
select is((select count(*)::int from private.meetup_sessions where post_id='a1720000-0000-0000-0000-000000000002'),1,'a session was created');
select is((select count(*)::int from private.meetup_attendance a join private.meetup_sessions s on s.id=a.session_id where s.post_id='a1720000-0000-0000-0000-000000000002'),4,'host and members are on the session');
select is((select count(*)::int from public.notifications where body like '%투표 결과가 나왔어요%'),3,'members hear the group result once');

-- Close without a winner.
select set_config('request.jwt.claims','{"sub":"a1710000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_meetup_poll('a1720000-0000-0000-0000-000000000002','{}',array['가','나']) as poll3 \gset
select lives_ok(format($$select public.decide_meetup_poll(%L,null,null)$$,:'poll3'),'host closes a poll without picking');
reset role;
select is((select status from private.meetup_polls where id=:'poll3'),'closed','closed');

-- Account deletion removes votes and the polls of the leaver's own meetups.
select private.purge_meetup_tool_account_data('a1710000-0000-0000-0000-000000000002');
select is((select count(*)::int from private.meetup_poll_votes where user_id='a1710000-0000-0000-0000-000000000002'),0,'votes are erased with the account');
select private.purge_meetup_tool_account_data('a1710000-0000-0000-0000-000000000001');
select is((select count(*)::int from private.meetup_polls where post_id::text like 'a1720000%'),0,'polls of a deleted host are erased');

select * from finish();
rollback;
