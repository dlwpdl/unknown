begin;
select no_plan();
select has_column('private','push_devices','timezone','device timezone is recorded without GPS');
select has_function('public','register_push_device',array['text','uuid','text'],'timezone-aware registration exists');
select has_function('public','register_push_device',array['text','uuid'],'existing app registration remains supported');
select ok(private.recommendation_time('2026-10-16 16:00Z','America/Vancouver'),'09:00 local is a sending slot');
select ok(not private.recommendation_time('2026-10-16 16:00Z','Asia/Seoul'),'the same instant is 01:00 in Korea and is suppressed');
select ok(not private.recommendation_time('2026-10-16 16:00Z',null),'an unknown timezone never guesses a city clock');
select is((select count(*)::integer from generate_series('2026-10-16 00:00Z'::timestamptz,'2026-10-16 23:55Z',interval '5 minutes') t
  where private.recommendation_time(t,'UTC')),24,'exactly eight fifteen-minute windows use the existing five-minute runner');
select ok(not private.recommendation_time('2026-10-16 19:45Z','UTC'),'missed final slots are not replayed late');
select ok(private.recommendation_time('2026-11-01 17:00Z','America/Vancouver'),'fall DST uses 09:00 device time');
select ok(not private.recommendation_time('2026-11-01 16:00Z','America/Vancouver'),'fall DST does not send at the old UTC offset');
select ok(private.recommendation_time('2027-03-14 16:00Z','America/Vancouver'),'spring DST uses 09:00 device time');
select ok(private.recommendation_time('2026-10-16 03:15Z','Asia/Kathmandu'),'quarter-hour timezone offsets use the same local schedule');
select is(private.next_recommendation_slot('2026-10-16 05:00Z','America/Vancouver'),'2026-10-16 16:00Z'::timestamptz,'an overnight one-shot waits for the next device morning');
select is(private.next_recommendation_slot('2026-10-16 16:20Z','America/Vancouver'),'2026-10-16 17:30Z'::timestamptz,'a missed slot waits for the next scheduled slot');
select is(private.next_recommendation_slot('2026-10-16 16:05Z','America/Vancouver'),'2026-10-16 16:05Z'::timestamptz,'a recommendation inside its slot can send immediately');
select ok(not has_function_privilege('anon','public.register_push_device(text,uuid,text)','execute'),'anonymous timezone registration is forbidden');
select ok(not has_function_privilege('authenticated','private.recommendation_timezone(uuid)','execute'),'other members cannot inspect device zones');

update public.posts set status='removed';
delete from private.push_delivery_queue;
update private.trending_config set enabled=true where id;
create temp table cadence_clock as select ((now() at time zone 'America/Vancouver')::date+1+time '09:00') at time zone 'America/Vancouver' first_slot;
insert into auth.users(id,email,raw_app_meta_data) values
('13900000-0000-0000-0000-000000000001','cadence-author@example.test','{}'),
('13900000-0000-0000-0000-000000000002','cadence-local@example.test','{}'),
('13900000-0000-0000-0000-000000000003','cadence-traveller@example.test','{}'),
('13900000-0000-0000-0000-000000000004','cadence-unknown@example.test','{}');
insert into public.profiles(id,nickname,city_id) select id,'cadence'||right(id::text,2),'vancouver'
  from auth.users where id::text like '13900000-%';
insert into public.notification_preferences(user_id,push_enabled,trending,city_food,city_places)
  select id,true,true,true,true from public.profiles where id::text like '13900000-%';
