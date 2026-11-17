begin;
set local search_path = public, extensions;
select no_plan();

-- A zone whose local clock shows hour h right now (whole-hour offsets, so the minutes match UTC).
create function pg_temp.zone_at(h integer) returns text language sql as $$
  select case when d = 0 then 'Etc/GMT' when d > 0 then 'Etc/GMT-' || d else 'Etc/GMT+' || (-d) end
  from (select case when x > 12 then x - 24 else x end d
    from (select ((h - extract(hour from now() at time zone 'UTC')::integer) % 24 + 24) % 24 x) a) b $$;

-- The 15-minute windows depend on the wall clock; the tests open them and drop the quiet hours.
create or replace function private.recommendation_time(p_at timestamptz, p_timezone text)
returns boolean language sql stable set search_path = '' as $$ select true $$;
insert into private.trending_config(id) values (true) on conflict do nothing;
update private.trending_config set enabled = true, quiet_start_hour = 0, quiet_end_hour = 0;
update private.notification_switches set new_posts = true, bubble_alerts = true;

insert into public.cities(id, name, province, timezone) values ('tune-test', '튠도시', 'BC', pg_temp.zone_at(12));
insert into auth.users(id, email, raw_app_meta_data)
select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'tune-' || n || '@example.invalid',
  case when n = 6 then '{"gling_persona":"x"}'::jsonb else '{}'::jsonb end from generate_series(1, 12) n;
insert into public.profiles(id, nickname, city_id)
select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '튠' || n, 'tune-test' from generate_series(1, 12) n;
-- 1 recipient, 2 author, 3 commenter, 4 blocker, 5 bubble switch off, 6 operated character, 7 night, 8 opened the app today,
-- 9 already got 3 this week, 10 roundup switch off, 11 meetup guest, 12 spare.
insert into auth.sessions(id, user_id, aal)
select ('ec100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, null from generate_series(1, 12) n;
insert into private.push_devices(user_id, session_id, token, timezone, timezone_updated_at)
select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, ('ec100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'ExpoPushToken[tune' || lpad(n::text, 12, '0') || ']', case when n = 7 then pg_temp.zone_at(23) else pg_temp.zone_at(12) end, now() from generate_series(1, 12) n;
insert into public.notification_preferences(user_id, push_enabled, bubble_alerts, new_posts)
select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, true, n <> 5, n <> 10 from generate_series(1, 12) n;

-- ===== names, switches, defaults
select has_column('public', 'notification_preferences', 'new_posts', 'new_posts preference exists');
select has_column('public', 'notification_preferences', 'bubble_alerts', 'bubble_alerts preference exists');
select col_default_is('public', 'notification_preferences', 'new_posts', 'true', 'new_posts defaults to on');
select col_default_is('private', 'notification_switches', 'new_posts', 'false', 'new_posts server switch starts off');
select col_default_is('private', 'notification_switches', 'bubble_alerts', 'false', 'bubble_alerts server switch starts off');
select is(private.notification_category('city_new_posts', 'user'), 'new_posts', 'roundup category');
select is(private.notification_category('live_bubble_nearby', 'live_bubble'), 'bubble_alerts', 'bubble category');
select is(private.notification_category('meetup_poll', 'post'), 'system', 'an unknown kind keeps the default category');

-- ===== preferences API
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","session_id":"ec100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_notification_preferences()->'switched_on', '["new_posts","bubble_alerts"]'::jsonb, 'switched-on list shows the new rows when the server switches are on');
select is(public.update_notification_preferences('{"new_posts":false,"bubble_alerts":false,"push_muted":["new_posts","bubble_alerts","nope"]}')->'push_muted',
  '["bubble_alerts","new_posts"]'::jsonb, 'new categories can be muted, unknown ones are dropped');
select is(public.get_notification_preferences()->'new_posts', 'false'::jsonb, 'new_posts saved');
select is(public.update_notification_preferences('{"new_posts":true,"bubble_alerts":true,"push_muted":[]}')->'bubble_alerts', 'true'::jsonb, 'bubble_alerts saved');
-- direct_requests (friend, folder and bubble requests) can be switched off in the app list and for push
select is(public.update_notification_preferences('{"direct_requests":false,"push_muted":["direct_requests"]}')->'push_muted', '["direct_requests"]'::jsonb, 'direct_requests can be muted for push');
select is(public.get_notification_preferences()->'direct_requests', 'false'::jsonb, 'direct_requests can be switched off for the app list');
reset role;
select is(private.create_notification('ec000000-0000-4000-8000-000000000001', 'friend_request', 'ec000000-0000-4000-8000-000000000003', 'user', 'ec000000-0000-4000-8000-000000000003', 'x', '/user/ec000000-0000-4000-8000-000000000003'), null, 'with direct_requests off no friend-request row is made');
update public.notification_preferences set direct_requests = true, push_muted = '{}' where user_id = 'ec000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
reset role;
update private.notification_switches set new_posts = false;
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_notification_preferences()->'switched_on', '["bubble_alerts"]'::jsonb, 'a switched-off row is hidden from the app');
reset role;
update private.notification_switches set new_posts = true;

