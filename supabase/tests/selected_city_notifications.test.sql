begin;
select no_plan();
-- This suite checks city boundaries; cadence and DST are exercised separately.
create or replace function private.recommendation_time(p_at timestamptz,p_timezone text)
returns boolean language sql stable set search_path='' as $$ select p_timezone is not null $$;

update private.trending_config set enabled=true,quiet_start_hour=0,quiet_end_hour=0 where id;
insert into auth.users(id,email,raw_app_meta_data)
select ('d7130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'selected-city-'||n||'@example.test','{}'
from generate_series(1,9) n;
insert into public.profiles(id,nickname,city_id)
select id,'selected-city-'||right(id::text,2),'vancouver' from auth.users where id::text like 'd7130000-%';
insert into auth.sessions(id,user_id) select id,id from public.profiles where id::text like 'd7130000-%';
insert into public.notification_preferences(user_id,push_enabled,trending,weekly_ranking,interests,nearby,city_food,city_places)
select id,true,true,true,true,true,true,true from public.profiles where id::text like 'd7130000-%'
on conflict(user_id) do update set push_enabled=true,trending=true,weekly_ranking=true,interests=true,nearby=true,city_food=true,city_places=true;
insert into private.push_devices(user_id,session_id,token)
select id,id,'ExpoPushToken[selected_city_fixture_'||right(id::text,2)||']' from public.profiles where id::text like 'd7130000-%';
update private.push_devices set timezone='UTC',timezone_updated_at=now()
where user_id::text like 'd7130000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body)
select 'd7131000-0000-4000-8000-000000000001','d7130000-0000-4000-8000-000000000001','vancouver',id,'Selected city festival','Public fixture'
from public.tags where slug='festival';
insert into public.posts(id,author_id,city_id,tag_id,title,body)
select 'd7131000-0000-4000-8000-000000000002','d7130000-0000-4000-8000-000000000001','vancouver',id,'Selected city food','Public food fixture'
from public.tags where slug='food';
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
values('tm-festival:vancouver',jsonb_build_object('events',jsonb_build_array(
 jsonb_build_object('id','selected-city-event','name','City Festival','country','CA','city','Vancouver','status','onsale','startsAt',(now()+interval '30 days')::text,'timeUnconfirmed',false),
 jsonb_build_object('id','wrong-city-event','name','Another City Festival','country','CA','city','Toronto','status','onsale','startsAt',(now()+interval '30 days')::text,'timeUnconfirmed',false)
)),now()+interval '15 minutes')
on conflict(cache_key) do update set payload=excluded.payload,updated_at=now(),expires_at=excluded.expires_at;

select is((select count(*)::int from private.ticketmaster_notification_events where event_id='wrong-city-event'),0,
 'a cache key cannot make an event in another city eligible');
select is((select count(*)::int from private.ticketmaster_notification_events where event_id='selected-city-event'),1,
 'an actual event in the selected city remains eligible');
create temporary table city_notices as
select ('d7130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid user_id,kind,
 case when n=9 then 'ticketmaster_event' else 'post' end target_type,
 case when n=9 then md5('ticketmaster:vancouver:selected-city-event')::uuid
  when n=6 then 'd7131000-0000-4000-8000-000000000002'::uuid else 'd7131000-0000-4000-8000-000000000001'::uuid end target_id
from (values (2,'weekly_ranking'),(3,'interest_post'),(4,'nearby_meetup'),(5,'trending_meetup'),
 (6,'city_food'),(7,'city_places'),(8,'trending_post'),(9,'city_places')) v(n,kind);
select private.create_notification(user_id,kind,null,target_type,target_id,'City fixture','/notifications') from city_notices;
select is((select count(*)::int from public.notifications where user_id::text like 'd7130000-%' and kind in
 ('weekly_ranking','interest_post','nearby_meetup','trending_meetup','city_food','city_places','trending_post')),8,
 'all city discovery kinds can be created for the chosen city');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id::text like 'd7130000-%'),8,
 'matching-city discoveries enter the existing device queue');
