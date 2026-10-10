begin;
select no_plan();

select has_function('private','send_daily_city_digest',array['timestamp with time zone'],'daily recommendation generator exists');

-- Isolate the rollback fixture from other local sample content.
update public.posts set status='removed';
delete from private.trending_topic_sent where kind='daily_city_digest';
update private.trending_config set enabled=true,quiet_start_hour=22,quiet_end_hour=8,min_score=1000000 where id;

insert into auth.users(id,email,raw_app_meta_data) values
('13600000-0000-0000-0000-000000000001','digest-author@example.test','{}'),
('13600000-0000-0000-0000-000000000002','digest-reader@example.test','{}'),
('13600000-0000-0000-0000-000000000003','digest-push-off@example.test','{}'),
('13600000-0000-0000-0000-000000000004','digest-category-off@example.test','{}'),
('13600000-0000-0000-0000-000000000005','digest-expired@example.test','{}'),
('13600000-0000-0000-0000-000000000006','digest-toronto@example.test','{}'),
('13600000-0000-0000-0000-000000000007','digest-blocked@example.test','{}'),
('13600000-0000-0000-0000-000000000008','digest@seed.gling.invalid','{}'),
('13600000-0000-0000-0000-000000000009','digest-review@example.test','{"review_access":true}');
insert into public.profiles(id,nickname,city_id)
select id,'digest'||right(id::text,2),case when right(id::text,1)='6' then 'toronto' else 'vancouver' end
from auth.users where id::text like '13600000-%';
insert into public.notification_preferences(user_id,push_enabled,trending)
select id,id not in ('13600000-0000-0000-0000-000000000001','13600000-0000-0000-0000-000000000003'),
  id<>'13600000-0000-0000-0000-000000000004'
from public.profiles where id::text like '13600000-%';
insert into auth.sessions(id,user_id,created_at,not_after)
select id,id,now(),case when right(id::text,1)='5' then now()-interval '1 hour' else null end
from public.profiles where id::text like '13600000-%';
insert into private.push_devices(user_id,session_id,token)
select id,id,'ExpoPushToken[digest_test_device_'||right(id::text,2)||']'
from public.profiles where id::text like '13600000-%';
insert into public.blocks(blocker_id,blocked_id) values
('13600000-0000-0000-0000-000000000007','13600000-0000-0000-0000-000000000001');
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at) values
('13610000-0000-0000-0000-000000000001','13600000-0000-0000-0000-000000000001','vancouver',1,'New Vancouver story','Fresh readable content','2026-10-08 21:00Z'),
('13610000-0000-0000-0000-000000000002','13600000-0000-0000-0000-000000000001','toronto',1,'New Toronto story','Fresh readable content','2026-10-08 21:00Z'),
('13610000-0000-0000-0000-000000000003','13600000-0000-0000-0000-000000000008','vancouver',1,'Seed story','Seed content excluded','2026-10-08 23:00Z'),
('13610000-0000-0000-0000-000000000004','13600000-0000-0000-0000-000000000009','vancouver',1,'Review story','Review content excluded','2026-10-08 23:00Z');

select lives_ok($$select private.send_daily_city_digest('2026-10-09 00:45Z')$$,'17:45 local does not send early');
select is((select count(*)::int from public.notifications where user_id::text like '13600000-%'),0,'no early recommendation');
select lives_ok($$select private.send_daily_city_digest('2026-10-09 01:00Z')$$,'18:00 Vancouver schedules a fresh recommendation below the popularity floor');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),1,'opted-in reader receives it');
select is((select count(*)::int from public.notifications where user_id::text like '13600000-%'),1,'push-off/category-off/expired/blocked/seed/review and other city recipients are excluded');
select is((select target_id from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),
  '13610000-0000-0000-0000-000000000001'::uuid,'the real fresh post is chosen over newer seed/review content');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id::text like '13600000-%'),1,'existing push queue receives the recommendation');
select lives_ok($$select private.send_daily_city_digest('2026-10-09 01:15Z')$$,'a second scheduled run is safe');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),1,'no duplicate city/day notification');

select lives_ok($$select private.send_daily_city_digest('2026-10-08 22:00Z')$$,'Toronto uses its own 18:00');
select is((select target_id from public.notifications where user_id='13600000-0000-0000-0000-000000000006'),
  '13610000-0000-0000-0000-000000000002'::uuid,'Toronto gets Toronto content');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),1,'Toronto time does not resend Vancouver');

insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at) values
('13610000-0000-0000-0000-000000000005','13600000-0000-0000-0000-000000000001','vancouver',1,'Next day story','Fresh content on the next day','2026-10-09 21:00Z');
select lives_ok($$select private.send_daily_city_digest('2026-10-10 01:45Z')$$,'late recovery is safe');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),1,'an outage does not replay the missed 18:00 slot');
select lives_ok($$select private.send_daily_city_digest('2026-10-10 01:00Z')$$,'next local day can receive a new story');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),2,'one recommendation on each eligible day');
select lives_ok($$select private.send_daily_city_digest('2026-10-11 01:00Z')$$,'a day without new eligible content is safe');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),2,'old stories are not repeated');

insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at) values
('13610000-0000-0000-0000-000000000006','13600000-0000-0000-0000-000000000001','vancouver',1,'Disabled test story','Fresh content while notifications disabled','2026-10-11 21:00Z');
update private.trending_config set enabled=false where id;
select lives_ok($$select private.send_daily_city_digest('2026-10-12 01:00Z')$$,'operator disabled recommendations are safe');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),2,'operator disable is respected');
update private.trending_config set enabled=true,quiet_start_hour=17,quiet_end_hour=20 where id;
select lives_ok($$select private.send_daily_city_digest('2026-10-12 01:00Z')$$,'custom local quiet hours are safe');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),2,'local quiet hours are respected');
update private.trending_config set quiet_start_hour=22,quiet_end_hour=8 where id;
update private.push_devices set disabled_at=now() where user_id='13600000-0000-0000-0000-000000000002';
select lives_ok($$select private.send_daily_city_digest('2026-10-12 01:00Z')$$,'disabled token is safe');
select is((select count(*)::int from public.notifications where user_id='13600000-0000-0000-0000-000000000002'),2,'disabled devices do not receive recommendations');

select ok(not has_function_privilege('anon','private.send_daily_city_digest(timestamptz)','execute'),'anonymous callers cannot run campaigns');
select ok(not has_function_privilege('authenticated','private.send_daily_city_digest(timestamptz)','execute'),'members cannot run campaigns');
select ok(not has_function_privilege('service_role','private.send_daily_city_digest(timestamptz)','execute'),'recommendations remain owned by database cron');
select * from finish();
rollback;