-- ===== 1. push budget: 3 a day, 120 minutes apart (push side)
-- Priors are written with triggers off, then claimed rows go through the real claim.
create temporary table prior(n integer, nid uuid);
set local session_replication_role = replica;
insert into public.notifications(id, user_id, kind, target_type, target_id, body, route, title, category, created_at)
select gen_random_uuid(), 'ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', ('ec000000-0000-4000-8000-0000000000' || (80 + n))::uuid,
  '이전 ' || n, '/', '이전', 'new_posts', now() - make_interval(hours => n * 3) from generate_series(1, 3) n;
insert into private.push_delivery_queue(notification_id, device_id, status, attempts, first_attempt_at, last_attempt_at, finished_at)
select n.id, d.id, 'provider_accepted', 1, n.created_at, n.created_at, n.created_at from public.notifications n
  join private.push_devices d on d.user_id = n.user_id where n.kind = 'city_new_posts' and n.user_id = 'ec000000-0000-4000-8000-000000000001';
-- a 4th pending one, as the enqueue trigger would have made it
insert into public.notifications(id, user_id, kind, target_type, target_id, body, route, title, category)
values ('ec200000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', 'ec000000-0000-4000-8000-000000000001',
  '‘글’ 말고도 3개 더 올라왔어요.', '/', '튠도시 새 글 4개', 'new_posts');
insert into private.push_delivery_queue(notification_id, device_id)
select 'ec200000-0000-4000-8000-000000000001', id from private.push_devices where user_id = 'ec000000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select is((select count(*)::int from public.claim_push_notifications('send', 10)), 0, 'three pushes already went today: the fourth is held');
select ok((select (q.next_attempt_at at time zone pg_temp.zone_at(12))::date = (now() at time zone pg_temp.zone_at(12))::date + 1
    and extract(hour from q.next_attempt_at at time zone pg_temp.zone_at(12)) >= 9
  from private.push_delivery_queue q where q.notification_id = 'ec200000-0000-4000-8000-000000000001'), 'it moves to 09:00 or later the next local day');
-- two earlier pushes only: it goes out
delete from private.push_delivery_queue q using public.notifications n where n.id = q.notification_id and n.kind = 'city_new_posts' and n.title = '이전' and n.created_at < now() - interval '8 hours';
update private.push_delivery_queue set next_attempt_at = now() where notification_id = 'ec200000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.claim_push_notifications('send', 10)), 1, 'with two earlier pushes the third goes out');
-- interval: the last push 100 minutes ago holds the next one until 120
update private.push_delivery_queue set status = 'pending', lease_id = null, lease_until = null, next_attempt_at = now(), last_attempt_at = null, first_attempt_at = null, attempts = 0
  where notification_id = 'ec200000-0000-4000-8000-000000000001';
delete from private.push_delivery_queue q using public.notifications n where n.id = q.notification_id and n.title = '이전';
set local session_replication_role = replica;
insert into private.push_delivery_queue(notification_id, device_id, status, attempts, first_attempt_at, last_attempt_at)
select n.id, d.id, 'provider_accepted', 1, now() - interval '100 minutes', now() - interval '100 minutes'
from (select id from public.notifications where title = '이전' limit 1) n cross join (select id from private.push_devices where user_id = 'ec000000-0000-4000-8000-000000000001') d;
set local session_replication_role = origin;
select is((select count(*)::int from public.claim_push_notifications('send', 10)), 0, 'a push 100 minutes ago still holds the next one');
select ok((select q.next_attempt_at >= now() + interval '19 minutes' from private.push_delivery_queue q where q.notification_id = 'ec200000-0000-4000-8000-000000000001'),
  'it waits until 120 minutes after the last push');
delete from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and kind = 'city_new_posts';

-- ===== 1b. write-time guard (the row for the in-app list)
set local session_replication_role = replica;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title, category, created_at)
select 'ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', ('ec000000-0000-4000-8000-0000000000' || (80 + n))::uuid, '이전', '/', '이전', 'new_posts', now() - make_interval(hours => n * 3) from generate_series(1, 3) n;
set local session_replication_role = origin;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title)
values ('ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', 'ec000000-0000-4000-8000-000000000001', '네번째', '/', '네번째');
select is((select count(*)::int from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and body = '네번째'), 0, 'the in-app guard also stops a 4th recommendation-family row in a day');
delete from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001';
set local session_replication_role = replica;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title, category, created_at)
values ('ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', 'ec000000-0000-4000-8000-000000000081', '이전', '/', '이전', 'new_posts', now() - interval '100 minutes');
set local session_replication_role = origin;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title)
values ('ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', 'ec000000-0000-4000-8000-000000000001', '간격', '/', '간격');
select is((select count(*)::int from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and body = '간격'), 0, 'the in-app guard waits 120 minutes (not 75)');
delete from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001';
set local session_replication_role = replica;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title, category, created_at)
values ('ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', 'ec000000-0000-4000-8000-000000000081', '이전', '/', '이전', 'new_posts', now() - interval '130 minutes');
set local session_replication_role = origin;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title)
values ('ec000000-0000-4000-8000-000000000001', 'city_new_posts', 'user', 'ec000000-0000-4000-8000-000000000001', '허용', '/', '허용');
select is((select count(*)::int from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and body = '허용'), 1, 'past 120 minutes a second note is allowed');
delete from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001';

