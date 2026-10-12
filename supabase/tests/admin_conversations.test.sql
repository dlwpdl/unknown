begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_admin_conversations',array['text','text','text','text','timestamp with time zone','text','text','integer'],'conversation filters and pagination have one server entry');
select has_function('public','get_admin_conversation',array['uuid','timestamp with time zone','uuid','uuid'],'thread reads support an exact cursor or focused message');
select has_function('public','save_admin_conversation_review',array['uuid','text','text','uuid','timestamp with time zone'],'review saves compare the prior review and observed signals');

insert into auth.users(id,email,raw_app_meta_data)
select ('18120000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'ac12-'||n||'@example.test',
  case when n=75 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,75)n;
insert into public.profiles(id,nickname,city_id)
select id,'AC12회원'||right(id::text,2),case when right(id::text,2)='05' then null
  when right(id::text,2) in ('02','04','06') then 'toronto' else 'vancouver' end
from auth.users where id::text like '18120000-%';
insert into auth.sessions(id,user_id,aal)
values('18126000-0000-0000-0000-000000000075','18120000-0000-0000-0000-000000000075','aal2');
insert into public.conversations(id,user_low_id,user_high_id,status,created_at)
select ('18120000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid,
  '18120000-0000-0000-0000-000000000001',('18120000-0000-0000-0000-'||lpad((n+6)::text,12,'0'))::uuid,
  'ended','2026-10-01' from generate_series(1,65)n;
insert into public.conversations(id,user_low_id,user_high_id,status,created_at) values
('18120000-0000-0000-0001-000000000100','18120000-0000-0000-0000-000000000001','18120000-0000-0000-0000-000000000002','ended','2026-10-01'),
('18120000-0000-0000-0001-000000000101','18120000-0000-0000-0000-000000000002','18120000-0000-0000-0000-000000000003','ended','2026-10-01');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('18120000-0000-0000-0003-000000000001','18120000-0000-0000-0000-000000000003','vancouver',1,
  'AC12 group title','fixture context',current_date,'{"capacity":8}');
insert into public.meetup_requests(post_id,host_id,requester_id,status) values
('18120000-0000-0000-0003-000000000001','18120000-0000-0000-0000-000000000003','18120000-0000-0000-0000-000000000004','approved'),
('18120000-0000-0000-0003-000000000001','18120000-0000-0000-0000-000000000003','18120000-0000-0000-0000-000000000006','pending');
select id as group_room from public.conversations where group_post_id='18120000-0000-0000-0003-000000000001' \gset
insert into public.messages(id,conversation_id,sender_id,body,created_at)
select ('18120000-0000-0000-0002-'||lpad(n::text,12,'0'))::uuid,'18120000-0000-0000-0001-000000000100',
  '18120000-0000-0000-0000-000000000001',case when n=1 then E'AC12 literal %_\\ marker' else 'fixture context '||n end,
  '2026-10-01 10:00:00.123456+00'::timestamptz+greatest(n-40,0)*interval '1 microsecond'
from generate_series(1,70)n;
insert into public.messages(id,conversation_id,sender_id,body,created_at,kind,image_path) values
('18120000-0000-0000-0002-000000001001','18120000-0000-0000-0001-000000000101','18120000-0000-0000-0000-000000000002',
 '📷 사진','2026-10-02','image','18120000-0000-0000-0000-000000000002/ac12_sent.webp');
insert into public.messages(id,conversation_id,sender_id,body,created_at)
values('18120000-0000-0000-0002-000000001002',:'group_room','18120000-0000-0000-0000-000000000005','AC12 former member','2026-10-04');
update public.safety_review_queue set status='reviewed',risk_level='low',risk_score=0,risk_reasons='[]',reviewed_at='2026-10-02'
where target_type='message' and target_id::text like '18120000-%';
update public.safety_review_queue set status='reviewed',risk_level='high',risk_score=0.8,risk_reasons='["fixture risk"]',reviewed_at='2026-10-03'
where target_id='18120000-0000-0000-0002-000000001001';
update public.safety_review_queue set status='failed',risk_level=null,risk_score=null,risk_reasons='[]',reviewed_at=null
where target_id='18120000-0000-0000-0002-000000001002';
insert into public.safety_alerts(target_type,target_id,author_id,conversation_id,category,severity,matched_terms,excerpt,created_at) values
('message','18120000-0000-0000-0002-000000000001','18120000-0000-0000-0000-000000000001',
 '18120000-0000-0000-0001-000000000100','fraud','critical',array['fixture'],'AC12 retained original','2026-10-01 12:00:00.123456+00'),
('message','18120000-0000-0000-0002-000000009999','18120000-0000-0000-0000-000000000001',
 '18120000-0000-0000-0001-000000000100','fraud','high',array['fixture'],'AC12 original no longer exists','2026-10-01 12:01:00+00');
insert into storage.buckets(id,name,public) values('ac12-private','ac12-private',false);
insert into storage.objects(bucket_id,name,owner_id) values
('chat-images','18120000-0000-0000-0000-000000000002/ac12_sent.webp','18120000-0000-0000-0000-000000000002'),
('chat-images','18120000-0000-0000-0000-000000000002/ac12_unsent.webp','18120000-0000-0000-0000-000000000002'),
('ac12-private','18120000-0000-0000-0000-000000000002/ac12_sent.webp','18120000-0000-0000-0000-000000000002');
create temp table ac_results(key text primary key,value jsonb);
grant all on ac_results to authenticated;
create temp table ac_original_messages as select to_jsonb(m) as value from public.messages m where m.id::text like '18120000-%';
create temp table ac_original_alerts as select to_jsonb(a) as value from public.safety_alerts a where a.target_id::text like '18120000-%';
create temp table ac_original_queue as select to_jsonb(q) as value from public.safety_review_queue q where q.target_id::text like '18120000-%';

select ok(not has_function_privilege('anon','public.get_admin_conversations(text,text,text,text,timestamptz,text,text,integer)','execute'),'anonymous cannot list conversations');
select ok(not has_function_privilege('anon','public.get_admin_conversation(uuid,timestamptz,uuid,uuid)','execute'),'anonymous cannot read a thread');
select ok(not has_function_privilege('anon','public.save_admin_conversation_review(uuid,text,text,uuid,timestamptz)','execute'),'anonymous cannot save a review');
select ok(not has_function_privilege('authenticated','private.admin_conversation_cases(uuid)','execute')
  and not has_function_privilege('service_role','private.admin_conversation_signals(uuid)','execute'),'private evidence helpers are not caller entry points');
select ok(not has_table_privilege('authenticated','public.admin_conversation_reviews','insert')
  and not has_table_privilege('authenticated','public.admin_conversation_reviews','update')
  and not has_table_privilege('authenticated','public.admin_conversation_reviews','delete'),'review history has no direct write grants');
select ok((select bool_and(prosecdef and proconfig=array['search_path=""']) from pg_proc
  where oid in ('public.get_admin_conversations(text,text,text,text,timestamptz,text,text,integer)'::regprocedure,
    'public.get_admin_conversation(uuid,timestamptz,uuid,uuid)'::regprocedure,
    'public.save_admin_conversation_review(uuid,text,text,uuid,timestamptz)'::regprocedure)),'all public RPCs use definer rights and an empty search path');
select ok(not has_function_privilege('service_role','public.get_admin_conversations(text,text,text,text,timestamptz,text,text,integer)','execute')
  and not has_function_privilege('service_role','public.get_admin_conversation(uuid,timestamptz,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.save_admin_conversation_review(uuid,text,text,uuid,timestamptz)','execute'),'service role cannot bypass the authenticated admin RPC boundary');
set local role anon;
select throws_ok($$select public.get_admin_conversations('all','all','all','all',null,'','recent',0)$$,'42501','permission denied for function get_admin_conversations','actual anonymous list call is rejected');
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'42501','permission denied for function get_admin_conversation','actual anonymous detail call is rejected');
select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','clear','note',null,null)$$,'42501','permission denied for function save_admin_conversation_review','actual anonymous save call is rejected');
reset role;

