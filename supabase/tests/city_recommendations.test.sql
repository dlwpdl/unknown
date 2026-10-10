begin;
select no_plan();
select has_view('private','ticketmaster_notification_events','event recommendations use the existing verified cache');
select has_function('private','send_city_recommendations',array['timestamp with time zone'],'frequent city recommendation generator exists');
select has_function('public','record_ticketmaster_event_click',array['text','text'],'real member event clicks can be recorded');
update public.posts set status='removed';
delete from public.ticketmaster_event_cache;
delete from private.trending_topic_sent;
update private.trending_config set enabled=true,quiet_start_hour=22,quiet_end_hour=8 where id;
create temporary table rec_clock as select
  ((now() at time zone 'America/Vancouver')::date + 1 + time '11:00') at time zone 'America/Vancouver' as first_slot;

insert into auth.users(id,email,raw_app_meta_data) values
('13800000-0000-0000-0000-000000000001','rec-author@example.test','{}'),
('13800000-0000-0000-0000-000000000002','rec-reader@example.test','{}'),
('13800000-0000-0000-0000-000000000003','rec-reader3@example.test','{}'),
('13800000-0000-0000-0000-000000000004','rec-reader4@example.test','{}'),
('13800000-0000-0000-0000-000000000005','rec-push-off@example.test','{}'),
('13800000-0000-0000-0000-000000000006','rec-category-off@example.test','{}'),
('13800000-0000-0000-0000-000000000007','rec-expired@example.test','{}'),
('13800000-0000-0000-0000-000000000008','rec@seed.gling.invalid','{}'),
('13800000-0000-0000-0000-000000000009','rec-review@example.test','{"review_access":true}'),
('13800000-0000-0000-0000-000000000010','rec-admin@example.test','{"role":"admin"}'),
('13800000-0000-0000-0000-000000000011','rec-toronto@example.test','{}');
insert into public.profiles(id,nickname,city_id)
select id,'rec'||right(id::text,2),case when right(id::text,2)='11' then 'toronto' else 'vancouver' end
from auth.users where id::text like '13800000-%';
insert into public.notification_preferences(user_id,push_enabled,trending,city_food,city_places)
select id,right(id::text,2) not in ('01','05'),right(id::text,2)<>'06',right(id::text,2)<>'06',right(id::text,2)<>'06'
from public.profiles where id::text like '13800000-%';
insert into auth.sessions(id,user_id,created_at,not_after)
select id,id,now(),case when right(id::text,2)='07' then now()-interval '1 hour' else null end
from public.profiles where id::text like '13800000-%';
insert into private.push_devices(user_id,session_id,token)
select id,id,'ExpoPushToken[recommendation_fixture_'||right(id::text,2)||']'
from public.profiles where id::text like '13800000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select ('13810000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '13800000-0000-0000-0000-000000000001','vancouver',4,'추천 카페 '||i,'Verified cafe introduction',first_slot-make_interval(hours=>25+i)
from rec_clock cross join generate_series(1,6) i;
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select '13810000-0000-0000-0000-000000000011','13800000-0000-0000-0000-000000000001','toronto',1,
 'Toronto recommendation','A separate city story',first_slot-interval '24 hours' from rec_clock;
select private.send_city_recommendations((select first_slot-interval '3 hours' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000011'),1,'Toronto receives its own 11:00 rather than Vancouver time');
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),0,'Toronto slot does not send early to Vancouver');

select lives_ok($$select private.send_city_recommendations((select first_slot-interval '15 minutes' from rec_clock))$$,'no early regular recommendation');
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),0,'regular slots are not sent early');
select lives_ok($$select private.send_city_recommendations((select first_slot from rec_clock))$$,'11:00 recommendation succeeds');
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),1,'first local slot is delivered');
select is((select count(*)::int from public.notifications where user_id in ('13800000-0000-0000-0000-000000000005','13800000-0000-0000-0000-000000000006','13800000-0000-0000-0000-000000000007','13800000-0000-0000-0000-000000000008','13800000-0000-0000-0000-000000000009')),0,'opt-outs, expired sessions and example accounts stay excluded');
select private.send_city_recommendations((select first_slot+interval '15 minutes' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),1,'same slot is claimed once');
select private.send_city_recommendations((select first_slot+interval '5 hours' from rec_clock));
select private.send_city_recommendations((select first_slot+interval '9 hours' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),3,'11/16/20 each offer a different recommendation');
select is((select count(distinct target_id)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),3,'same post is not repeated');
select private.send_city_recommendations((select first_slot+interval '9 hours 45 minutes' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),3,'missed slots are not replayed late');

