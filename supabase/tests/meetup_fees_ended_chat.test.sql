begin;
set local search_path=public,extensions;
select no_plan();

insert into public.cities(id,name,province,timezone) values('fees-test','Fees test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'fees-test','Fees test','meetup') on conflict do nothing;
insert into auth.users(id,email) select ('d0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fees-'||n||'@example.invalid' from generate_series(1,5)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Fee'||right(id::text,4),'fees-test',now(),now(),now(),'test' from auth.users where id::text like 'd0000000-%';
insert into private.chilling_profiles(id,profile) values('d0000000-0000-4000-8000-000000000001','{"intro":"Host fixture","interests":[],"promptOne":"","promptTwo":""}');
-- 1 host, 2 approved member, 3 pending, 4 outsider, 5 approved member who leaves before the end.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','fees-test',31997,'Fees fixture','Synthetic local test',current_date,
  '{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}');
insert into public.messages(id,conversation_id,sender_id,body,created_at)
select 'd0200000-0000-4000-8000-000000000001',id,'d0000000-0000-4000-8000-000000000001','Before approval',now()-interval '1 hour'
from public.conversations where group_post_id='d0100000-0000-4000-8000-000000000001';
insert into public.meetup_requests(id,post_id,host_id,requester_id,status) values
 ('d0300000-0000-4000-8000-000000000002','d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','pending'),
 ('d0300000-0000-4000-8000-000000000003','d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003','pending'),
 ('d0300000-0000-4000-8000-000000000005','d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000005','pending');
create temp table room as select id from public.conversations where group_post_id='d0100000-0000-4000-8000-000000000001';
grant select on room to authenticated;

select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.respond_meetup_request('d0300000-0000-4000-8000-000000000002','approved');
select public.respond_meetup_request('d0300000-0000-4000-8000-000000000005','approved');
reset role;

-- Fee.
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_fee('d0100000-0000-4000-8000-000000000001',10)$$,'P0001','MEETUP_NOT_FOUND','Members cannot set a fee');
reset role;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_fee('d0100000-0000-4000-8000-000000000001',0)$$,'P0001','INVALID_MEETUP_FEE','Zero is not a fee');
select throws_ok($$select public.set_meetup_fee('d0100000-0000-4000-8000-000000000001',10.555)$$,'P0001','INVALID_MEETUP_FEE','Fees use cents');
select lives_ok($$select public.set_meetup_fee('d0100000-0000-4000-8000-000000000001',15.5,' Venue rental ','2026-11-01')$$,'Host sets a fee');
reset role;
select is((select room_preview->'fee' from public.posts where id='d0100000-0000-4000-8000-000000000001'),
  '{"amount":15.5,"note":"Venue rental","dueOn":"2026-11-01"}'::jsonb,'Fee is public on the meetup');
select is((select count(*)::integer from public.notifications where kind='meetup_changed' and user_id='d0000000-0000-4000-8000-000000000002'),0,'Setting a fee sends no schedule-change notice');
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_fee_paid('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003',true)$$,'P0001','REQUEST_NOT_FOUND','Pending applicants cannot be marked paid');
select lives_ok($$select public.set_meetup_fee_paid('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',true)$$,'Host marks a member paid');
select lives_ok($$select public.set_meetup_fee_paid('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',true)$$,'Marking twice is harmless');
select is((select count(*)::integer from public.get_meetup_fee_payments('d0100000-0000-4000-8000-000000000001')),1,'Host sees the mark');
reset role;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select user_id from public.get_meetup_fee_payments('d0100000-0000-4000-8000-000000000001')),'d0000000-0000-4000-8000-000000000002'::uuid,'Member sees their own mark');
select throws_ok($$select public.set_meetup_fee_paid('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',false)$$,'P0001','MEETUP_NOT_FOUND','Members cannot mark themselves');
reset role;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.get_meetup_fee_payments('d0100000-0000-4000-8000-000000000001')),0,'Outsiders see no marks');
reset role;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_meetup_fee_paid('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',false)$$,'Host can undo a mark');
select is((select count(*)::integer from public.get_meetup_fee_payments('d0100000-0000-4000-8000-000000000001')),0,'Undo removes the mark');
select lives_ok($$select public.set_meetup_fee('d0100000-0000-4000-8000-000000000001',null)$$,'Host removes the fee');
reset role;
select ok(not ((select room_preview from public.posts where id='d0100000-0000-4000-8000-000000000001') ? 'fee'),'Removing clears the fee');
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_fee_paid('d0100000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',true)$$,'P0001','MEETUP_NOT_FOUND','No marks without a fee');
select public.send_message_v2((select id from room),'After approval');
reset role;

-- Ended meetup: approved members keep a read-only chat.
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select public.leave_meetup('d0100000-0000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('d0100000-0000-4000-8000-000000000001')$$,'Host ends the meetup');
select throws_ok($$select public.set_meetup_fee('d0100000-0000-4000-8000-000000000001',5)$$,'P0001','MEETUP_CLOSED','Ended meetups take no fee');
reset role;
select is((select status||':'||ended_with_meetup from public.meetup_requests where id='d0300000-0000-4000-8000-000000000002'),'cancelled:true','Approved member is marked as ended with the meetup');
select is((select ended_with_meetup from public.meetup_requests where id='d0300000-0000-4000-8000-000000000003'),false,'Pending applicant is not');
select is((select ended_with_meetup from public.meetup_requests where id='d0300000-0000-4000-8000-000000000005'),false,'Member who left earlier is not');
select ok(private.can_read_conversation((select id from room),'d0000000-0000-4000-8000-000000000002'),'Ended member still opens the chat');
select ok(private.can_read_message((select id from room),'d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001',now()),'Ended member reads messages from their membership');
select ok(not private.can_read_message((select id from room),'d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001',now()-interval '1 hour'),'Their history window is unchanged');
select ok(not private.can_read_conversation((select id from room),'d0000000-0000-4000-8000-000000000003'),'Pending applicant has no chat');
select ok(not private.can_read_conversation((select id from room),'d0000000-0000-4000-8000-000000000005'),'Member who left earlier has no chat');
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.send_message_v2((select id from room),'After the end')$$,'P0001',null,'Ended chat is read-only');
reset role;

select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select i->>'status' from jsonb_array_elements(public.get_conversation_inbox('all',20,null,null,null,null)->'items') i where (i->>'id')::uuid=(select id from room)),'ended','Ended room stays in the member inbox as ended');
reset role;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from jsonb_array_elements(public.get_conversation_inbox('all',20,null,null,null,null)->'items') i where (i->>'id')::uuid=(select id from room)),0,'Member who left earlier does not see it');
reset role;

select ok(not has_function_privilege('anon','public.set_meetup_fee(uuid,numeric,text,date)','execute'),'Anonymous cannot set fees');
select ok(not has_function_privilege('anon','public.get_meetup_fee_payments(uuid)','execute'),'Anonymous cannot read marks');
select * from finish();
rollback;
