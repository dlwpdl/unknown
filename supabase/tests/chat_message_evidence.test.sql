begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
('a1230000-0000-0000-0000-000000000001','evidence-author@example.test','{}'),
('a1230000-0000-0000-0000-000000000002','evidence-peer@example.test','{}'),
('a1230000-0000-0000-0000-000000000003','evidence-admin@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,ai_safety_consent_at) values
('a1230000-0000-0000-0000-000000000001','검사작성자','vancouver',now()),
('a1230000-0000-0000-0000-000000000002','검사상대','vancouver',now()),
('a1230000-0000-0000-0000-000000000003','검사관리자','vancouver',now());
insert into auth.sessions(id,user_id,aal) values('a1236000-0000-0000-0000-000000000001','a1230000-0000-0000-0000-000000000003','aal2');
insert into public.conversations(id,user_low_id,user_high_id,status,requester_id) values
('a1231000-0000-0000-0000-000000000001','a1230000-0000-0000-0000-000000000001','a1230000-0000-0000-0000-000000000002','active','a1230000-0000-0000-0000-000000000001');
insert into public.messages(id,conversation_id,sender_id,body) values
('a1232000-0000-0000-0000-000000000001','a1231000-0000-0000-0000-000000000001','a1230000-0000-0000-0000-000000000001',repeat('정',2000));
insert into private.message_history(message_id,actor_id,action,original)
select m.id,m.sender_id,'edit',to_jsonb(m)||jsonb_build_object('body',case when n=8 then 'retained-danger-marker' when n=9 then repeat(' ',14000)||'padding-danger-marker' else repeat('😀',2000) end)
from public.messages m cross join generate_series(1,10) n where m.id='a1232000-0000-0000-0000-000000000001';
update public.messages set body='current benign' where id='a1232000-0000-0000-0000-000000000001';
update public.safety_review_queue set created_at='1900-01-01' where target_id='a1232000-0000-0000-0000-000000000001';
create or replace function public.get_message_safety_context(p_target_id uuid) returns jsonb
language sql security definer set search_path='' as $$select jsonb_build_object('text',repeat('😀',6000)||'context-tail-marker')$$;
create temp table evidence_segments(history_id bigint,body text);
create function pg_temp.review_segment(p_error text default null) returns jsonb language plpgsql as $$
declare lease record; content jsonb; outcome jsonb;
begin
  select * into lease from public.claim_safety_reviews_v2(1);
  assert lease.target_id='a1232000-0000-0000-0000-000000000001';
  content:=public.get_message_safety_content(lease.target_id,lease.id,lease.content_hash,lease.claimed_at);
  insert into evidence_segments values((content->'scan'->>'historyId')::bigint,content->>'text');
  outcome:=public.complete_message_safety_review(lease.id,lease.content_hash,lease.claimed_at,
    (content->'scan'->>'historyId')::bigint,(content->'scan'->>'offset')::int,
    case when content->>'text' like '%retained-danger-marker%' then 1 else 0 end,
    case when content->>'text' like '%retained-danger-marker%' then 'critical' else 'low' end,
    case when content->>'text' like '%retained-danger-marker%' then '["credible_threat"]'::jsonb else '["none"]'::jsonb end,p_error);
  if coalesce((outcome->>'alert')::boolean,false) then
    perform public.raise_safety_alert(lease.id);
    assert exists(select 1 from private.admin_conversation_signals('a1231000-0000-0000-0000-000000000001') where severity='critical');
  end if;
  return outcome;
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.review_segment('offline failure');
select is((select status from public.safety_review_queue where target_id='a1232000-0000-0000-0000-000000000001'),'failed','failed chunks remain retryable');
select is((select history_id from private.message_safety_progress p join public.safety_review_queue q on q.id=p.queue_id where q.target_id='a1232000-0000-0000-0000-000000000001'),0::bigint,'failed chunks do not advance retained evidence');
update public.safety_review_queue set next_attempt_at=now() where target_id='a1232000-0000-0000-0000-000000000001';
do $$declare result jsonb; begin
  for n in 1..30 loop
    result:=pg_temp.review_segment();
    exit when (result->>'finished')::boolean;
  end loop;
  assert (result->>'finished')::boolean,'all versions and context chunks must finish';
end $$;
select ok(exists(select 1 from evidence_segments where body like '%retained-danger-marker%'),'a late dangerous retained version is analyzed');
select ok(exists(select 1 from evidence_segments where body like '%context-tail-marker%'),'context tail is analyzed across later chunks');
select ok(exists(select 1 from evidence_segments where body like '%padding-danger-marker%'),'outer padding cannot crowd retained content out of a model request');
select is((select count(distinct history_id) from evidence_segments where history_id<>0),10::bigint,'every retained version is covered');
select ok((select max(char_length(body))<=5050 from evidence_segments),'Unicode chunks fit the existing provider input budget');
select is((select risk_level from public.safety_review_queue where target_id='a1232000-0000-0000-0000-000000000001'),'critical','benign later chunks cannot erase prior risk');
select is((select attempts::int from public.safety_review_queue where target_id='a1232000-0000-0000-0000-000000000001'),0,'successful progress does not exhaust the five failure retries');
select ok(not has_table_privilege('authenticated','private.message_safety_progress','select'),'private context snapshots are not participant readable');
select ok(not has_function_privilege('authenticated','public.claim_safety_reviews_v2(integer)','execute'),'the progress protocol stays service-only');
select set_config('request.jwt.claims','{"sub":"a1230000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select public.edit_chat_message('a1232000-0000-0000-0000-000000000001','new benign');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temp table evidence_lease as select * from public.claim_safety_reviews_v2(1);
create temp table evidence_loaded as select public.get_message_safety_content(target_id,id,content_hash,claimed_at) as value from evidence_lease;
insert into private.message_history(message_id,actor_id,action,original)
select id,sender_id,'edit',to_jsonb(m) from public.messages m where id='a1232000-0000-0000-0000-000000000001';
update public.messages set body='newer benign' where id='a1232000-0000-0000-0000-000000000001';
select is((public.complete_message_safety_review(l.id,l.content_hash,l.claimed_at,(c.value->'scan'->>'historyId')::bigint,0,0,'low','["none"]')->>'accepted')::boolean,false,'concurrent edits invalidate older worker completions') from evidence_lease l cross join evidence_loaded c;
select is((select risk_level from public.safety_review_queue where target_id='a1232000-0000-0000-0000-000000000001'),'critical','new edits preserve previously detected retained risk');
truncate evidence_lease;
insert into evidence_lease select * from public.claim_safety_reviews_v2(1);
update public.safety_review_queue set updated_at=now()-interval '6 minutes' where target_id='a1232000-0000-0000-0000-000000000001';
create temp table evidence_reclaimed as select * from public.claim_safety_reviews_v2(1);
select ok((select r.claimed_at>l.claimed_at from evidence_reclaimed r cross join evidence_lease l),'abandoned leases resume within the existing scheduled worker');
select is((public.complete_message_safety_review(id,content_hash,claimed_at,0,0,null,null,'[]','old failure')->>'accepted')::boolean,false,'an expired worker cannot fail a newly reclaimed lease') from evidence_lease;
select public.complete_message_safety_review(id,content_hash,claimed_at,0,0,null,null,'[]','new failure') from evidence_reclaimed;
select is((select risk_level from public.safety_review_queue where target_id='a1232000-0000-0000-0000-000000000001'),'critical','later failures cannot erase already detected risk');
update public.safety_review_queue set next_attempt_at=now() where target_id='a1232000-0000-0000-0000-000000000001';
do $$ begin
  for n in 1..10 loop
    perform pg_temp.review_segment();
    exit when exists(select 1 from private.message_safety_progress p join public.safety_review_queue q on q.id=p.queue_id
      where q.target_id='a1232000-0000-0000-0000-000000000001' and p.current_offset>0);
  end loop;
end $$;
create or replace function public.get_message_safety_context(p_target_id uuid) returns jsonb
language sql security definer set search_path='' as $$select jsonb_build_object('text','consent-revoked-placeholder')$$;
truncate evidence_lease,evidence_loaded;
insert into evidence_lease select * from public.claim_safety_reviews_v2(1);
insert into evidence_loaded select public.get_message_safety_content(target_id,id,content_hash,claimed_at) from evidence_lease;
select ok((select value->>'text' like '%consent-revoked-placeholder%' and value->>'text' not like '%😀%' from evidence_loaded),'later segments recheck the existing consent filter');
select is((select (value->'scan'->>'offset')::int from evidence_loaded),0,'changed context restarts only the current snapshot');

insert into storage.objects(bucket_id,name,owner_id) values('chat-images','a1230000-0000-0000-0000-000000000001/evidence.webp','a1230000-0000-0000-0000-000000000001');
insert into public.messages(id,conversation_id,sender_id,body,kind,image_path) values
('a1232000-0000-0000-0000-000000000002','a1231000-0000-0000-0000-000000000001','a1230000-0000-0000-0000-000000000001','사진','image','a1230000-0000-0000-0000-000000000001/evidence.webp');
select set_config('request.jwt.claims','{"sub":"a1230000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.delete_chat_message('a1232000-0000-0000-0000-000000000002');
reset role;
select set_config('request.jwt.claims','{"sub":"a1230000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='chat-images' and name='a1230000-0000-0000-0000-000000000001/evidence.webp'),0::bigint,'a participant cannot read another sender deleted photo');
reset role;
select set_config('request.jwt.claims','{"sub":"a1230000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1","session_id":"a1236000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='chat-images' and name='a1230000-0000-0000-0000-000000000001/evidence.webp'),0::bigint,'AAL1 admins cannot read retained attachments');
reset role;
select set_config('request.jwt.claims','{"sub":"a1230000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"a1236000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_admin_message_history('a1232000-0000-0000-0000-000000000002')),1,'AAL2 admin receives the retained original path through audited history');
select is((select count(*) from storage.objects where bucket_id='chat-images' and name='a1230000-0000-0000-0000-000000000001/evidence.webp'),1::bigint,'non-uploader AAL2 admin can read the retained photo');
reset role;
select ok((select count(*)>=2 from public.admin_access_logs where actor_id='a1230000-0000-0000-0000-000000000003' and resource_id='a1232000-0000-0000-0000-000000000002'),'history and retained Storage access are audited');
delete from auth.sessions where id='a1236000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='chat-images' and name='a1230000-0000-0000-0000-000000000001/evidence.webp'),0::bigint,'stale elevated sessions cannot read retained photos');
reset role;
select * from finish();
rollback;