-- ===== 2. night deferral
select ok(private.night_push_due('meetup_review_request', 'x', null, pg_temp.zone_at(23)) > now() + interval '1 minute', 'review request at 23:00 waits');
select is((private.night_push_due('meetup_review_request', 'x', null, pg_temp.zone_at(23)) at time zone pg_temp.zone_at(23))::time, '08:00'::time, '... until 08:00 local');
select is((private.night_push_due('meetup_host_tip', 'x', null, pg_temp.zone_at(3)) at time zone pg_temp.zone_at(3))::time, '08:00'::time, 'host tip at 03:00 waits for 08:00 the same morning');
select ok(private.night_push_due('meetup_host_tip', 'x', null, pg_temp.zone_at(3)) <= now() + interval '8 hours', '... the same morning, not a day later');
select ok(private.night_push_due('meetup_host_tip', 'x', null, pg_temp.zone_at(12)) <= now() + interval '1 second', 'daytime goes out now');
select ok(private.night_push_due('meetup_reminder', '튠 모임이 24시간 뒤에 시작해요. (11/20 19:00 · 모임 장소 기준)', null, pg_temp.zone_at(23)) > now() + interval '1 minute', 'the 24-hour reminder waits at night');
select ok(private.night_push_due('meetup_reminder', '튠 모임이 1시간 뒤에 시작해요.', null, pg_temp.zone_at(23)) <= now() + interval '1 second', 'the 1-hour reminder never waits');
select ok(private.night_push_due('message', 'x', null, pg_temp.zone_at(23)) <= now() + interval '1 second'
  and private.night_push_due('comment', 'x', null, pg_temp.zone_at(23)) <= now() + interval '1 second'
  and private.night_push_due('account_security', 'x', null, pg_temp.zone_at(23)) <= now() + interval '1 second', 'messages, comments and account security are untouched');
select ok(private.night_push_due('meetup_host_tip', 'x', 'ec000000-0000-4000-8000-000000000007', null) is not null, 'no device zone falls back to the city zone');

-- end to end with the real enqueue trigger: an in-app row right away, the push for 08:00
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on, room_preview) values
 ('ec300000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000007', 'tune-test', 1, '밤 시험 모임', '본문', current_date,
  jsonb_build_object('eventKind', 'once', 'startsAt', now() + interval '30 hours', 'endsAt', now() + interval '32 hours', 'timezone', 'America/Vancouver', 'capacity', 8, 'memberCount', 1));
select is(private.create_notification('ec000000-0000-4000-8000-000000000007', 'meetup_host_tip', null, 'post', 'ec300000-0000-4000-8000-000000000001', '팁', '/post/ec300000-0000-4000-8000-000000000001') is not null, true, 'the in-app row is made at once');
select ok((select q.next_attempt_at > now() + interval '1 minute' from private.push_delivery_queue q join public.notifications n on n.id = q.notification_id
  where n.user_id = 'ec000000-0000-4000-8000-000000000007' and n.kind = 'meetup_host_tip'), 'the night push is queued for later');
select is(private.create_notification('ec000000-0000-4000-8000-000000000001', 'meetup_host_tip', null, 'post', 'ec300000-0000-4000-8000-000000000001', '팁', '/post/ec300000-0000-4000-8000-000000000001') is not null, true, 'a daytime recipient gets the row');
select ok((select q.next_attempt_at <= now() + interval '1 second' from private.push_delivery_queue q join public.notifications n on n.id = q.notification_id
  where n.user_id = 'ec000000-0000-4000-8000-000000000001' and n.kind = 'meetup_host_tip'), 'a daytime push is queued now');
delete from public.notifications where kind = 'meetup_host_tip';

-- ===== 3. new posts roundup
create temporary table clock as select date_trunc('hour', now()) + interval '7 minutes' p_now;
update public.cities set timezone = pg_temp.zone_at(18) where id = 'tune-test';
update private.push_devices set timezone = pg_temp.zone_at(18) where user_id <> 'ec000000-0000-4000-8000-000000000007';
set local session_replication_role = replica;
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on, view_count, created_at)
select ('ec400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ec000000-0000-4000-8000-000000000002', 'tune-test', 1, '글 ' || n, '본문', current_date,
  n * 10, (select p_now from clock) - make_interval(hours => n) from generate_series(1, 3) n;
set local session_replication_role = origin;
select is(private.send_new_posts_roundup((select p_now from clock)), 0, 'three posts are not enough');
set local session_replication_role = replica;
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on, view_count, created_at)
values ('ec400000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000002', 'tune-test', 1, '조회 많은 글', '본문', current_date, 500, (select p_now from clock) - interval '5 hours');
-- 9 already got three this week; 8 opened the app today; 3 saw one 30 hours ago only
insert into public.notifications(user_id, kind, target_type, target_id, body, route, title, category, created_at)
select 'ec000000-0000-4000-8000-000000000009', 'city_new_posts', 'user', ('ec000000-0000-4000-8000-0000000000' || (60 + n))::uuid, '이전', '/', '이전', 'new_posts',
  (select p_now from clock) - make_interval(days => n) from generate_series(1, 3) n;
