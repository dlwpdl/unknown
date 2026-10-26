begin;
set local search_path=public,extensions;
select no_plan();

-- End-to-end as two signed-in accounts, using the app's RPCs and RLS table reads (what PostgREST does).
insert into public.cities(id,name,province,timezone) values('flow-test','Flow test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31998,'flow-test','Flow test','meetup') on conflict do nothing;
insert into auth.users(id,email) select ('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'flow-'||n||'@example.invalid' from generate_series(1,3)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Flow'||right(id::text,4),'flow-test',now(),now(),now(),'test' from auth.users where id::text like 'e0000000-%';
insert into private.chilling_profiles(id,profile) select id,'{"intro":"Flow fixture","interests":[],"promptOne":"","promptTwo":""}' from auth.users where id::text like 'e0000000-%';
-- 1 host, 2 member who joins without history, 3 member with history who leaves before the end.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('e0100000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','flow-test',31998,'Flow fixture','Synthetic local test',current_date,
  '{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}');
create temp table room as select id from public.conversations where group_post_id='e0100000-0000-4000-8000-000000000001';
grant select on room to authenticated;
-- The app reads its own profile revision; the private table is not readable directly.
create temp table rev as select id,updated_at::text r from private.chilling_profiles where id::text like 'e0000000-%';
grant select on rev to authenticated;

-- Host speaks first.
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.send_message_v3((select id from room),'e0400000-0000-4000-8000-000000000001','Welcome, before anyone joined')$$,'Host posts in the empty room');
reset role;
-- Same transaction means the same now(); back-date so the history window is observable.
update public.messages set created_at=now()-interval '1 hour' where body='Welcome, before anyone joined';

-- Both accounts apply the way the app does.
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.request_chilling_join_v2('e0100000-0000-4000-8000-000000000001','I walk every weekend','chilling-v2',
  (select r from rev where id='e0000000-0000-4000-8000-000000000002'))$$,'Member applies through the app path');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.request_chilling_join_v2('e0100000-0000-4000-8000-000000000001','Count me in','chilling-v2',
  (select r from rev where id='e0000000-0000-4000-8000-000000000003'))$$,'Second member applies');
reset role;

select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),0,'Applicant reads no chat before approval');
select is((select status from public.meetup_requests where post_id='e0100000-0000-4000-8000-000000000001'),'pending','Applicant sees only their own pending request');
reset role;

-- Host approves one without and one with earlier messages.
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.meetup_requests where post_id='e0100000-0000-4000-8000-000000000001' and status='pending'),2,'Host sees both requests');
select lives_ok($$select public.respond_meetup_request_v2((select id from public.meetup_requests where requester_id='e0000000-0000-4000-8000-000000000002'),'approved',false)$$,'Host approves from now on');
select lives_ok($$select public.respond_meetup_request_v2((select id from public.meetup_requests where requester_id='e0000000-0000-4000-8000-000000000003'),'approved',true)$$,'Host approves with history');
reset role;
select is((select (room_preview->>'memberCount')::integer from public.posts where id='e0100000-0000-4000-8000-000000000001'),3,'Member count includes both');

select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),0,'New member does not see the earlier message');
select lives_ok($$select public.send_message_v3((select id from room),'e0400000-0000-4000-8000-000000000002','Hi all')$$,'New member sends');
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),1,'New member sees their own message');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),2,'History member sees the earlier message too');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),2,'Host sees everything');

-- Fee, seen from both sides.
select lives_ok($$select public.set_meetup_fee('e0100000-0000-4000-8000-000000000001',20,'Court rental','2026-11-15')$$,'Host sets a fee');
select lives_ok($$select public.set_meetup_fee_paid('e0100000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002',true)$$,'Host marks the first member paid');
select is((select count(*)::integer from public.get_meetup_fee_payments('e0100000-0000-4000-8000-000000000001')),1,'Host sees one mark');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select room_preview->'fee'->>'amount' from public.posts where id='e0100000-0000-4000-8000-000000000001'),'20','Member reads the fee on the meetup');
select is((select count(*)::integer from public.get_meetup_fee_payments('e0100000-0000-4000-8000-000000000001')),1,'Member sees they are marked paid');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.get_meetup_fee_payments('e0100000-0000-4000-8000-000000000001')),0,'Unpaid member sees no one else''s mark');
-- Second member leaves before the end.
select lives_ok($$select public.leave_meetup('e0100000-0000-4000-8000-000000000001')$$,'Second member leaves');
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),0,'Leaving takes the chat away');
reset role;

-- Host ends the meetup.
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('e0100000-0000-4000-8000-000000000001')$$,'Host ends the meetup');
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),2,'Host keeps the chat');
reset role;

select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.messages where conversation_id=(select id from room)),1,'Remaining member still reads their part of the chat');
select is((select ended_with_meetup from public.meetup_requests where post_id='e0100000-0000-4000-8000-000000000001'),true,'Member''s own request says it ended with the meetup');
select throws_ok($$select public.send_message_v3((select id from room),'e0400000-0000-4000-8000-000000000003','Still here?')$$,'P0001',null,'Ended chat refuses new messages');
select is((select i->>'status' from jsonb_array_elements(public.get_conversation_inbox('all',20,null,null,null,null)->'items') i where (i->>'id')::uuid=(select id from room)),'ended','Inbox shows the room as ended');
reset role;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from jsonb_array_elements(public.get_conversation_inbox('all',20,null,null,null,null)->'items') i where (i->>'id')::uuid=(select id from room)),0,'Member who left earlier has no room in the inbox');
reset role;

select * from finish();
rollback;