insert into auth.sessions(id,user_id,created_at) select id,id,now() from public.profiles where id::text like '13900000-%';
select set_config('request.jwt.claims','{"sub":"13900000-0000-0000-0000-000000000002","session_id":"13900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_device('ExpoPushToken[cadence_local_12345]',auth.uid());
select throws_ok($$select public.register_push_device('ExpoPushToken[cadence_local_12345]',auth.uid(),'Invalid/Timezone')$$,'P0001','INVALID_TIMEZONE','invalid timezone is rejected');
select throws_ok($$select public.register_push_device('ExpoPushToken[cadence_local_12345]','13900000-0000-0000-0000-000000000003','Asia/Seoul')$$,'P0001','AUTH_CONTEXT_CHANGED','a member cannot change another account timezone');
select public.register_push_device('ExpoPushToken[cadence_local_12345]',auth.uid(),'America/Vancouver');
reset role;
select is(private.recommendation_timezone('13900000-0000-0000-0000-000000000002'),'America/Vancouver','new registration stores the authenticated device timezone');
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at) values
('13900000-0000-0000-0000-000000000003','13900000-0000-0000-0000-000000000003','ExpoPushToken[cadence_travel_12345]','Asia/Seoul',now()),
('13900000-0000-0000-0000-000000000004','13900000-0000-0000-0000-000000000004','ExpoPushToken[cadence_unknown_12345]',null,null);
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at)
  select ('13910000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'13900000-0000-0000-0000-000000000001',
    'vancouver',4,'추천 카페 '||i,'Verified cafe introduction',first_slot-interval '24 hours'
  from cadence_clock cross join generate_series(1,12) i;
select private.send_city_recommendations((select first_slot from cadence_clock));
select private.send_city_recommendations((select first_slot+interval '5 minutes' from cadence_clock));
select is((select count(*)::integer from public.notifications where user_id='13900000-0000-0000-0000-000000000002'),1,'a five-minute retry does not repeat a slot');
select is((select count(*)::integer from public.notifications where user_id='13900000-0000-0000-0000-000000000003'),0,'selecting Vancouver does not send overnight to a traveller in Korea');
select is((select count(*)::integer from public.notifications where user_id='13900000-0000-0000-0000-000000000004'),0,'an old app without timezone gets no recommendation push');
select private.send_city_recommendations(first_slot+make_interval(mins=>90*i)) from cadence_clock cross join generate_series(1,7) i;
select is((select count(*)::integer from public.notifications where user_id='13900000-0000-0000-0000-000000000002'),8,'eight local slots produce eight distinct recommendations');
select is((select count(distinct q.notification_id)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
  where n.user_id='13900000-0000-0000-0000-000000000002'),8,'all eight use the existing device queue');
select private.send_city_recommendations((select first_slot+interval '11 hours' from cadence_clock));
select is((select count(*)::integer from public.notifications where user_id='13900000-0000-0000-0000-000000000002'),8,'no ninth recommendation or evening catch-up');
select private.send_city_recommendations((select first_slot+interval '8 hours' from cadence_clock));
select is((select count(*)::integer from public.notifications where user_id='13900000-0000-0000-0000-000000000003'),1,'a traveller receives Vancouver content at Korea 09:00 even when Vancouver has no slot');
select set_config('request.jwt.claims','{"sub":"13900000-0000-0000-0000-000000000002","session_id":"13900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_device('ExpoPushToken[cadence_local_12345]',auth.uid(),'Asia/Seoul');
reset role;
select is(private.recommendation_timezone('13900000-0000-0000-0000-000000000002'),'Asia/Seoul','foreground re-registration updates a travelling member timezone');
update private.push_devices set timezone=null where user_id='13900000-0000-0000-0000-000000000002';
select is((select count(*)::integer from public.claim_push_notifications('send',100)
  where user_id='13900000-0000-0000-0000-000000000002'),0,'send claims recheck the device zone and suppress already queued recommendations');
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
values('13900000-0000-0000-0000-000000000002','comment','13900000-0000-0000-0000-000000000001',
  'post','13910000-0000-0000-0000-000000000001','A real activity reply','/post/13910000-0000-0000-0000-000000000001');
select is((select count(*)::integer from public.claim_push_notifications('send',100)
  where user_id='13900000-0000-0000-0000-000000000002' and category='replies'),1,'an unknown zone does not block replies');

-- A global topic marker must still retain work for every device-timezone cohort.
update private.trending_config set quiet_start_hour=0,quiet_end_hour=0 where id;
update private.push_devices set timezone='Asia/Tokyo',timezone_updated_at=now() where user_id='13900000-0000-0000-0000-000000000002';
insert into private.push_devices(user_id,session_id,token,timezone,timezone_updated_at) values
('13900000-0000-0000-0000-000000000003','13900000-0000-0000-0000-000000000003','ExpoPushToken[cadence_second_device_12345]','UTC',now()-interval '1 hour'),
('13900000-0000-0000-0000-000000000003','13900000-0000-0000-0000-000000000003','ExpoPushToken[cadence_unknown_device_12345]',null,null);
insert into public.posts(id,author_id,city_id,tag_id,title,body,hashtags)
select ('13920000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('13900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'vancouver',1,'Timezone topic fixture','A real local topic',array['#timezonecohorts']
from generate_series(1,3) n;
select public.send_trending_topic_notifications();
select is((select count(*)::integer from public.notifications where kind='trending_hashtag'
 and user_id in ('13900000-0000-0000-0000-000000000002','13900000-0000-0000-0000-000000000003')),2,
 'the real topic producer retains both device-zone recipients');
select is((select count(distinct n.user_id)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.kind='trending_hashtag' and n.user_id in ('13900000-0000-0000-0000-000000000002','13900000-0000-0000-0000-000000000003')),2,
 'both cohorts have durable delivery work before the city-wide marker is consumed');
select public.send_trending_topic_notifications();
select is((select count(*)::integer from public.notifications where kind='trending_hashtag'
 and user_id in ('13900000-0000-0000-0000-000000000002','13900000-0000-0000-0000-000000000003')),2,'repeating the topic producer does not duplicate either cohort');

delete from public.notifications where user_id='13900000-0000-0000-0000-000000000003';
insert into public.notifications(id,user_id,kind,target_type,target_id,body,route,created_at)
select '13990000-0000-0000-0000-000000000001','13900000-0000-0000-0000-000000000003','weekly_ranking','post',
 '13910000-0000-0000-0000-000000000012','One-shot ranking','/post/13910000-0000-0000-0000-000000000012',first_slot from cadence_clock;
select is((select q.next_attempt_at from private.push_delivery_queue q join private.push_devices d on d.id=q.device_id
 where q.notification_id='13990000-0000-0000-0000-000000000001' and d.timezone='Asia/Seoul'),
 (select first_slot+interval '8 hours' from cadence_clock),'an overnight ranking waits until Seoul morning');
select is((select q.next_attempt_at from private.push_delivery_queue q join private.push_devices d on d.id=q.device_id
 where q.notification_id='13990000-0000-0000-0000-000000000001' and d.timezone='UTC'),
 (select first_slot+interval '30 minutes' from cadence_clock),'another active device waits for its own local slot');
select is((select count(*)::integer from private.push_delivery_queue where notification_id='13990000-0000-0000-0000-000000000001'),2,
 'an unknown-zone device is skipped without losing work for the two known devices');

-- Revalidate a delayed one-shot against the real current clock, then advance only the slot gate.
update public.notifications set created_at=now()-interval '3 hours' where id='13990000-0000-0000-0000-000000000001';
update private.push_devices set timezone=(select name from pg_timezone_names where not private.recommendation_time(now(),name)
 and extract(hour from now() at time zone name) between 9 and 19 order by name limit 1)
where user_id='13900000-0000-0000-0000-000000000003' and timezone is not null;
update private.push_delivery_queue set next_attempt_at=now() where notification_id='13990000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.claim_push_notifications('send',100)
 where notification_id='13990000-0000-0000-0000-000000000001'),0,'an early claim emits no ranking outside the device slot');
select ok((select bool_and(status='pending' and next_attempt_at>now() and first_attempt_at is null and attempts=0)
 from private.push_delivery_queue where notification_id='13990000-0000-0000-0000-000000000001'),
 'a three-hour-old ranking is deferred without spending a send attempt');
create or replace function private.next_recommendation_slot(p_after timestamptz,p_timezone text)
returns timestamptz language sql stable set search_path='' as $$ select p_after $$;
update private.push_delivery_queue set next_attempt_at=now() where notification_id='13990000-0000-0000-0000-000000000001';
create temporary table delayed_claims as select * from public.claim_push_notifications('send',100);
select is((select count(*)::integer from delayed_claims where notification_id='13990000-0000-0000-0000-000000000001'),2,
 'both devices can claim the retained ranking once their slot arrives');
select is((select count(distinct notification_id)::integer from private.push_delivery_queue
 where notification_id='13990000-0000-0000-0000-000000000001' and first_attempt_at is not null),1,
 'multi-device fan-out spends one shared user recommendation');
update public.profiles set city_id='toronto' where id='13900000-0000-0000-0000-000000000003';
update private.push_delivery_queue set lease_until=now()-interval '1 second',next_attempt_at=now()
where notification_id='13990000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.claim_push_notifications('send',100)
 where notification_id='13990000-0000-0000-0000-000000000001'),0,'a changed selected city cancels the retained old-city ranking');
