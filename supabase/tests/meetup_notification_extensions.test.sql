begin;
select no_plan();
select has_table('private','meetup_notification_notices','private recipient-bound meetup snapshots exist');
select has_function('private','send_meetup_reminders',array['timestamp with time zone'],'scheduled in-app reminders exist');
select results_eq($$select slot from private.meetup_reminder_times('2030-06-10 22:00Z','America/Vancouver') order by due_at$$,array['day_before','morning','hour_before'],'three reminder stages');
select results_eq($$select due_at from private.meetup_reminder_times('2030-06-10 22:00Z','America/Vancouver') order by due_at$$,array['2030-06-09 22:00Z'::timestamptz,'2030-06-10 16:00Z'::timestamptz,'2030-06-10 21:00Z'::timestamptz],'morning uses event timezone');
select is((select count(*)::int from private.meetup_reminder_times('2030-06-10 17:00Z','America/Vancouver')),2,'10am start merges morning and one-hour reminder');
select is((select count(*)::int from private.meetup_reminder_times('2030-06-10 15:00Z','America/Vancouver')),2,'8am start skips morning after start');
select is((select due_at from private.meetup_reminder_times('2030-03-10 22:00Z','America/Vancouver') where slot='day_before'),'2030-03-09 22:00Z'::timestamptz,'day-before is exactly 24 hours across DST');
select ok(not has_function_privilege('authenticated','private.send_meetup_reminders(timestamptz)','execute'),'clients cannot send reminders');
select ok(not has_table_privilege('authenticated','private.meetup_reminder_deliveries','insert'),'clients cannot forge delivery history');

-- Isolate scheduled fixtures from unrelated dated meetups; rollback restores them.
update public.posts set room_preview=jsonb_set(room_preview,'{closed}','true')
where room_preview->>'eventKind'='once' and coalesce(room_preview->>'closed','false')<>'true';

