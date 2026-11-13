begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('cps-test','City place saves test','BC','America/Vancouver',true),('cps-other','Other city','BC','America/Vancouver',true),
 ('cps-top','Top places test','BC','America/Vancouver',true);
insert into auth.users(id,email) select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cps-'||n||'@example.test' from generate_series(1,24) n;
insert into public.profiles(id,nickname,city_id) select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'CPS'||n,'cps-test' from generate_series(1,24) n;
create function pg_temp.member(n integer) returns uuid language sql immutable as $$ select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e5190000-0000-4000-8000-000000000001','Linked cafe','cps-test','trial','granted','Synthetic rollback fixture','business',pg_temp.member(24),now());
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:840004','e5190000-0000-4000-8000-000000000001','cps-test');
-- Map places for posts with a map line; 840010 and 840011 share one spot.
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,jsonb_build_object('collectedAt','2026-11-13T00:00:00Z','cities',jsonb_build_object('cps-test',jsonb_build_object('places',jsonb_build_array(
  jsonb_build_object('id','osm:node:840008','cityId','cps-test','name','Pin place','latitude',49.2801,'longitude',-123.1101),
  jsonb_build_object('id','osm:node:840010','cityId','cps-test','name','Twin A','latitude',49.2802,'longitude',-123.1102),
  jsonb_build_object('id','osm:node:840011','cityId','cps-test','name','Twin B','latitude',49.2802,'longitude',-123.1102))))),current_date)
on conflict(id) do update set payload=excluded.payload,refreshed_on=excluded.refreshed_on;

-- 840001: two members saved it this week, so it is rising.
insert into private.saved_places(user_id,city_id,place_key) values(pg_temp.member(1),'cps-test','osm:node:840001'),(pg_temp.member(2),'cps-test','osm:node:840001');
-- 840002: one member saved it, marked 가 봤어요 and reviewed it. Still one person, so no state.
insert into private.saved_places(user_id,city_id,place_key) values(pg_temp.member(3),'cps-test','osm:node:840002');
insert into private.saved_place_been(user_id,saved_key) values(pg_temp.member(3),'place:cps-test:osm:node:840002');
insert into public.posts(id,author_id,city_id,tag_id,title,body,status,place_review_osm_id,place_review_score) values
 ('e51a0000-0000-4000-8000-000000000001',pg_temp.member(3),'cps-test',4,'후기',E'글링 평점: 8.0/10\n\n좋았어요\n\n장소 후기: https://www.openstreetmap.org/node/840002','published','osm:node:840002',8);
-- 840003: a save 20 days ago and a 가 봤어요 10 days ago: two members this month, none this week.
insert into private.saved_places(user_id,city_id,place_key,created_at) values(pg_temp.member(4),'cps-test','osm:node:840003',now()-interval '20 days');
insert into private.saved_place_been(user_id,saved_key,been_at) values(pg_temp.member(5),'place:cps-test:osm:node:840003',now()-interval '10 days');
-- 840009: two members, but both over a month ago.
insert into private.saved_places(user_id,city_id,place_key,created_at) values(pg_temp.member(1),'cps-test','osm:node:840009',now()-interval '40 days'),(pg_temp.member(2),'cps-test','osm:node:840009',now()-interval '45 days');
-- 840004: member 4 saved the place and its business and counts once; member 5 saved only the business; member 20 marked the business 가 봤어요.
insert into private.saved_places(user_id,city_id,place_key) values(pg_temp.member(4),'cps-test','osm:node:840004');
insert into private.saved_merchants(user_id,merchant_id) values(pg_temp.member(4),'e5190000-0000-4000-8000-000000000001'),(pg_temp.member(5),'e5190000-0000-4000-8000-000000000001');
insert into private.saved_place_been(user_id,saved_key) values(pg_temp.member(20),'merchant:cps-test:e5190000-0000-4000-8000-000000000001');
-- Hidden saves and a block still count; an operated character and a suspended account do not.
insert into private.profile_sharing(user_id,saved_places_to_friends) values(pg_temp.member(6),false);
insert into public.blocks(blocker_id,blocked_id) values(pg_temp.member(7),pg_temp.member(1));
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id=pg_temp.member(11);
update public.profiles set account_status='suspended' where id=pg_temp.member(12);
insert into private.saved_places(user_id,city_id,place_key) values
 (pg_temp.member(6),'cps-test','osm:node:840005'),(pg_temp.member(7),'cps-test','osm:node:840005'),(pg_temp.member(11),'cps-test','osm:node:840005'),
 (pg_temp.member(12),'cps-test','osm:node:840005'),(pg_temp.member(13),'cps-other','osm:node:840005');
