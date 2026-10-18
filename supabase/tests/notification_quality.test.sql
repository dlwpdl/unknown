begin;
set local search_path=public,extensions;
select no_plan();
update public.posts set status='removed';
delete from public.ticketmaster_event_cache;
delete from public.notifications;
delete from private.trending_topic_sent;
update private.trending_config set enabled=true,quiet_start_hour=0,quiet_end_hour=0 where id;
create temp table quality_clock as select ((now() at time zone 'UTC')::date+1+time '09:00') at time zone 'UTC' first_slot;
insert into auth.users(id,email,raw_app_meta_data) select
 ('17800000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'quality-'||i||'@example.test','{}'::jsonb from generate_series(1,4) i;
insert into public.profiles(id,nickname,city_id) select id,'quality'||right(id::text,2),
 case when right(id::text,2)='03' then 'toronto' else 'vancouver' end from auth.users where id::text like '17800000-%';
insert into public.notification_preferences(user_id,push_enabled,trending,city_food,city_places)
 select id,true,true,true,true from public.profiles where id::text like '17800000-%';
insert into auth.sessions(id,user_id,created_at) select id,id,now() from public.profiles where id::text like '17800000-%';
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at)
 select id,id,'ExpoPushToken[quality_fixture_'||right(id::text,2)||']','UTC',now()
 from public.profiles where id='17800000-0000-4000-8000-000000000002';

insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
 select 'tm-festival:vancouver',jsonb_build_object('events',jsonb_build_array(
 jsonb_build_object('id','quality-session-a','name','Quality Festival','venue','Fixture Hall','country','CA','city','Vancouver','status','onsale','timeUnconfirmed',false,'startsAt',first_slot+interval '2 days','segment','Music','genre','Jazz'),
 jsonb_build_object('id','quality-session-b','name','Quality Festival','venue','Fixture Hall','country','CA','city','Vancouver','status','onsale','timeUnconfirmed',false,'startsAt',first_slot+interval '2 days 30 minutes','segment','Music','genre','Jazz'))),now()+interval '15 minutes' from quality_clock;
select private.send_city_recommendations(first_slot) from quality_clock;
select private.send_city_recommendations(first_slot+interval '90 minutes') from quality_clock;
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),1,
 'two entry times of the same city/name/venue/day produce only one recommendation');
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000003'),0,
 'festival selection remains inside the saved city');
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{events}',jsonb_build_array(payload->'events'->1));
select private.send_city_recommendations(first_slot+interval '3 hours') from quality_clock;
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),1,
 'persisted event identity blocks a repeat after the original provider entry leaves the cache');
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{events,0,venue}','"Another Hall"');
select private.send_city_recommendations(first_slot+interval '4 hours 30 minutes') from quality_clock;
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),2,
 'the same event name at another venue is not incorrectly merged');
create temp table previous_day_key as select private.event_recommendation_key('vancouver',md5('ticketmaster:vancouver:quality-session-b')::uuid) key;
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{events,0,startsAt}',to_jsonb(((payload#>>'{events,0,startsAt}')::timestamptz+interval '1 day')::text));
select isnt(private.event_recommendation_key('vancouver',md5('ticketmaster:vancouver:quality-session-b')::uuid),
 (select key from previous_day_key),'the same venue and event on a different local date keep distinct identities');

delete from public.notifications;
delete from private.trending_topic_sent;
update public.ticketmaster_event_cache set payload=jsonb_build_object('events',jsonb_build_array(
 jsonb_build_object('id','generic-inventory','name','Ordinary Ticket Listing','venue','Fixture Hall','country','CA','city','Vancouver','status','onsale','timeUnconfirmed',false,'startsAt',now()+interval '60 days')));
select private.send_city_recommendations(first_slot) from quality_clock;
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),0,
 'a regular slot does not push distant generic ticket inventory just to fill a quota');