insert into private.analytics_visits(user_id, platform, bucket, first_at, last_at, screen, app_version)
values ('ec000000-0000-4000-8000-000000000008', 'ios', date_trunc('hour', (select p_now from clock)), (select p_now from clock) - interval '2 hours', (select p_now from clock) - interval '1 hour', 'home', '1.6.0'),
       ('ec000000-0000-4000-8000-000000000003', 'ios', date_trunc('hour', (select p_now from clock)) - interval '1 day', (select p_now from clock) - interval '30 hours', (select p_now from clock) - interval '30 hours', 'home', '1.6.0');
set local session_replication_role = origin;
-- 4 blocks the author: those posts are not visible to 4
insert into public.blocks(blocker_id, blocked_id) values ('ec000000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000002');
update private.notification_switches set new_posts = false;
select is(private.send_new_posts_roundup((select p_now from clock)), 0, 'server switch off: nothing is made');
update private.notification_switches set new_posts = true;
select ok(private.send_new_posts_roundup((select p_now from clock)) >= 1, 'four posts: the roundup goes out');
select is((select title from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and kind = 'city_new_posts'), '튠도시 새 글 4개', 'title: city and total');
select is((select body from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and kind = 'city_new_posts'), '‘조회 많은 글’ 말고도 3개 더 올라왔어요.', 'body: most viewed post and the rest');
select is((select route from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and kind = 'city_new_posts'), '/', 'it opens the home feed');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id = q.notification_id where n.user_id = 'ec000000-0000-4000-8000-000000000001' and n.kind = 'city_new_posts'), 1, 'and is queued for push');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000002'), 0, 'the author counts only other people''s posts');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000004'), 0, 'blocked authors'' posts do not count');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000008'), 0, 'someone who opened the app today gets none');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000003'), 1, 'opening the app yesterday does not count');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000009'), 3, 'three this week already: no fourth');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000010'), 0, 'preference off: none');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000006'), 0, 'operated characters get none');
select is(private.send_new_posts_roundup((select p_now from clock)), 0, 'running it again the same evening adds nothing');
select is(private.send_new_posts_roundup((select p_now from clock) + interval '2 hours'), 0, 'outside the local 18:00 window nothing is made');