select set_config('request.jwt.claims','{"sub":"18120000-0000-0000-0000-000000000074","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_conversations('all','all','all','all',null,'AC12','risk',0)$$,'P0001','ADMIN_REQUIRED','a forged admin JWT cannot promote a member');
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','members cannot read another room');
select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','clear','note',null,null)$$,'P0001','ADMIN_REQUIRED','members cannot save reviews');
select throws_ok($$select * from public.admin_conversation_reviews$$,'42501','permission denied for table admin_conversation_reviews','member cannot directly read review history');
select is((select count(*)::integer from storage.objects where name like '%ac12_sent.webp'),0,'outsider cannot read a sent photo');
reset role;
select set_config('request.jwt.claims','{"sub":"18120000-0000-0000-0000-000000000075","role":"authenticated","aal":"aal1","session_id":"18126000-0000-0000-0000-000000000075","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','AAL1 admin is denied');
reset role;
select set_config('request.jwt.claims','{"sub":"18120000-0000-0000-0000-000000000075","role":"authenticated","aal":"aal2","session_id":"18126000-0000-0000-0000-000000000075","app_metadata":{"role":"admin"}}',true);
delete from auth.sessions where id='18126000-0000-0000-0000-000000000075';
set local role authenticated;
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','revoked AAL2 session is denied');
reset role;
insert into auth.sessions(id,user_id,aal) values('18126000-0000-0000-0000-000000000075','18120000-0000-0000-0000-000000000075','aal2');
update auth.sessions set not_after=now()-interval '1 second' where id='18126000-0000-0000-0000-000000000075';
set local role authenticated;
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','expired elevated session is denied');
reset role;
update auth.sessions set not_after=null,aal='aal1' where id='18126000-0000-0000-0000-000000000075';
set local role authenticated;
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','claimed AAL2 cannot bypass actual first-factor session');
reset role;
update auth.sessions set aal='aal2' where id='18126000-0000-0000-0000-000000000075';
update public.profiles set account_status='suspended' where id='18120000-0000-0000-0000-000000000075';
set local role authenticated;
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','inactive admin profile is denied');
reset role;
update public.profiles set account_status='active' where id='18120000-0000-0000-0000-000000000075';
update auth.users set raw_app_meta_data='{}' where id='18120000-0000-0000-0000-000000000075';
set local role authenticated;
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'P0001','ADMIN_REQUIRED','revoked stored admin role is denied');
reset role;
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='18120000-0000-0000-0000-000000000075';

