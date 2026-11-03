begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','move_admin_event_stage',array['uuid','text','timestamp with time zone','text','timestamp with time zone'],'board move takes the winner group and visit time');
select hasnt_function('public','move_admin_event_stage',array['uuid','text','timestamp with time zone'],'no second three-argument overload to make calls ambiguous');

insert into public.cities values('event-board-two','이벤트 보드 2단계 도시','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('e1600000-0000-0000-0000-000000000001','board-two-admin@example.test','{"role":"admin"}'),
 ('e1600000-0000-0000-0000-000000000002','board-two-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('e1600000-0000-0000-0000-000000000001','보드2관리','event-board-two'),('e1600000-0000-0000-0000-000000000002','보드2회원','event-board-two');
insert into auth.sessions(id,user_id,aal) values('e1660000-0000-0000-0000-000000000001','e1600000-0000-0000-0000-000000000001','aal2');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind)
  values('e1620000-0000-0000-0000-000000000001','보드2 식당','event-board-two','trial','granted','동의 확인','business');
-- Applications closed three days ago; picking winners happens after that. Two winner spots.
insert into private.partnership_campaigns(id,merchant_id,title,status,team_limit,ends_on)
  values('e1630000-0000-0000-0000-000000000001','e1620000-0000-0000-0000-000000000001','보드2 이벤트','open',2,current_date-3);
insert into private.partnership_apply_settings(campaign_id,visit_dates,time_slots,party_max,late_gets_benefit)
  values('e1630000-0000-0000-0000-000000000001',array[current_date+5],array['12:00','18:00'],2,true);
insert into private.partnership_benefits(id,merchant_id,campaign_id,title,audience,status,discount_percent,expires_on,starts_on,max_discount_cents,weekdays)
  values('e1640000-0000-0000-0000-000000000001','e1620000-0000-0000-0000-000000000001','e1630000-0000-0000-0000-000000000001','신청자 할인','creators','active',25,current_date+30,current_date+1,2000,'{1,2,3,4}');
insert into private.merchant_event_profiles(merchant_id,instagram,ig_location_id,ig_location_name)
  values('e1620000-0000-0000-0000-000000000001','board2cafe','123456','보드2 식당');
insert into private.partnership_dm_templates(campaign_id,dm_group,language,body,approved_sha256,approved_at) values
 ('e1630000-0000-0000-0000-000000000001','discount','en','Thanks for applying',encode(sha256(convert_to('Thanks for applying','UTF8')),'hex'),now()),
 ('e1630000-0000-0000-0000-000000000001','winner','ko','축하드려요',null,null);
insert into private.partnership_creators(id,display_name,city_id,profile_url,status,followers_count,recent_reel_avg_views,is_private,uses_korean) values
 ('e1610000-0000-0000-0000-000000000001','two.a','event-board-two','https://www.instagram.com/two.a/','active',41000,21000,false,false),
 ('e1610000-0000-0000-0000-000000000002','two.b','event-board-two','https://www.instagram.com/two.b/','active',16000,8400,false,true),
 ('e1610000-0000-0000-0000-000000000003','two.c','event-board-two','https://www.instagram.com/two.c/','active',9000,5000,false,false),
 ('e1610000-0000-0000-0000-000000000004','two.d','event-board-two','https://www.instagram.com/two.d/','paused',3000,900,true,false),
 ('e1610000-0000-0000-0000-000000000005','two.e','event-board-two','https://www.instagram.com/two.e/','active',2000,700,false,false);
insert into private.partnership_participations(id,campaign_id,creator_id,applied_via,language,applied_at,preferred_slots,party_size,has_allergies,allergies,reel_within_days,dm_channel)
  select ('e1650000-0000-0000-0000-00000000000'||n)::uuid,'e1630000-0000-0000-0000-000000000001',('e1610000-0000-0000-0000-00000000000'||n)::uuid,
    'apply_link','en',case when n=3 then now() else now()-interval '5 days' end,
    jsonb_build_array(jsonb_build_object('date',current_date+5,'time','12:00')),2,n=2,case when n=2 then '견과류' end,3,'instagram'
  from generate_series(1,5) n;
create function pg_temp.entry(n int) returns private.partnership_participations language sql security definer set search_path='' as $$
 select * from private.partnership_participations where id=('e1650000-0000-0000-0000-00000000000'||n)::uuid
$$;
create function pg_temp.move(n int,stage text,grp text default null,at timestamptz default null) returns text language sql as $$
 select format('select public.move_admin_event_stage(%L,%L,%L,%L,%L)',(pg_temp.entry(n)).id,stage,(pg_temp.entry(n)).updated_at,grp,at)
$$;

select set_config('request.jwt.claims','{"sub":"e1600000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(pg_temp.move(1,'proposed','winner'),'P0001','ADMIN_REQUIRED','a forged admin claim cannot pick a winner');
reset role;
select set_config('request.jwt.claims','{"sub":"e1600000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"e1660000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;

select throws_ok(pg_temp.move(1,'replied','winner'),'P0001','INVALID_PARTNERSHIP','the winner group only goes with the 당첨 column');
select throws_ok(pg_temp.move(1,'proposed','discount'),'P0001','INVALID_PARTNERSHIP','the board never sets discount or sorry');
select throws_ok(pg_temp.move(1,'proposed',null,now()),'P0001','INVALID_PARTNERSHIP','a visit time only goes with 방문 확정');
select throws_ok(pg_temp.move(1,'confirmed',null,'infinity'),'P0001','INVALID_PARTNERSHIP','an infinite visit time is refused');
select throws_ok(pg_temp.move(4,'proposed','winner'),'P0001','PARTNERSHIP_INACTIVE','a paused creator cannot be picked');

select lives_ok(pg_temp.move(1,'proposed','winner'),'picking a winner after applications closed works');
select is(row((pg_temp.entry(1)).outreach_stage,(pg_temp.entry(1)).stage,(pg_temp.entry(1)).dm_group,(pg_temp.entry(1)).contacted)::text,row('proposed'::text,'selected'::text,'winner'::text,true)::text,'a pick sets 당첨, selected and the winner group together');
select lives_ok(pg_temp.move(2,'proposed','winner'),'second winner fills the last spot');
select throws_ok(pg_temp.move(3,'proposed','winner'),'P0001','PARTNERSHIP_CAPACITY','a third winner is refused at two spots');

-- Undo the second pick: back among applicants, out of the winner group, and the spot opens again.
select lives_ok(pg_temp.move(2,'candidate'),'a winner pick can be undone');
select is(row((pg_temp.entry(2)).outreach_stage,(pg_temp.entry(2)).stage,(pg_temp.entry(2)).dm_group)::text,row('candidate'::text,'applied'::text,null::text)::text,'undo clears selection and group');
select lives_ok(pg_temp.move(3,'proposed','winner'),'the freed spot can be given to someone else');

-- Without the group the board keeps its old meaning (outreach only).
select lives_ok(pg_temp.move(5,'proposed'),'an old-style move still works');
select is(row((pg_temp.entry(5)).stage,(pg_temp.entry(5)).dm_group)::text,row('applied'::text,null::text)::text,'an old-style move leaves stage and group alone');

-- Visit time: filled once from the browser, never overwritten.
select lives_ok(pg_temp.move(1,'confirmed',null,'2026-11-20T20:30:00Z'),'confirming fills the visit time');
select is((pg_temp.entry(1)).scheduled_at,'2026-11-20T20:30:00Z'::timestamptz,'visit time stored as sent');
select lives_ok(pg_temp.move(1,'replied'),'card can step back');
select lives_ok(pg_temp.move(1,'confirmed',null,'2026-11-21T01:00:00Z'),'confirming again succeeds');
select is((pg_temp.entry(1)).scheduled_at,'2026-11-20T20:30:00Z'::timestamptz,'an existing visit time is never overwritten');
select lives_ok(pg_temp.move(1,'confirmed'),'repeating the same move is a no-op');
reset role;

select is((select count(*) from private.partnership_events where action='participation_selected' and details->>'source'='event_board'
  and details->>'campaign_id'='e1630000-0000-0000-0000-000000000001'),3::bigint,'each pick is recorded as a selection, so event terms lock');
select is((select details->>'from_stage' from private.partnership_events where resource_id='e1650000-0000-0000-0000-000000000002'
  and action='participation_outreach_moved' and details->>'outreach_stage'='candidate'),'selected','undo audit keeps the strict stage it left');

-- Once a DM is queued or sent the pick is final, and a discount DM cannot be turned into a win.
update private.partnership_participations set dm_status='sent',dm_sent_at=now() where id='e1650000-0000-0000-0000-000000000003';
update private.partnership_participations set dm_group='discount',dm_status='queued' where id='e1650000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(pg_temp.move(3,'candidate'),'P0001','PARTNERSHIP_STAGE','a winner whose DM went out cannot be undone');
select throws_ok(pg_temp.move(2,'proposed','winner'),'P0001','PARTNERSHIP_STAGE','a queued discount DM cannot become a win');

-- Store link checks (mobile 20261102150000): two kept for two.a, one undone for two.b.
reset role;
insert into private.partnership_campaign_links(id,campaign_id,kind,token_sha256,expires_on)
  values('e1670000-0000-0000-0000-000000000001','e1630000-0000-0000-0000-000000000001','store',repeat('a',64),current_date+30);
insert into private.partnership_store_uses(campaign_id,link_id,creator_id,participation_id,kind,used_at,cancelled_at) values
 ('e1630000-0000-0000-0000-000000000001','e1670000-0000-0000-0000-000000000001','e1610000-0000-0000-0000-000000000001','e1650000-0000-0000-0000-000000000001','winner',now()-interval '2 days',null),
 ('e1630000-0000-0000-0000-000000000001','e1670000-0000-0000-0000-000000000001','e1610000-0000-0000-0000-000000000001','e1650000-0000-0000-0000-000000000001','winner',now()-interval '1 day',null),
 ('e1630000-0000-0000-0000-000000000001','e1670000-0000-0000-0000-000000000001','e1610000-0000-0000-0000-000000000002','e1650000-0000-0000-0000-000000000002','discount',now()-interval '1 day',now()-interval '23 hours');
set local role authenticated;
create temp table board on commit drop as select public.get_admin_event_board() b;
create temp view ev as select e from jsonb_array_elements((select b from board)->'campaigns') e where e->>'id'='e1630000-0000-0000-0000-000000000001';
create temp view en as select c,x from jsonb_array_elements((select b from board)->'creators') c,jsonb_array_elements(c->'entries') x
  where x->>'campaign_id'='e1630000-0000-0000-0000-000000000001';
select is((select row(e->>'apply_link',e->>'late_gets_benefit',e->>'timezone')::text from ev),row('true','true','America/Vancouver')::text,'event shows it takes entries by link, the late rule and its time zone');
select is((select row(e->'benefit'->>'id',e->'benefit'->>'max_discount_cents',e->'benefit'->'weekdays')::text from ev),row('e1640000-0000-0000-0000-000000000001','2000','[1,2,3,4]'::jsonb)::text,'event shows the applicants benefit terms');
select is((select e->'event_profile'->>'instagram' from ev),'board2cafe','event shows the shop Instagram');
select is((select jsonb_agg(t->>'approved' order by t->>'dm_group') from ev,jsonb_array_elements(e->'dm_templates') t),'["true","false"]'::jsonb,'templates say whether they are approved');
select is((select e->'result_post' from ev),'null'::jsonb,'no result post yet');
select is((select x->>'late' from en where c->>'id'='e1610000-0000-0000-0000-000000000003'),'true','an entry after the deadline is marked late');
select is((select x->>'late' from en where c->>'id'='e1610000-0000-0000-0000-000000000001'),'false','an entry before the deadline is not late');
select is((select row(x->>'allergies',x->>'party_size',x->'preferred_slots'->0->>'time')::text from en where c->>'id'='e1610000-0000-0000-0000-000000000002'),row('견과류','2','12:00')::text,'the apply form answers come through');
select is((select row(c->>'followers_count',c->>'recent_reel_avg_views',c->>'uses_korean')::text from en where c->>'id'='e1610000-0000-0000-0000-000000000002'),row('16000','8400','true')::text,'profile numbers come through');
select is((select row(x->>'stage',x->>'dm_group',x->>'dm_status',x->>'scheduled_at')::text from en where c->>'id'='e1610000-0000-0000-0000-000000000001'),row('selected','winner',null::text,'2026-11-20T20:30:00+00:00')::text,'winner, group and visit time come through');
select is((select x->>'store_uses' from en where c->>'id'='e1610000-0000-0000-0000-000000000001'),'2','store link checks count per person');
select is((select x->>'store_uses' from en where c->>'id'='e1610000-0000-0000-0000-000000000002'),'0','an undone check does not count');
select is((select e->>'store_uses' from ev),'2','the event shows its store link total');
reset role;
select * from finish();
rollback;
