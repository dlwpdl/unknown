begin;
select no_plan();
select has_function('public','get_conversation_inbox',array['text','integer','text','timestamp with time zone','uuid','uuid'],'bounded inbox RPC exists');
insert into auth.users(id,email) values
 ('43000000-0000-0000-0000-000000000001','inbox-one@example.test'),
 ('43000000-0000-0000-0000-000000000002','inbox-two@example.test'),
 ('43000000-0000-0000-0000-000000000003','inbox-three@example.test');
insert into public.profiles(id,nickname,city_id) values
 ('43000000-0000-0000-0000-000000000001','인박스하나','vancouver'),
 ('43000000-0000-0000-0000-000000000002','인박스둘','vancouver'),
 ('43000000-0000-0000-0000-000000000003','인박스셋','vancouver');
insert into public.conversations(id,user_low_id,user_high_id,status,created_at)
 select ('43000000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid,
 '43000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000002','ended',now()
 from generate_series(1,52) n;
insert into public.conversations(id,user_low_id,user_high_id,status,created_at) values
 ('43000000-0000-0000-0002-000000000001','43000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000002','active',now()-interval '1 year'),
 ('43000000-0000-0000-0002-000000000002','43000000-0000-0000-0000-000000000001','43000000-0000-0000-0000-000000000003','pending',now());
select set_config('request.jwt.claims','{"sub":"43000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_conversation_inbox()->'items'),30,'first page remains bounded with long history');
select is(public.get_conversation_inbox()->'items'->0->>'status','active','old active room stays ahead of recent archived history');
select is((public.get_conversation_inbox()->>'pending_count')::int,1,'pending count is separate from displayed history');
select is(jsonb_array_length(public.get_conversation_inbox('requests')->'items'),1,'request filter applies before pagination');
select is(jsonb_array_length(public.get_conversation_inbox('group')->'items'),0,'kind filter applies on server');
select is(public.get_conversation_inbox(p_conversation_id=>'43000000-0000-0000-0001-000000000001')->'selected'->>'id',
 '43000000-0000-0000-0001-000000000001','off-page deep link resolves independently');
with first as (select public.get_conversation_inbox() page),
 next as (select public.get_conversation_inbox('all',30,page->'cursor'->>'status',
  (page->'cursor'->>'createdAt')::timestamptz,(page->'cursor'->>'id')::uuid) page from first)
select is(jsonb_array_length(page->'items'),23,'equal-time keyset cursor neither skips nor repeats history') from next;
select throws_ok($$select public.get_conversation_inbox('unsupported')$$,'P0001','INVALID_INBOX_FILTER','invalid filters are rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"43000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_conversation_inbox(p_conversation_id=>'43000000-0000-0000-0001-000000000001')->'selected','null'::jsonb,'outsider cannot resolve another room');
select is(jsonb_array_length(public.get_conversation_inbox()->'items'),0,'outsider sees no active or archived private rooms');
reset role;
select ok(not has_function_privilege('anon','public.get_conversation_inbox(text,integer,text,timestamptz,uuid,uuid)','execute'),'anonymous cannot call inbox');
select * from finish();
rollback;
