begin;
select plan(23);
select has_function('public','get_location_preference',array[]::text[],'location preferences exist');
insert into auth.users(id,email,raw_app_meta_data) values
('88880000-1111-1111-1111-111111111111','location@example.test','{}'),
('88880000-2222-2222-2222-222222222222','location-admin@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id) values
('88880000-1111-1111-1111-111111111111','위치검사회원','vancouver'),
('88880000-2222-2222-2222-222222222222','위치검사관리자','vancouver');
insert into auth.sessions(id,user_id,created_at) values
('88880000-3333-3333-3333-333333333333','88880000-1111-1111-1111-111111111111',now());
select set_config('request.jwt.claims','{"sub":"88880000-1111-1111-1111-111111111111","session_id":"88880000-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_location_preference()->>'enabled','false','location defaults off');
select throws_ok($$select public.record_location_event(49.28,-123.12,100,now(),p_user_id=>auth.uid())$$,'P0001','LOCATION_CONSENT_REQUIRED','no silent collection');
select public.set_location_preference(true,'2026-09-11',auth.uid());
select throws_ok($$select public.record_location_event(49.28,-123.12,100,now(),p_user_id=>'88880000-2222-2222-2222-222222222222')$$,'P0001','AUTH_CONTEXT_CHANGED','account switching cannot misattribute a fix');
select lives_ok($$select public.record_location_event(49.28,-123.12,100,now(),p_user_id=>auth.uid())$$,'opted-in login is recorded');
select lives_ok($$select public.record_location_event(49.28,-123.12,100,now(),p_user_id=>auth.uid())$$,'login retries are idempotent');
select throws_ok($$select public.record_location_event(91,-123,100,now(),p_user_id=>auth.uid())$$,'P0001','INVALID_LOCATION','reject out-of-range coordinates');
select throws_ok($$select public.record_location_event(49,-123,100,now()-interval '6 minutes',p_user_id=>auth.uid())$$,'P0001','INVALID_LOCATION','reject stale fixes');
select throws_ok($$select public.record_location_event(49,-123,100,now(),'88880000-4444-4444-4444-444444444444',p_user_id=>auth.uid())$$,'P0001','INVALID_LOCATION_CONTEXT','cannot link an unrelated post');
select throws_ok($$select * from private.location_events$$,'42501',null,'private coordinates cannot be selected by members');
reset role;
select is((select count(*)::int from private.location_events),1,'duplicate login does not grow history');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on) values
('88880000-5555-5555-5555-555555555555','88880000-1111-1111-1111-111111111111','vancouver',5,'위치검사 모임','검사',current_date);
set local role authenticated;
select lives_ok($$select public.record_location_event(49.28,-123.12,100,now(),p_post_id=>'88880000-5555-5555-5555-555555555555',p_user_id=>auth.uid())$$,'published meetup accepts a fresh location');
reset role;
select is((select kind from private.location_events where post_id is not null),'meetup','meetup context comes from the actual post');
set local role authenticated;
update public.profiles set city_id='toronto',neighborhood=null where id=auth.uid();
reset role;

select set_config('request.jwt.claims','{"sub":"88880000-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_user_overview('88880000-1111-1111-1111-111111111111')#>>'{location_snapshot,latitude}','49.28','admin overview shows device snapshot');
select is(public.get_admin_user_overview('88880000-1111-1111-1111-111111111111')#>>'{profile,city_id}','toronto','admin shows updated preference separately from Vancouver GPS snapshot');
select is(public.get_admin_user_overview('88880000-2222-2222-2222-222222222222')->'location_snapshot','null'::jsonb,'a saved city does not fabricate a GPS snapshot');
select is((public.get_admin_user_activity('88880000-1111-1111-1111-111111111111','account',p_query=>'위치 기록')->>'total')::int,1,'existing audited timeline includes location');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='88880000-2222-2222-2222-222222222222' and subject_user_id='88880000-1111-1111-1111-111111111111' and scope='user_detail'),'coordinate reads are audited');
update private.location_events set received_at=now()-interval '31 days';
set local role authenticated;
select is(public.get_admin_user_overview('88880000-1111-1111-1111-111111111111')->'location_snapshot','null'::jsonb,'expired coordinates are excluded even before the purge runs');
select is((public.get_admin_user_activity('88880000-1111-1111-1111-111111111111',p_query=>'위치 기록')->>'total')::int,0,'expired timeline locations are excluded');
reset role;
select set_config('request.jwt.claims','{"sub":"88880000-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select public.set_location_preference(false,'2026-09-11',auth.uid());
reset role;
select is((select count(*)::int from private.location_events),0,'withdrawal deletes coordinates');
set local role anon;
select throws_ok($$select public.get_location_preference()$$,'42501',null,'anonymous preference reads are denied');
reset role;
delete from public.posts where id='88880000-5555-5555-5555-555555555555';
delete from auth.users where id='88880000-1111-1111-1111-111111111111';
select is((select count(*)::int from private.location_preferences),0,'account deletion removes location consent');
select * from finish();
rollback;
