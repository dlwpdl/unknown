begin;
set local search_path=public,extensions;
select no_plan();
delete from private.push_delivery_queue;
insert into public.cities values('wsa-test','Weekend test','BC','America/Vancouver',true),('wsa-other','Weekend other','BC','America/Vancouver',true);
insert into auth.users(id,email) select ('e5200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'wsa-'||n||'@example.test' from generate_series(1,15) n;
update auth.users set raw_app_meta_data='{"gling_persona":true}' where id='e5200000-0000-4000-8000-000000000013';
update auth.users set raw_app_meta_data='{"merchant_enabled":true}' where id='e5200000-0000-4000-8000-000000000015';
insert into public.profiles(id,nickname,city_id) select u.id,x.nickname,x.city from auth.users u join (values
 (1,'하늘','wsa-test'),(2,'바다','wsa-test'),(3,'PrefsOff','wsa-test'),(4,'Stranger','wsa-test'),(5,'Pending','wsa-test'),
 (6,'PushMuted','wsa-test'),(7,'OffSaver','wsa-test'),(8,'NoWeekend','wsa-test'),(9,'OtherCity','wsa-other'),
 (10,'Saver10','wsa-test'),(11,'Saver11','wsa-test'),(12,'Saver12','wsa-test'),(13,'Persona','wsa-test'),(14,'Blocked','wsa-test'),(15,'Owner','wsa-test')
) x(n,nickname,city) on u.id=('e5200000-0000-4000-8000-0000000000'||lpad(x.n::text,2,'0'))::uuid;
create temp table wsa(n integer primary key,id uuid) on commit drop;
insert into wsa select n,('e5200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(1,15) n;
grant select on wsa to authenticated;
-- Everyone has a live phone with push on, so the queue shows exactly what would go out.
insert into auth.sessions(id,user_id) select id,id from wsa;
insert into public.notification_preferences(user_id,push_enabled) select id,true from wsa;
update public.notification_preferences set friend_saves=false where user_id=(select id from wsa where n=3);
update public.notification_preferences set push_muted=array['friend_saves','weekend_picks'] where user_id=(select id from wsa where n=6);
update public.notification_preferences set weekend_picks=false where user_id=(select id from wsa where n=8);
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at)
select id,id,'ExpoPushToken[wsa_fixture_'||n||']','America/Vancouver',now() from wsa;

insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at) values
 ('e5210000-0000-4000-8000-000000000001','Harbour Bakery','wsa-test','trial','granted','Synthetic rollback fixture','business',(select id from wsa where n=15),now());
insert into private.city_place_catalog(id,payload,refreshed_on) values(true,jsonb_build_object('collectedAt','2026-11-13T00:00:00Z','cities',jsonb_build_object('wsa-test',jsonb_build_object(
 'places',jsonb_build_array(
  jsonb_build_object('id','osm:node:830001','cityId','wsa-test','name','Sunset Beach','address','1 Beach Ave','category','places','latitude',49.28,'longitude',-123.14,'sourceUrl','https://www.openstreetmap.org/node/830001'),
  jsonb_build_object('id','osm:node:830002','cityId','wsa-test','name','Harbour Cafe','address','2 Main St','category','cafe','latitude',49.27,'longitude',-123.1,'sourceUrl','https://www.openstreetmap.org/node/830002'),
  jsonb_build_object('id','osm:node:830003','cityId','wsa-test','name','Old Library','address','3 Book Rd','category','places','latitude',49.26,'longitude',-123.12,'sourceUrl','https://www.openstreetmap.org/node/830003')),
 'recommendations',jsonb_build_array(jsonb_build_object('placeId','osm:node:830003'),jsonb_build_object('placeId','osm:node:830001'))))),current_date)
 on conflict(id) do update set payload=excluded.payload;
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:830002','e5210000-0000-4000-8000-000000000001','wsa-test');

-- 하늘(1) is friends with 바다, PrefsOff, PushMuted and Blocked; 바다(2) also with OffSaver. Pending only asked; Stranger never did.
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at)
select least(a.id,b.id),greatest(a.id,b.id),a.id,now()-interval '2 days',now()-interval '1 day'
from (values (1,2),(1,3),(1,6),(1,14),(2,7)) p(x,y) join wsa a on a.n=p.x join wsa b on b.n=p.y;
insert into private.friendships(user_low_id,user_high_id,requester_id)
select least(a.id,b.id),greatest(a.id,b.id),b.id from wsa a,wsa b where a.n=1 and b.n=5;
insert into private.profile_sharing(user_id,saved_places_to_friends) select id,false from wsa where n=7;
-- A block ends a friendship on its own; put the row back to prove the pair check still drops it.
insert into public.blocks(blocker_id,blocked_id) select b.id,a.id from wsa a,wsa b where a.n=1 and b.n=14;
insert into private.friendships(user_low_id,user_high_id,requester_id,created_at,accepted_at)
select least(a.id,b.id),greatest(a.id,b.id),a.id,now()-interval '2 days',now()-interval '1 day' from wsa a,wsa b where a.n=1 and b.n=14;