-- Successful foreground detail opens, never display counters or anonymous traffic.
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
values('tm-festival:vancouver',jsonb_build_object('events',jsonb_build_array(jsonb_build_object(
 'id','real-fest','name','Real Festival','country','CA','city','Vancouver','status','onsale',
 'startsAt',(now()+interval '30 days')::text,'timeUnconfirmed',false))),now()+interval '15 minutes');
select set_config('request.jwt.claims','{"sub":"13800000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.record_ticketmaster_event_click('vancouver','real-fest')$$,'authenticated member can record a real cached event open');
select public.record_ticketmaster_event_click('vancouver','real-fest');
select throws_ok($$select * from private.ticketmaster_event_clicks$$,'42501',null,'member click records remain private');
select throws_ok($$select public.record_ticketmaster_event_click('vancouver','../admin')$$,'P0001','INVALID_EVENT','injected event IDs are rejected');
select throws_ok($$select public.record_ticketmaster_event_click('toronto','real-fest')$$,'P0001','EVENT_NOT_FOUND','city cannot be substituted');
reset role;
select is((select count(*)::int from private.ticketmaster_event_clicks where user_id='13800000-0000-0000-0000-000000000002'),1,'reopening does not inflate daily unique clicks');
update private.ticketmaster_event_clicks set created_at=(select first_slot-interval '1 hour' from rec_clock)
where user_id='13800000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims','{"sub":"13800000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select public.record_ticketmaster_event_click('vancouver','real-fest');
reset role;
select is((select count(*)::int from private.ticketmaster_event_clicks where user_id='13800000-0000-0000-0000-000000000008'),0,'seed clicks are not member evidence');
select set_config('request.jwt.claims','{"sub":"13800000-0000-0000-0000-000000000010","role":"authenticated"}',true);
set local role authenticated;
select public.record_ticketmaster_event_click('vancouver','real-fest');
reset role;
select is((select count(*)::int from private.ticketmaster_event_clicks where user_id='13800000-0000-0000-0000-000000000010'),0,'admin clicks are not member evidence');
select ok(not has_function_privilege('anon','public.record_ticketmaster_event_click(text,text)','execute'),'anonymous traffic cannot produce member popularity');

delete from public.notifications where user_id::text like '13800000-%';
delete from private.trending_topic_sent;
select private.send_city_recommendations((select first_slot-interval '1 hour' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),0,'first catalog observation does not claim old listings are new or popular');
insert into private.ticketmaster_event_clicks(target_id,user_id,day,created_at)
select md5('ticketmaster:vancouver:real-fest')::uuid,id,(first_slot at time zone 'UTC')::date,first_slot-interval '1 hour'
from public.profiles cross join rec_clock where id in ('13800000-0000-0000-0000-000000000003','13800000-0000-0000-0000-000000000004');
select private.send_city_recommendations((select first_slot-interval '30 minutes' from rec_clock));
select ok((select body like '요새 글링인들이 많이 찾는 페스티벌%' from public.notifications where user_id='13800000-0000-0000-0000-000000000002' limit 1),'three distinct real members qualify a popular festival');
select is((select route from public.notifications where user_id='13800000-0000-0000-0000-000000000002' limit 1),'/events/real-fest?cityId=vancouver','festival opens its exact city event');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id='13800000-0000-0000-0000-000000000002'),1,'festival uses the existing push delivery queue');
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{events,0,status}','"canceled"');
select is(private.notification_target_visible('13800000-0000-0000-0000-000000000002','ticketmaster_event',md5('ticketmaster:vancouver:real-fest')::uuid),false,'a canceled festival cannot leak through queued delivery');
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{events,0,status}','"onsale"');
update public.ticketmaster_event_cache set updated_at=now()-interval '24 hours';
select is(private.notification_target_visible('13800000-0000-0000-0000-000000000002','ticketmaster_event',md5('ticketmaster:vancouver:real-fest')::uuid),false,'stale event data is not recommended or delivered');
update public.ticketmaster_event_cache set updated_at=now();

