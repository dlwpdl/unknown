begin;
set local search_path=public,extensions;
select no_plan();
-- business dm fixtures
insert into public.conversations(id,kind,user_low_id,business_high_id,status) values
 ('b1980000-0000-4000-8000-000000000001','business','b1900000-0000-4000-8000-000000000003','b1910000-0000-4000-8000-000000000001','active');
insert into public.messages(id,conversation_id,sender_id,sender_business_id,body) values
 ('b1981000-0000-4000-8000-000000000001','b1980000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000002','b1910000-0000-4000-8000-000000000001','Retained synthetic business evidence'),
 ('b1981000-0000-4000-8000-000000000002','b1980000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000001','b1910000-0000-4000-8000-000000000001','Retained owner evidence');
insert into private.message_history(message_id,actor_id,action,original)
 select id,'b1900000-0000-4000-8000-000000000001','edit',to_jsonb(m) from public.messages m where id='b1981000-0000-4000-8000-000000000001';
insert into public.reports(id,reporter_id,reported_user_id,target_type,target_id,reason_code) values
 ('b1982000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000003','b1900000-0000-4000-8000-000000000002','message','b1981000-0000-4000-8000-000000000001','spam');
update public.profiles set neighborhood='Synthetic neighborhood',bio='Synthetic bio',avatar_path=id::text||'/synthetic.webp' where id::text like 'b1900000-%';
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$update public.profiles set bio='Allowed synthetic edit' where id=auth.uid()$$,'ordinary self profile edit remains allowed with generated auth reference');
select throws_ok($$update public.profiles set account_status='deleted' where id=auth.uid()$$,'42501',null,'ordinary profile write still cannot set protected account status');
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'existing account deletion remains available to business operator');
reset role;
select ok(exists(select 1 from public.conversations where id='b1980000-0000-4000-8000-000000000001' and kind='business'),'account purge does not delete or relabel business conversation');
select ok(exists(select 1 from public.messages where id='b1981000-0000-4000-8000-000000000001' and sender_id='b1900000-0000-4000-8000-000000000002' and body='Retained synthetic business evidence'),'original business actor and body remain private safety evidence');
select ok(exists(select 1 from private.message_history where message_id='b1981000-0000-4000-8000-000000000001'),'private editing evidence survives account purge');
select ok(exists(select 1 from public.reports where id='b1982000-0000-4000-8000-000000000001'),'business report evidence survives actor deletion');
select ok(exists(select 1 from public.safety_review_queue where target_type='message' and target_id='b1981000-0000-4000-8000-000000000001'),'all-content safety work survives account purge');
select is((select account_status from public.profiles where id='b1900000-0000-4000-8000-000000000002'),'deleted','existing personal deletion status is preserved');
select lives_ok($$delete from auth.users where id='b1900000-0000-4000-8000-000000000002'$$,'existing Edge hard-auth deletion can finish without deleting business safety evidence');
select ok(not exists(select 1 from auth.users where id='b1900000-0000-4000-8000-000000000002'),'operator auth row is actually removed');
select ok(exists(select 1 from public.profiles where id='b1900000-0000-4000-8000-000000000002' and account_status='deleted'
  and nickname='탈퇴회원_b1900000' and city_id is null and neighborhood is null and bio is null and avatar_path is null),'retained operator profile is scrubbed of public personal fields');
select ok(not private.business_chat_can_use('b1900000-0000-4000-8000-000000000002','b1910000-0000-4000-8000-000000000001'),'deleted actor tombstone cannot authorize business access');
select is((select confrelid from pg_constraint where conrelid='public.messages'::regclass and conname='messages_sender_id_fkey'),'public.profiles'::regclass::oid,'old PostgREST sender embedding keeps exact profile relation');
select throws_ok($$insert into public.profiles(id,nickname,city_id) values('b19f0000-0000-4000-8000-000000000001','No orphan allowed','vancouver')$$,'23503',null,'active profile still requires a real auth row');
select lives_ok($$delete from auth.users where id='b1900000-0000-4000-8000-000000000007'$$,'unrelated active auth deletion keeps existing profile cascade');
select ok(not exists(select 1 from public.profiles where id='b1900000-0000-4000-8000-000000000007'),'unrelated active profile does not become an orphan');
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'business owner can use existing account purge');
reset role;
select lives_ok($$delete from auth.users where id='b1900000-0000-4000-8000-000000000001'$$,'owner hard-auth deletion succeeds with retained editing evidence');
select ok(not exists(select 1 from auth.users where id='b1900000-0000-4000-8000-000000000001'),'owner auth row is actually removed');
select ok(exists(select 1 from private.message_history where message_id='b1981000-0000-4000-8000-000000000001' and actor_id='b1900000-0000-4000-8000-000000000001'),'original editing actor UUID remains private after auth deletion');
select ok(not private.business_chat_business_ready('b1910000-0000-4000-8000-000000000001'),'owner deletion invalidates current business access');
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'personal business-room endpoint can purge account');
reset role;
select lives_ok($$delete from auth.users where id='b1900000-0000-4000-8000-000000000003'$$,'personal endpoint hard-auth deletion succeeds with immutable endpoint evidence');
select ok(not exists(select 1 from auth.users where id='b1900000-0000-4000-8000-000000000003'),'personal endpoint auth row is actually removed');
select is((select user_low_id from public.conversations where id='b1980000-0000-4000-8000-000000000001'),'b1900000-0000-4000-8000-000000000003'::uuid,'personal endpoint UUID is retained without history rewrite');
select is((select status from public.conversations where id='b1980000-0000-4000-8000-000000000001'),'ended','personal endpoint deletion ends the business room');
select ok(exists(select 1 from public.reports where id='b1982000-0000-4000-8000-000000000001' and reporter_id='b1900000-0000-4000-8000-000000000003'),'private report attribution survives reporter auth deletion');
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"b1990000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_conversation('b1980000-0000-4000-8000-000000000001',null,null,null)->'messages'->0->>'sender_id','b1900000-0000-4000-8000-000000000002','AAL2 review still resolves actual retained actor UUID');
reset role;
select is((select count(*) from public.profiles where account_status='deleted' and nickname='탈퇴회원_b1900000'),3::bigint,'scrubbed same-prefix tombstones coexist without breaking later purges');
select throws_ok($$update public.profiles set nickname='업무대화합성검사5' where id='b1900000-0000-4000-8000-000000000006'$$,'23505',null,'active nickname duplicates remain rejected');
update public.profiles set nickname='CaseSensitiveFixture' where id='b1900000-0000-4000-8000-000000000005';
update public.profiles set account_status='suspended' where id='b1900000-0000-4000-8000-000000000006';
select throws_ok($$update public.profiles set nickname='casesensitivefixture' where id='b1900000-0000-4000-8000-000000000006'$$,'23505',null,'suspended nickname uniqueness remains case insensitive');
select throws_ok($$update public.profiles set auth_reference_id=null where id='b1900000-0000-4000-8000-000000000005'$$,'428C9',null,'generated auth linkage cannot be overridden even by table owner');
select throws_ok($$update public.profiles set account_status='active' where id='b1900000-0000-4000-8000-000000000002'$$,'23503',null,'deleted auth-less tombstone cannot become active orphan');
select * from finish();
rollback;