select ok((select bool_and(city_id='vancouver') from public.notifications where user_id::text like 'd7130000-%'),
 'city discoveries retain their authoritative source city');

select set_config('request.jwt.claims','{"sub":"d7130000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='weekly_ranking'),1,'matching city appears in the personal inbox');
reset role;
update public.profiles set city_id='toronto' where id::text like 'd7130000-%' and id<>'d7130000-0000-4000-8000-000000000001';
select ok(not private.notification_city_matches(jsonb_populate_record(null::public.notifications,jsonb_build_object(
  'user_id','d7130000-0000-4000-8000-000000000002','kind','saved_merchant_post','city_id','vancouver',
  'target_type','post','target_id','d7131000-0000-4000-8000-000000000001'))),
  'saved business recommendations also stop when the selected city changes');
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='weekly_ranking'),0,'changing city removes former-city discovery from the inbox');
select is((select count(*)::int from public.notifications where kind='weekly_ranking'),0,'raw member reads enforce the same city boundary');
reset role;
select is((select count(*)::int from city_notices c join public.notifications n on n.user_id=c.user_id and n.kind=c.kind
 join private.push_devices d on d.user_id=c.user_id where private.push_notification_eligible(d.id,n.id)),0,
 'all already queued former-city discoveries become ineligible');
select is((select count(*)::int from city_notices where private.create_notification(user_id,kind,null,target_type,target_id,'Wrong city fixture','/notifications') is not null),0,
 'wrong-city alerts are rejected before inbox insertion and queueing');
update private.push_delivery_queue q set next_attempt_at=now() from public.notifications n
where n.id=q.notification_id and n.user_id::text like 'd7130000-%';
select is((select count(*)::int from public.claim_push_notifications('send',100) where user_id::text like 'd7130000-%'),0,
 'the protected send claim emits no old-city title, body or device token');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.user_id::text like 'd7130000-%' and q.status='cancelled'),8,'old pending discoveries are cancelled by the existing claim path');

select private.create_notification('d7130000-0000-4000-8000-000000000002','post_like','d7130000-0000-4000-8000-000000000001',
 'post','d7131000-0000-4000-8000-000000000001','Personal activity','/notifications');
select private.create_notification('d7130000-0000-4000-8000-000000000002','meetup_review_request',null,
 'post','d7131000-0000-4000-8000-000000000001','Joined meetup review','/profile/meetup-reviews');
select private.create_notification('d7130000-0000-4000-8000-000000000002','account_security',null,
 'user','d7130000-0000-4000-8000-000000000002','Account security','/profile/settings');
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind in ('post_like','meetup_review_request','account_security')),3,
 'personal activity, joined-meetup and security alerts survive a city change');
reset role;
select is((select count(*)::int from public.claim_push_notifications('send',100) where user_id='d7130000-0000-4000-8000-000000000002'),3,
 'personal activity and security still reach the protected sender');

update public.profiles set city_id='vancouver' where id='d7130000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='weekly_ranking'),1,
 'historical discoveries are retained and become readable when the member selects that city again');
reset role;
update public.posts set city_id='toronto' where id='d7131000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='weekly_ranking'),0,
 'moving the source post to another city also invalidates its old discovery');
reset role;

update public.posts set hashtags=array['#knowncitytopic'] where id='d7131000-0000-4000-8000-000000000002';
select is(private.create_notification('d7130000-0000-4000-8000-000000000002','trending_hashtag',null,'tag',
 md5('trending-hashtag:vancouver:'||private.canonicalize_hashtag('#knowncitytopic'))::uuid,'Unproven topic','/notifications'),null::uuid,
 'an unlinked topic without a producer city is not broadcast');
