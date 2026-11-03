begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','get_admin_campaign_live',array['uuid'],'dashboard read exists');
select has_function('public','add_admin_campaign_metric',array['uuid','uuid','text','text','bigint','text','date','date','text','boolean','text'],'number entry exists');
select hasnt_function('public','delete_admin_campaign_metric',array['uuid'],'numbers are withdrawn through the ledger, never deleted');
select ok(not has_function_privilege('anon','public.get_admin_campaign_live(uuid)','execute'),'anon cannot read the dashboard');
select ok(not has_function_privilege('service_role','public.add_admin_campaign_metric(uuid,uuid,text,text,bigint,text,date,date,text,boolean,text)','execute'),'service role cannot type numbers');
select ok(not has_function_privilege('authenticated','private.campaign_alerts(uuid)','execute'),'signed-in users cannot call the rules directly');
select ok(not has_table_privilege('authenticated','private.partnership_metrics','select'),'signed-in users cannot read the number log');

insert into public.cities values('live-board','현황판 도시','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('e1700000-0000-0000-0000-000000000001','live-admin@example.test','{"role":"admin"}'),
 ('e1700000-0000-0000-0000-000000000002','live-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('e1700000-0000-0000-0000-000000000001','현황관리','live-board'),('e1700000-0000-0000-0000-000000000002','현황회원','live-board');
insert into auth.sessions(id,user_id,aal) values
 ('e1760000-0000-0000-0000-000000000001','e1700000-0000-0000-0000-000000000001','aal2'),
 ('e1760000-0000-0000-0000-000000000002','e1700000-0000-0000-0000-000000000001','aal1');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind)
  values('e1720000-0000-0000-0000-000000000001','현황 식당','live-board','trial','granted','동의 확인','business');
insert into private.partnership_campaigns(id,merchant_id,title,status,team_limit,minimum_views,support_amount_cents,currency,terms,ends_on) values
 ('e1730000-0000-0000-0000-000000000001','e1720000-0000-0000-0000-000000000001','현황 이벤트','open',6,5000,15000,'CAD','식사: $150까지',current_date+20),
 ('e1730000-0000-0000-0000-000000000002','e1720000-0000-0000-0000-000000000001','다른 이벤트','open',3,null,null,null,'',current_date+20);
-- The benefit is still a draft, so a live store link has nothing to show.
insert into private.partnership_benefits(id,merchant_id,campaign_id,title,audience,status,discount_percent,expires_on)
  values('e1740000-0000-0000-0000-000000000001','e1720000-0000-0000-0000-000000000001','e1730000-0000-0000-0000-000000000001','초안','creators','draft',25,current_date+30);
insert into private.partnership_campaign_links(id,campaign_id,kind,token_sha256,expires_on,created_at)
  values('e1770000-0000-0000-0000-000000000001','e1730000-0000-0000-0000-000000000001','store',repeat('b',64),current_date+30,now()-interval '10 days');
insert into private.partnership_creators(id,display_name,city_id,profile_url,status)
  select ('e1710000-0000-0000-0000-00000000000'||n)::uuid,'live.'||n,'live-board','https://www.instagram.com/live.'||n||'/','active'
  from generate_series(1,8) n;
-- 1 confirmed, no date · 2 confirmed, visit 2 days ago never checked at the store · 3 visited 9 days ago, no content
-- 4 posted, content under the bar · 5 proposed 5 days ago · 6 hold · 7 candidate · 8 proposed today.
insert into private.partnership_participations(id,campaign_id,creator_id,outreach_stage,contacted,scheduled_at,visited_at,content_url)
  select ('e1750000-0000-0000-0000-00000000000'||n)::uuid,'e1730000-0000-0000-0000-000000000001',('e1710000-0000-0000-0000-00000000000'||n)::uuid,
    (array['confirmed','confirmed','confirmed','posted','proposed','hold','candidate','proposed'])[n],n<>7,
    case n when 2 then now()-interval '2 days' when 3 then now()-interval '9 days' end,
    case n when 3 then now()-interval '9 days' end,
    case n when 4 then 'https://www.instagram.com/reel/LiveAbc01/' else '' end
  from generate_series(1,8) n;
insert into private.partnership_events(actor_id,resource_id,action,details,created_at) values
 (null,'e1750000-0000-0000-0000-000000000005','participation_outreach_moved','{"kind":"participation","outreach_stage":"proposed"}',now()-interval '5 days'),
 (null,'e1750000-0000-0000-0000-000000000008','participation_outreach_moved','{"kind":"participation","to":"proposed"}',now());
update private.partnership_participations set created_at=now()-interval '6 days' where campaign_id='e1730000-0000-0000-0000-000000000001';
insert into private.partnership_metrics(id,campaign_id,participation_id,subject,metric,value,url,observed_at,source) values
 ('e1780000-0000-0000-0000-000000000001','e1730000-0000-0000-0000-000000000001','e1750000-0000-0000-0000-000000000004','creator_content','views',800,'https://www.instagram.com/reel/LiveAbc01/',now()-interval '4 days','graph_api'),
 ('e1780000-0000-0000-0000-000000000002','e1730000-0000-0000-0000-000000000001','e1750000-0000-0000-0000-000000000004','creator_content','views',1200,'https://www.instagram.com/reel/LiveAbc01/',now()-interval '1 hour','graph_api');
insert into private.partnership_store_uses(campaign_id,link_id,creator_id,participation_id,kind,used_at) values
 ('e1730000-0000-0000-0000-000000000001','e1770000-0000-0000-0000-000000000001','e1710000-0000-0000-0000-000000000004','e1750000-0000-0000-0000-000000000004','discount','2026-11-03 19:00 America/Vancouver');

select throws_ok($$insert into private.partnership_metrics(campaign_id,subject,metric,value,source) values('e1730000-0000-0000-0000-000000000001','creator_content','views',1,'owner')$$,
  '23514',null,'creator content needs its person and link');
select throws_ok($$insert into private.partnership_metrics(campaign_id,subject,metric,value,url,source) values('e1730000-0000-0000-0000-000000000001','our_post','views',1,'https://evil.example/x','owner')$$,
  '23514',null,'only an Instagram post link is kept');
select throws_ok($$insert into private.partnership_metrics(campaign_id,subject,metric,value,period_start,period_end,source) values('e1730000-0000-0000-0000-000000000001','store','views',1,current_date,current_date,'store_report')$$,
  '23514',null,'a store report holds store numbers, not views');

-- Forged claims and AAL1 sessions are refused.
select set_config('request.jwt.claims','{"sub":"e1700000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_campaign_live('e1730000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','a forged admin claim cannot read the dashboard');
select throws_ok($$select public.add_admin_campaign_metric('e1730000-0000-0000-0000-000000000001',null,'store','google_calls',3,null,current_date,current_date,'store_report',true,'')$$,'P0001','ADMIN_REQUIRED','a forged admin claim cannot type numbers');
reset role;
select set_config('request.jwt.claims','{"sub":"e1700000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"e1760000-0000-0000-0000-000000000002","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_campaign_live('e1730000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','AAL1 administrator cannot read the dashboard');
reset role;
select set_config('request.jwt.claims','{"sub":"e1700000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"e1760000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;

select throws_ok($$select public.get_admin_campaign_live(gen_random_uuid())$$,'P0001','PARTNERSHIP_NOT_FOUND','an unknown campaign is refused');
select throws_ok($$select public.add_admin_campaign_metric('e1730000-0000-0000-0000-000000000001',null,'our_post','views',700,'https://www.instagram.com/p/LiveRes01/',null,null,'graph_api',true,'')$$,
  'P0001','INVALID_PARTNERSHIP','API counts cannot be typed by hand');
select throws_ok($$select public.add_admin_campaign_metric('e1730000-0000-0000-0000-000000000002','e1750000-0000-0000-0000-000000000004','creator_content','views',9,'https://www.instagram.com/reel/LiveAbc01/',null,null,'creator_capture',true,'')$$,
  'P0001','PARTNERSHIP_NOT_FOUND','a person from another campaign is refused');
select lives_ok($$select public.add_admin_campaign_metric('e1730000-0000-0000-0000-000000000001',null,'store','google_directions',42,null,current_date-7,current_date-1,'store_report',true,'가게 캡처')$$,
  'the owner types what the business reported');
select lives_ok($$select public.add_admin_campaign_metric('e1730000-0000-0000-0000-000000000001',null,'our_post','views',700,'https://www.instagram.com/p/LiveRes01/',null,null,'owner',true,'')$$,
  'the owner types our result post views');

create temp table live on commit drop as select public.get_admin_campaign_live('e1730000-0000-0000-0000-000000000001') l;
create temp view al as select a from jsonb_array_elements((select l from live)->'alerts') a;
select is((select jsonb_agg(a->>'kind') from al),'["pipeline_low","benefit_missing","confirmed_no_date","visit_unchecked","no_content_7d","proposed_no_reply","content_low_views","hold_waiting"]'::jsonb,
  'every rule fires here, most urgent first');
select is((select a->'facts'->>'confirmed' from al where a->>'kind'='pipeline_low'),'4','confirmed counts posted too');
select is((select jsonb_agg(p->>'name') from al,jsonb_array_elements(a->'people') p where a->>'kind'='confirmed_no_date'),'["live.1"]'::jsonb,'confirmed without a date are named');
select is((select jsonb_agg(p->>'name') from al,jsonb_array_elements(a->'people') p where a->>'kind'='visit_unchecked'),'["live.2"]'::jsonb,'a past visit nobody checked at the store');
select is((select jsonb_agg(p->>'name') from al,jsonb_array_elements(a->'people') p where a->>'kind'='proposed_no_reply'),'["live.5"]'::jsonb,'only a proposal older than three days waits too long');
select is((select a->'people'->0->>'views' from al where a->>'kind'='content_low_views'),'1200','the latest count is compared');
select is((select (l->'store_uses_by_day')::text from live),'{"2026-11-03": 1}','store checks group by the shop''s day');
select is((select jsonb_array_length(l->'metrics') from live),4,'API and typed numbers come back');
select is((select l->'support'->>'terms' from live),'식사: $150까지','what the business gives comes back');
select ok((select (x->>'visited_at') is not null from live,jsonb_array_elements(l->'entries') x where x->>'id'='e1750000-0000-0000-0000-000000000003'),'visit time comes back');

reset role;
select is((select count(*)::int from private.partnership_events where action='campaign_metric_added'),2,'typed numbers are logged');
-- With a live benefit and enough people waiting, the two red rules go quiet.
update private.partnership_benefits set status='active',starts_on=current_date where id='e1740000-0000-0000-0000-000000000001';
update private.partnership_campaigns set team_limit=4 where id='e1730000-0000-0000-0000-000000000001';
select is((select count(*)::int from jsonb_array_elements(private.campaign_alerts('e1730000-0000-0000-0000-000000000001')) a
  where a->>'kind' in ('pipeline_low','benefit_missing')),0,'red rules clear once fixed');
-- Someone who has been is not missing a visit date: a visit time or a store check takes them off the list.
update private.partnership_participations set scheduled_at=null where id='e1750000-0000-0000-0000-000000000003';
select is((select jsonb_agg(p->>'name') from jsonb_array_elements(private.campaign_alerts('e1730000-0000-0000-0000-000000000001')) a,
  jsonb_array_elements(a->'people') p where a->>'kind'='confirmed_no_date'),'["live.1"]'::jsonb,'a visited person with no date is not named');
insert into private.partnership_store_uses(campaign_id,link_id,creator_id,participation_id,kind,used_at) values
 ('e1730000-0000-0000-0000-000000000001','e1770000-0000-0000-0000-000000000001','e1710000-0000-0000-0000-000000000001','e1750000-0000-0000-0000-000000000001','discount',now());
select is((select count(*)::int from jsonb_array_elements(private.campaign_alerts('e1730000-0000-0000-0000-000000000001')) a
  where a->>'kind'='confirmed_no_date'),0,'a store check counts as having been');
select * from finish();
rollback;