set local role authenticated;
insert into ac_results values ('all',public.get_admin_conversations('all','all','all','all',null,'AC12','recent',0));
select is((select jsonb_array_length(value->'rows') from ac_results where key='all'),50,'conversation page is limited to 50');
select is((select value->'counts'->>'all' from ac_results where key='all'),'68','counts cover every matching room beyond the first page');
select is((select value->>'nextOffset' from ac_results where key='all'),'50','a 51st result provides the next offset');
insert into ac_results values ('second',public.get_admin_conversations('all','all','all','all',null,'AC12','recent',50));
select is((select jsonb_array_length(value->'rows') from ac_results where key='second'),18,'second page returns the remaining rooms');
select ok((select value->>'nextOffset' is null from ac_results where key='second'),'last conversation page has no next offset');
select is((select count(*)::integer from (select row->>'id' from ac_results,jsonb_array_elements(value->'rows')row
  where key in ('all','second') group by row->>'id')x),68,'conversation pages do not duplicate rooms');
select is(public.get_admin_conversations('toronto','all','direct','all',null,'AC12','recent',0)->'counts'->>'all','2','either side of a direct room matches its city');
select is(public.get_admin_conversations('vancouver','all','direct','all',null,'000000000100','recent',0)->'counts'->>'all','1','the same cross-city room is found through the other city');
select is(public.get_admin_conversations('unknown','all','group','all',null,'AC12','recent',0)->'counts'->>'all','1','a departed sender with no city keeps the group discoverable');
select is(public.get_admin_conversations('toronto','all','group','all',null,'AC12','recent',0)->'counts'->>'all','1','approved group member city is included');
select is(public.get_admin_conversations('all','all','all','none',null,'AC12','recent',0)->'counts'->>'all','66','unflagged rooms include empty and ended rooms');
select is(public.get_admin_conversations('all','pending','all','all',null,'AC12','risk',0)->'counts'->>'all','68','scope changes keep global matching counts');
select is(jsonb_array_length(public.get_admin_conversations('all','pending','all','all',null,'AC12','risk',0)->'rows'),2,'analysis failures alone do not become risk signals');
select is(jsonb_array_length(public.get_admin_conversations('all','all','all','high',null,'AC12','risk',0)->'rows'),2,'high filter includes critical keyword and AI risk');
select is(public.get_admin_conversations('all','all','all','all','2026-10-03','AC12','recent',0)->'counts'->>'all','1','period filter follows latest message or room creation');
select is(public.get_admin_conversations('all','all','all','all',null,E'%_\\','recent',0)->'counts'->>'all','1','percent underscore and backslash search are literal');
select is(public.get_admin_conversations('all','all','group','all',null,'group title','recent',0)->'counts'->>'all','1','group title is searchable');
select throws_ok($$select public.get_admin_conversations('all','all','all','all',null,repeat('x',201),'risk',0)$$,'P0001','INVALID_CONVERSATION_FILTER','oversized queries are rejected');
select throws_ok($$select public.get_admin_conversations('all','all','all','all',null,'','risk',-1)$$,'P0001','INVALID_CONVERSATION_FILTER','negative offsets are rejected');
select throws_ok($$select public.get_admin_conversations('all','invalid','all','all',null,'','risk',0)$$,'P0001','INVALID_CONVERSATION_FILTER','unsupported filter values are rejected');