-- Recipient-local lunch and evening can occur at the same UTC instant.
delete from public.notifications;
delete from public.ticketmaster_event_cache;
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at)
 values('17800000-0000-4000-8000-000000000004','17800000-0000-4000-8000-000000000004','ExpoPushToken[quality_evening_fixture]','Asia/Dhaka',now());
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
 select '17810000-0000-4000-8000-000000000001'::uuid,'17800000-0000-4000-8000-000000000001'::uuid,'vancouver',4,'점심 맛집 소개','식사 장소를 소개하는 실제 본문입니다.',first_slot-interval '1 hour' from quality_clock
 union all select '17810000-0000-4000-8000-000000000002'::uuid,'17800000-0000-4000-8000-000000000001'::uuid,'vancouver',10,'가볼 만한 공원','산책 장소를 소개하는 실제 본문입니다.',first_slot-interval '30 minutes' from quality_clock;
select private.send_city_recommendations(first_slot+interval '3 hours') from quality_clock;
select is((select target_id from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),
 '17810000-0000-4000-8000-000000000001'::uuid,'device-local lunch prioritizes the food post');
select is((select target_id from public.notifications where user_id='17800000-0000-4000-8000-000000000004'),
 '17810000-0000-4000-8000-000000000002'::uuid,'device-local evening prioritizes the place post');
select private.send_city_recommendations(first_slot+interval '3 hours 5 minutes') from quality_clock;
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),1,
 'another five-minute run cannot turn one local slot into a burst');

-- A topic may stay in the inbox without consuming a recommendation push.
delete from public.notifications;
update public.posts set hashtags=array['qualitytopic'] where id='17810000-0000-4000-8000-000000000001';
insert into public.notifications(user_id,kind,target_type,target_id,body,route,city_id)
 values('17800000-0000-4000-8000-000000000002','trending_hashtag','tag',md5('trending-hashtag:vancouver:qualitytopic')::uuid,'동네 주제 안내','/notifications','vancouver');
select is((select count(*)::int from public.notifications where kind='trending_hashtag'),1,'topic inbox history is preserved');
select is((select count(*)::int from private.push_delivery_queue),0,'a hashtag-only notice does not create an interrupting push');

delete from public.notifications;
update public.posts set status='removed';
delete from private.push_devices where user_id='17800000-0000-4000-8000-000000000004';
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
 select 'tm-festival:vancouver',jsonb_build_object('events',jsonb_agg(jsonb_build_object(
 'id','copy-event-'||i,'name','Quality Festival '||i,'venue','Fixture Hall '||i,'country','CA','city','Vancouver','status','onsale',
 'timeUnconfirmed',false,'startsAt',first_slot+interval '2 days'+i*interval '1 hour','segment','Music','genre','Jazz'))),now()+interval '15 minutes'
 from quality_clock cross join generate_series(1,6) i;
select private.send_city_recommendations(first_slot+i*interval '90 minutes') from quality_clock cross join generate_series(0,5) i;
select is((select count(*)::int from public.notifications where user_id='17800000-0000-4000-8000-000000000002'),6,
 'six useful distinct events can occupy six existing slots');
create temp table quality_styles as select
 case when body ~ '^[0-9]{1,2}월 [0-9]{1,2}일, ' then 0 else 1 end
 + case when body like '% 열릴 예정이에요.' then 2 else 0 end style,
 row_number() over(order by created_at,id) position
 from public.notifications where user_id='17800000-0000-4000-8000-000000000002';
select is((select count(distinct style)::int from quality_styles),4,
 'different events rotate through four complete sentence styles');
select ok(not exists(select 1 from (select style,lag(style) over(order by position) previous from quality_styles) x
 where style=previous),'consecutive event sentence styles do not repeat');
select ok(not exists(select 1 from public.notifications where body like '%같이 갈 사람!?%'),
 'the superseded universal invitation is not appended to every event');
select ok((select bool_and(char_length(body)<=90) from public.notifications),'variety preserves the concise event body budget');

-- A send refreshes facts and preserves the resulting copy through a retry.
create or replace function private.recommendation_time(p_at timestamptz,p_timezone text) returns boolean language sql stable as $$select true$$;
update private.push_delivery_queue set next_attempt_at=now()+interval '1 day';
update private.push_delivery_queue set next_attempt_at=now() where notification_id=(select id from public.notifications
 where user_id='17800000-0000-4000-8000-000000000002' order by created_at,id limit 1);