-- 840007: a persona and a suspended account join one real member this week: still one person.
insert into private.saved_places(user_id,city_id,place_key) values(pg_temp.member(8),'cps-test','osm:node:840007'),(pg_temp.member(11),'cps-test','osm:node:840007'),(pg_temp.member(12),'cps-test','osm:node:840007');
insert into private.saved_place_been(user_id,saved_key) values(pg_temp.member(11),'place:cps-test:osm:node:840007');
-- 840008: two members posted with it attached (member 10 twice) and nobody saved it. Posts on the twin spot and a removed post
-- never count.
insert into public.posts(id,author_id,city_id,tag_id,title,body,status) values
 ('e51a0000-0000-4000-8000-000000000002',pg_temp.member(9),'cps-test',4,'점심',E'맛있었어요\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.2801%2C-123.1101\n위치: 아무 이름','published'),
 ('e51a0000-0000-4000-8000-000000000003',pg_temp.member(10),'cps-test',4,'또 점심',E'Google 지도: https://www.google.com/maps/search/?api=1&query=49.2801%2C-123.1101\n위치: Pin place','published'),
 ('e51a0000-0000-4000-8000-000000000004',pg_temp.member(10),'cps-test',4,'저녁',E'Google 지도: https://www.google.com/maps/search/?api=1&query=49.2801%2C-123.1101','published'),
 ('e51a0000-0000-4000-8000-000000000005',pg_temp.member(9),'cps-test',4,'쌍둥이',E'Google 지도: https://www.google.com/maps/search/?api=1&query=49.2802%2C-123.1102','published'),
 ('e51a0000-0000-4000-8000-000000000006',pg_temp.member(10),'cps-test',4,'쌍둥이',E'Google 지도: https://www.google.com/maps/search/?api=1&query=49.2802%2C-123.1102','published'),
 ('e51a0000-0000-4000-8000-000000000007',pg_temp.member(14),'cps-test',4,'지운 글',E'Google 지도: https://www.google.com/maps/search/?api=1&query=49.2801%2C-123.1101','removed');
-- cps-top: eleven places with three members each this week, newest first. Only ten can be rising; the eleventh is popular.
insert into private.saved_places(user_id,city_id,place_key,created_at)
 select pg_temp.member(m),'cps-top','osm:node:8500'||lpad(k::text,2,'0'),now()-make_interval(hours=>k) from generate_series(1,11) k,generate_series(14,16) m;

create function pg_temp.row_of(p_key text,p_city text default 'cps-test') returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.get_city_place_saves(p_city)) e where e->>'placeKey'=p_key
$$;
grant execute on function pg_temp.row_of(text,text) to anon,authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(pg_temp.row_of('osm:node:840001')->>'status','trending','two members this week is rising');
select is(pg_temp.row_of('osm:node:840002')->'status','null'::jsonb,'one member alone never makes a state, however many things they did');
select is((pg_temp.row_of('osm:node:840002')->>'saverCount')::integer,1,'and they count once');
select is(pg_temp.row_of('osm:node:840003')->>'status','popular','two members this month, none this week, is popular');
select is(pg_temp.row_of('osm:node:840009')->'status','null'::jsonb,'activity over a month ago is no state');
select is((pg_temp.row_of('osm:node:840004')->>'saverCount')::integer,2,'a place and its business count one person once');
select is((pg_temp.row_of('osm:node:840004')->>'saverCount')::integer,(public.get_place_saves('cps-test','osm:node:840004')->>'saverCount')::integer,'a business-linked place shows the place screen total');
select is(pg_temp.row_of('osm:node:840004')->>'status','trending','가 봤어요 on the linked business counts for its place');
select is((pg_temp.row_of('osm:node:840005')->>'saverCount')::integer,2,'a hidden saver and one who blocked the viewer count; a persona, a suspended account and another city do not');
select is((pg_temp.row_of('osm:node:840005')->>'saverCount')::integer,(public.get_place_saves('cps-test','osm:node:840005')->>'saverCount')::integer,'the same total as the place screen');
select is(pg_temp.row_of('osm:node:840007')->'status','null'::jsonb,'an operated character and a suspended account never make a place rise');
select is(pg_temp.row_of('osm:node:840008')->>'status','trending','two members posting with the place attached make it rise');
select is((pg_temp.row_of('osm:node:840008')->>'saverCount')::integer,0,'without a save the total stays 0');
select is(pg_temp.row_of('osm:node:840010'),null,'a post on a spot two places share counts for neither');
select is(pg_temp.row_of('osm:node:840011'),null);
select is((select count(*)::integer from jsonb_array_elements(public.get_city_place_saves('cps-top')) e where e->>'status'='trending'),10,'at most ten rising places in a city');
select is(pg_temp.row_of('osm:node:850011','cps-top')->>'status','popular','the eleventh is popular');
select is(pg_temp.row_of('osm:node:850001','cps-top')->>'status','trending','the newest of the tied places rises');
select is((select jsonb_agg(distinct k) from jsonb_array_elements(public.get_city_place_saves('cps-test')) e,jsonb_object_keys(e) k),'["placeKey", "saverCount", "status"]'::jsonb,'only the place key, the total and the status leave');
select ok(public.get_city_place_saves('cps-test')::text !~* 'e5180000|CPS[0-9]','no member id or nickname leaves');
select is(public.get_city_place_saves('nope'),'[]'::jsonb,'an unknown city is empty');
select is(public.get_city_place_saves(null),'[]'::jsonb,'no city is empty');
reset role;
select set_config('request.jwt.claims','',true);
set local role anon;
select is((pg_temp.row_of('osm:node:840004')->>'saverCount')::integer,2,'a signed-out visitor sees the same totals');
select is(pg_temp.row_of('osm:node:840008')->>'status','trending','and the same states');
reset role;
select is((select provolatile::text from pg_proc where oid='public.get_city_place_saves(text)'::regprocedure),'s','the function cannot write');
select ok((select prosecdef from pg_proc where oid='public.get_city_place_saves(text)'::regprocedure),'it reads private tables as its owner');
select ok(has_function_privilege('anon','public.get_city_place_saves(text)','execute'),'anon can read');
select ok(has_function_privilege('authenticated','public.get_city_place_saves(text)','execute'),'members can read');
select ok(not has_function_privilege('service_role','public.get_city_place_saves(text)','execute'),'other roles get nothing');
select ok(exists(select 1 from private.behavior_targets where id='discovery.status') and exists(select 1 from private.behavior_targets where id='search.price'),'the new chips have analytics targets');
select * from finish();
rollback;
