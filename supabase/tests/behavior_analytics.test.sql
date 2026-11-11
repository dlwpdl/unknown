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
select lives_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"feed","kind":"press","target":"web_page","value":1},{"seq":3,"screen":"feed","kind":"press","target":"secret-user-text","value":1}]')$$,'an unregistered target no longer rejects the rest of its batch');
select lives_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":5,"screen":"feed","kind":"scroll","target":"secret-user-text","value":50}]','direct')$$,'the app''s four-argument call keeps unregistered targets too');
-- 1.5.1 retries a refused batch forever from the front of its queue, so one template id (poll option, app language,
-- membership family, business channel switch) used to stop every later event of that session.
select lives_ok($$select public.record_behavior_events('qa-151-template-session-0001','ios',(select jsonb_agg(jsonb_build_object('seq',n,'screen','post','kind','press','value',1,
  'target',(array['post.poll.option.0','app_language.ko','membership.family.business','merchant.channel.gling.on','web_page'])[1+n%5])) from generate_series(1,25) n),'direct')$$,'a 1.5.1 batch with template ids is accepted');
select lives_ok($$select public.record_behavior_events('qa-151-template-session-0001','ios',(select jsonb_agg(jsonb_build_object('seq',n,'screen','post','kind','press','value',1,
  'target',(array['post.poll.option.0','app_language.ko','membership.family.business','merchant.channel.gling.on','web_page'])[1+n%5])) from generate_series(1,25) n),'direct')$$,'its retry is accepted without duplicates');
select lives_ok($$select public.record_behavior_events('qa-151-template-session-0001','ios','[{"seq":26,"screen":"post","kind":"press","target":"web_page","value":1}]','direct')$$,'later events of that session are recorded');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":4,"screen":"feed","kind":"view","target":"secret-user-text","value":1}]')$$,'P0001','INVALID_BEHAVIOR','views still need the screen target');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":4,"screen":"feed","kind":"success","target":"secret-user-text","value":1}]')$$,'P0001','INVALID_BEHAVIOR','success still needs a listed target');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"feed","kind":"view","target":"screen","value":1,"email":"secret@example.com"}]')$$,'P0001','INVALID_BEHAVIOR','unexpected properties rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"/chat/private-id","kind":"view","target":"screen","value":1}]')$$,'P0001','INVALID_BEHAVIOR','raw routes rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[{"seq":2,"screen":"feed","kind":"scroll","target":"web_page","value":101}]')$$,'P0001','INVALID_BEHAVIOR','invalid depth rejected');
select throws_ok($$select public.record_behavior_events('qa-anonymous-session-12345','web','[]')$$,'P0001','INVALID_BEHAVIOR','empty batches rejected');
reset role;
select is((select count(*) from private.behavior_events where session_id='qa-anonymous-session-12345'),4::bigint,'retry stores one event and rejected batches store none');
select is((select array_agg(target order by seq) from private.behavior_events where session_id='qa-anonymous-session-12345'),array['screen','web_page','unregistered','unregistered'],'the sent text is stored only as the fixed unregistered target');
select ok(not exists(select 1 from private.behavior_events where target like '%secret%'),'unregistered text is never stored');
select is((select count(*) filter(where target='unregistered')||'/'||count(*) from private.behavior_events where session_id='qa-151-template-session-0001'),'20/26','the 1.5.1 session keeps all 26 events, template ids as unregistered');
select set_config('request.jwt.claims','{"sub":"73737373-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_behavior()$$,'P0001','ADMIN_REQUIRED','members cannot read reports');
select lives_ok($$select public.record_behavior_events('qa-member-session-12345','ios','[{"seq":1,"screen":"feed","kind":"view","target":"screen","value":1},{"seq":2,"screen":"feed","kind":"dwell","target":"screen","value":30000},{"seq":3,"screen":"meetup-join","kind":"success","target":"meetup_request_complete","value":1}]')$$,'member batch accepted');
select lives_ok($$select public.record_behavior_events('qa-member-event-session-12345','ios','[{"seq":1,"screen":"events","kind":"view","target":"screen","value":1},{"seq":2,"screen":"events","kind":"press","target":"ticketmaster.event.open","value":1},{"seq":3,"screen":"event-detail","kind":"dwell","target":"screen","value":12000},{"seq":4,"screen":"meetup-create","kind":"success","target":"ticketmaster.meetup.created","value":1}]')$$,'event journey and actual meetup creation accepted');
select throws_ok($$select public.record_behavior_events('qa-member-event-session-12345','ios','[{"seq":5,"screen":"events/G5vYZabc","kind":"view","target":"screen","value":1}]')$$,'P0001','INVALID_BEHAVIOR','event IDs cannot enter analytics screen names');
reset role;
select is((select count(*) from private.behavior_events where user_id='73737373-1111-1111-1111-111111111111'),7::bigint,'member identity assigned by server');
-- Admin reads need an MFA (aal2) session since 20261030140000_admin_direct_db.
insert into auth.sessions(id,user_id,aal) values('73737373-2222-2222-2222-aaaaaaaaaaaa','73737373-2222-2222-2222-222222222222','aal2');
select set_config('request.jwt.claims','{"sub":"73737373-2222-2222-2222-222222222222","role":"authenticated","aal":"aal2","session_id":"73737373-2222-2222-2222-aaaaaaaaaaaa","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select (s->>'views')::integer from jsonb_array_elements(public.get_admin_behavior(7,'behavior-test')->'screens') s where s->>'screen'='feed'),1,'city report excludes anonymous views');
select is((select (s->>'dwellMs')::integer from jsonb_array_elements(public.get_admin_behavior(7,'behavior-test')->'screens') s where s->>'screen'='feed'),30000,'foreground milliseconds aggregated');
select ok(exists(select 1 from jsonb_array_elements(public.get_admin_behavior(7,'behavior-test')->'actions') a where a->>'target'='meetup_request_complete'),'success separate from click');
select is((select (s->>'dwellMs')::integer from jsonb_array_elements(public.get_admin_behavior(7,'behavior-test')->'screens') s where s->>'screen'='event-detail'),12000,'event detail dwell is reportable');
select is(jsonb_array_length(public.get_admin_behavior(7,'behavior-test')->'recent'),7,'ordered details retained');
select throws_ok($$select public.get_admin_behavior(999)$$,'P0001','INVALID_ANALYTICS_FILTER','bounded report period');
select ok(exists(select 1 from public.admin_access_logs where actor_id=auth.uid() and scope='analytics'),'reads audited');
reset role;
-- Foreign key ensures physical account deletion cannot leave identified telemetry.
select ok(exists(select 1 from pg_constraint where conrelid='private.behavior_events'::regclass and confrelid='public.profiles'::regclass and confdeltype='c'),'account erasure cascades');
update public.profiles set account_status='deleted' where id='73737373-1111-1111-1111-111111111111';
select is((select count(*) from private.behavior_events where user_id='73737373-1111-1111-1111-111111111111'),0::bigint,'soft account deletion erases events');
select * from finish();
rollback;