insert into ac_results values ('thread',public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null));
select is((select jsonb_array_length(value->'messages') from ac_results where key='thread'),50,'latest thread read is bounded to 50');
select is((select value->'messages'->0->>'id' from ac_results where key='thread'),'18120000-0000-0000-0002-000000000021','thread is ascending and tied timestamps use message id');
select is((select (value->'nextCursor'->>'at')::timestamptz from ac_results where key='thread'),'2026-10-01 10:00:00.123456+00'::timestamptz,'cursor preserves raw microseconds');
select is((select value->'nextCursor'->>'id' from ac_results where key='thread'),'18120000-0000-0000-0002-000000000021','cursor is the exact earliest displayed message');
insert into ac_results select 'older',public.get_admin_conversation('18120000-0000-0000-0001-000000000100',
  (value->'nextCursor'->>'at')::timestamptz,(value->'nextCursor'->>'id')::uuid,null) from ac_results where key='thread';
select is((select jsonb_array_length(value->'messages') from ac_results where key='older'),20,'older page covers the remaining identical-timestamp messages');
select ok((select value->>'nextCursor' is null and (value->>'hasNewer')::boolean from ac_results where key='older'),'oldest page has no older cursor and indicates newer messages');
select is((select count(*)::integer from (select m->>'id' from ac_results,jsonb_array_elements(value->'messages')m
  where key in ('thread','older') group by m->>'id')x),70,'message pages neither skip nor duplicate equal timestamps');
insert into ac_results values ('focus',public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,'18120000-0000-0000-0002-000000000030'));
select is((select jsonb_array_length(value->'messages') from ac_results where key='focus'),51,'focus read is at most 25 before focus and 25 after');
select is((select value->'messages'->25->>'id' from ac_results where key='focus'),'18120000-0000-0000-0002-000000000030','focus message has its surrounding context');
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,'18120000-0000-0000-0002-000000001001')$$,'P0001','CONVERSATION_MESSAGE_NOT_FOUND','foreign-room focus cannot cross a conversation boundary');
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',now(),null,null)$$,'P0001','INVALID_CONVERSATION_CURSOR','cursor requires timestamp and id together');
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',now(),'18120000-0000-0000-0002-000000000001','18120000-0000-0000-0002-000000000001')$$,'P0001','INVALID_CONVERSATION_CURSOR','focus and cursor are mutually exclusive');
select throws_ok($$select public.get_admin_conversation(null,null,null,null)$$,'P0001','CONVERSATION_NOT_FOUND','null conversation id is rejected');
select throws_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000099999',null,null,null)$$,'P0001','CONVERSATION_NOT_FOUND','missing conversation is rejected');
select is((select value->'conversation'->>'signal_count' from ac_results where key='thread'),'2','keyword signals count both present and missing originals');
select ok((select exists(select 1 from jsonb_array_elements(value->'signals')s where s->>'excerpt'='AC12 original no longer exists' and s->>'message_at' is null) from ac_results where key='thread'),'missing original retains the saved alert excerpt');
insert into ac_results values ('image',public.get_admin_conversation('18120000-0000-0000-0001-000000000101',null,null,null));
select is((select value->'signals'->0->>'source' from ac_results where key='image'),'ai','AI review appears alongside keyword signals');
select is((select (value->'signals'->0->>'message_at')::timestamptz from ac_results where key='image'),'2026-10-02'::timestamptz,'AI signal keeps original message time');
select is((select (value->'signals'->0->>'created_at')::timestamptz from ac_results where key='image'),'2026-10-03'::timestamptz,'AI signal uses review completion time');
select is((select value->'messages'->0->>'kind' from ac_results where key='image'),'image','attachment metadata is returned');
insert into ac_results values ('group',public.get_admin_conversation(:'group_room',null,null,null));
select is((select jsonb_array_length(value->'conversation'->'participants') from ac_results where key='group'),3,'group includes host approved member and departed sender only');
select is((select value->'conversation'->>'pending_analysis' from ac_results where key='group'),'1','failed AI analysis remains visible as outstanding analysis');
select is((select value->'conversation'->>'risk_level' from ac_results where key='group'),'none','failed analysis never asserts safety or violation');
select is((select count(*)::integer from storage.objects where bucket_id='chat-images' and name like '%ac12_sent.webp'),1,'AAL2 admin can read only a photo bound to an existing message');
select is((select count(*)::integer from storage.objects where name like '%ac12_unsent.webp'),0,'admin photo policy excludes unsent objects');
select is((select count(*)::integer from storage.objects where bucket_id='ac12-private'),0,'admin photo policy does not open other buckets');

