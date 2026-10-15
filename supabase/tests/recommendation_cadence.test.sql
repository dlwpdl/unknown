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
select * from finish();
rollback;
