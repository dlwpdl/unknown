begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_admin_event_board','event board read RPC exists');
select has_function('public','move_admin_event_stage',array['uuid','text','timestamp with time zone','text','timestamp with time zone'],'event stage move RPC exists');
select has_function('public','add_admin_event_candidates',array['uuid','uuid[]'],'event candidate add RPC exists');
select col_default_is('private','partnership_participations','outreach_stage','candidate','new participations start as board candidates');
insert into public.cities values('event-board-test','이벤트 보드 검사 도시','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('e1500000-0000-0000-0000-000000000001','event-board-admin@example.test','{"role":"admin"}'),
 ('e1500000-0000-0000-0000-000000000002','event-board-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('e1500000-0000-0000-0000-000000000001','보드관리검사','event-board-test'),
 ('e1500000-0000-0000-0000-000000000002','보드회원검사','event-board-test');
insert into auth.sessions(id,user_id,aal) values
 ('e1560000-0000-0000-0000-000000000001','e1500000-0000-0000-0000-000000000001','aal2'),
 ('e1560000-0000-0000-0000-000000000002','e1500000-0000-0000-0000-000000000001','aal1');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind) values
 ('e1520000-0000-0000-0000-000000000001','보드 검사 식당','event-board-test','trial','granted','동의 확인','business'),
 ('e1520000-0000-0000-0000-000000000002','보드 검사 삭제 식당','event-board-test','trial','granted','동의 확인','business');

-- Forged claims and AAL1 sessions are refused before any read or write.
select set_config('request.jwt.claims','{"sub":"e1500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_event_board()$$,'P0001','ADMIN_REQUIRED','forged admin claim cannot read the board');
select throws_ok($$select public.move_admin_event_stage(gen_random_uuid(),'proposed',now())$$,'P0001','ADMIN_REQUIRED','ordinary member cannot move a card');
select throws_ok($$select public.add_admin_event_candidates(gen_random_uuid(),array[gen_random_uuid()])$$,'P0001','ADMIN_REQUIRED','ordinary member cannot add candidates');
reset role;
select set_config('request.jwt.claims','{"sub":"e1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"e1560000-0000-0000-0000-000000000002","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_event_board()$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot read the board');
select throws_ok($$select public.add_admin_event_candidates(gen_random_uuid(),array[gen_random_uuid()])$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot add candidates');
reset role;

select set_config('request.jwt.claims','{"sub":"e1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"e1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.save_admin_partnership('creator',jsonb_build_object('id','e1510000-0000-0000-0000-000000000001','display_name','보드 크리에이터 하나','city_id','event-board-test','profile_url','https://www.instagram.com/board_one/','content_summary','밴쿠버 푸디. 한인으로 보임: 이름에 한글'));
select public.save_admin_partnership('creator',jsonb_build_object('id','e1510000-0000-0000-0000-000000000002','display_name','보드 크리에이터 둘','city_id','event-board-test','profile_url','https://www.instagram.com/board_two/','notes','한인 아님이라고 메모해도 표시는 소개 기록만 따릅니다'));
select public.save_admin_partnership('campaign',jsonb_build_object('id','e1530000-0000-0000-0000-000000000001','merchant_id','e1520000-0000-0000-0000-000000000001','title','보드 검사 이벤트','team_limit',20,'ends_on','2026-11-30'));
select public.save_admin_partnership('campaign',jsonb_build_object('id','e1530000-0000-0000-0000-000000000002','merchant_id','e1520000-0000-0000-0000-000000000002','title','보드 검사 다른 이벤트'));

select throws_ok($$select public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000001','{}'::uuid[])$$,'P0001','INVALID_PARTNERSHIP','empty candidate list refused');
select throws_ok($$select public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000001',array[null::uuid])$$,'P0001','INVALID_PARTNERSHIP','null candidate refused');
select throws_ok($$select public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000001',array_fill(gen_random_uuid(),array[101]))$$,'P0001','INVALID_PARTNERSHIP','oversized batch refused');
select throws_ok($$select public.add_admin_event_candidates(gen_random_uuid(),array['e1510000-0000-0000-0000-000000000001'::uuid])$$,'P0001','PARTNERSHIP_NOT_FOUND','unknown event refused');
select throws_ok($$select public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000001',array[gen_random_uuid()])$$,'P0001','PARTNERSHIP_NOT_FOUND','unknown creator refused without a partial insert');
select is(public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000001',array['e1510000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000002','e1510000-0000-0000-0000-000000000001']::uuid[]),2,'two distinct creators become candidates');
select is(public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000001',array['e1510000-0000-0000-0000-000000000001']::uuid[]),0,'re-adding is a no-op');
select is(public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000002',array['e1510000-0000-0000-0000-000000000001']::uuid[]),1,'the same creator can join another event');
reset role;
create function pg_temp.entry(campaign uuid,creator uuid) returns private.partnership_participations language sql security definer set search_path='' as $$
 select * from private.partnership_participations where campaign_id=campaign and creator_id=creator
$$;
select is((select count(*) from private.partnership_participations where campaign_id='e1530000-0000-0000-0000-000000000001'),2::bigint,'retries created no duplicates');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).outreach_stage,'candidate','candidates start in the first column');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).stage,'applied','strict participation stage keeps its default');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).contacted,false,'a new candidate is not contacted');
select is((select count(*) from private.partnership_events where action='participation_created' and details->>'source'='event_board'),3::bigint,'each new candidate is audited once');
update private.merchants set deleted_at=now() where id='e1520000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.add_admin_event_candidates('e1530000-0000-0000-0000-000000000002',array['e1510000-0000-0000-0000-000000000002'::uuid])$$,'P0001','PARTNERSHIP_INACTIVE','a deleted business takes no new candidates');

select throws_ok(format('select public.move_admin_event_stage(%L,%L,%L)',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).id,'selected',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).updated_at),'P0001','INVALID_PARTNERSHIP','strict stage names are not board stages');
select throws_ok(format('select public.move_admin_event_stage(%L,%L,%L)',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).id,'proposed','2020-01-01T00:00:00Z'),'P0001','PARTNERSHIP_CHANGED','a stale card cannot overwrite a newer move');
select throws_ok($$select public.move_admin_event_stage(gen_random_uuid(),'proposed',now())$$,'P0001','PARTNERSHIP_NOT_FOUND','missing card is explicit');
select lives_ok(format('select public.move_admin_event_stage(%L,%L,%L)',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).id,'proposed',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).updated_at),'card moves to proposed');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).contacted,true,'proposing marks the person contacted');
select lives_ok(format('select public.move_admin_event_stage(%L,%L,%L)',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).id,'hold',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).updated_at),'card moves to hold');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).contacted,true,'holding keeps the contacted mark');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).stage,'applied','board moves never touch the strict stage');
select lives_ok(format('select public.move_admin_event_stage(%L,%L,%L)',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000002')).id,'hold',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000002')).updated_at),'an uncontacted candidate can be held');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000002')).contacted,false,'holding a candidate does not invent contact');
reset role;
select is((select count(*) from private.partnership_events where action='participation_outreach_moved'),3::bigint,'every move is audited');
set local role authenticated;
-- The existing participation editor keeps working on a moved card.
select lives_ok(format('select public.save_admin_partnership(%L,%L::jsonb,%L)','participation',jsonb_build_object('id',(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).id,'notes','기존 편집기 저장')::text,(pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).updated_at),'existing editor saves a moved card');
select is((pg_temp.entry('e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000001')).outreach_stage,'hold','the existing editor leaves the board stage alone');
select is(public.get_admin_partnerships('campaigns','',0,'e1530000-0000-0000-0000-000000000001')->'participations'->0->>'outreach_stage','hold','campaign detail exposes the board stage');

