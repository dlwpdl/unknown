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
select is(public.get_place_saves('ps-test','osm:node:830001')->'similar','[]'::jsonb,'the viewer and a hidden saver do not make up the 3 needed');
reset role;
insert into private.saved_places(user_id,city_id,place_key) values
 ('e5170000-0000-4000-8000-000000000005','ps-test','osm:node:830001'),('e5170000-0000-4000-8000-000000000005','ps-test','osm:node:830002');
set local role authenticated;
select is(public.get_place_saves('ps-test','osm:node:830001')->'similar'->0->>'placeKey','osm:node:830002','three other sharing members show the similar place');
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