select is((select friend_saves or weekend_picks from private.notification_switches),false,'both alerts ship switched off');
select ok(not has_table_privilege('authenticated','private.notification_switches','select'),'members cannot read the switches');
select ok(not has_function_privilege('authenticated','private.send_weekend_picks(timestamp with time zone)','execute'),'members cannot run the weekend send');
select is((select count(*)::integer from cron.job where jobname='gling-weekend-picks' and schedule='5 * * * *'),1,'the weekend send runs hourly');

-- 1) Switched off: a save writes and queues nothing.
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=1),true);
select lives_ok($$select public.set_saved_item('place','osm:node:830001',true,'wsa-test')$$,'saving still works while the alert is off');
select is(public.get_notification_preferences()->'switched_on','[]'::jsonb,'the app hides both settings rows while the switches are off');
reset role;
select is((select count(*)::integer from public.notifications where kind in ('friend_saved_place','weekend_picks')),0,'switched off: no friend-save row');
select is((select count(*)::integer from private.push_delivery_queue),0,'switched off: nothing queued');

-- 2) Switched on.
update private.notification_switches set friend_saves=true;
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=1),true);
select lives_ok($$select public.set_saved_item('place','osm:node:830003',true,'wsa-test')$$,'하늘 saves a place');
reset role;
select is((select body||' '||route||' '||category from public.notifications n join wsa w on w.id=n.user_id where w.n=2 and n.kind='friend_saved_place'),
  '하늘님이 ‘Old Library’ 저장했어요. /places/osm:node:830003?cityId=wsa-test friend_saves','a friend gets the place by name and opens it');
select is((select count(*)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id join wsa w on w.id=n.user_id where w.n=2),1,'and its push is queued');
select is((select count(*)::integer from public.notifications n join wsa w on w.id=n.user_id where w.n in (3,4,5,14) and n.kind='friend_saved_place'),0,
  'no row for a friend who turned it off, a stranger, a pending request or a blocked pair');
select is((select count(*)::integer from public.notifications n join wsa w on w.id=n.user_id where w.n=6 and n.kind='friend_saved_place'),1,'a muted push still keeps the in-app row');
select is((select count(*)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id join wsa w on w.id=n.user_id where w.n=6),0,'but queues no push');

-- 3) Later the same day: one row, rewritten as a count, unread again, no second push.
update public.notifications set read_at=now() where kind='friend_saved_place';
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=1),true);
select lives_ok($$select public.set_saved_item('merchant','e5210000-0000-4000-8000-000000000001',true)$$,'하늘 saves a business');
reset role;
select is((select string_agg(body||' '||route||' '||(read_at is null)::text,' | ') from public.notifications n join wsa w on w.id=n.user_id where w.n=2 and n.kind='friend_saved_place'),
  '하늘님이 장소 3곳을 저장했어요. /user/e5200000-0000-4000-8000-000000000001 true','the day''s saves (the one from before the switch too) fold into one unread row');
select is((select count(*)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id join wsa w on w.id=n.user_id where w.n=2),1,'without a second push');

-- 4) A business saved through its place, then turned on for updates, is not a second save.
delete from public.notifications where kind='friend_saved_place';
insert into private.saved_places(user_id,city_id,place_key) select id,'wsa-test','osm:node:830002' from wsa where n=2;
select is((select body from public.notifications n join wsa w on w.id=n.user_id where w.n=1 and n.kind='friend_saved_place'),'바다님이 ‘Harbour Bakery’ 저장했어요.',
  'a place with a business page uses the business name');
delete from public.notifications where kind='friend_saved_place';
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=2),true);
select lives_ok($$select public.set_saved_merchant_notifications('e5210000-0000-4000-8000-000000000001',true)$$,'바다 turns on its updates');
reset role;
select is((select count(*)::integer from private.saved_merchants sm join wsa w on w.id=sm.user_id where w.n=2),1,'that wrote the business alias row');
select is((select count(*)::integer from public.notifications where kind='friend_saved_place'),0,'the alias row sends nothing');

-- 5) Sharing off: OffSaver's friends hear nothing.
insert into private.saved_places(user_id,city_id,place_key) select id,'wsa-test','osm:node:830001' from wsa where n=7;
select is((select count(*)::integer from public.notifications where kind='friend_saved_place'),0,'a saver who hides saves from friends sends nothing');

-- 6) A day later the next save is a new row again.
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=1),true);
select public.set_saved_item('place','osm:node:830001',false,'wsa-test');
select public.set_saved_item('place','osm:node:830001',true,'wsa-test');
reset role;
update public.notifications set created_at=now()-interval '25 hours' where kind='friend_saved_place';
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=1),true);
select public.set_saved_item('place','osm:node:830003',false,'wsa-test');
select public.set_saved_item('place','osm:node:830003',true,'wsa-test');
reset role;
select is((select string_agg(body,' | ' order by created_at) from public.notifications n join wsa w on w.id=n.user_id where w.n=2 and n.kind='friend_saved_place'),
  '하늘님이 ‘Sunset Beach’ 저장했어요. | 하늘님이 ‘Old Library’ 저장했어요.','one row per friend per 24 hours');