-- Fresh event discovery is distinct from upstream creation and real popularity.
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
values('tm-event:vancouver:new-event',jsonb_build_object('event',jsonb_build_object(
 'id','new-event','name','Newly discovered concert','country','CA','city','Vancouver','status','onsale',
 'startsAt',(now()+interval '31 days')::text,'timeUnconfirmed',false)),now()+interval '15 minutes');
select private.send_city_recommendations((select first_slot+interval '1 hour' from rec_clock));
select ok((select body like '새로 발견한 행사%' from public.notifications where user_id='13800000-0000-0000-0000-000000000002' and route like '%new-event%'),'a newly observed event is announced without claiming upstream publication time');
select private.send_city_recommendations((select first_slot+interval '1 hour 5 minutes' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002' and route like '%new-event%'),1,'the event is not repeated');

insert into public.posts(id,author_id,city_id,tag_id,title,body,view_count,created_at)
select '13810000-0000-0000-0000-000000000100','13800000-0000-0000-0000-000000000001','vancouver',1,
 'Adjusted counter','Display counter is not real activity',999999,first_slot+interval '90 minutes' from rec_clock;
select private.send_city_recommendations((select first_slot+interval '2 hours' from rec_clock));
select is((select count(*)::int from public.notifications where target_id='13810000-0000-0000-0000-000000000100'),0,'adjusted display views cannot manufacture rising posts');
insert into public.post_views(post_id,user_id,created_at)
select '13810000-0000-0000-0000-000000000100',r.id,first_slot+interval '110 minutes'
from public.profiles r cross join rec_clock where r.id in ('13800000-0000-0000-0000-000000000002','13800000-0000-0000-0000-000000000003','13800000-0000-0000-0000-000000000004');
select private.send_city_recommendations((select first_slot+interval '2 hours' from rec_clock));
select ok((select body like '지금 반응이 빠르게 오르는 글%' from public.notifications
 where user_id='13800000-0000-0000-0000-000000000002' and target_id='13810000-0000-0000-0000-000000000100'),'real recent acceleration produces a rising-post notification');
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select '13810000-0000-0000-0000-000000000101','13800000-0000-0000-0000-000000000001','vancouver',4,
 'New cafe','Real new cafe introduction',first_slot+interval '125 minutes' from rec_clock;
select private.send_city_recommendations((select first_slot+interval '2 hours 10 minutes' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),3,'recommendations do not arrive in a short burst');
insert into public.blocks(blocker_id,blocked_id) values('13800000-0000-0000-0000-000000000002','13800000-0000-0000-0000-000000000001');
select private.send_city_recommendations((select first_slot+interval '2 hours 40 minutes' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),3,'blocked place authors are excluded');
delete from public.blocks where blocker_id='13800000-0000-0000-0000-000000000002';
select private.send_city_recommendations((select first_slot+interval '2 hours 45 minutes' from rec_clock));
select ok((select body like '새로 올라온 맛집·레스토랑%' from public.notifications
 where user_id='13800000-0000-0000-0000-000000000002' and target_id='13810000-0000-0000-0000-000000000101'),'a fresh place post produces its own recommendation');
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select ('13810000-0000-0000-0000-'||lpad((200+i)::text,12,'0'))::uuid,'13800000-0000-0000-0000-000000000001','vancouver',4,
 'Fresh cafe '||i,'Another actual new place',first_slot+make_interval(hours=>4+i) from rec_clock cross join generate_series(1,3) i;
select private.send_city_recommendations((select first_slot+interval '4 hours' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),4,'event alerts reserve capacity for the remaining regular slots');
select private.send_city_recommendations((select first_slot+interval '5 hours' from rec_clock));
select private.send_city_recommendations((select first_slot+interval '9 hours' from rec_clock));
select private.send_city_recommendations((select first_slot+interval '10 hours' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),6,'general recommendations stop at six per local day');
select is((select count(distinct n.id)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.user_id='13800000-0000-0000-0000-000000000002' and n.category in ('trending','city_food','city_places')),6,'all six recommendations enter the existing queue');
select private.send_city_recommendations((select first_slot+interval '12 hours' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002'),6,'local quiet hours stop discovery notifications');
update private.trending_config set enabled=false where id;
select is(private.send_city_recommendations((select first_slot+interval '24 hours' from rec_clock)),0,'operator disable stops recommendations');
update private.trending_config set enabled=true where id;

-- Real activity triggers keep working when the recommendation budget is full.
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
('13810000-0000-0000-0000-000000000900','13800000-0000-0000-0000-000000000002','vancouver',1,'Activity checks','Actual member-owned post');
insert into public.post_reactions(post_id,user_id,kind) values
('13810000-0000-0000-0000-000000000900','13800000-0000-0000-0000-000000000003','like');
insert into public.comments(id,post_id,author_id,body) values
('13820000-0000-0000-0000-000000000001','13810000-0000-0000-0000-000000000900','13800000-0000-0000-0000-000000000003','Root comment on member post'),
('13820000-0000-0000-0000-000000000002','13810000-0000-0000-0000-000000000001','13800000-0000-0000-0000-000000000002','Member comment on another post');
insert into public.comment_likes(comment_id,user_id) values('13820000-0000-0000-0000-000000000002','13800000-0000-0000-0000-000000000004');
insert into public.comments(id,post_id,author_id,parent_id,reply_to_id,body) values
('13820000-0000-0000-0000-000000000003','13810000-0000-0000-0000-000000000001','13800000-0000-0000-0000-000000000003',
 '13820000-0000-0000-0000-000000000002','13820000-0000-0000-0000-000000000002','Actual threaded reply');
select is((select count(distinct n.kind)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.user_id='13800000-0000-0000-0000-000000000002' and n.kind in ('post_like','comment','comment_like','reply')),4,'likes, comments, comment likes and threaded replies all queue outside the recommendation budget');
delete from private.discovery_post_queue;
update public.notification_preferences set interests=true,interest_tag_ids=array[4] where user_id='13800000-0000-0000-0000-000000000002';
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
('13810000-0000-0000-0000-000000000901','13800000-0000-0000-0000-000000000001','vancouver',4,'Preferred topic','New matching interest post');
update private.discovery_post_queue set enqueued_at=clock_timestamp() where post_id='13810000-0000-0000-0000-000000000901';
select private.process_discovery_posts(500);
select is((select count(distinct n.id)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.user_id='13800000-0000-0000-0000-000000000002' and n.kind='interest_post'),1,'explicit interest-topic new posts remain immediate and separate');
select ok(not has_function_privilege('authenticated','private.send_city_recommendations(timestamptz)','execute'),'members cannot broadcast recommendations');
select ok(not has_function_privilege('service_role','private.send_city_recommendations(timestamptz)','execute'),'only the database-owned job can start the generator');

-- Readable fallback and the legacy meetup job share the same member policy.
update public.posts set status='removed';
delete from public.ticketmaster_event_cache;
delete from public.notifications where user_id::text like '13800000-%';
delete from private.trending_topic_sent;
update public.notification_preferences set push_enabled=(right(user_id::text,2) in ('02','04')),trending=true where user_id::text like '13800000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select '13810000-0000-0000-0000-000000000c01','13800000-0000-0000-0000-000000000001','vancouver',1,
 'First member target','A regular slot target',first_slot-interval '24 hours' from rec_clock;
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select '13810000-0000-0000-0000-000000000c02','13800000-0000-0000-0000-000000000003','vancouver',1,
 'Second member target','Another readable regular target',first_slot-interval '25 hours' from rec_clock;
insert into public.blocks(blocker_id,blocked_id) values('13800000-0000-0000-0000-000000000002','13800000-0000-0000-0000-000000000001');
select private.send_city_recommendations((select first_slot from rec_clock));
select private.send_city_recommendations((select first_slot+interval '5 minutes' from rec_clock));
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000002' and category='trending'),1,'member with blocked first target receives a readable slot fallback');
select is((select count(*)::int from public.notifications where user_id='13800000-0000-0000-0000-000000000004' and category='trending'),1,'first-target member receives exactly one slot recommendation');
delete from public.notifications where user_id::text like '13800000-%';
delete from public.blocks where blocker_id='13800000-0000-0000-0000-000000000002';
insert into public.posts(id,author_id,city_id,tag_id,title,body)
select ('13810000-0000-0000-0000-'||lpad((1000+i)::text,12,'0'))::uuid,'13800000-0000-0000-0000-000000000001','vancouver',1,
 'Queue target '||i,'Another readable recommendation' from generate_series(0,5) i;
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at)
select '13800000-0000-0000-0000-000000000002','trending_post','post',('13810000-0000-0000-0000-'||lpad((1000+i)::text,12,'0'))::uuid,
 'Already queued recommendation','/post/13810000-0000-0000-0000-'||lpad((1000+i)::text,12,'0'),first_slot+make_interval(hours=>i) from rec_clock cross join generate_series(0,5) i;
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at)
select '13800000-0000-0000-0000-000000000002','trending_meetup','post','13810000-0000-0000-0000-000000000c02',
 'Legacy meetup discovery','/post/13810000-0000-0000-0000-000000000c02',first_slot+interval '5 hours 1 minute' from rec_clock;
select is((select count(distinct n.id)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.user_id='13800000-0000-0000-0000-000000000002' and n.kind in ('trending_post','trending_meetup')),6,'legacy meetup discovery shares the member recommendation cap');

-- Sending uses the real current clock, independently of the simulated recommendation slots.
delete from public.notifications where user_id::text like '13800000-%';
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at) values
('13800000-0000-0000-0000-000000000002','trending_post','post','13810000-0000-0000-0000-000000000c01','Delayed recommendation1','/post/13810000-0000-0000-0000-000000000c01',now()-interval '65 minutes'),
('13800000-0000-0000-0000-000000000002','trending_post','post','13810000-0000-0000-0000-000000000c02','Delayed recommendation2','/post/13810000-0000-0000-0000-000000000c02',now()-interval '31 minutes');
update private.trending_config set quiet_start_hour=extract(hour from now() at time zone 'America/Vancouver')::int,
 quiet_end_hour=mod(extract(hour from now() at time zone 'America/Vancouver')::int+1,24) where id;
select is((select count(*)::int from public.claim_push_notifications('send',100)
 where user_id='13800000-0000-0000-0000-000000000002' and category='trending'),0,'pending recommendations do not dispatch during local quiet hours');
delete from public.notifications where user_id::text like '13800000-%';
update private.trending_config set quiet_start_hour=0,quiet_end_hour=0 where id;
insert into public.notifications(user_id,kind,target_type,target_id,body,route)
values('13800000-0000-0000-0000-000000000002','trending_post','post','13810000-0000-0000-0000-000000000c01','Fresh quiet-hour recommendation','/post/13810000-0000-0000-0000-000000000c01');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.body='Fresh quiet-hour recommendation'),1,'the quiet-hour send check starts with a genuinely pending recommendation');
update private.trending_config set quiet_start_hour=extract(hour from now() at time zone 'America/Vancouver')::int,
 quiet_end_hour=mod(extract(hour from now() at time zone 'America/Vancouver')::int+1,24) where id;
