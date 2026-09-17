begin;
select no_plan();
select has_function('public','get_conversation_members',array['uuid'],'member list RPC exists');
insert into auth.users(id,email)
select ('69000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'members69-'||n||'@example.test' from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id)
select id,'대화멤버'||right(id::text,2),'vancouver' from auth.users where id::text like '69000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('69000000-0000-0000-0001-000000000001','69000000-0000-0000-0000-000000000001','vancouver',1,'멤버 확인','소개',current_date,'{"capacity":8}');
insert into public.meetup_requests(post_id,host_id,requester_id,status)
values('69000000-0000-0000-0001-000000000001','69000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000002','approved'),
('69000000-0000-0000-0001-000000000001','69000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000003','pending');
select id as room from public.conversations where group_post_id='69000000-0000-0000-0001-000000000001' \gset
select set_config('request.jwt.claims','{"sub":"69000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.get_conversation_members(:'room')),2,'approved member sees only host and approved members');
select is((select nickname from public.get_conversation_members(:'room') where is_host),'대화멤버01','host badge identifies actual host');
reset role;
select set_config('request.jwt.claims','{"sub":"69000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.get_conversation_members(%L)',:'room'),'P0001','CONVERSATION_ACCESS_DENIED','pending applicant cannot inspect members');
reset role;
select set_config('request.jwt.claims','{"sub":"69000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.get_conversation_members(%L)',:'room'),'P0001','CONVERSATION_ACCESS_DENIED','outsider cannot inspect members');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('69000000-0000-0000-0000-000000000002','69000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','{"sub":"69000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.get_conversation_members(:'room')),1,'blocked profile disappears from roster');
reset role;
update public.meetup_requests set status='cancelled' where requester_id='69000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(format('select public.get_conversation_members(%L)',:'room'),'P0001','CONVERSATION_ACCESS_DENIED','departed member loses roster access');
reset role;
select ok(not has_function_privilege('anon','public.get_conversation_members(uuid)','execute'),'anonymous cannot list members');
select * from finish();
rollback;
