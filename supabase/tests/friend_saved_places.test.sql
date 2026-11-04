begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('fsp-test','Friend map test','BC','America/Vancouver',true),('fsp-other','Friend map other','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5150000-0000-4000-8000-000000000001','fsp-viewer@example.test'),
 ('e5150000-0000-4000-8000-000000000002','fsp-f1@example.test'),
 ('e5150000-0000-4000-8000-000000000003','fsp-f2@example.test'),
 ('e5150000-0000-4000-8000-000000000004','fsp-off@example.test'),
 ('e5150000-0000-4000-8000-000000000005','fsp-persona@example.test'),
 ('e5150000-0000-4000-8000-000000000006','fsp-reported@example.test'),
 ('e5150000-0000-4000-8000-000000000007','fsp-suspended@example.test'),
 ('e5150000-0000-4000-8000-000000000008','fsp-stranger@example.test'),
 ('e5150000-0000-4000-8000-000000000009','fsp-pending@example.test'),
 ('e5150000-0000-4000-8000-000000000010','fsp-lonely@example.test'),
 ('e5150000-0000-4000-8000-000000000011','fsp-f3@example.test'),
 ('e5150000-0000-4000-8000-000000000012','fsp-f4@example.test'),
 ('e5150000-0000-4000-8000-000000000013','fsp-owner@example.test'),
 ('e5150000-0000-4000-8000-000000000014','fsp-blocked@example.test');
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id='e5150000-0000-4000-8000-000000000005';
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='e5150000-0000-4000-8000-000000000013';
insert into public.profiles(id,nickname,city_id,avatar_path) values
 ('e5150000-0000-4000-8000-000000000001','Viewer','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000002','하늘','fsp-test','e5150000-0000-4000-8000-000000000002/avatar.jpg'),
 ('e5150000-0000-4000-8000-000000000003','바다','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000004','OffFriend','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000005','PersonaFriend','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000006','ReportedFriend','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000007','SuspendedFriend','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000008','Stranger','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000009','Pending','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000010','Lonely','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000011','숲길','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000012','별빛','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000013','Owner','fsp-test',null),
 ('e5150000-0000-4000-8000-000000000014','BlockedFriend','fsp-test',null);
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e5160000-0000-4000-8000-000000000001','Map cafe','fsp-test','trial','granted','Synthetic rollback fixture','business','e5150000-0000-4000-8000-000000000013',now());
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,'{"cities":{"fsp-test":{"places":[{"id":"osm:node:820001","cityId":"fsp-test","name":"Park","address":"Park address","category":"park","latitude":49.2,"longitude":-123.1,"sourceUrl":"https://www.openstreetmap.org/node/820001"},{"id":"osm:node:820002","cityId":"fsp-test","name":"Cafe","address":"Cafe address","category":"cafe","latitude":49.21,"longitude":-123.11,"sourceUrl":"https://www.openstreetmap.org/node/820002"}]}},"collectedAt":"2026-11-04T00:00:00Z"}',current_date)
 on conflict(id) do update set payload=excluded.payload;
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:820002','e5160000-0000-4000-8000-000000000001','fsp-test');

-- Everyone below is the viewer's accepted friend except the stranger and the pending request.
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at)
select 'e5150000-0000-4000-8000-000000000001',id::uuid,'e5150000-0000-4000-8000-000000000001',now()-interval '1 day',now()
from unnest(array['e5150000-0000-4000-8000-000000000002','e5150000-0000-4000-8000-000000000003','e5150000-0000-4000-8000-000000000004',
  'e5150000-0000-4000-8000-000000000005','e5150000-0000-4000-8000-000000000006','e5150000-0000-4000-8000-000000000007',
  'e5150000-0000-4000-8000-000000000011','e5150000-0000-4000-8000-000000000012','e5150000-0000-4000-8000-000000000014']) id;
insert into private.friendships(user_low_id,user_high_id,requester_id) values
 ('e5150000-0000-4000-8000-000000000001','e5150000-0000-4000-8000-000000000009','e5150000-0000-4000-8000-000000000009');
insert into private.profile_sharing(user_id,saved_places_to_friends) values('e5150000-0000-4000-8000-000000000004',false);
-- A report and a block end friendships on their own; put those rows back to prove the pair check drops them anyway.
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values
 ('e5150000-0000-4000-8000-000000000001','e5150000-0000-4000-8000-000000000006','user','e5150000-0000-4000-8000-000000000006','spam');
insert into public.blocks(blocker_id,blocked_id) values('e5150000-0000-4000-8000-000000000014','e5150000-0000-4000-8000-000000000001');
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at) values
 ('e5150000-0000-4000-8000-000000000001','e5150000-0000-4000-8000-000000000006','e5150000-0000-4000-8000-000000000001',now()-interval '1 day',now()),
 ('e5150000-0000-4000-8000-000000000001','e5150000-0000-4000-8000-000000000014','e5150000-0000-4000-8000-000000000001',now()-interval '1 day',now());