select is((select count(*)::int from public.claim_push_notifications('send',100)
 where user_id='13800000-0000-0000-0000-000000000002' and category='trending'),0,'fresh recommendations also respect actual send-time quiet hours');
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
values('13800000-0000-0000-0000-000000000002','post_like','13800000-0000-0000-0000-000000000003','post','13810000-0000-0000-0000-000000000c01','Activity stays immediate','/post/13810000-0000-0000-0000-000000000c01');
select is((select count(*)::int from public.claim_push_notifications('send',100)
 where user_id='13800000-0000-0000-0000-000000000002' and category='post_likes'),1,'recommendation quiet hours do not suppress activity sends');

delete from public.notifications where user_id::text like '13800000-%';
update private.trending_config set quiet_start_hour=0,quiet_end_hour=0 where id;
insert into private.push_devices(user_id,session_id,token)
values('13800000-0000-0000-0000-000000000002','13800000-0000-0000-0000-000000000002','ExpoPushToken[recommendation_fixture_second_device]');
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at) values
('13800000-0000-0000-0000-000000000002','trending_post','post','13810000-0000-0000-0000-000000000c01','First batch target','/post/13810000-0000-0000-0000-000000000c01',now()-interval '35 minutes'),
('13800000-0000-0000-0000-000000000002','trending_post','post','13810000-0000-0000-0000-000000000c02','Second batch target','/post/13810000-0000-0000-0000-000000000c02',now()-interval '1 minute');
-- Model a backlog with fresh content: creation guards cannot substitute for send guards.
update public.notifications set created_at=now()-interval '1 minute' where user_id='13800000-0000-0000-0000-000000000002';
create temporary table first_claim as select * from public.claim_push_notifications('send',100);
select is((select count(distinct notification_id)::int from first_claim where user_id='13800000-0000-0000-0000-000000000002'),1,'one batch claims only one recommendation per member');
select is((select count(*)::int from first_claim where user_id='13800000-0000-0000-0000-000000000002'),2,'both devices receive the same recommendation');
select is((select count(distinct notification_id)::int from private.push_delivery_queue where first_attempt_at is not null
 and notification_id in (select id from public.notifications where user_id='13800000-0000-0000-0000-000000000002')),1,'first claims count once before any network response');