-- ===== 4. nearby bubbles
update private.push_devices set timezone = pg_temp.zone_at(12) where user_id <> 'ec000000-0000-4000-8000-000000000007';
update public.cities set timezone = pg_temp.zone_at(12) where id = 'tune-test';
insert into public.cities(id, name, province, timezone) values ('tune-other', '다른도시', 'BC', pg_temp.zone_at(12));
insert into auth.users(id, email) values ('ec000000-0000-4000-8000-000000000020', 'tune-20@example.invalid');
insert into public.profiles(id, nickname, city_id) values ('ec000000-0000-4000-8000-000000000020', '타도시', 'tune-other');
insert into private.live_bubbles(id, author_id, city_id, body, latitude, longitude, audience, kind, expires_at) values
 ('ec500000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'tune-test', '지금 커피 한잔 하실 분', 49.28, -123.12, 'friends', 'member', now() + interval '1 hour'),
 ('ec500000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000003', 'tune-test', '운영 핀', 49.28, -123.12, 'city', 'pin', now() + interval '1 hour');
select is((select count(*)::int from private.bubble_alert_jobs), 0, 'friends-only bubbles and pins never queue an alert');
update private.notification_switches set bubble_alerts = false;
update private.live_bubbles set ended_at = now() where author_id = 'ec000000-0000-4000-8000-000000000002' and ended_at is null;
insert into private.live_bubbles(id, author_id, city_id, body, latitude, longitude, audience, kind, expires_at)
values ('ec500000-0000-4000-8000-000000000003', 'ec000000-0000-4000-8000-000000000002', 'tune-test', '스위치 꺼짐', 49.28, -123.12, 'city', 'member', now() + interval '1 hour');
select is((select count(*)::int from private.bubble_alert_jobs), 0, 'switch off: no alert is queued');
select is((select count(*)::int from private.bubble_alert_authors), 0, 'and the author keeps the daily slot');
update private.live_bubbles set ended_at = now() where id = 'ec500000-0000-4000-8000-000000000003';
update private.notification_switches set bubble_alerts = true;
-- a recipient that already got one in the last 24 hours (12)
set local session_replication_role = replica;
insert into public.notifications(user_id, kind, target_type, target_id, body, route, category, created_at)
values ('ec000000-0000-4000-8000-000000000012', 'live_bubble_nearby', 'live_bubble', 'ec500000-0000-4000-8000-000000000099', '이전', '/discover', 'bubble_alerts', now() - interval '3 hours');
set local session_replication_role = origin;
update private.live_bubbles set ended_at = now() where author_id = 'ec000000-0000-4000-8000-000000000002' and ended_at is null;
insert into private.live_bubbles(id, author_id, city_id, body, latitude, longitude, audience, kind, expires_at)
values ('ec500000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000002', 'tune-test', '지금 커피 한잔 하실 분', 49.28, -123.12, 'city', 'member', now() + interval '30 minutes');
select is((select count(*)::int from private.bubble_alert_jobs), 1, 'a city bubble queues one alert');
select is(private.process_bubble_alerts(), 6, 'it reaches the city''s real members');
select is((select body from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and kind = 'live_bubble_nearby'), '지금 튠도시에 말풍선이 떴어요. ‘지금 커피 한잔 하실 분’', 'copy with city and the bubble text');
select is((select route || '|' || target_type || '|' || coalesce(actor_id::text, 'none') from public.notifications where user_id = 'ec000000-0000-4000-8000-000000000001' and kind = 'live_bubble_nearby'),
  '/discover|live_bubble|none', 'opens the map, hides who posted');
select is((select count(*)::int from public.notifications where kind = 'live_bubble_nearby' and user_id in
  ('ec000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000005', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000007', 'ec000000-0000-4000-8000-000000000020')
  and created_at > now() - interval '1 minute'), 0, 'not the poster, the one who switched it off, an operated character, someone at night, or another city');
select is((select count(*)::int from public.notifications where kind = 'live_bubble_nearby' and user_id = 'ec000000-0000-4000-8000-000000000012' and created_at > now() - interval '1 minute'), 0, 'one per recipient per 24 hours');
select is((select count(*)::int from private.bubble_alert_jobs), 0, 'the job is finished');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id = q.notification_id where n.kind = 'live_bubble_nearby' and n.user_id = 'ec000000-0000-4000-8000-000000000001' and q.next_attempt_at <= now() + interval '1 second'), 1, 'the push is queued at once');
select ok((select c.push_ttl between 1 and 1800 from public.claim_push_notifications('send', 50) c where c.kind = 'live_bubble_nearby' and c.user_id = 'ec000000-0000-4000-8000-000000000001'), 'push TTL stays inside the bubble''s remaining time');
-- abuse: the poster cannot set off a second city alert within 24 hours, and a blocked word never goes out
update private.live_bubbles set ended_at = now() where author_id = 'ec000000-0000-4000-8000-000000000002' and ended_at is null;
insert into private.live_bubbles(id, author_id, city_id, body, latitude, longitude, audience, kind, expires_at)
values ('ec500000-0000-4000-8000-000000000005', 'ec000000-0000-4000-8000-000000000002', 'tune-test', '또 올려요', 49.28, -123.12, 'city', 'member', now() + interval '1 hour');
select is((select count(*)::int from private.bubble_alert_jobs), 0, 'a second city bubble within 24 hours alerts nobody');
update private.bubble_alert_authors set last_at = now() - interval '25 hours';
update private.live_bubbles set ended_at = now() where author_id = 'ec000000-0000-4000-8000-000000000002' and ended_at is null;
insert into private.live_bubbles(id, author_id, city_id, body, latitude, longitude, audience, kind, expires_at)
values ('ec500000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000002', 'tune-test', '씨발 광고', 49.28, -123.12, 'city', 'member', now() + interval '1 hour');
select is((select count(*)::int from private.bubble_alert_jobs), 1, 'after 24 hours the author may alert again');
select is(private.process_bubble_alerts(), 0, 'a body the word check rejects is never sent');
select is((select count(*)::int from private.bubble_alert_jobs), 0, 'and its job is dropped');
select ok(has_function_privilege('postgres', 'private.process_bubble_alerts(integer)', 'execute')
  and not has_function_privilege('anon', 'private.process_bubble_alerts(integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.process_bubble_alerts(integer)', 'execute'), 'the bubble job is not callable by clients');

-- the poster's call runs the same synchronous word check as posts, which is why the bubble text itself may go in the alert
select ok((select prosrc like '%private.assert_content_allowed(body)%' from pg_proc where oid = 'public.post_live_bubble(text,text,text,integer,double precision,double precision,text)'::regprocedure), 'post_live_bubble runs the word check');
select throws_ok($$select private.assert_content_allowed('씨발 광고')$$, 'P0001', 'CONTENT_NOT_ALLOWED', 'that check rejects blocked words');