update public.profiles set account_status='suspended' where id='e5150000-0000-4000-8000-000000000007';

-- The park: 하늘, 바다, 숲길, 별빛 and every friend who must stay hidden. The cafe: 하늘 through its business only.
insert into private.saved_places(user_id,city_id,place_key,created_at)
select id::uuid,'fsp-test','osm:node:820001',now()-make_interval(mins=>n::integer)
from unnest(array['e5150000-0000-4000-8000-000000000002','e5150000-0000-4000-8000-000000000003','e5150000-0000-4000-8000-000000000011',
  'e5150000-0000-4000-8000-000000000012','e5150000-0000-4000-8000-000000000004','e5150000-0000-4000-8000-000000000005',
  'e5150000-0000-4000-8000-000000000006','e5150000-0000-4000-8000-000000000007','e5150000-0000-4000-8000-000000000008',
  'e5150000-0000-4000-8000-000000000009','e5150000-0000-4000-8000-000000000014']) with ordinality x(id,n);
insert into private.saved_places(user_id,city_id,place_key) values
 ('e5150000-0000-4000-8000-000000000003','fsp-other','osm:node:820009'),
 ('e5150000-0000-4000-8000-000000000004','fsp-test','osm:node:820003');
insert into private.saved_merchants(user_id,merchant_id) values('e5150000-0000-4000-8000-000000000002','e5160000-0000-4000-8000-000000000001');
insert into private.saved_users(user_id,target_user_id) values('e5150000-0000-4000-8000-000000000002','e5150000-0000-4000-8000-000000000008');

select ok(not has_function_privilege('anon','public.get_friend_saved_places(text)','execute'),'anonymous visitors cannot read friends'' saves');
select ok(has_function_privilege('authenticated','public.get_friend_saved_places(text)','execute'),'members can');
select ok(exists(select 1 from private.behavior_targets where id='discovery.scope.friends') and exists(select 1 from private.behavior_targets where id='friend.notice.hide'),
  'the new controls have fixed analytics targets');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5150000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.get_friend_saved_places('Not A City')$$,'P0001','INVALID_CITY','a malformed city is refused');
select is(public.get_friend_saved_places('fsp-test')->>'friendCount','5',
  '하늘, 바다, 숲길, 별빛 and the friend who turned sharing off count; the persona, reported, blocked and suspended friends do not');
select is((select string_agg(x->>'placeKey',',' order by ord) from jsonb_array_elements(public.get_friend_saved_places('fsp-test')->'places') with ordinality p(x,ord)),
  'osm:node:820001,osm:node:820002','the most-saved place first, the business place next; the turned-off friend''s place stays off');
select is(public.get_friend_saved_places('fsp-test')->'places'->0->>'friendCount','4','only the four sharing friends count on the park');
select is((select string_agg(x->>'nickname',',' order by ord) from jsonb_array_elements(public.get_friend_saved_places('fsp-test')->'places'->0->'friends') with ordinality p(x,ord)),
  '하늘,바다,숲길','at most three friends, latest save first');
select is(public.get_friend_saved_places('fsp-test')->'places'->0->'friends'->0,
  '{"id":"e5150000-0000-4000-8000-000000000002","nickname":"하늘","avatarPath":"e5150000-0000-4000-8000-000000000002/avatar.jpg"}'::jsonb,
  'each friend carries a nickname and a photo path only');
select is(public.get_friend_saved_places('fsp-test')->'places'->1->>'friendCount','1','a business saved directly shows on its linked place');
select is(jsonb_array_length(public.get_friend_saved_places('fsp-other')->'places'),1,'another city only returns that city');
select ok(public.get_friend_saved_places('fsp-test')::text !~ 'Persona|Reported|Suspended|Stranger|Pending|Blocked|OffFriend','no hidden person appears anywhere');

select set_config('request.jwt.claims','{"sub":"e5150000-0000-4000-8000-000000000010","role":"authenticated"}',true);
select is(public.get_friend_saved_places('fsp-test'),'{"friendCount":0,"places":[]}'::jsonb,'no friends, nothing to show');
select set_config('request.jwt.claims','{"sub":"e5150000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is(public.get_friend_saved_places('fsp-test'),'{"friendCount":0,"places":[]}'::jsonb,'an operated character sees no friends either');
select set_config('request.jwt.claims','{"sub":"e5150000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.get_friend_saved_places('fsp-test'),'{"friendCount":1,"places":[]}'::jsonb,'바다 sees only 바다''s own friend (who saved nothing), never friends of friends');
select * from finish();
rollback;