select ok((select bool_and(status='cancelled') from private.push_delivery_queue
 where notification_id='13990000-0000-0000-0000-000000000001'),'old-city pending devices are cancelled before any provider call');
-- A delayed retry reserves its new claim time before another recommendation can claim.
delete from public.notifications where user_id='13900000-0000-0000-0000-000000000003';
update public.profiles set city_id='vancouver' where id='13900000-0000-0000-0000-000000000003';
update private.push_devices set disabled_at=now() where user_id='13900000-0000-0000-0000-000000000003';
update private.push_devices set disabled_at=null,timezone='UTC',timezone_updated_at=now()
where token='ExpoPushToken[cadence_second_device_12345]';
insert into public.notifications(id,user_id,kind,target_type,target_id,body,route)
select ('13991000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'13900000-0000-0000-0000-000000000003',
 'weekly_ranking','post',('13910000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Retry accounting fixture',
 '/post/13910000-0000-0000-0000-'||lpad(i::text,12,'0') from generate_series(1,10) i;
update private.push_delivery_queue set id=notification_id,next_attempt_at=now()+interval '1 day'
where notification_id::text like '13991000-%';
update private.push_delivery_queue set next_attempt_at=now(),first_attempt_at=now()-interval '90 minutes',attempts=1
where notification_id='13991000-0000-0000-0000-000000000001';
update private.push_delivery_queue set next_attempt_at=now() where notification_id='13991000-0000-0000-0000-000000000002';
create temp table retry_claims as select * from public.claim_push_notifications('send',100);
select is((select count(distinct notification_id)::integer from retry_claims where notification_id::text like '13991000-%'),1,
 'a delayed retry and fresh recommendation cannot share the same provider batch');
select is((select last_attempt_at from private.push_delivery_queue where notification_id='13991000-0000-0000-0000-000000000001'),now(),
 'a reclaimed recommendation records its actual retry time');

-- Yesterday's retry counts in today's distinct-ID allowance without charging fan-out twice.
update private.push_devices set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=18 order by name limit 1)
where token='ExpoPushToken[cadence_second_device_12345]';
create temp table retry_day as select timezone zone,((now() at time zone timezone)::date+time '09:00') at time zone timezone morning,
 (((now() at time zone timezone)::date-1)+time '19:30') at time zone timezone previous_evening
from private.push_devices where token='ExpoPushToken[cadence_second_device_12345]';
update public.notifications set created_at=(select previous_evening from retry_day)
where id='13991000-0000-0000-0000-000000000001';
update private.push_delivery_queue set lease_id=null,lease_until=null,first_attempt_at=(select previous_evening from retry_day),
 last_attempt_at=(select previous_evening from retry_day),created_at=(select previous_evening from retry_day),next_attempt_at=now(),attempts=1
where notification_id='13991000-0000-0000-0000-000000000001';
update private.push_delivery_queue set status='provider_accepted',first_attempt_at=(select morning from retry_day),
 last_attempt_at=(select morning from retry_day),attempts=1
where notification_id between '13991000-0000-0000-0000-000000000003' and '13991000-0000-0000-0000-000000000009';
select is((select count(*)::integer from public.claim_push_notifications('send',100)
 where notification_id='13991000-0000-0000-0000-000000000001'),1,'a prior-day retry can consume the eighth current-day allowance');
select is((select count(distinct notification_id)::integer from private.push_delivery_queue
 where notification_id::text like '13991000-%' and (last_attempt_at at time zone (select zone from retry_day))::date=
 (now() at time zone (select zone from retry_day))::date),8,'the current local day counts seven prior IDs plus the retried ID');
-- Isolate the day budget after the retry spacing assertion above.
update private.push_delivery_queue set last_attempt_at=(select morning from retry_day)
where notification_id='13991000-0000-0000-0000-000000000001';
update private.push_delivery_queue set next_attempt_at=now() where notification_id='13991000-0000-0000-0000-000000000010';
select is((select count(*)::integer from public.claim_push_notifications('send',100)
 where notification_id='13991000-0000-0000-0000-000000000010'),0,'a ninth distinct ID waits even after the retry spacing has elapsed');
select ok((select status='pending' and attempts=0 and next_attempt_at>now() from private.push_delivery_queue
 where notification_id='13991000-0000-0000-0000-000000000010'),'the ninth recommendation stays pending without a charged attempt');
select * from finish();
rollback;