-- ===== 5. comment and reply push titles
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on) values
 ('ec600000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'tune-test', 1, '내 글', '본문', current_date);
delete from public.notifications; delete from private.push_delivery_queue;
insert into public.comments(id, post_id, author_id, body) values
 ('ec700000-0000-4000-8000-000000000001', 'ec600000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', E'첫 줄\n둘째 줄 ' || repeat('가', 120));
create temporary table claimed as select * from public.claim_push_notifications('send', 50);
select is((select push_title from claimed where kind = 'comment'), '튠3님의 댓글', 'comment push title');
select is((select body from claimed where kind = 'comment'), left('첫 줄 둘째 줄 ' || repeat('가', 120), 100), 'body is the comment, newlines as spaces, first 100 characters');
select is((select body from public.notifications where kind = 'comment'), '튠3님이 내 글에 댓글을 남겼어요.', 'the in-app sentence is unchanged');
insert into public.comments(id, post_id, author_id, body, reply_to_id, parent_id) values
 ('ec700000-0000-4000-8000-000000000002', 'ec600000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', '내 댓글에 답', null, null);
insert into public.comments(id, post_id, author_id, body, reply_to_id, parent_id) values
 ('ec700000-0000-4000-8000-000000000003', 'ec600000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', '답글이에요', 'ec700000-0000-4000-8000-000000000002', 'ec700000-0000-4000-8000-000000000002');
create temporary table claimed2 as select * from public.claim_push_notifications('send', 50);
select is((select push_title from claimed2 where kind = 'reply'), '튠2님의 답글', 'reply push title');
select is((select body from claimed2 where kind = 'reply'), '답글이에요', 'reply push body');
-- a comment that is gone keeps the stored sentence
insert into public.comments(id, post_id, author_id, body) values
 ('ec700000-0000-4000-8000-000000000004', 'ec600000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', '곧 지울 댓글');
set local session_replication_role = replica;
update public.comments set deleted_at = now() where id = 'ec700000-0000-4000-8000-000000000004';
set local session_replication_role = origin;
create temporary table claimed3 as select * from public.claim_push_notifications('send', 50);
select is((select count(*)::int from claimed3 where body = '곧 지울 댓글' or push_title is not null), 0, 'a deleted comment never puts its text in a push');

-- ===== 6. copy lines and meetup rows
delete from public.notifications; delete from private.push_delivery_queue;
-- (message) push without preview names the sender
insert into public.conversations(id, user_low_id, user_high_id, status) values
 ('ec800000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', 'active');
insert into public.messages(id, conversation_id, sender_id, body) values
 ('ec900000-0000-4000-8000-000000000001', 'ec800000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000003', '비밀 내용');
create temporary table claimed4 as select * from public.claim_push_notifications('send', 50);
select is((select body from claimed4 where kind = 'message'), '튠3님이 메시지를 보냈어요.', 'message push names the sender and hides the content');

-- (meetup_request, meetup_approved, closed, cancelled) through the real functions
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
create temporary table m(post_id uuid, request_id uuid);
grant all on m to authenticated;
insert into m(post_id) select public.create_post('tune-test', (select id from public.tags where slug = 'meetup'), '튠 시험 모임', '호스트가 신청을 봅니다.', array['모임'], array[]::text[], '{"capacity":4}'::jsonb);
reset role;
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
update m set request_id = public.request_meetup_join(post_id, '같이 가요');
reset role;
select is((select body from public.notifications where kind = 'meetup_request' and user_id = 'ec000000-0000-4000-8000-000000000001'), '모임 멤버님이 튠 시험 모임 모임에 같이 가고 싶대요.', 'meetup_request names the display name (no nickname) and the meetup');
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.respond_meetup_request((select request_id from m), 'approved');
reset role;
select is((select body from public.notifications where kind = 'meetup_approved' and user_id = 'ec000000-0000-4000-8000-000000000011'), '튠 시험 모임 모임에 같이 가게 됐어요. 채팅방에 인사 한마디 남겨 보세요.', 'meetup_approved');
update public.posts set room_preview = room_preview || '{"eventKind":"group","cadence":"매주"}'::jsonb where id = (select post_id from m);
update public.posts set room_preview = room_preview || '{"closed":true}'::jsonb where id = (select post_id from m);
select is((select body from public.notifications where kind = 'meetup_cancelled' and user_id = 'ec000000-0000-4000-8000-000000000011' order by created_at desc limit 1), '튠 시험 모임 모임 모집이 끝났어요.', 'a closed meetup says sign-ups ended');
select is((select count(*)::int from public.notifications where kind = 'meetup_closed'), 0, 'no new kind: the closed sentence rides on meetup_cancelled');
-- a second meetup that the host removes
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
create temporary table m2(post_id uuid, request_id uuid);
grant all on m2 to authenticated;
insert into m2(post_id) select public.create_post('tune-test', (select id from public.tags where slug = 'meetup'), '튠 취소 모임', '호스트가 신청을 봅니다.', array['모임'], array[]::text[], '{"capacity":4}'::jsonb);
reset role;
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
set local role authenticated;
update m2 set request_id = public.request_meetup_join(post_id, '같이 가요');
reset role;
select set_config('request.jwt.claims', '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.respond_meetup_request((select request_id from m2), 'approved');
reset role;
update public.posts set room_preview = room_preview || '{"eventKind":"group","cadence":"매주"}'::jsonb where id = (select post_id from m2);
update public.posts set status = 'removed' where id = (select post_id from m2);
select is((select body from public.notifications where kind = 'meetup_cancelled' and user_id = 'ec000000-0000-4000-8000-000000000012' and body like '튠 취소%'), '튠 취소 모임 모임이 취소됐어요.', 'a removed meetup says it was cancelled');

-- (meetup_review_request)
insert into private.meetup_sessions(id, post_id, host_id, starts_at, ends_at)
values ('eca00000-0000-4000-8000-000000000001', (select post_id from m), 'ec000000-0000-4000-8000-000000000001', now() - interval '15 hours', now() - interval '12 hours' - interval '20 seconds');
insert into private.meetup_attendance(session_id, user_id, checked_in_at) values ('eca00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000011', now() - interval '14 hours');
select ok(private.send_meetup_review_requests(now()) >= 1, 'review requests are sent');
select is((select body from public.notifications where kind = 'meetup_review_request' and user_id = 'ec000000-0000-4000-8000-000000000011'), '튠 시험 모임 모임 잘 다녀왔어요? 같이 간 분들 후기 남겨 주세요.', 'review request names the meetup');

-- (interest_post, nearby_meetup) and the followed-host duplicate
insert into public.tags(id, slug, label, kind) values (31998, 'tune-tag', '튠태그', 'post') on conflict do nothing;
insert into auth.users(id, email) values ('ec000000-0000-4000-8000-000000000040', 'tune-40@example.invalid'), ('ec000000-0000-4000-8000-000000000041', 'tune-41@example.invalid');
insert into public.profiles(id, nickname, city_id) values ('ec000000-0000-4000-8000-000000000040', '관심40', 'tune-test'), ('ec000000-0000-4000-8000-000000000041', '근처41', 'tune-test');
insert into public.notification_preferences(user_id, interests, nearby, interest_tag_ids, discovery_updated_at, push_enabled) values
 ('ec000000-0000-4000-8000-000000000040', true, true, array[31998]::integer[], '-infinity', false),
 ('ec000000-0000-4000-8000-000000000041', false, true, '{}', '-infinity', false)
 on conflict (user_id) do update set interests = excluded.interests, nearby = excluded.nearby, interest_tag_ids = excluded.interest_tag_ids, discovery_updated_at = '-infinity';
delete from public.notifications; delete from private.push_delivery_queue; delete from private.discovery_post_queue;
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on) values
 ('ecb00000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000002', 'tune-test', 31998, '태그 글 제목', '본문', current_date);
select ok(private.process_discovery_posts(500) >= 1, 'discovery runs');
select is((select body from public.notifications where kind = 'interest_post' and user_id = 'ec000000-0000-4000-8000-000000000040'), '#튠태그에 새 글이 올라왔어요. ‘태그 글 제목’', 'interest_post names the tag and the post');
delete from public.notifications; delete from private.discovery_post_queue;
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on, room_preview) values
 ('ecb00000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000002', 'tune-test', 1, '새 모임 제목', '본문', current_date,
  jsonb_build_object('eventKind', 'once', 'startsAt', now() + interval '3 days', 'endsAt', now() + interval '3 days 2 hours', 'timezone', 'America/Vancouver', 'capacity', 8, 'memberCount', 1));