create temp table board on commit drop as select public.get_admin_event_board() b;
select is(jsonb_array_length((select b from board)->'campaigns'),2,'both events are listed');
select is((select b from board)->'campaigns'->0->>'title','보드 검사 이벤트','older open event comes first');
select is(((select b from board)->'campaigns'->0->>'team_limit')::int,20,'goal team count is returned');
select ok(((select b from board)->'campaigns'->0->>'days_left') is not null,'days left is computed in the business timezone');
select is((select e->>'korean' from jsonb_array_elements((select b from board)->'creators') e where e->>'id'='e1510000-0000-0000-0000-000000000001'),'true','discovery marker shows the Korean tag');
select is((select e->>'korean' from jsonb_array_elements((select b from board)->'creators') e where e->>'id'='e1510000-0000-0000-0000-000000000002'),'false','owner notes are not parsed as Korean data');
select is((select jsonb_array_length(e->'entries') from jsonb_array_elements((select b from board)->'creators') e where e->>'id'='e1510000-0000-0000-0000-000000000001'),2,'a creator lists entries from every event');
select is((select b from board)->>'more','false','small boards are complete');
select is((select x->>'held_from' from jsonb_array_elements((select b from board)->'creators') e, jsonb_array_elements(e->'entries') x
  where e->>'id'='e1510000-0000-0000-0000-000000000001' and x->>'campaign_id'='e1530000-0000-0000-0000-000000000001'),'proposed','a held card remembers the board stage it left');
select is((select x->>'held_from' from jsonb_array_elements((select b from board)->'creators') e, jsonb_array_elements(e->'entries') x
  where e->>'id'='e1510000-0000-0000-0000-000000000002' and x->>'campaign_id'='e1530000-0000-0000-0000-000000000001'),'candidate','a candidate held straight away goes back to candidate');
reset role;
select * from finish();
rollback;
