begin;
select no_plan();
insert into auth.users(id,email) values('9b000000-0000-0000-0000-000000000001','context-sender@example.invalid'),('9b000000-0000-0000-0000-000000000002','context-peer@example.invalid');
insert into public.profiles(id,nickname,city_id,ai_safety_consent_at) values('9b000000-0000-0000-0000-000000000001','대화검사','vancouver',now()),('9b000000-0000-0000-0000-000000000002','동의미확인','vancouver',null);
insert into public.conversations(id,user_low_id,user_high_id,requester_id,status,accepted_at)
values('9b100000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000002','9b000000-0000-0000-0000-000000000001','active',now());
insert into public.messages(id,conversation_id,sender_id,body,created_at)
select ('9b200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'9b100000-0000-0000-0000-000000000001',
 case when n%2=0 then '9b000000-0000-0000-0000-000000000001'::uuid else '9b000000-0000-0000-0000-000000000002'::uuid end,
 case when n=1 then '너무 오래된 대화' when n%2=1 then '동의 없는 상대의 원문' else '동의한 작성자의 맥락 '||n end,now()-(9-n)*interval '1 minute'
 from generate_series(1,8)n;
set local role anon;
select throws_ok($$select public.get_message_safety_context('9b200000-0000-0000-0000-000000000008')$$,'42501',null,'guest cannot read private safety context');
reset role;
select set_config('request.jwt.claims','{"sub":"9b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_message_safety_context('9b200000-0000-0000-0000-000000000008')$$,'42501',null,'conversation membership does not expose the service safety endpoint');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.get_message_safety_context('9b200000-0000-0000-0000-000000000008')->>'authorId','9b000000-0000-0000-0000-000000000001','current message retains the actual sender binding');
select ok(public.get_message_safety_context('9b200000-0000-0000-0000-000000000008')->>'text' not like '%동의 없는 상대의 원문%','prior peer text is omitted when consent is missing');
select ok(public.get_message_safety_context('9b200000-0000-0000-0000-000000000008')->>'text' not like '%너무 오래된 대화%','surrounding history is bounded to six preceding messages');
select ok(public.get_message_safety_context('9b200000-0000-0000-0000-000000000008')->>'text' like '%동의한 작성자의 맥락 6%','necessary consented surrounding context remains available');
select is(public.get_message_safety_context('9b200000-0000-0000-0000-000000000099'),null::jsonb,'missing target remains missing');
reset role;
select * from finish();
rollback;