insert into auth.users(id,email) select ('a1020000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'reminder102-'||n||'@example.test' from generate_series(1,4) n;
insert into public.profiles(id,nickname,city_id) select id,'일정검사102-'||right(id::text,1),'vancouver' from auth.users where id::text like 'a1020000-%';
insert into auth.sessions(id,user_id,created_at) values ('a1020000-0000-0000-0000-000000000020','a1020000-0000-0000-0000-000000000001',now());
insert into private.push_devices(user_id,session_id,token) values ('a1020000-0000-0000-0000-000000000001','a1020000-0000-0000-0000-000000000020','ExpoPushToken[reminder102testdevice]');
insert into public.notification_preferences(user_id,push_enabled) values ('a1020000-0000-0000-0000-000000000001',true);
create temp table reminder_clock as select (((now() at time zone 'America/Vancouver')::date+3)+time '15:00') at time zone 'America/Vancouver' as start;
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview)
select 'a1020000-0000-0000-0000-000000000010','a1020000-0000-0000-0000-000000000001','vancouver',1,'일정 알림 테스트','본문',
jsonb_build_object('eventKind','once','startsAt',start,'endsAt',start+interval '2 hours','timezone','America/Vancouver','capacity',8)
from reminder_clock;
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at) values
('a1020000-0000-0000-0000-000000000010','a1020000-0000-0000-0000-000000000001','a1020000-0000-0000-0000-000000000002','approved',now()),
('a1020000-0000-0000-0000-000000000010','a1020000-0000-0000-0000-000000000001','a1020000-0000-0000-0000-000000000003','pending',null);
select is(private.send_meetup_reminders((select start-interval '24 hours 1 second' from reminder_clock)),0,'not sent early');
select is(private.send_meetup_reminders((select start-interval '24 hours' from reminder_clock)),2,'host and approved participant receive reminder');
select is(private.send_meetup_reminders((select start-interval '24 hours'+interval '20 seconds' from reminder_clock)),0,'retry cannot duplicate reminder');
select is((select count(*)::int from public.notifications where kind='meetup_reminder' and user_id in ('a1020000-0000-0000-0000-000000000003','a1020000-0000-0000-0000-000000000004')),0,'pending and unrelated users excluded');
select ok((select bool_and(category='meetups' and target_type='meetup_notice' and route='/post/a1020000-0000-0000-0000-000000000010') from public.notifications where kind='meetup_reminder'),'existing category and detail route');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='meetup_reminder'),1,'24-hour reminder reaches registered host push');
insert into public.notification_preferences(user_id,meetups) values ('a1020000-0000-0000-0000-000000000002',false);
select is(private.send_meetup_reminders((select start-interval '6 hours' from reminder_clock)),1,'9am local respects opt-out and still reminds host');
update public.notification_preferences set meetups=true where user_id='a1020000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims','{"sub":"a1020000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.leave_meetup('a1020000-0000-0000-0000-000000000010');
reset role;
select set_config('request.jwt.claims','{}',true);
select ok(not private.notification_target_visible('a1020000-0000-0000-0000-000000000002','meetup_notice',(select target_id from public.notifications where kind='meetup_reminder' and user_id='a1020000-0000-0000-0000-000000000002' limit 1)),'member departure invalidates earlier queued recipient notice');
select is(private.send_meetup_reminders((select start-interval '1 hour' from reminder_clock)),1,'member who left receives no one-hour reminder');
select ok((select exists(select 1 from public.notifications where kind='meetup_reminder' and user_id='a1020000-0000-0000-0000-000000000001' and body like '%1시간 뒤%')),'one-hour reminder copy');
-- Rescheduling uses the current schedule, not a previously enqueued job.
update public.posts set room_preview=room_preview||jsonb_build_object('startsAt',(select start+interval '1 day' from reminder_clock),'endsAt',(select start+interval '1 day 2 hours' from reminder_clock)) where id='a1020000-0000-0000-0000-000000000010';
select is(private.send_meetup_reminders((select start from reminder_clock)),1,'new start receives its own day-before reminder');
select is(private.send_meetup_reminders((select start+interval '23 hours 2 minutes' from reminder_clock)),0,'missed reminder is not backfilled');
select is(private.send_meetup_reminders((select start+interval '1 day' from reminder_clock)),0,'already started event sends nothing');
update public.posts set room_preview=room_preview||'{"closed":true}' where id='a1020000-0000-0000-0000-000000000010';
select is(private.send_meetup_reminders((select start+interval '23 hours' from reminder_clock)),0,'closed meetup sends nothing');
select is((select count(*)::int from public.notifications where kind='meetup_morning' and user_id='a1020000-0000-0000-0000-000000000001'),1,'morning is distinct inbox notice');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='meetup_morning'),0,'morning stays inbox only');
select ok(not private.notification_target_visible('a1020000-0000-0000-0000-000000000004','meetup_notice',(select target_id from public.notifications where kind='meetup_reminder' limit 1)),'unrelated account cannot read private notice');
select is((select count(*)::int from public.notifications where kind='meetup_changed' and user_id='a1020000-0000-0000-0000-000000000001'),1,'actual reschedule notifies host once');
select is((select count(*)::int from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000001'),1,'early close notifies host once');
select ok(not private.notification_target_visible('a1020000-0000-0000-0000-000000000001','meetup_notice',(select target_id from public.notifications where kind='meetup_reminder' limit 1)),'closed/rescheduled reminder is stale');
update public.posts set room_preview=room_preview where id='a1020000-0000-0000-0000-000000000010';
select is((select count(*)::int from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000001'),1,'unchanged closed save is idempotent');
-- Reopen only inside the rollback fixture to exercise place changes and natural expiry.
alter table public.posts disable trigger posts_membership_limit;
update public.posts set room_preview=room_preview||'{"closed":false}' where id='a1020000-0000-0000-0000-000000000010';
alter table public.posts enable trigger posts_membership_limit;
update public.posts set body=body||E'\n\nGoogle 지도: https://maps.app.goo.gl/meetup151' where id='a1020000-0000-0000-0000-000000000010';
select is((select count(*)::int from public.notifications where kind='meetup_changed' and user_id='a1020000-0000-0000-0000-000000000001'),2,'actual map/place change produces one notice');
update public.posts set body=body||' ' where id='a1020000-0000-0000-0000-000000000010';
select is((select count(*)::int from public.notifications where kind='meetup_changed' and user_id='a1020000-0000-0000-0000-000000000001'),2,'map whitespace save produces no notice');
update public.meetup_requests set status='approved',responded_at=now() where post_id='a1020000-0000-0000-0000-000000000010' and requester_id='a1020000-0000-0000-0000-000000000002';
update public.posts set room_preview=room_preview||'{"closed":true}' where id='a1020000-0000-0000-0000-000000000010';
update public.meetup_requests set status='cancelled',responded_at=now() where post_id='a1020000-0000-0000-0000-000000000010' and status in ('approved','pending');
select is((select count(*)::int from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000002'),1,'closure reaches current approved member once');
select ok(private.notification_target_visible('a1020000-0000-0000-0000-000000000002','meetup_notice',(select target_id from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000002' limit 1)),'closure notice survives closure cancelling request');
select is((select count(*)::int from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000003'),0,'pending applicant excluded from cancellation');
-- Isolate claim work to fixture devices, then confirm old schedules are cancelled by the worker.
update private.push_delivery_queue set next_attempt_at=now()+interval '1 day' where device_id not in
  (select id from private.push_devices where user_id='a1020000-0000-0000-0000-000000000001');
select count(*) from public.claim_push_notifications('send',100);
select ok((select bool_and(q.status='cancelled') from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
  where n.kind='meetup_reminder' and n.user_id='a1020000-0000-0000-0000-000000000001'),'claim cancels queued reminders for an obsolete schedule');
select ok(not has_table_privilege('authenticated','private.meetup_notification_notices','insert'),'client cannot forge private meetup notices');
-- Seed an already elapsed schedule as a database-owner rollback fixture, then use the real expiry job.
create temp table cancellation_count as select count(*)::int n from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000001';
alter table public.posts disable trigger posts_chilling_event_details;
alter table public.posts disable trigger posts_membership_limit;
update public.posts set room_preview=room_preview||jsonb_build_object('closed',false,'startsAt',now()-interval '3 hours','endsAt',now()-interval '1 hour') where id='a1020000-0000-0000-0000-000000000010';
alter table public.posts enable trigger posts_chilling_event_details;
alter table public.posts enable trigger posts_membership_limit;
select private.expire_chilling_events();
select is((select count(*)::int from public.notifications where kind='meetup_cancelled' and user_id='a1020000-0000-0000-0000-000000000001'),(select n from cancellation_count),'natural expiry sends no cancellation notice');
select * from finish();
rollback;
