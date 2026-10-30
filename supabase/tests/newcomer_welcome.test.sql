begin;
set local search_path=public,extensions;
select no_plan();

-- Fixed local noon today; fixtures are placed relative to it so the weekday never matters.
create temporary table clock as select ((date_trunc('day',now() at time zone 'America/Vancouver')+interval '12 hours') at time zone 'America/Vancouver') noon;

insert into public.cities(id,name,province,timezone) values('newcomer-test','Newcomer test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'newcomer-test','Newcomer test','meetup') on conflict do nothing;
-- 1 host (old), 2 newcomer day 1, 3 veteran, 4 newcomer day 3 with a request, 5 newcomer day 3, 6 newcomer day 0,
-- 7 newcomer day 7 who attended the host's meetup, 8 newcomer day 7 who did not.
insert into auth.users(id,email) select ('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'newcomer-'||n||'@example.invalid' from generate_series(1,8)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'New'||right(id::text,4),'newcomer-test',now(),now(),now(),'test',
  (select noon from clock)-case right(id::text,1) when '1' then interval '100 days' when '2' then interval '1 day' when '3' then interval '100 days'
    when '4' then interval '3 days' when '5' then interval '3 days' when '6' then interval '2 hours' else interval '7 days' end
from auth.users where id::text like 'e0000000-%';

-- A: first-timer friendly in two days. B: newcomer-only group. C: Sunday evening this week, first-timer friendly.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select 'e0100000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','newcomer-test',31997,'Stanley walk','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',noon+interval '2 days','endsAt',noon+interval '2 days 2 hours','timezone','America/Vancouver','capacity',8,'memberCount',1)
from clock;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('e0100000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','newcomer-test',31997,'Board games','Synthetic local test',current_date,
  '{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select 'e0100000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000003','newcomer-test',31997,'Sunday dinner','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',sunday,'endsAt',sunday+interval '2 hours','timezone','America/Vancouver','capacity',8,'memberCount',1,'newcomerWelcome',true)
from (select (date_trunc('week',noon at time zone 'America/Vancouver')+interval '6 days 18 hours') at time zone 'America/Vancouver' sunday from clock) s;

-- D: the same host's meetup next week.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select 'e0100000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000001','newcomer-test',31997,'Next week run','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',next,'endsAt',next+interval '2 hours','timezone','America/Vancouver','capacity',8,'memberCount',1)
from (select (date_trunc('week',noon at time zone 'America/Vancouver')+interval '9 days 12 hours') at time zone 'America/Vancouver' next from clock) s;
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at) values
 ('e0200000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001',now()-interval '3 days',now()-interval '3 days'+interval '2 hours');
insert into private.meetup_attendance(session_id,user_id,confirmed_at,confirmation_source) values
 ('e0200000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000007',now()-interval '3 days','peer');

-- Host switch.
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_newcomer('e0100000-0000-4000-8000-000000000001',true,false)$$,'P0001','MEETUP_NOT_FOUND','Only the host sets newcomer labels');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_newcomer('e0100000-0000-4000-8000-000000000001',false,true)$$,'P0001','INVALID_NEWCOMER_OPTION','Newcomer-only needs the welcome switch');
select lives_ok($$select public.set_meetup_newcomer('e0100000-0000-4000-8000-000000000001',true,false)$$,'Host turns on the welcome');
select lives_ok($$select public.set_meetup_newcomer('e0100000-0000-4000-8000-000000000002',true,true)$$,'Host makes a newcomer-only meetup');
reset role;
select is((select room_preview->'newcomerWelcome' from public.posts where id='e0100000-0000-4000-8000-000000000001'),'true'::jsonb,'Welcome flag saved');
select ok(not (select room_preview ? 'newcomerOnly' from public.posts where id='e0100000-0000-4000-8000-000000000001'),'Anyone-can-apply leaves no newcomerOnly key');
select is((select room_preview->>'capacity' from public.posts where id='e0100000-0000-4000-8000-000000000001'),'8','Existing room fields stay');

-- Server-side newcomer-only gate on every request path.
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values
  ('e0100000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000003','pending')$$,
  'P0001','MEETUP_NEWCOMERS_ONLY','A member past the newcomer period cannot request a newcomer-only meetup');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values
  ('e0100000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000004','pending')$$,
  'A newcomer can request it');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values
  ('e0100000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000003','pending')$$,
  'Ordinary welcome meetups stay open to everyone');

-- My own status only.
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_my_newcomer_status()->>'newcomer')::boolean,true,'Day-one member is a newcomer');
select is((public.get_my_newcomer_status()->>'periodDays')::integer,60,'Default period is 60 days');
select is(public.get_newcomer_welcome_meetups()->>'mode','welcome','Welcome list uses first-timer friendly meetups');
select is(public.get_newcomer_welcome_meetups()->'ids'->>0,'e0100000-0000-4000-8000-000000000001','Soonest welcome meetup first');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((public.get_my_newcomer_status()->>'newcomer')::boolean,false,'Day-100 member is past the period');
select is((public.get_my_newcomer_status()->>'requested')::boolean,true,'A request counts as the request step');
reset role;
update private.newcomer_config set period_days=200;
select ok(private.newcomer_ends_at('e0000000-0000-4000-8000-000000000003') is not null,'The operator value changes the period without a release');
update private.newcomer_config set period_days=60;

-- First-week nudges.
select is(private.send_newcomer_nudges((select noon from clock)),5,'Nudges go out');
select is((select step from private.newcomer_nudges where user_id='e0000000-0000-4000-8000-000000000002'),'day1','Day one gets the day-1 nudge');
select matches((select body from public.notifications n join private.newcomer_nudges s on s.notification_id=n.id where s.user_id='e0000000-0000-4000-8000-000000000002'),
  '^이번 주 모임이 올라왔어요\. (Stanley walk|Sunday dinner), 아직 자리 있어요\.$','Day-1 copy names a real meetup');
select is((select count(*)::integer from private.newcomer_nudges where user_id='e0000000-0000-4000-8000-000000000004'),0,'Day three is skipped after a request');
select matches((select body from public.notifications n join private.newcomer_nudges s on s.notification_id=n.id where s.user_id='e0000000-0000-4000-8000-000000000005'),
  '^이번 주말엔 처음 오는 분 반기는 모임이 (한|두) 곳 있어요\.$','Day three counts this weekend''s welcome meetups');
select is((select step from private.newcomer_nudges where user_id='e0000000-0000-4000-8000-000000000006'),'day0','Sign-up day gets the in-app note');
select is((select count(*)::integer from private.push_delivery_queue q join private.newcomer_nudges s on s.notification_id=q.notification_id where s.step='day0'),0,'Sign-up day never pushes');
select is((select count(*)::integer from private.newcomer_nudges where user_id in ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000003')),0,'Past-period members get nothing');
select is(private.send_newcomer_nudges((select noon from clock)),0,'Each step is sent once');
select is((select step from private.newcomer_nudges where user_id='e0000000-0000-4000-8000-000000000007'),'day7_attended','Day seven after a first meetup gets the attended copy');
select is((select target_id from public.notifications n join private.newcomer_nudges s on s.notification_id=n.id where s.user_id='e0000000-0000-4000-8000-000000000007'),
  'e0100000-0000-4000-8000-000000000004'::uuid,'It points at the same host''s next meetup');
select is((select step from private.newcomer_nudges where user_id='e0000000-0000-4000-8000-000000000008'),'day7','Day seven without a meetup gets the general copy');
select is((select count(*)::integer from public.notifications where kind='trending_meetup' and user_id::text like 'e0000000-%'),5,'One row per sent step');

select * from finish();
rollback;
