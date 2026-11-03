begin;
set local search_path=public,extensions;
select no_plan();
select has_function('private','event_check_reason',array['private.partnership_participations'],'check reason exists');
select ok(not has_function_privilege('authenticated','private.event_check_reason(private.partnership_participations)','execute'),'signed-in users cannot call the reason rule');
select ok(not has_function_privilege('anon','public.get_admin_event_board()','execute'),'anon still cannot read the board');

insert into public.cities values('check-board','확인 도시','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values('e1800000-0000-0000-0000-000000000001','check-admin@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id) values('e1800000-0000-0000-0000-000000000001','확인관리','check-board');
insert into auth.sessions(id,user_id,aal) values('e1860000-0000-0000-0000-000000000001','e1800000-0000-0000-0000-000000000001','aal2');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind)
  values('e1820000-0000-0000-0000-000000000001','확인 식당','check-board','trial','granted','동의 확인','business');
insert into private.partnership_campaigns(id,merchant_id,title,status,team_limit,ends_on)
  values('e1830000-0000-0000-0000-000000000001','e1820000-0000-0000-0000-000000000001','확인 이벤트','open',20,current_date+20);
insert into private.partnership_creators(id,display_name,city_id,profile_url,status)
  select ('e1810000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'check.'||n,'check-board','https://www.instagram.com/check.'||n||'/','active'
  from generate_series(1,40) n;
-- 1 different repeat answer (then a drop-reason edit kept the flag) · 2 rush: 30 link entries in the hour before
-- 3 hand flag · 4 old answer flag cleared, then flagged by hand · 5 not flagged · 6 old answer flag cleared, flagged with no event
-- 10..39 the rush's earlier link entries.
insert into private.partnership_participations(id,campaign_id,creator_id,applied_via,applied_at,needs_check)
  select ('e1850000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'e1830000-0000-0000-0000-000000000001',('e1810000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
    case when n=3 then 'event_board' else 'apply_link' end,
    case when n=3 then null when n=2 then now()-interval '10 minutes' when n>=10 then now()-interval '50 minutes'+(n-10)*interval '1 minute' else now()-interval '5 hours' end,
    n<10 and n<>5
  from generate_series(1,39) n where n<7 or n>=10;
insert into private.partnership_events(actor_id,resource_id,action,details,created_at) values
 (null,'e1850000-0000-0000-0000-000000000001','participation_apply_conflict',
   '{"kind":"participation","campaign_id":"e1830000-0000-0000-0000-000000000001","creator_id":"x","source":"apply_link","language":"en","slots":[],"party":3,"has_allergies":true,"allergies":"peanuts","reel_days":7}',now()-interval '2 hours'),
 ('e1800000-0000-0000-0000-000000000001','e1850000-0000-0000-0000-000000000001','participation_reviewed','{"kind":"participation","drop_reason":"늦음","needs_check":true}',now()-interval '1 hour'),
 ('e1800000-0000-0000-0000-000000000001','e1850000-0000-0000-0000-000000000003','participation_reviewed','{"kind":"participation","drop_reason":null,"needs_check":true}',now()-interval '1 hour'),
 (null,'e1850000-0000-0000-0000-000000000004','participation_apply_conflict','{"kind":"participation","party":2}',now()-interval '4 hours'),
 ('e1800000-0000-0000-0000-000000000001','e1850000-0000-0000-0000-000000000004','participation_reviewed','{"kind":"participation","drop_reason":null,"needs_check":false}',now()-interval '3 hours'),
 ('e1800000-0000-0000-0000-000000000001','e1850000-0000-0000-0000-000000000004','participation_reviewed','{"kind":"participation","drop_reason":null,"needs_check":true}',now()-interval '2 hours'),
 (null,'e1850000-0000-0000-0000-000000000006','participation_apply_conflict','{"kind":"participation","party":2}',now()-interval '4 hours'),
 ('e1800000-0000-0000-0000-000000000001','e1850000-0000-0000-0000-000000000006','participation_reviewed','{"kind":"participation","drop_reason":null,"needs_check":false}',now()-interval '3 hours');

create temp table reasons on commit drop as
  select right(p.id::text,2)::int n,private.event_check_reason(p) r from private.partnership_participations p
  where p.campaign_id='e1830000-0000-0000-0000-000000000001';
select is((select r->>'reason' from reasons where n=1),'apply_changed','a different repeat answer wins over a later drop-reason edit');
select is((select r->'answer' from reasons where n=1),'{"language":"en","slots":[],"party":3,"has_allergies":true,"allergies":"peanuts","reel_days":7}'::jsonb,
  'the changed answer comes without the bookkeeping fields');
select is((select r->>'reason' from reasons where n=2),'rush','30 link entries in the hour before means the rush flag');
select is((select r->>'reason' from reasons where n=3),'manual','a hand flag');
select is((select r->>'reason' from reasons where n=4),'manual','an answer flag cleared earlier does not count again');
select ok((select r is null from reasons where n=5),'no reason when not flagged');
select ok((select r is null from reasons where n=6),'no guess when nothing after the last clear explains it');
select ok((select r is null from reasons where n=10),'an early link entry is not a rush');

select set_config('request.jwt.claims','{"sub":"e1800000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"e1860000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
create temp table board on commit drop as select public.get_admin_event_board() b;
reset role;
select is((select e->'check'->>'reason' from board,jsonb_array_elements(b->'creators') c,jsonb_array_elements(c->'entries') e
  where e->>'id'='e1850000-0000-0000-0000-000000000001'),'apply_changed','the board carries the reason');
select is((select e->'check'->'answer'->>'party' from board,jsonb_array_elements(b->'creators') c,jsonb_array_elements(c->'entries') e
  where e->>'id'='e1850000-0000-0000-0000-000000000001'),'3','and the changed answer');
select ok((select e->'check'='null'::jsonb from board,jsonb_array_elements(b->'creators') c,jsonb_array_elements(c->'entries') e
  where e->>'id'='e1850000-0000-0000-0000-000000000005'),'an unflagged row has no reason');
select is((select (e->>'needs_check')::boolean from board,jsonb_array_elements(b->'creators') c,jsonb_array_elements(c->'entries') e
  where e->>'id'='e1850000-0000-0000-0000-000000000002'),true,'the rest of the entry is unchanged');
select * from finish();
rollback;
