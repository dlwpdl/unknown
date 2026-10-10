begin;
select no_plan();
select has_column('public','notification_preferences','city_food','food alerts have an independent preference');
select has_column('public','notification_preferences','city_places','place alerts have an independent preference');
select has_function('private','city_recommendation_category',array['text','uuid'],'recommendation classification is shared with delivery');

update public.posts set status='removed';
delete from public.ticketmaster_event_cache;
update public.notification_preferences set push_enabled=false;
update private.trending_config set enabled=true,quiet_start_hour=22,quiet_end_hour=8 where id;
create temporary table city_clock as select
  ((now() at time zone 'America/Vancouver')::date+time '10:00') at time zone 'America/Vancouver' as at;
insert into auth.users(id,email,raw_app_meta_data)
select ('14600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'city-alert-'||n||'@example.test','{}'
from generate_series(1,7) n;
insert into public.profiles(id,nickname,city_id)
select id,'city-alert-'||right(id::text,2),case when right(id::text,2)='05' then 'toronto' else 'vancouver' end
from auth.users where id::text like '14600000-%';
insert into auth.sessions(id,user_id,not_after)
select id,id,case when right(id::text,2)='07' then now()-interval '1 hour' else null end
from public.profiles where id::text like '14600000-%';
select set_config('request.jwt.claims','{"sub":"14600000-0000-4000-8000-000000000002","role":"authenticated","session_id":"14600000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select is((public.get_notification_preferences()->>'city_food')::boolean,true,'new readers default to food alerts ON');
select is((public.get_notification_preferences()->>'city_places')::boolean,true,'new readers default to place alerts ON');
select lives_ok($$select public.update_notification_preferences('{"city_food":false}')$$,'reader can switch food alerts off');
select is((public.get_notification_preferences()->>'city_food')::boolean,false,'saved food OFF is returned');
select is((public.get_notification_preferences()->>'city_places')::boolean,true,'food change preserves place setting');
select is((public.get_notification_preferences()->>'message_preview')::boolean,false,'city settings preserve private message preview');
select throws_ok($$select public.update_notification_preferences('{"city_places":"false"}')$$,'P0001','INVALID_PREFERENCES','string booleans are rejected');
select throws_ok($$select public.update_notification_preferences('{"city_food":null}')$$,'P0001','INVALID_PREFERENCES','null cannot silently reset a choice');
select throws_ok($$select public.update_notification_preferences('{"user_id":"14600000-0000-4000-8000-000000000003","city_food":true}')$$,'P0001','INVALID_PREFERENCES','a patch cannot choose another account');
select throws_ok($$update public.notification_preferences set city_food=true$$,'42501',null,'direct preference writes remain unavailable');
reset role;
select ok(not has_function_privilege('anon','private.city_recommendation_category(text,uuid)','execute'),'guests cannot inspect private classification');
select ok(not has_function_privilege('authenticated','private.city_recommendation_category(text,uuid)','execute'),'members cannot inspect private classification');
select ok(not has_function_privilege('service_role','private.city_recommendation_category(text,uuid)','execute'),'worker must use the protected claim');

insert into public.notification_preferences(user_id,push_enabled,trending,city_food,city_places)
select id,true,false,right(id::text,2) in ('01','02','05','06','07'),right(id::text,2) in ('01','03','05','06','07')
from public.profiles where id::text like '14600000-%'
on conflict(user_id) do update set push_enabled=excluded.push_enabled,trending=excluded.trending,city_food=excluded.city_food,city_places=excluded.city_places;
insert into private.push_devices(user_id,session_id,token)
select id,id,'ExpoPushToken[city_alert_fixture_'||right(id::text,2)||']' from public.profiles where id::text like '14600000-%';
insert into public.blocks(blocker_id,blocked_id)
values('14600000-0000-4000-8000-000000000006','14600000-0000-4000-8000-000000000001');
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
select ('14610000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'14600000-0000-4000-8000-000000000001',
  'vancouver',t.id,title,body,at-make_interval(mins=>n)
from (values
 (1,'food','맛집 새 소식','오늘 새로 소개된 식당'),
 (2,'travel','가볼 만한 곳','새로운 전망 명소'),
 (3,'business','새 레스토랑 소개','캐나다의 restaurant 소식'),
 (4,'life','동네 산책','공원과 도서관 소개'),
 (5,'jobs','레스토랑 채용','Restaurant에서 함께 일할 분'),
 (6,'business','회계 업체 소개','회계 서비스 안내')
) v(n,slug,title,body) join public.tags t on t.slug=v.slug cross join city_clock;
select is(private.city_recommendation_category('post','14610000-0000-4000-8000-000000000001'),'city_food','food category stays food');
select is(private.city_recommendation_category('post','14610000-0000-4000-8000-000000000002'),'city_places','travel category stays places');
select is(private.city_recommendation_category('post','14610000-0000-4000-8000-000000000003'),'city_food','public restaurant introductions are included');
select is(private.city_recommendation_category('post','14610000-0000-4000-8000-000000000004'),'city_places','ordinary library and walk introductions are included');
select is(private.city_recommendation_category('post','14610000-0000-4000-8000-000000000005'),'trending','restaurant employment posts do not become food updates');
select is(private.city_recommendation_category('post','14610000-0000-4000-8000-000000000006'),'trending','other business news stays general');
select is(private.city_recommendation_category('ticketmaster_event','14610000-0000-4000-8000-000000000001'),'city_places','verified event recommendations share the places choice');
select private.send_city_recommendations((select at from city_clock));
select is((select count(*)::int from public.notifications where user_id='14600000-0000-4000-8000-000000000002' and category='city_food'),1,'food ON works independently of general trending OFF');
select is((select count(*)::int from public.notifications where user_id='14600000-0000-4000-8000-000000000003' and category='city_places'),1,'places ON works independently of food and trending OFF');
select is((select count(*)::int from public.notifications where user_id='14600000-0000-4000-8000-000000000002' and category='city_places'),0,'place OFF does not follow food ON');
select is((select count(*)::int from public.notifications where user_id='14600000-0000-4000-8000-000000000003' and category='city_food'),0,'food OFF does not follow place ON');
select is((select count(*)::int from public.notifications where user_id in ('14600000-0000-4000-8000-000000000004','14600000-0000-4000-8000-000000000005','14600000-0000-4000-8000-000000000006','14600000-0000-4000-8000-000000000007')),0,'all OFF, other city, blocks and expired sessions remain excluded');
select ok((select body like '%맛집·레스토랑%' and route='/post/'||target_id::text from public.notifications where user_id='14600000-0000-4000-8000-000000000002' limit 1),'food alert uses its exact real post and correct label');
select private.send_city_recommendations((select at+interval '5 minutes' from city_clock));
select is((select count(*)::int from public.notifications where user_id='14600000-0000-4000-8000-000000000002'),1,'food and place updates do not add a burst');

-- All fixtures and delivery claims are inside this rollback; no device is contacted.
delete from public.notifications where user_id::text like '14600000-%';
update private.trending_config set quiet_start_hour=0,quiet_end_hour=0 where id;
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
values('14600000-0000-4000-8000-000000000002','city_food','14600000-0000-4000-8000-000000000001','post','14610000-0000-4000-8000-000000000001','New food update','/post/14610000-0000-4000-8000-000000000001');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id='14600000-0000-4000-8000-000000000002'),1,'food updates use the existing queue');
create temporary table city_claim as select * from public.claim_push_notifications() where user_id='14600000-0000-4000-8000-000000000002';
select is((select count(*)::int from city_claim),1,'food ON can be claimed by the existing delivery worker');
select is((select category from city_claim),'city_food','the claimed category matches the independent food setting');
select ok((select body='New food update' and route='/post/14610000-0000-4000-8000-000000000001' from city_claim),'claim preserves the exact food content destination');
select public.complete_push_notification(id,lease_id,'retry',null,'EXPO_UNAVAILABLE') from city_claim;
update private.push_delivery_queue set next_attempt_at=now() where notification_id in (select notification_id from city_claim);
update public.notification_preferences set city_food=false where user_id='14600000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.claim_push_notifications() where user_id='14600000-0000-4000-8000-000000000002'),0,'switching OFF before a send suppresses the queued update');
select ok((select bool_and(q.status='cancelled') from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id='14600000-0000-4000-8000-000000000002'),'withdrawn updates are cancelled without retries');
delete from public.notifications where user_id::text like '14600000-%';
update public.notification_preferences set city_food=true where user_id='14600000-0000-4000-8000-000000000002';
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
values('14600000-0000-4000-8000-000000000002','city_food','14600000-0000-4000-8000-000000000001','post','14610000-0000-4000-8000-000000000003','Restaurant update','/post/14610000-0000-4000-8000-000000000003');
update public.profiles set city_id='toronto' where id='14600000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.claim_push_notifications() where user_id='14600000-0000-4000-8000-000000000002'),0,'moving cities before delivery cancels the old city update');
update public.profiles set city_id='vancouver' where id='14600000-0000-4000-8000-000000000002';
delete from public.notifications where user_id::text like '14600000-%';
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
values('14600000-0000-4000-8000-000000000002','city_food','14600000-0000-4000-8000-000000000001','post','14610000-0000-4000-8000-000000000003','Restaurant update','/post/14610000-0000-4000-8000-000000000003');
update public.posts set status='removed' where id='14610000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.claim_push_notifications() where user_id='14600000-0000-4000-8000-000000000002'),0,'removed restaurant updates cannot reach a lock screen');

delete from public.notifications where user_id::text like '14600000-%';
update public.notification_preferences set trending=true,city_food=false where user_id='14600000-0000-4000-8000-000000000002';
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
values('14600000-0000-4000-8000-000000000002','trending_post','14600000-0000-4000-8000-000000000001','post','14610000-0000-4000-8000-000000000001','Older generic restaurant recommendation','/post/14610000-0000-4000-8000-000000000001');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id='14600000-0000-4000-8000-000000000002'),0,'older generic food recommendations also honor the new food OFF choice');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
select '14610000-0000-4000-8000-000000000099','14600000-0000-4000-8000-000000000004','vancouver',id,'내 식당 후기','내 글의 활동은 계속 받기' from public.tags where slug='food';
insert into public.post_reactions(post_id,user_id,kind)
values('14610000-0000-4000-8000-000000000099','14600000-0000-4000-8000-000000000001','like');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id='14600000-0000-4000-8000-000000000004' and n.kind='post_like'),1,'food discovery OFF preserves personal food-post activity notifications');
select * from finish();
rollback;