update private.push_delivery_queue set lease_until=now()-interval '1 second',next_attempt_at=now()
where id in (select id from first_claim);
create temporary table retry_claim as select * from public.claim_push_notifications('send',100);
select is((select count(*)::int from retry_claim where user_id='13800000-0000-0000-0000-000000000002'),2,'retries of the same recommendation remain supported');
select public.complete_push_notification(id,lease_id,'ticket',gen_random_uuid()::text) from retry_claim;
update private.push_delivery_queue set next_attempt_at=now() where id in (select id from retry_claim);
update private.trending_config set enabled=false where id;
select is((select count(*)::int from public.claim_push_notifications('receipt',100)
 where user_id='13800000-0000-0000-0000-000000000002'),2,'receipt polling is independent of recommendation send limits');

delete from public.notifications where user_id::text like '13800000-%';
update private.trending_config set enabled=true where id;
-- Put the test city at local noon so six earlier claims fit in this day at any UTC test time.
update public.cities set timezone='Etc/GMT'||case when extract(hour from now() at time zone 'UTC')::int>=12 then '+' else '-' end
 ||abs(extract(hour from now() at time zone 'UTC')::int-12)::text where id='vancouver';
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at)
select '13800000-0000-0000-0000-000000000002','trending_post','post',('13810000-0000-0000-0000-'||lpad((1000+i)::text,12,'0'))::uuid,
 'Earlier accepted target','/post/13810000-0000-0000-0000-'||lpad((1000+i)::text,12,'0'),now()-make_interval(hours=>i+1) from generate_series(0,5) i;