insert into public.notifications(user_id,kind,target_type,target_id,body,route,city_id)
values('d7130000-0000-4000-8000-000000000002','trending_hashtag','tag',md5('trending-hashtag:vancouver:'||private.canonicalize_hashtag('#knowncitytopic'))::uuid,'Wrong-city topic','/notifications','toronto');
select is((select count(*)::int from public.notifications where user_id='d7130000-0000-4000-8000-000000000002' and kind='trending_hashtag'),0,
 'a known but different topic city is rejected');
insert into public.notifications(user_id,kind,target_type,target_id,body,route,city_id)
values('d7130000-0000-4000-8000-000000000002','trending_hashtag','tag',md5('trending-hashtag:vancouver:'||private.canonicalize_hashtag('#knowncitytopic'))::uuid,'Selected-city topic','/notifications','vancouver');
alter table public.notifications disable trigger notifications_preferences;
insert into public.notifications(user_id,kind,target_type,target_id,body,route)
values('d7130000-0000-4000-8000-000000000002','trending_hashtag','tag',md5('trending-hashtag:vancouver:'||private.canonicalize_hashtag('#knowncitytopic'))::uuid,'Legacy topic with unknown city','/notifications');
alter table public.notifications enable trigger notifications_preferences;
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='trending_hashtag'),1,
 'only the topic with known matching origin is readable; unknown legacy history stays hidden');
select throws_ok($$select private.notification_city_matches(n) from public.notifications n limit 1$$,'42501',null,
 'members cannot invoke the privileged city helper directly');
reset role;
select ok(not has_function_privilege('anon','private.can_read_notification(public.notifications)','execute')
 and not has_function_privilege('service_role','private.can_read_notification(public.notifications)','execute'),
 'the new member wrapper grants neither guest nor worker access');
update public.profiles set city_id='toronto' where id='d7130000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='trending_hashtag'),0,
 'changing city also hides an unlinked topic with a known former-city origin');
reset role;
select is((select count(*)::int from public.claim_push_notifications('send',100) where category='trending'),0,
 'a queued topic from the previous city is never emitted');

update public.cities set is_open=true where id='montreal';
insert into public.ticketmaster_event_cache(cache_key,payload,expires_at)
values('tm-event:montreal:accent-city-event',jsonb_build_object('event',jsonb_build_object(
 'id','accent-city-event','name','Montreal Festival','country','CA','city','Montréal','status','onsale',
 'startsAt',(now()+interval '30 days')::text,'timeUnconfirmed',false)),now()+interval '15 minutes');
select is((select count(*)::int from private.ticketmaster_notification_events where event_id='accent-city-event'),1,
 'venue-city normalization retains Montreal with its normal French accent');

delete from public.notifications where user_id::text like 'd7130000-%';
update public.posts set status='removed' where id::text not like 'd7131000-%';
update public.profiles set city_id='vancouver' where id='d7130000-0000-4000-8000-000000000002';
update private.trending_config set quiet_start_hour=(extract(hour from now())::int+1)%24,
 quiet_end_hour=(extract(hour from now())::int+1)%24 where id;
insert into public.posts(id,author_id,city_id,tag_id,title,body,hashtags)
select ('d7131000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,
 ('d7130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'vancouver',id,'Local topic fixture','Public fixture',array['#selectedcitytopic']
from generate_series(1,3) n cross join public.tags where slug='festival';
select public.send_trending_topic_notifications();
select is((select count(*)::int from public.notifications where user_id='d7130000-0000-4000-8000-000000000002' and kind='trending_hashtag'),1,
 'the real topic producer creates a valid matching-city notification');
select is((select count(*)::int from public.notifications where user_id='d7130000-0000-4000-8000-000000000003' and kind='trending_hashtag'),0,
 'the real topic producer excludes another selected city');
select ok((select city_id='vancouver' and target_id is not null from public.notifications
 where user_id='d7130000-0000-4000-8000-000000000002' and kind='trending_hashtag'),
 'the real producer supplies city evidence and a stable non-null topic identity');
select * from finish();
rollback;
