begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','start_business_conversation',array['uuid','uuid','uuid','uuid'],'explicit business endpoints have a separate entry point');
select has_function('public','get_business_chat_messages',array['uuid','uuid','integer','timestamp with time zone','uuid','uuid[]'],'safe messages support bounded exact-ID refresh');
select ok(not private.can_read_conversation('b1910000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000001'),'unknown business conversation cannot use legacy reader');
-- Synthetic data only; injected into a transaction or a disposable schema-only database.
insert into auth.users(id,email,raw_app_meta_data)
  select ('b1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'business-dm-'||n||'@example.test',
    case when n=4 then '{"role":"admin"}'::jsonb else '{"merchant_enabled":true}'::jsonb end from generate_series(1,7)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
  select ('b1900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'업무대화합성검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,7)n;
insert into auth.sessions(id,user_id,aal) values('b1990000-0000-4000-8000-000000000004','b1900000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,owner_id,owner_verified_at,trial_ends_at)
  select ('b1910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'합성 비즈니스 '||n,'vancouver','','trial','granted','synthetic backend fixture','business',
    ('b1900000-0000-4000-8000-'||lpad((case n when 1 then 1 else 5 end)::text,12,'0'))::uuid,now(),current_date+2 from generate_series(1,2)n;
insert into private.merchant_operators(merchant_id,user_id) values
  ('b1910000-0000-4000-8000-000000000001','b1900000-0000-4000-8000-000000000002'),
  ('b1910000-0000-4000-8000-000000000002','b1900000-0000-4000-8000-000000000006');

create temp table dm_ids(name text primary key,id uuid);
grant select,insert,update on dm_ids to authenticated;
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
insert into dm_ids values('personal_business',public.start_business_conversation(null,'b1910000-0000-4000-8000-000000000001',null));
select throws_ok($$select public.start_business_conversation(p_other_business_id=>'b1910000-0000-4000-8000-000000000001',p_other_user_id=>null)$$,'42883',null,'scope omission cannot default to personal identity');
select is(public.start_business_conversation(null,'b1910000-0000-4000-8000-000000000001',null),(select id from dm_ids where name='personal_business'),'repeat start returns the same active room');
select throws_ok($$select public.start_business_conversation(null,null,'b1900000-0000-4000-8000-000000000001')$$,'P0001','INVALID_RECIPIENT','personal-to-personal never falls into business API');
select is(public.get_merchant_profile('b1910000-0000-4000-8000-000000000001')->>'can_message','false','old compiled clients cannot open business rooms');
select is(public.get_merchant_profile('b1910000-0000-4000-8000-000000000001')->>'can_business_message','true','new clients receive a distinct capability');
select throws_ok($$select public.start_merchant_conversation('b1910000-0000-4000-8000-000000000001')$$,'P0001','MERCHANT_CONTACT_UNAVAILABLE','legacy business entry stays blocked');
select is((select count(*) from public.conversations where id=(select id from dm_ids where name='personal_business')),0::bigint,'personal endpoint cannot select raw business conversation');
select is(public.get_conversation_inbox()->'items','[]'::jsonb,'legacy personal inbox omits business room');
select is(public.get_identity_conversation_inbox(null)->'items'->0->'self_identity'->>'id','b1900000-0000-4000-8000-000000000003','selected personal inbox includes its public endpoint');
insert into dm_ids values('user_message',public.send_business_chat_message((select id from dm_ids where name='personal_business'),null,'b1920000-0000-4000-8000-000000000001',p_body=>'Synthetic question'));
select is(public.send_business_chat_message((select id from dm_ids where name='personal_business'),null,'b1920000-0000-4000-8000-000000000001',p_body=>'Synthetic question'),(select id from dm_ids where name='user_message'),'same payload retries are idempotent before rate limit');
select throws_ok($$select public.send_business_chat_message((select id from dm_ids where name='personal_business'),null,'b1920000-0000-4000-8000-000000000001',p_body=>'Different')$$,'P0001','SEND_ID_CONFLICT','same token cannot silently change a message');
select is((select count(*) from public.messages where conversation_id=(select id from dm_ids where name='personal_business')),0::bigint,'sender cannot select raw actor rows or joins');
select is((select count(*) from realtime.messages where topic='business-chat:b1900000-0000-4000-8000-000000000001'),0::bigint,'personal endpoint cannot read another auth user realtime topic');
select ok(exists(select 1 from realtime.messages where topic='business-chat:b1900000-0000-4000-8000-000000000003'),'personal endpoint may receive its own private auth topic');
select throws_ok($$insert into realtime.messages(topic,event,extension,private,payload) values('business-chat:b1900000-0000-4000-8000-000000000003','business_chat_changed','broadcast',true,'{}')$$,'42501',null,'client cannot publish even to its own business-chat topic');

select throws_ok($$select public.send_message((select id from dm_ids where name='personal_business'),'Legacy bypass')$$,'P0001','CONVERSATION_NOT_FOUND','legacy send cannot target business');
select throws_ok($$select public.get_conversation_members((select id from dm_ids where name='personal_business'))$$,'P0001','CONVERSATION_ACCESS_DENIED','legacy member join cannot disclose owners');
select is((select count(*) from public.get_message_reactions(array[(select id from dm_ids where name='user_message')])),0::bigint,'legacy reaction join cannot read business state');
reset role;
select is((select count(*) from public.safety_review_queue where target_type='message' and target_id=(select id from dm_ids where name='user_message')),1::bigint,'unreported business message enters all-content safety queue once');
select is((select count(*) from public.notifications where target_id=(select id from dm_ids where name='user_message') and recipient_business_id='b1910000-0000-4000-8000-000000000001'),2::bigint,'incoming business message fans out to current owner and operator');
select ok(not exists(select 1 from public.notifications where target_id=(select id from dm_ids where name='user_message') and route not like '%&businessId=b1910000-0000-4000-8000-000000000001'),'business recipient routes bind explicit identity');
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_business_chat_messages((select id from dm_ids where name='personal_business'),null)$$,'P0001','CONVERSATION_ACCESS_DENIED','operator personal selection cannot read its business room');
insert into dm_ids values('business_message',public.send_business_chat_message((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001','b1920000-0000-4000-8000-000000000002',p_body=>'Synthetic answer',p_reply_to_id=>(select id from dm_ids where name='user_message')));
select is(public.get_business_chat_messages((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001',p_message_ids=>array[(select id from dm_ids where name='business_message')])->'items'->0->>'sender_id','b1910000-0000-4000-8000-000000000001','message sender is public business UUID');
select is(public.get_business_chat_messages((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001',p_message_ids=>array[(select id from dm_ids where name='business_message')])->'items'->0->'reply_to'->>'sender_id','b1900000-0000-4000-8000-000000000003','reply snippet includes the public sender UUID');
select is(public.get_business_chat_messages((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001',p_message_ids=>array[(select id from dm_ids where name='business_message')])->'items'->0->'reply_to'->>'sender_kind','user','reply snippet binds public identity kind as well as UUID');
select ok(position('b1900000-0000-4000-8000-000000000002' in public.get_business_chat_messages((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001')::text)=0,'safe room envelope never contains private operator ID');
select lives_ok($$select public.mark_business_chat_read((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001',(select id from dm_ids where name='user_message'))$$,'operator can advance shared endpoint read position');
select is(public.set_business_chat_reaction((select id from dm_ids where name='user_message'),'b1910000-0000-4000-8000-000000000001',true),' {"hearts":1,"mine":true}'::jsonb,'business reaction belongs to endpoint');
reset role;
select is((select sender_id from public.messages where id=(select id from dm_ids where name='business_message')),'b1900000-0000-4000-8000-000000000002'::uuid,'actual author is retained privately');
select is((select actor_id from public.notifications where target_id=(select id from dm_ids where name='business_message') limit 1),null::uuid,'business notification has no real actor UUID');
select is((select actor_business_id from public.notifications where target_id=(select id from dm_ids where name='business_message') limit 1),'b1910000-0000-4000-8000-000000000001'::uuid,'business notification carries public business UUID');
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.set_business_chat_reaction((select id from dm_ids where name='user_message'),'b1910000-0000-4000-8000-000000000001',true)->>'hearts','1','owner shares operator reaction without double counting');
select is(public.edit_business_chat_message((select id from dm_ids where name='business_message'),'b1910000-0000-4000-8000-000000000001','Shared edit')->>'sender_id','b1910000-0000-4000-8000-000000000001','owner may edit another current operator business message');
select throws_ok($$select public.edit_business_chat_message((select id from dm_ids where name='business_message'),'b1910000-0000-4000-8000-000000000001','Lost edit')$$,'P0001','MESSAGE_CHANGED','optimistic edit rejects stale editor');
reset role;
select is((select actor_id from private.message_history where message_id=(select id from dm_ids where name='business_message') limit 1),'b1900000-0000-4000-8000-000000000001'::uuid,'editor identity is audited privately');
select is((select sender_id from public.messages where id=(select id from dm_ids where name='business_message')),'b1900000-0000-4000-8000-000000000002'::uuid,'editing never rewrites original author');
select ok(exists(select 1 from private.message_history where message_id=(select id from dm_ids where name='business_message') and original->>'body'='Synthetic answer'),'pre-edit content remains in safety evidence');
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_business_chat_messages((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001')$$,'P0001','CONVERSATION_ACCESS_DENIED','unconnected enabled account cannot impersonate business');
reset role;
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_business_chat_messages((select id from dm_ids where name='personal_business'),null,p_message_ids=>array[(select id from dm_ids where name='business_message')])->'items'),1,'exact-ID refresh returns only requested current DTO');
select throws_ok($$select public.get_business_chat_messages((select id from dm_ids where name='personal_business'),null,p_message_ids=>array_fill(gen_random_uuid(),array[51]))$$,'P0001','MESSAGE_BATCH_TOO_LARGE','exact-ID batch capped at fifty');
select is(jsonb_array_length(public.get_business_chat_messages((select id from dm_ids where name='personal_business'),null,p_message_ids=>array[]::uuid[])->'items'),0,'empty refresh never downloads all messages');
insert into dm_ids values('report',public.report_business_chat_message((select id from dm_ids where name='business_message'),null,'spam','Synthetic report'));
select is((select count(*) from public.reports where id=(select id from dm_ids where name='report')),0::bigint,'reporter cannot read raw business actor or evidence');
select is(jsonb_array_length(public.get_business_chat_messages((select id from dm_ids where name='personal_business'),null,p_message_ids=>array[(select id from dm_ids where name='business_message')])->'items'),0,'reported message disappears from safe refresh');
reset role;
select ok((select evidence->>'sender_id'='b1900000-0000-4000-8000-000000000002' from public.reports where id=(select id from dm_ids where name='report')),'server report evidence keeps actual actor');
-- Revoke the operator and prove old topic membership cannot create new fanout.
create temp table dm_fanout_before as select count(*) n from realtime.messages where topic='business-chat:b1900000-0000-4000-8000-000000000002';
delete from private.merchant_operators where merchant_id='b1910000-0000-4000-8000-000000000001' and user_id='b1900000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_business_chat_messages((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001')$$,'P0001','CONVERSATION_ACCESS_DENIED','revoked role cannot read');
select throws_ok($$select public.send_business_chat_message((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001','b1920000-0000-4000-8000-000000000003',p_body=>'Revoked')$$,'P0001','CONVERSATION_ACCESS_DENIED','revoked role cannot send');
select is((select count(*) from public.notifications where recipient_business_id='b1910000-0000-4000-8000-000000000001'),0::bigint,'revoked role cannot read retained business notices');
reset role;
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.mark_business_chat_read((select id from dm_ids where name='personal_business'),'b1910000-0000-4000-8000-000000000001',(select id from dm_ids where name='business_message'))$$,'owner still reads after unrelated operator revocation');
reset role;
select is((select count(*) from realtime.messages where topic='business-chat:b1900000-0000-4000-8000-000000000002'),(select n from dm_fanout_before),'revoked old subscription receives no later broadcast');
select ok(exists(select 1 from realtime.messages where topic='business-chat:b1900000-0000-4000-8000-000000000001'),'real broadcasts reach the current owner topic');
select ok(not exists(select 1 from realtime.messages r cross join lateral jsonb_object_keys(r.payload) k where r.topic like 'business-chat:b1900000-%'
  and k not in ('id','conversation_id','message_id','recipient_business_id')),'realtime payload contains identifiers only');
select ok(not has_function_privilege('anon','public.start_business_conversation(uuid,uuid,uuid,uuid)','execute'),'anonymous cannot open business rooms');
select ok(not has_function_privilege('authenticated','private.business_chat_recipients(uuid)','execute'),'ordinary callers cannot enumerate private recipients');
select ok(not has_table_privilege('authenticated','private.business_chat_sends','select'),'idempotency payload is private');
insert into realtime.messages(id,topic,extension) values('b19c0000-0000-4000-8000-000000000001','business-chat:b1900000-0000-4000-8000-000000000003','broadcast');
create policy business_dm_permissive_probe on realtime.messages for select to authenticated using(true);
create policy business_dm_publish_probe on realtime.messages for insert to authenticated with check(true);
select set_config('request.jwt.claims','{"sub":"b1900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from realtime.messages where id='b19c0000-0000-4000-8000-000000000001'),1::bigint,'Realtime server read probe authorizes own topic when private defaults false');
select is((select count(*) from realtime.messages where topic='business-chat:b1900000-0000-4000-8000-000000000001'),0::bigint,'permissive SELECT cannot bypass own-topic restriction');
select throws_ok($$insert into realtime.messages(topic,event,extension,private,payload) values('business-chat:b1900000-0000-4000-8000-000000000003','business_chat_changed','broadcast',true,'{}')$$,'42501',null,'permissive INSERT cannot bypass server-only publishing');
reset role;

select throws_ok($$update public.conversations set business_low_id='b1910000-0000-4000-8000-000000000002' where id=(select id from dm_ids where name='personal_business')$$,'P0001','BUSINESS_ENDPOINTS_IMMUTABLE','endpoints cannot be relabeled');


select * from finish();
rollback;