update private.push_delivery_queue set status='provider_accepted',first_attempt_at=now()-interval '1 hour'
where notification_id in (select id from public.notifications where user_id='13800000-0000-0000-0000-000000000002');
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at)
values('13800000-0000-0000-0000-000000000002','trending_meetup','post','13810000-0000-0000-0000-000000000c01','Seventh send target','/post/13810000-0000-0000-0000-000000000c01',now());
insert into private.push_delivery_queue(notification_id,device_id)
select n.id,d.id from public.notifications n join private.push_devices d on d.user_id=n.user_id
where n.body='Seventh send target' on conflict do nothing;
select is((select count(*)::int from public.claim_push_notifications('send',100)
 where user_id='13800000-0000-0000-0000-000000000002'),0,'actual local-day send budget counts six distinct recommendations across devices');
delete from public.notifications where user_id::text like '13800000-%';
insert into public.notifications(user_id,kind,target_type,target_id,body,route,created_at) values
('13800000-0000-0000-0000-000000000002','trending_post','post','13810000-0000-0000-0000-000000000c01','Older target','/post/13810000-0000-0000-0000-000000000c01',now()-interval '3 hours'),
('13800000-0000-0000-0000-000000000002','trending_meetup','post','13810000-0000-0000-0000-000000000c01','Duplicate legacy target','/post/13810000-0000-0000-0000-000000000c01',now());
select is((select count(distinct q.notification_id)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.user_id='13800000-0000-0000-0000-000000000002'),1,'legacy and current recommendations do not repeat the same target');
select is((select count(*)::int from public.claim_push_notifications('send',100)
 where user_id='13800000-0000-0000-0000-000000000002'),0,'a stale recommendation is not replayed after worker downtime');
select * from finish();
rollback;
