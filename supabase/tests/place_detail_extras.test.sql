begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('pc-test','Place corrections test','BC','America/Vancouver',true);
insert into auth.users(id,email) values
 ('e5180000-0000-4000-8000-000000000001','pc-a@example.test'),
 ('e5180000-0000-4000-8000-000000000002','pc-b@example.test'),
 ('e5180000-0000-4000-8000-000000000003','pc-c@example.test'),
 ('e5180000-0000-4000-8000-000000000004','pc-hidden@example.test');
insert into public.profiles(id,nickname,city_id) values
 ('e5180000-0000-4000-8000-000000000001','Alpha','pc-test'),
 ('e5180000-0000-4000-8000-000000000002','Bravo','pc-test'),
 ('e5180000-0000-4000-8000-000000000003','Charlie','pc-test'),
 ('e5180000-0000-4000-8000-000000000004','Hidden','pc-test');
insert into private.profile_sharing(user_id,saved_places_to_friends) values('e5180000-0000-4000-8000-000000000004',false);
-- set_saved_place_state saves only a place on the map, so the test city gets one catalog place.
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,'{"cities":{"pc-test":{"places":[{"id":"osm:node:840001","cityId":"pc-test","name":"Cafe","address":"Cafe address","category":"cafe","latitude":49.2,"longitude":-123.1,"sourceUrl":"https://www.openstreetmap.org/node/840001"}]}},"collectedAt":"2026-11-13T00:00:00Z"}',current_date)
 on conflict(id) do update set payload=excluded.payload;
insert into private.saved_places(user_id,city_id,place_key)
 select u,'pc-test','osm:node:840001' from unnest(array['e5180000-0000-4000-8000-000000000001','e5180000-0000-4000-8000-000000000002',
  'e5180000-0000-4000-8000-000000000003','e5180000-0000-4000-8000-000000000004']::uuid[]) u;

-- 정보가 달라요: signed-in members only, nobody reads the table through the API.
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840001','hours')$$,'42501',null,'a visitor who is not signed in cannot send');
select throws_ok($$select * from private.place_corrections$$,'42501',null,'a visitor cannot read the corrections');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840001','hours')$$,'P0001','AUTH_REQUIRED','a token without a member is refused');
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840001','price')$$,'P0001','INVALID_PLACE_CORRECTION','an unknown kind is refused');
select throws_ok($$select public.report_place_correction('nope','osm:node:840001','hours')$$,'P0001','INVALID_PLACE_CORRECTION','an unknown city is refused');
select throws_ok($$select public.report_place_correction('pc-test','https://example.com','hours')$$,'P0001','INVALID_PLACE_CORRECTION','a key that is not a place is refused');
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840001','other',repeat('가',301))$$,'P0001','INVALID_PLACE_CORRECTION','a note over 300 characters is refused');
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840001','other','a'||chr(1)||'b')$$,'P0001','INVALID_PLACE_CORRECTION','a control character is refused');
select lives_ok($$select public.report_place_correction('pc-test','osm:node:840001','hours','  월요일은
 쉬어요  ')$$,'a member sends one');
select throws_ok($$select * from private.place_corrections$$,'42501',null,'a member cannot read the corrections, their own included');
select throws_ok($$insert into private.place_corrections(user_id,city_id,place_key,kind) values('e5180000-0000-4000-8000-000000000002','pc-test','osm:node:840001','other')$$,'42501',null,'a member cannot write a row for someone else');
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840001','closed')$$,'P0001','PLACE_CORRECTION_SENT_TODAY','the same place twice in a day is refused');
select lives_ok($$select public.report_place_correction('pc-test','partner:pc-cafe','contact')$$,'another place the same day is fine');
select lives_ok($$select public.report_place_correction('pc-test','osm:node:'||(840100+i),'other') from generate_series(1,28) i$$,'thirty places in a day go in');
select throws_ok($$select public.report_place_correction('pc-test','osm:node:840999','other')$$,'P0001','RATE_LIMITED','the thirty-first place that day is refused');
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.report_place_correction('pc-test','osm:node:840001','closed')$$,'another member can send the same place');
reset role;
select is((select note from private.place_corrections where user_id='e5180000-0000-4000-8000-000000000001' and place_key='osm:node:840001'),'월요일은 쉬어요','the note is kept on one line without the outer spaces');
select is((select count(*)::integer from private.place_corrections where city_id='pc-test'),31,'every accepted correction is one row');
select is((select note from private.place_corrections where user_id='e5180000-0000-4000-8000-000000000002'),null,'no note stays empty');
update private.place_corrections set created_at=created_at-interval '25 hours' where user_id='e5180000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.report_place_correction('pc-test','osm:node:840001','hours')$$,'the next day the same member can send that place again');

-- 가 봤어요·가 보고 싶어요: everyone saverCount counts, including someone who hid their saves; get_place_saves keeps its shape.
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.set_saved_place_state('place','osm:node:840001','been','pc-test')->>'status','been','A marks it been');
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is(public.set_saved_place_state('place','osm:node:840001','been','pc-test')->>'status','been','the member who hid their saves marks it been');
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_place_save_kinds('pc-test','osm:node:840001'),'{"beenCount":2,"wantCount":2}'::jsonb,'two have been and two want to go');
select is((public.get_place_saves('pc-test','osm:node:840001')->>'saverCount')::integer,4,'the split adds up to saverCount');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_place_saves('pc-test','osm:node:840001')) k),
 array['firstIsMe','friends','placeKey','saverCount','similar','weekCount'],'get_place_saves returns the same fields older apps read');
reset role;
-- Having been stays after an unsave (saved_place_been), but only people who still save it count.
delete from private.saved_places where user_id='e5180000-0000-4000-8000-000000000001' and place_key='osm:node:840001';
update public.profiles set account_status='suspended' where id='e5180000-0000-4000-8000-000000000003';
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is(public.get_place_save_kinds('pc-test','osm:node:840001'),'{"beenCount":1,"wantCount":1}'::jsonb,'a visitor sees the same numbers; unsaved and inactive members drop out');
select is(public.get_place_save_kinds('pc-test','osm:node:849999'),'{"beenCount":0,"wantCount":0}'::jsonb,'a place nobody saved is zero');
select is(public.get_place_save_kinds('nope','osm:node:840001'),null::jsonb,'an unknown city returns nothing');
select is(public.get_place_save_kinds('pc-test','bad key'),null::jsonb,'a key that is not a place returns nothing');
select * from finish();
rollback;