-- 41 already got the followed host's note for this post; 40 did not
insert into private.host_follow_alerts(user_id, host_id, post_id) values ('ec000000-0000-4000-8000-000000000041', 'ec000000-0000-4000-8000-000000000002', 'ecb00000-0000-4000-8000-000000000002');
select ok(private.process_discovery_posts(500) >= 1, 'discovery runs for the meetup');
select is((select body from public.notifications where kind = 'nearby_meetup' and user_id = 'ec000000-0000-4000-8000-000000000040'), '튠도시에 새 모임이 생겼어요. ‘새 모임 제목’', 'nearby_meetup names the place and the meetup');
select is((select count(*)::int from public.notifications where kind = 'nearby_meetup' and user_id = 'ec000000-0000-4000-8000-000000000041'), 0, 'someone who got the followed host''s note gets no second row for the same meetup');

-- (copy lines written by functions that need heavy fixtures: the sentences are checked in the function text)
select ok((select prosrc like '%님이 대화 신청을 수락했어요. 지금 말 걸어 보세요.%' from pg_proc where oid = 'public.respond_live_bubble_request(uuid,text)'::regprocedure), 'live_bubble_accepted sentence');
select ok((select prosrc like '%에 새 후기가 올라왔어요.%' from pg_proc where oid = 'private.notify_merchant_review_received()'::regprocedure), 'merchant_review_received sentence');
select ok((select prosrc like '%에 새 소식이 올라왔어요.%' from pg_proc where oid = 'private.notify_saved_merchant_post(uuid,boolean)'::regprocedure), 'saved_merchant_post sentence');
select ok((select prosrc like '%'' 글이 많이 올라와요.''%' from pg_proc where oid = 'public.send_trending_topic_notifications()'::regprocedure), 'trending_hashtag sentence');
select ok((select prosrc like '%에서 제일 많이 읽은 글이에요. ‘%' from pg_proc where oid = 'private.publish_weekly_ranking()'::regprocedure), 'weekly_ranking sentence');
select ok(private.event_recommendation_body(null, '{"segment":"Arts & Theatre","genre":"Dance","startsAt":"2026-11-15T20:00:00Z","venue":""}'::jsonb, 'vancouver') !~ '^(행사 소식이에요|일정을 살펴봐요|이런 행사도 있어요|외출 계획에 참고해요)', 'event notes carry no lead-in phrase');

-- ===== 7. unknown kinds behave as before (same SQL as the probe in scripts/check-notification-tune.py)
alter table public.notifications drop constraint notifications_kind_check;
delete from public.notifications; delete from private.push_delivery_queue;
select is(private.create_notification('ec000000-0000-4000-8000-000000000001', k, null, 'post', 'ec600000-0000-4000-8000-000000000001', 'x', '/post/ec600000-0000-4000-8000-000000000001') is not null, true, 'unknown kind ' || k || ' still makes a row')
  from unnest(array['meetup_poll', 'meetup_poll_vote', 'meetup_waiting', 'meetup_host_transfer']) k;
select is((select string_agg(distinct category, ',') from public.notifications), 'system', 'unknown kinds keep the default category');
select is((select count(*)::int from private.push_delivery_queue q where q.next_attempt_at <= now() + interval '1 second'), 4, 'and go to the push queue at once');