update public.ticketmaster_event_cache set payload=jsonb_set(payload,'{events,0,description}','"야외 무대에서 재즈 공연이 열려요."');
create temp table quality_claim as select * from public.claim_push_notifications('send',100);
select is((select count(*)::int from quality_claim),1,'only the due event is claimed');
select ok((select body like '%야외 무대에서 재즈 공연이 열려요.%' from quality_claim),'delivery refreshes the real event description');
select is((select body from quality_claim),'야외 무대에서 재즈 공연이 열려요.',
 'a refreshed source sentence needs no decorative opening');
select public.complete_push_notification(id,lease_id,'retry',null,'EXPO_UNAVAILABLE') from quality_claim;
update private.push_delivery_queue set next_attempt_at=now() where id in(select id from quality_claim);
create temp table quality_retry as select * from public.claim_push_notifications('send',100);
select is((select body from quality_retry),(select body from quality_claim),'a retry never becomes a differently worded notification');

-- Existing queued variants are suppressed without preventing the same alert on a second device.
delete from public.notifications;
delete from public.ticketmaster_event_cache;
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at)
 values('17800000-0000-4000-8000-000000000002','17800000-0000-4000-8000-000000000002','ExpoPushToken[quality_second_device]','UTC',now());
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
 select 'tm-festival:vancouver',jsonb_build_object('events',jsonb_agg(jsonb_build_object(
 'id','legacy-session-'||i,'name','Legacy Festival','venue','Legacy Hall','country','CA','city','Vancouver','status','onsale',
 'timeUnconfirmed',false,'startsAt',now()+interval '2 days'+i*interval '30 minutes'))),now()+interval '15 minutes'
 from generate_series(1,2) i;
alter table public.notifications disable trigger notifications_preferences;
insert into public.notifications(user_id,kind,category,target_type,target_id,city_id,recommendation_key,body,route,created_at)
 select '17800000-0000-4000-8000-000000000002','city_places','city_places','ticketmaster_event',e.target_id,'vancouver',
 null,e.name,'/events/'||e.event_id||'?cityId=vancouver',now()-interval '1 hour'
 from private.ticketmaster_notification_events e;
alter table public.notifications enable trigger notifications_preferences;
update private.push_delivery_queue q set next_attempt_at=now()-case when n.route like '%session-1?%' then interval '2 minutes' else interval '1 minute' end
 from public.notifications n where n.id=q.notification_id;
create temp table legacy_claims as select * from public.claim_push_notifications('send',100);
select is((select count(*)::int from legacy_claims),2,'both active devices receive the same first event notification');
select is((select count(distinct notification_id)::int from legacy_claims),1,'alternate admission times cannot become a second queued send');
select is((select count(*)::int from private.push_delivery_queue where status='cancelled' and last_error='DUPLICATE_EVENT'),2,
 'already queued duplicate event variants are cancelled before provider submission');
select ok(not exists(select 1 from public.notifications where recommendation_key is null),
 'a refreshed source recovers persisted identities for legacy NULL-key recommendations');
update public.notifications set recommendation_key=null where id in(select notification_id from legacy_claims);
update private.push_delivery_queue set status='pending',last_error=null,finished_at=null,next_attempt_at=now()
 where notification_id not in(select notification_id from legacy_claims);
select is((select count(*)::int from public.claim_push_notifications('send',100)),0,
 'a new keyed event is also suppressed against an already attempted legacy NULL-key variant');
select is((select count(*)::int from private.push_delivery_queue where status='cancelled' and last_error='DUPLICATE_EVENT'),2,
 'legacy delivery history is recovered before comparing a new keyed queue entry');
select ok(not has_function_privilege('anon','private.event_recommendation_key(text,uuid)','execute')
 and not has_function_privilege('authenticated','private.event_recommendation_body(uuid,jsonb,text,text)','execute')
 and not has_function_privilege('service_role','private.event_recommendation_key(text,uuid)','execute'),
 'event identity and recipient copy history remain behind private trusted boundaries');
select * from finish();
rollback;
