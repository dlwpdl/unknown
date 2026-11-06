begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('cps-test','City place saves test','BC','America/Vancouver',true),('cps-other','Other city','BC','America/Vancouver',true);
insert into auth.users(id,email) select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cps-'||n||'@example.test' from generate_series(1,14) n;
insert into public.profiles(id,nickname,city_id) select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'CPS'||n,'cps-test' from generate_series(1,14) n;
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e5190000-0000-4000-8000-000000000001','Linked cafe','cps-test','trial','granted','Synthetic rollback fixture','business','e5180000-0000-4000-8000-000000000014',now());
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:840004','e5190000-0000-4000-8000-000000000001','cps-test');

-- Ten members saved this a month ago: popular and no longer rising.
insert into private.saved_places(user_id,city_id,place_key,created_at)
 select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cps-test','osm:node:840001',now()-interval '30 days' from generate_series(1,10) n;
-- Nine a month ago is one short of popular.
insert into private.saved_places(user_id,city_id,place_key,created_at)
 select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cps-test','osm:node:840006',now()-interval '30 days' from generate_series(1,9) n;
-- Three in the last week are rising, two are not.
insert into private.saved_places(user_id,city_id,place_key)
 select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cps-test','osm:node:840002' from generate_series(1,3) n;
insert into private.saved_places(user_id,city_id,place_key)
 select ('e5180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cps-test','osm:node:840003' from generate_series(1,2) n;
-- Member 4 saved the place and its business and counts once; member 5 saved only the business.
insert into private.saved_places(user_id,city_id,place_key) values('e5180000-0000-4000-8000-000000000004','cps-test','osm:node:840004');
insert into private.saved_merchants(user_id,merchant_id) values
 ('e5180000-0000-4000-8000-000000000004','e5190000-0000-4000-8000-000000000001'),
 ('e5180000-0000-4000-8000-000000000005','e5190000-0000-4000-8000-000000000001');
-- Hidden saves and a block still count; an operated character and a suspended account do not.
insert into private.profile_sharing(user_id,saved_places_to_friends) values('e5180000-0000-4000-8000-000000000006',false);
insert into public.blocks(blocker_id,blocked_id) values('e5180000-0000-4000-8000-000000000007','e5180000-0000-4000-8000-000000000001');
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id='e5180000-0000-4000-8000-000000000011';
update public.profiles set account_status='suspended' where id='e5180000-0000-4000-8000-000000000012';
insert into private.saved_places(user_id,city_id,place_key) values
 ('e5180000-0000-4000-8000-000000000006','cps-test','osm:node:840005'),
 ('e5180000-0000-4000-8000-000000000007','cps-test','osm:node:840005'),
 ('e5180000-0000-4000-8000-000000000011','cps-test','osm:node:840005'),
 ('e5180000-0000-4000-8000-000000000012','cps-test','osm:node:840005'),
 ('e5180000-0000-4000-8000-000000000013','cps-other','osm:node:840005');

create function pg_temp.row_of(p_key text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.get_city_place_saves('cps-test')) e where e->>'placeKey'=p_key
$$;
grant execute on function pg_temp.row_of(text) to anon,authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5180000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((pg_temp.row_of('osm:node:840001')->>'saverCount')::integer,10,'every saver counts');
select is(pg_temp.row_of('osm:node:840001')->>'status','popular','10 members overall is popular');
select is(pg_temp.row_of('osm:node:840006')->'status','null'::jsonb,'9 members overall has no status');
select is(pg_temp.row_of('osm:node:840002')->>'status','trending','3 members in the last week is trending');
select is(pg_temp.row_of('osm:node:840003')->'status','null'::jsonb,'2 members in the last week has no status');
select is((pg_temp.row_of('osm:node:840004')->>'saverCount')::integer,2,'a place and its business count one person once');
select is((pg_temp.row_of('osm:node:840004')->>'saverCount')::integer,(public.get_place_saves('cps-test','osm:node:840004')->>'saverCount')::integer,'a business-linked place shows the place screen total');
select is((pg_temp.row_of('osm:node:840005')->>'saverCount')::integer,2,'a hidden saver and one who blocked the viewer count; a persona, a suspended account and another city do not');
select is((pg_temp.row_of('osm:node:840005')->>'saverCount')::integer,(public.get_place_saves('cps-test','osm:node:840005')->>'saverCount')::integer,'the same total as the place screen');
select is((select jsonb_agg(distinct k) from jsonb_array_elements(public.get_city_place_saves('cps-test')) e,jsonb_object_keys(e) k),'["placeKey", "saverCount", "status"]'::jsonb,'only the place key, the total and the status leave');
select ok(public.get_city_place_saves('cps-test')::text !~* 'e5180000|CPS[0-9]','no member id or nickname leaves');
select is(public.get_city_place_saves('nope'),'[]'::jsonb,'an unknown city is empty');
select is(public.get_city_place_saves(null),'[]'::jsonb,'no city is empty');
reset role;
select set_config('request.jwt.claims','',true);
set local role anon;
select is((pg_temp.row_of('osm:node:840001')->>'saverCount')::integer,10,'a signed-out visitor sees the same totals');
reset role;
select is((select provolatile::text from pg_proc where oid='public.get_city_place_saves(text)'::regprocedure),'s','the function cannot write');
select ok((select prosecdef from pg_proc where oid='public.get_city_place_saves(text)'::regprocedure),'it reads private tables as its owner');
select ok(has_function_privilege('anon','public.get_city_place_saves(text)','execute'),'anon can read');
select ok(has_function_privilege('authenticated','public.get_city_place_saves(text)','execute'),'members can read');
select ok(not has_function_privilege('service_role','public.get_city_place_saves(text)','execute'),'other roles get nothing');
select * from finish();
rollback;