select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','invalid','note',null,null)$$,'P0001','INVALID_CONVERSATION_REVIEW_STATUS','review status is validated');
select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','clear',E' \t\n ',null,null)$$,'P0001','INVALID_CONVERSATION_REVIEW_NOTE','whitespace-only review notes are rejected');
select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','clear',repeat('x',1001),null,null)$$,'P0001','INVALID_CONVERSATION_REVIEW_NOTE','oversized notes are rejected');
select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','clear','note',null,null)$$,'P0001','CONVERSATION_SIGNALS_CHANGED','stale signal snapshot cannot be saved');
insert into ac_results select 'review1',public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','clear',E' \tverified context\n ',null,
  (value->'conversation'->>'latest_signal_at')::timestamptz) from ac_results where key='thread';
select is((select value->>'note' from ac_results where key='review1'),'verified context','valid notes are trimmed');
select is((select value->>'actor_id' from ac_results where key='review1'),'18120000-0000-0000-0000-000000000075','review records the authenticated operator');
select ok(exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and objsubid=1
  and classid::bigint=((hashtextextended('admin-conversation-review:18120000-0000-0000-0001-000000000100',0)>>32)&4294967295)
  and objid::bigint=(hashtextextended('admin-conversation-review:18120000-0000-0000-0001-000000000100',0)&4294967295)),
  'review save owns the exact room advisory transaction lock');
select throws_ok($$select public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','closed','note',null,'2026-10-01 12:01:00+00')$$,'P0001','CONVERSATION_REVIEW_CHANGED','another operator revision causes a conflict');
insert into ac_results select 'review2',public.save_admin_conversation_review('18120000-0000-0000-0001-000000000100','closed','followup',
  (value->>'id')::uuid,(value->>'last_signal_at')::timestamptz) from ac_results where key='review1';
select throws_ok($$select * from public.admin_conversation_reviews$$,'42501','permission denied for table admin_conversation_reviews','AAL2 admin cannot bypass audited history RPCs');
select is(public.get_admin_conversations('all','done','all','all',null,'AC12','recent',0)->'counts'->>'high','1','done historical risk does not inflate pending high count');
select is(jsonb_array_length(public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)->'review_history'),2,'detail returns review history');
reset role;
select is((select count(*)::integer from public.admin_access_logs where actor_id='18120000-0000-0000-0000-000000000075' and scope='conversations' and resource_id='18120000-0000-0000-0001-000000000100'),6,'successful reads and writes audit the selected conversation');
select ok(not exists((select to_jsonb(m) from public.messages m where m.id::text like '18120000-%') except select value from ac_original_messages)
  and not exists(select value from ac_original_messages except select to_jsonb(m) from public.messages m where m.id::text like '18120000-%'),'investigation never changes or deletes raw messages');
select ok(not exists((select to_jsonb(a) from public.safety_alerts a where a.target_id::text like '18120000-%') except select value from ac_original_alerts)
  and not exists(select value from ac_original_alerts except select to_jsonb(a) from public.safety_alerts a where a.target_id::text like '18120000-%'),'review saving never changes or deletes raw alert statuses or notes');
select ok(not exists((select to_jsonb(q) from public.safety_review_queue q where q.target_id::text like '18120000-%') except select value from ac_original_queue)
  and not exists(select value from ac_original_queue except select to_jsonb(q) from public.safety_review_queue q where q.target_id::text like '18120000-%'),'review saving never changes or deletes AI queue work');