-- ===== 8. the newcomer split is checked in newcomer_welcome.test.sql

-- ===== 9. permissions
select ok((select bool_and(p.prosecdef) from pg_proc p where p.oid in ('private.send_new_posts_roundup(timestamptz)'::regprocedure,
  'private.process_bubble_alerts(integer)'::regprocedure, 'private.queue_bubble_alert()'::regprocedure, 'private.night_push_due(text,text,uuid,text)'::regprocedure)), 'new functions are security definer');
select ok((select bool_and(coalesce(p.proconfig, '{}') @> array['search_path=""']) from pg_proc p where p.oid in ('private.send_new_posts_roundup(timestamptz)'::regprocedure,
  'private.process_bubble_alerts(integer)'::regprocedure, 'private.queue_bubble_alert()'::regprocedure, 'private.night_push_due(text,text,uuid,text)'::regprocedure)), 'with an empty search_path');
select ok(not has_function_privilege('anon', 'private.send_new_posts_roundup(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.send_new_posts_roundup(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.night_push_due(text,text,uuid,text)', 'execute'), 'anon and signed-in clients cannot run them');
select ok(not has_function_privilege('anon', 'public.claim_push_notifications(text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_push_notifications(text,integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_push_notifications(text,integer)', 'execute'), 'the claim stays service-role only');
select is((select count(*)::int from pg_class c where c.oid in ('private.bubble_alert_jobs'::regclass, 'private.bubble_alert_authors'::regclass) and c.relowner = 'postgres'::regrole and c.relrowsecurity), 2, 'new tables belong to postgres and have row security on');
select is((select count(*)::int from pg_proc p where p.oid in ('private.send_new_posts_roundup(timestamptz)'::regprocedure, 'private.process_bubble_alerts(integer)'::regprocedure,
  'private.queue_bubble_alert()'::regprocedure, 'private.night_push_due(text,text,uuid,text)'::regprocedure) and p.proowner = 'postgres'::regrole), 4, 'new functions belong to postgres');
select is((select confdeltype::text from pg_constraint where conrelid = 'private.bubble_alert_authors'::regclass and contype = 'f'), 'c', 'the per-person table follows the account on delete');
select is((select count(*)::int from cron.job where jobname = 'gling-minute-jobs'), 1, 'still one minute job (no extra schedule)');
select ok((select pg_get_functiondef('private.run_minute_jobs()'::regprocedure) like '%process_bubble_alerts%' and pg_get_functiondef('private.run_minute_jobs()'::regprocedure) like '%send_new_posts_roundup%'), 'the minute job runs both new steps');

-- ===== B.C. fixed clock (20261117010000): Vancouver hours are the UTC-7 ones even where the zone data still says UTC-8
select ok((select bool_and(pg_get_functiondef(p.oid) like '%private.meetup_clock_zone(%') from pg_proc p where p.oid in (
  'private.night_push_due(text,text,uuid,text)'::regprocedure, 'private.send_new_posts_roundup(timestamptz)'::regprocedure,
  'private.process_bubble_alerts(integer)'::regprocedure, 'private.send_newcomer_nudges(timestamptz)'::regprocedure)), 'the four local-hour checks use the fixed B.C. clock');
select is(private.night_push_due('meetup_host_tip', 'x', null, 'America/Vancouver'), private.night_push_due('meetup_host_tip', 'x', null, 'America/Phoenix'),
  'Vancouver quiet hours follow the UTC-7 clock');
create temporary table van_clock as
  select ((date_trunc('day', now() at time zone 'America/Phoenix') + interval '18 hours 5 minutes') at time zone 'America/Phoenix') p_now;
insert into public.cities(id, name, province, timezone) values ('tune-van', '밴도시', 'BC', 'America/Vancouver');
insert into auth.users(id, email) values ('ec000000-0000-4000-8000-000000000013', 'tune-13@example.invalid');
insert into public.profiles(id, nickname, city_id) values ('ec000000-0000-4000-8000-000000000013', '튠13', 'tune-van');
insert into auth.sessions(id, user_id, aal) values ('ec100000-0000-4000-8000-000000000013', 'ec000000-0000-4000-8000-000000000013', null);
insert into private.push_devices(user_id, session_id, token, timezone, timezone_updated_at)
values ('ec000000-0000-4000-8000-000000000013', 'ec100000-0000-4000-8000-000000000013', 'ExpoPushToken[tune000000000013]', 'America/Vancouver', now());
set local session_replication_role = replica;
insert into public.posts(id, author_id, city_id, tag_id, title, body, posted_on, view_count, created_at)
select ('ec410000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ec000000-0000-4000-8000-000000000002', 'tune-van', 1, '밴 글 ' || n, '본문', current_date,
  n, (select p_now from van_clock) - make_interval(hours => n) from generate_series(1, 4) n;
set local session_replication_role = origin;
update private.notification_switches set new_posts = true;
select ok(private.send_new_posts_roundup((select p_now from van_clock)) >= 1, '18:05 on the real Vancouver clock is inside the roundup window');
select is((select count(*)::int from public.notifications where kind = 'city_new_posts' and user_id = 'ec000000-0000-4000-8000-000000000013'), 1,
  '... and the Vancouver member gets it then, not an hour later');

select * from finish();
rollback;
