begin;
select no_plan();
insert into public.cities values ('behavior-test','행동검사','BC','UTC',true);
insert into auth.users(id,email,raw_app_meta_data) values
('73737373-1111-1111-1111-111111111111','behavior@example.com','{}'),
('73737373-2222-2222-2222-222222222222','behavior-admin@example.com','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id) values
('73737373-1111-1111-1111-111111111111','행동검사회원','behavior-test'),
('73737373-2222-2222-2222-222222222222','행동검사관리자','behavior-test');
set local role anon;
select throws_ok($$select * from private.behavior_events$$,'42501',null,'anonymous cannot read events');
select throws_ok($$select public.get_admin_behavior()$$,'42501',null,'anonymous cannot read reports');
select lives_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1}]')$$,'anonymous telemetry is accepted');
select lives_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1}]')$$,'retry is idempotent');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"feed","kind":"press","target":"secret-user-text","value":1}]')$$,'P0001','INVALID_BEHAVIOR','arbitrary text rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"feed","kind":"view","target":"screen","value":1,"email":"secret@example.com"}]')$$,'P0001','INVALID_BEHAVIOR','unexpected properties rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"/chat/private-id","kind":"view","target":"screen","value":1}]')$$,'P0001','INVALID_BEHAVIOR','raw routes rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"feed","kind":"scroll","target":"web_page","value":101}]')$$,'P0001','INVALID_BEHAVIOR','invalid depth rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[]')$$,'P0001','INVALID_BEHAVIOR','empty batches rejected');
reset role;
select is((select count(*) from private.behavior_events where session_id='qa-anonymous-session-12345'),1::bigint,'retry stores one event');
select set_config('request.jwt.claims','{"sub":"73737373-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_behavior()$$,'P0001','ADMIN_REQUIRED','members cannot read reports');
select lives_ok($$select public.record_behavior_events('qa-member-session-12345','ios','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1},{"seq":2,"screen":"feed","kind":"dwell","target":"screen","value":30000},{"seq":3,"screen":"meetup-join","kind":"success","target":"meetup_request_complete","value":1}]')$$,'member batch accepted');
reset role;
select is((select count(*) from private.behavior_events where user_id='73737373-1111-1111-1111-111111111111'),3::bigint,'member identity assigned by server');
select set_config('request.jwt.claims','{"sub":"73737373-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((public.get_admin_behavior(7,'behavior-test')->'screens'->0->>'views')::integer,1,'city report excludes anonymous views');
select is((public.get_admin_behavior(7,'behavior-test')->'screens'->0->>'dwellMs')::integer,30000,'foreground milliseconds aggregated');
select is((public.get_admin_behavior(7,'behavior-test')->'actions'->0->>'target'),'meetup_request_complete','success separate from click');
select is(jsonb_array_length(public.get_admin_behavior(7,'behavior-test')->'recent'),3,'ordered details retained');
select throws_ok($$select public.get_admin_behavior(999)$$,'P0001','INVALID_ANALYTICS_FILTER','bounded report period');
select ok(exists(select 1 from public.admin_access_logs where actor_id=auth.uid() and scope='analytics'),'reads audited');
reset role;
-- Foreign key ensures physical account deletion cannot leave identified telemetry.
select ok(exists(select 1 from pg_constraint where conrelid='private.behavior_events'::regclass and confrelid='public.profiles'::regclass and confdeltype='c'),'account erasure cascades');
update public.profiles set account_status='deleted' where id='73737373-1111-1111-1111-111111111111';
select is((select count(*) from private.behavior_events where user_id='73737373-1111-1111-1111-111111111111'),0::bigint,'soft account deletion erases events');
select * from finish();
rollback;