insert into public.safety_alerts(target_type,target_id,author_id,conversation_id,category,severity,matched_terms,excerpt,created_at)
select 'message',('18120000-0000-0000-0002-'||lpad((10000+n)::text,12,'0'))::uuid,'18120000-0000-0000-0000-000000000001',
 '18120000-0000-0000-0001-000000000100','fraud','critical',array['fixture'],'old retained risk','2026-10-01 11:00:00+00'
from generate_series(1,20)n;
insert into public.safety_alerts(target_type,target_id,author_id,conversation_id,category,severity,matched_terms,excerpt,created_at) values
('message','18120000-0000-0000-0002-000000000060','18120000-0000-0000-0000-000000000001',
 '18120000-0000-0000-0001-000000000100','fraud','medium',array['fixture'],'new actionable context','2026-10-05');
set local role authenticated;
insert into ac_results values ('reopened',public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null));
select ok((select (value->'conversation'->>'reopened')::boolean from ac_results where key='reopened'),'new keyword signal reopens a closed conversation');
select is((select value->'conversation'->>'status' from ac_results where key='reopened'),'new','reopened conversation requires a new review');
select is((select value->'conversation'->>'risk_level' from ac_results where key='reopened'),'medium','new signal priority supersedes historical critical signals');
select is((select value->'conversation'->>'signal_count' from ac_results where key='reopened'),'23','full signal count is retained even when payload is bounded');
select ok((select jsonb_array_length(value->'signals')<=12 from ac_results where key='reopened'),'detail returns displayed flags plus only ten priority signals');
select ok((select exists(select 1 from jsonb_array_elements(value->'signals')s where s->>'excerpt'='new actionable context') from ac_results where key='reopened'),'reopened signal is included ahead of old critical evidence');
select throws_ok(format('select public.save_admin_conversation_review(%L,%L,%L,%L,%L)',
  '18120000-0000-0000-0001-000000000100','clear','stale note',value->>'id',value->>'last_signal_at'),
  'P0001','CONVERSATION_SIGNALS_CHANGED','new signals reject a stale review snapshot') from ac_results where key='review2';
insert into ac_results select 'image_review',public.save_admin_conversation_review('18120000-0000-0000-0001-000000000101','clear','AI context reviewed',null,
  (value->'conversation'->>'latest_signal_at')::timestamptz) from ac_results where key='image';
reset role;
update public.safety_review_queue set reviewed_at='2026-10-06',risk_level='medium',risk_reasons='["new assessment"]'
where target_id='18120000-0000-0000-0002-000000001001';
set local role authenticated;
select ok((public.get_admin_conversation('18120000-0000-0000-0001-000000000101',null,null,null)->'conversation'->>'reopened')::boolean,'later AI completion reopens a clear conversation');
select is(jsonb_array_length(public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)->'review_history'),2,'conflicting writes leave all prior review history intact');
reset role;
insert into public.admin_conversation_reviews(conversation_id,actor_id,status,note,created_at)
select '18120000-0000-0000-0001-000000000001','18120000-0000-0000-0000-000000000075','reviewing','history fixture '||n,
  '2026-10-01'::timestamptz+n*interval '1 second' from generate_series(1,25)n;
set local role authenticated;
select is(jsonb_array_length(public.get_admin_conversation('18120000-0000-0000-0001-000000000001',null,null,null)->'review_history'),20,'detail bounds review history to the latest twenty records');
select is(public.get_admin_conversation('18120000-0000-0000-0001-000000000001',null,null,null)->'review_history'->0->>'note','history fixture 25','review history is newest first');
reset role;
select set_config('request.jwt.claims','{"sub":"18120000-0000-0000-0000-000000000074","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select * from public.admin_conversation_reviews$$,'42501','permission denied for table admin_conversation_reviews','member cannot directly read populated review evidence');
select is((select count(*)::integer from storage.objects where name like '%ac12_sent.webp'),0,'member cannot inherit the admin photo read policy');
reset role;

alter table public.messages drop column if exists reply_to_id;
select set_config('request.jwt.claims','{"sub":"18120000-0000-0000-0000-000000000075","role":"authenticated","aal":"aal2","session_id":"18126000-0000-0000-0000-000000000075","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.get_admin_conversation('18120000-0000-0000-0001-000000000100',null,null,null)$$,'thread reads work with the production message schema without reply_to_id');
reset role;

select * from finish();
rollback;
