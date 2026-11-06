begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('ps-test','Place saves test','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5170000-0000-4000-8000-000000000001','ps-viewer@example.test'),
 ('e5170000-0000-4000-8000-000000000002','ps-s1@example.test'),
 ('e5170000-0000-4000-8000-000000000003','ps-s2@example.test'),
 ('e5170000-0000-4000-8000-000000000004','ps-off@example.test'),
 ('e5170000-0000-4000-8000-000000000005','ps-s3@example.test');
insert into public.profiles(id,nickname,city_id) values
 ('e5170000-0000-4000-8000-000000000001','Viewer','ps-test'),
 ('e5170000-0000-4000-8000-000000000002','S1','ps-test'),
 ('e5170000-0000-4000-8000-000000000003','S2','ps-test'),
 ('e5170000-0000-4000-8000-000000000004','Off','ps-test'),
 ('e5170000-0000-4000-8000-000000000005','S3','ps-test');
insert into private.profile_sharing(user_id,saved_places_to_friends) values('e5170000-0000-4000-8000-000000000004',false);
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,'{"cities":{"ps-test":{"places":[{"id":"osm:node:830001","cityId":"ps-test","name":"Park","address":"Park address","category":"places","latitude":49.2,"longitude":-123.1,"sourceUrl":"https://www.openstreetmap.org/node/830001"},{"id":"osm:node:830002","cityId":"ps-test","name":"Cafe","address":"Cafe address","category":"cafe","latitude":49.21,"longitude":-123.11,"sourceUrl":"https://www.openstreetmap.org/node/830002"}]}},"collectedAt":"2026-11-04T00:00:00Z"}',current_date)
 on conflict(id) do update set payload=excluded.payload;
-- The viewer, two members and one who hid their saves all saved both places.
insert into private.saved_places(user_id,city_id,place_key)
 select u,'ps-test',k from unnest(array['e5170000-0000-4000-8000-000000000001','e5170000-0000-4000-8000-000000000002',
   'e5170000-0000-4000-8000-000000000003','e5170000-0000-4000-8000-000000000004']::uuid[]) u,
  unnest(array['osm:node:830001','osm:node:830002']) k;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((public.get_place_saves('ps-test','osm:node:830001')->>'saverCount')::integer,4,'everyone counts toward the saver number');
select is(public.get_place_saves('ps-test','osm:node:830001')->'similar','[]'::jsonb,'a place few people saved shows no similar places');
reset role;
-- Similar places must not reveal one person's list through a few new accounts (PR #102 security review).
insert into auth.users(id,email,created_at) select ('e5170000-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid,'ps-old'||i||'@example.test',now()-interval '8 days' from generate_series(1,10) i;
insert into public.profiles(id,nickname,city_id) select ('e5170000-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid,'Old'||i,'ps-test' from generate_series(1,10) i;
create temp table ps_old on commit drop as select i,('e5170000-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid id from generate_series(1,10) i;
insert into private.saved_places(user_id,city_id,place_key) select id,'ps-test',k from ps_old,unnest(array['osm:node:830001','osm:node:830002']) k where i<=9;
set local role authenticated;
select is(public.get_place_saves('ps-test','osm:node:830001')->'similar','[]'::jsonb,'nine week-old savers are not enough to show similar places');
reset role;
insert into private.saved_places(user_id,city_id,place_key) select id,'ps-test','osm:node:830001' from ps_old where i=10;
-- 830003: four old members and three new accounts. 830004: five old members. 830005: four old members and one old member who hid their saves.
insert into private.saved_places(user_id,city_id,place_key) select id,'ps-test','osm:node:830003' from ps_old where i<=4;
insert into private.saved_places(user_id,city_id,place_key) values
 ('e5170000-0000-4000-8000-000000000002','ps-test','osm:node:830003'),('e5170000-0000-4000-8000-000000000003','ps-test','osm:node:830003'),('e5170000-0000-4000-8000-000000000005','ps-test','osm:node:830003'),('e5170000-0000-4000-8000-000000000005','ps-test','osm:node:830001');
insert into private.saved_places(user_id,city_id,place_key) select id,'ps-test','osm:node:830004' from ps_old where i<=5;
update auth.users set created_at=now()-interval '8 days' where id='e5170000-0000-4000-8000-000000000004';
insert into private.saved_places(user_id,city_id,place_key) select id,'ps-test','osm:node:830005' from ps_old where i<=4;
insert into private.saved_places(user_id,city_id,place_key) values('e5170000-0000-4000-8000-000000000004','ps-test','osm:node:830005');
set local role authenticated;
select is((select jsonb_agg(x->>'placeKey' order by x->>'placeKey') from jsonb_array_elements(public.get_place_saves('ps-test','osm:node:830001')->'similar') x),'["osm:node:830002","osm:node:830004"]'::jsonb,'only places five week-old sharing members saved show; new accounts and hidden savers do not count');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is(public.get_place_saves('ps-test','osm:node:830001')->'similar','[]'::jsonb,'visitors who are not signed in see no similar places');
set local role authenticated;
select is(public.get_place_saves('nope','osm:node:830001'),null::jsonb,'an unknown city returns nothing');

-- G1 저장 종류: 가 봤어요 stays on the saved key, 가 보고 싶어요 clears it, null unsaves.
select set_config('request.jwt.claims','{"sub":"e5170000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.set_saved_place_state('place','osm:node:830001','been','ps-test')->>'status','been','S1 marks it been');
select is(public.get_saved_place_state('place','osm:node:830001','ps-test')->>'status','been','been reads back');
select is(public.set_saved_place_state('place','osm:node:830001','want','ps-test')->>'status','want','want clears been');
select is(public.set_saved_place_state('place','osm:node:830001',null,'ps-test')->>'saved','false','null unsaves');
select is(public.get_saved_place_state('place','osm:node:830001','ps-test')->'status','null'::jsonb,'an unsaved place has no status');
select throws_ok($$select public.set_saved_place_state('place','osm:node:830001','maybe','ps-test')$$,'P0001','INVALID_SAVED_TARGET','an unknown status is refused');
select * from finish();
rollback;
