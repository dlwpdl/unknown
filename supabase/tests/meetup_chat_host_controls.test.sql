begin;
set local search_path=public,extensions;
select no_plan();

insert into public.cities(id,name,province,timezone) values('controls-test','Controls test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31996,'controls-test','Controls test','meetup') on conflict do nothing;
insert into auth.users(id,email) select ('c0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'controls-'||n||'@example.invalid' from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Ctl'||right(id::text,4),'controls-test',now(),now(),now(),'test' from auth.users where id::text like 'c0000000-%';
insert into private.chilling_profiles(id,profile) values('c0000000-0000-4000-8000-000000000001','{"intro":"Host fixture","interests":[],"promptOne":"","promptTwo":""}');
-- 1 host, 2 member without history, 3 member with history, 4 later applicant.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','controls-test',31996,'Controls fixture','Synthetic local test',current_date,
  '{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}');
insert into public.messages(id,conversation_id,sender_id,body,created_at)
select 'c0200000-0000-4000-8000-000000000001',id,'c0000000-0000-4000-8000-000000000001','Before anyone joined',now()-interval '1 hour'
from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001';
insert into public.meetup_requests(id,post_id,host_id,requester_id,status) values
 ('c0300000-0000-4000-8000-000000000002','c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','pending'),
 ('c0300000-0000-4000-8000-000000000003','c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003','pending');

select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_request_v2('c0300000-0000-4000-8000-000000000003','approved',true)$$,'P0001','REQUEST_NOT_FOUND','Only the host can approve with history');
reset role;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request('c0300000-0000-4000-8000-000000000002','approved')$$,'Released clients still approve without history');
select lives_ok($$select public.respond_meetup_request_v2('c0300000-0000-4000-8000-000000000003','approved',true)$$,'Host approves and shares earlier messages in one call');
reset role;

select ok(not private.can_read_message((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),
  'c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001',now()-interval '1 hour'),'Default member starts from approval');
select ok(private.can_read_message((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),
  'c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001',now()-interval '1 hour'),'History member reads earlier messages');
select is((select message_id from private.chat_read_positions where user_id='c0000000-0000-4000-8000-000000000003'),
  'c0200000-0000-4000-8000-000000000001'::uuid,'Shared history arrives already read');

select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_meetup_history_access('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',true)$$,'Host can share history later');
reset role;
select ok(private.can_read_message((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),
  'c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001',now()-interval '1 hour'),'Later share takes effect');

-- Unread: reading the chat clears that chat's message notifications only.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.send_message_v2((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),'After approval');
reset role;
select is((select count(*)::integer from public.notifications where user_id='c0000000-0000-4000-8000-000000000002' and kind='message' and read_at is null),1,'Member has one unread message notification');
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.mark_chat_read((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),
  (select id from public.messages where body='After approval'))$$,'Member reads the chat');
reset role;
select is((select count(*)::integer from public.notifications where user_id='c0000000-0000-4000-8000-000000000002' and kind='message' and read_at is null),0,'Reading clears the chat badge');
select is((select count(*)::integer from public.notifications where user_id='c0000000-0000-4000-8000-000000000003' and kind='message' and read_at is null),1,'Another member keeps their own unread state');

-- Idempotent send.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.send_message_v3((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),'c0400000-0000-4000-8000-000000000001','Retry me'),
  public.send_message_v3((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),'c0400000-0000-4000-8000-000000000001','Retry me'),'A retry returns the first message');
select throws_ok($$select public.send_message_v3('c0100000-0000-4000-8000-000000000001','c0400000-0000-4000-8000-000000000002','')$$,'P0001',null,'Invalid sends still fail');
reset role;
select is((select count(*)::integer from public.messages where body='Retry me'),1,'Only one message was stored');

-- Recruiting pause.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_recruiting('c0100000-0000-4000-8000-000000000001',false)$$,'P0001','MEETUP_NOT_FOUND','Members cannot pause recruiting');
reset role;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_meetup_recruiting('c0100000-0000-4000-8000-000000000001',false)$$,'Host pauses recruiting');
reset role;
select ok(private.meetup_is_open('published',(select room_preview from public.posts where id='c0100000-0000-4000-8000-000000000001')),'Paused meetup stays open for members');
select is((select count(*)::integer from public.notifications where kind in ('meetup_changed','meetup_cancelled') and target_type='meetup_notice'
  and user_id in ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003')),0,'Pausing sends no schedule-change notice');
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004','pending')$$,'P0001','MEETUP_RECRUITING_CLOSED','New requests are refused while paused, whatever path writes them');
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_meetup_recruiting('c0100000-0000-4000-8000-000000000001',true)$$,'Host reopens recruiting');
reset role;
select ok(not ((select room_preview from public.posts where id='c0100000-0000-4000-8000-000000000001') ? 'recruitingClosed'),'Reopen removes the flag');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004','pending')$$,'Requests work again after reopening');

-- Member removal.
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.remove_meetup_member('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003')$$,'P0001','MEETUP_NOT_FOUND','Members cannot remove each other');
reset role;
select set_config('request.jwt.claims','{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.remove_meetup_member('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003')$$,'Host removes a member');
select throws_ok($$select public.remove_meetup_member('c0100000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000004')$$,'P0001','REQUEST_NOT_FOUND','Pending applicants are rejected, not removed');
reset role;
select is((select status from public.meetup_requests where id='c0300000-0000-4000-8000-000000000003'),'rejected','Removed member is no longer approved');
select ok(not private.can_read_conversation((select id from public.conversations where group_post_id='c0100000-0000-4000-8000-000000000001'),'c0000000-0000-4000-8000-000000000003'),'Removed member loses the chat');
select is((select (room_preview->>'memberCount')::integer from public.posts where id='c0100000-0000-4000-8000-000000000001'),2,'Member count follows removal');
select is((select count(*)::integer from public.notifications where user_id='c0000000-0000-4000-8000-000000000003' and kind='meetup_rejected'),1,'Removed member is told');

select ok(not has_function_privilege('anon','public.remove_meetup_member(uuid,uuid)','execute'),'Anonymous cannot remove members');
select ok(not has_function_privilege('anon','public.send_message_v3(uuid,uuid,text,text,text,numeric,numeric,uuid,text)','execute'),'Anonymous cannot send');
select ok(has_function_privilege('authenticated','public.set_meetup_recruiting(uuid,boolean)','execute'),'Signed-in hosts can call recruiting');
select * from finish();
rollback;