-- 7) Friday picks. Next week's Friday 11:05 in the city's own time, so the fixture event is always in the future.
create temp table wsa_now on commit drop as
 select ((date_trunc('week',now() at time zone 'America/Vancouver')::date+11)+time '11:05') at time zone 'America/Vancouver' t;
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at) select 'tm-festival:wsa-test',jsonb_build_object('events',jsonb_build_array(
 jsonb_build_object('id','wsa-fest','name',E'Harbour  Lights\nFestival','country','CA','city','wsa-test','status','onsale','timeUnconfirmed',false,'startsAt',(t+interval '1 day')::text),
 jsonb_build_object('id','wsa-late','name','Next Week Show','country','CA','city','wsa-test','status','onsale','timeUnconfirmed',false,'startsAt',(t+interval '4 days')::text))),now()+interval '1 hour' from wsa_now;
-- Three members saved Sunset Beach in the last week: 뜨는 중.
insert into private.saved_places(user_id,city_id,place_key,created_at) select id,'wsa-test','osm:node:830001',(select t from wsa_now)-interval '1 day' from wsa where n in (10,11,12);
select is(private.send_weekend_picks((select t from wsa_now)),0,'switched off: the Friday send writes nothing');
select is((select count(*)::integer from public.notifications where kind='weekend_picks'),0,'and no row exists');
update private.notification_switches set weekend_picks=true;
select is(private.send_weekend_picks((select t-interval '1 day' from wsa_now)),0,'not on Thursday');
select is(private.send_weekend_picks((select t+interval '4 hours' from wsa_now)),0,'not after 14:00 Friday');
select is(private.send_weekend_picks((select t from wsa_now)),12,'Friday 11:05: every active member of the city except the one who turned it off and the operated character');
select is((select body||' '||route||' '||category from public.notifications n join wsa w on w.id=n.user_id where w.n=2 and n.kind='weekend_picks'),
  '이번 주말 갈 만한 곳 골라 뒀어요. Harbour Lights Festival, Sunset Beach, Old Library /events/wsa-fest?cityId=wsa-test weekend_picks',
  'this weekend''s event, then the place people are saving, then a TOP 50 pick; it opens the first one');
select is((select count(*)::integer from public.notifications n join wsa w on w.id=n.user_id where w.n in (8,9,13) and n.kind='weekend_picks'),0,
  'nothing for the member who turned it off, another city or an operated character');
select is((select count(*)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id join wsa w on w.id=n.user_id where w.n=2 and n.kind='weekend_picks'),1,'its push is queued');
select is((select count(*)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id join wsa w on w.id=n.user_id where w.n=6 and n.kind='weekend_picks'),0,'a muted push keeps only the in-app row');
select is(private.send_weekend_picks((select t+interval '1 hour' from wsa_now)),0,'the later Friday runs send nobody a second one');
select is(private.send_weekend_picks((select t+interval '7 days' from wsa_now)),12,'the next Friday sends again');
-- The TOP 50 order rotates by week, so only the names are checked.
select is((select body from public.notifications n join wsa w on w.id=n.user_id where w.n=2 and n.kind='weekend_picks' order by created_at desc limit 1)
  in ('이번 주말 갈 만한 곳 골라 뒀어요. Old Library, Sunset Beach','이번 주말 갈 만한 곳 골라 뒀어요. Sunset Beach, Old Library'),true,
  'with no event and no saves that week, the TOP 50 picks alone still make two');
delete from private.city_place_catalog;
select is(private.send_weekend_picks((select t+interval '14 days' from wsa_now)),0,'fewer than two names: nothing goes out');

-- 8) Settings read and write the two new rows; switching off hides them again.
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=3),true);
select is(public.get_notification_preferences()->'switched_on','["friend_saves", "weekend_picks"]'::jsonb,'both rows show once switched on');
select is(public.get_notification_preferences()->>'friend_saves','false','the stored choice reads back');
select is((select (x->>'friend_saves')||' '||(x->>'weekend_picks')||' '||(x->'push_muted')::text
  from public.update_notification_preferences('{"friend_saves":true,"weekend_picks":false,"push_muted":["friend_saves"]}') x),'true false ["friend_saves"]',
  'both toggles and their push pills save');
reset role;
update private.notification_switches set friend_saves=false,weekend_picks=false;
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'role','authenticated')::text from wsa where n=4),true);
select is(public.get_notification_preferences()->'switched_on','[]'::jsonb,'switching both off hides the rows again');
select is(public.get_notification_preferences()->>'weekend_picks','true','and a member who never touched them has both on');
reset role;
select * from finish();
rollback;
