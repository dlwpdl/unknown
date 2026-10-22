begin;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('9e000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'quick-'||n||'@example.invalid','{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now() from generate_series(1,3)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select id,'추천'||right(id::text,1),'vancouver',now(),now(),now() from auth.users where id::text like '9e000000%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,kind,listing_status,expires_at)
values ('9e100000-0000-0000-0000-000000000001','9e000000-0000-0000-0000-000000000002','vancouver',(select id from public.tags where slug='used'),'책상 판매','사용한 책상',current_date,'listing','open',now()+interval '30 days'),
 ('9e100000-0000-0000-0000-000000000002','9e000000-0000-0000-0000-000000000002','vancouver',(select id from public.tags where slug='housing'),'집 구해요','입주할 집',current_date,'listing','open',now()+interval '30 days'),
 ('9e100000-0000-0000-0000-000000000003','9e000000-0000-0000-0000-000000000003','vancouver',(select id from public.tags where slug='used'),'타인 글','타인',current_date,'listing','open',now()+interval '30 days');
select set_config('request.jwt.claims','{"sub":"9e000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.start_conversation('9e000000-0000-0000-0000-000000000002','9e100000-0000-0000-0000-000000000001') as room_id \gset
select is(public.get_chat_suggestion_context(:'room_id')->>'category','used','canonical selling source is returned');
select public.send_suggested_message(:'room_id','안녕하세요! 아직 판매 중인가요?','9e200000-0000-4000-8000-000000000001') as sent_id \gset
select is(public.send_suggested_message(:'room_id','안녕하세요! 아직 판매 중인가요?','9e200000-0000-4000-8000-000000000001'),:'sent_id'::uuid,'replayed click returns the same message');
select is((select count(*)::integer from public.messages where conversation_id=:'room_id'),1,'one actual message after repeat');
select throws_ok(format('select public.send_suggested_message(%L,%L,%L)',:'room_id','다른 문장','9e200000-0000-4000-8000-000000000001'),'P0001','SEND_ID_CONFLICT','same client ID cannot change its content');
select throws_ok(format('select public.send_suggested_message(%L,%L,%L)',:'room_id',' ','9e200000-0000-4000-8000-000000000003'),'P0001','INVALID_MESSAGE','empty quick send is refused');
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='message' and target_id=:'sent_id'),1,'existing all-message safety queue runs once');
select is((select count(*)::integer from private.chat_suggested_sends where sender_id='9e000000-0000-0000-0000-000000000001'),1,'failed sends leave no pending receipt');
delete from private.action_rate_events where user_id='9e000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.start_conversation('9e000000-0000-0000-0000-000000000002','9e100000-0000-0000-0000-000000000002'),:'room_id'::uuid,'existing pair reuses its room');
select is(public.get_chat_suggestion_context(:'room_id')->>'category','housing_wanted','latest requested housing context is correct');
reset role;
select is((select origin_post_id from public.conversations where id=:'room_id'),'9e100000-0000-0000-0000-000000000001'::uuid,'original transaction source is preserved');
delete from private.action_rate_events where user_id='9e000000-0000-0000-0000-000000000001';
set local role authenticated;
select public.start_conversation('9e000000-0000-0000-0000-000000000002','9e100000-0000-0000-0000-000000000003');
select is(public.get_chat_suggestion_context(:'room_id')->>'postId','9e100000-0000-0000-0000-000000000002','another author cannot forge a new conversation context');
select throws_ok($$select * from private.chat_suggested_sends$$,'42501',null,'private receipt table has no client access');
reset role;
select set_config('request.jwt.claims','{"sub":"9e000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.get_chat_suggestion_context(%L)',:'room_id'),'P0001','CONVERSATION_NOT_FOUND','third party cannot read the context');
select throws_ok(format('select public.send_suggested_message(%L,%L,%L)',:'room_id','타인 방','9e200000-0000-4000-8000-000000000001'),'P0001','CONVERSATION_NOT_FOUND','third party cannot reuse a sender receipt');
reset role;
select set_config('request.jwt.claims','{"sub":"9e000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.blocks(blocker_id,blocked_id) values('9e000000-0000-0000-0000-000000000001','9e000000-0000-0000-0000-000000000002');
select throws_ok(format('select public.send_suggested_message(%L,%L,%L)',:'room_id','안녕하세요! 아직 판매 중인가요?','9e200000-0000-4000-8000-000000000001'),'P0001','CONVERSATION_NOT_ACTIVE','blocked/ended room cannot replay a send');
reset role;
set local role anon;
select throws_ok(format('select public.get_chat_suggestion_context(%L)',:'room_id'),'42501',null,'anonymous context lookup denied');
select throws_ok(format('select public.send_suggested_message(%L,%L,%L)',:'room_id','안녕하세요','9e200000-0000-4000-8000-000000000001'),'42501',null,'anonymous send denied');
reset role;
select * from finish();
rollback;
