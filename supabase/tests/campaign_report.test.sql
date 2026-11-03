begin;
set local search_path=public,extensions;
select no_plan();
select has_function('private','campaign_report',array['uuid','boolean'],'the report builder exists');
select has_function('public','event_report_view',array['text'],'the business report view exists');
select has_view('private','partnership_metrics_live','the live number view exists');
select ok(has_function_privilege('service_role','public.event_report_view(text)','execute')
  and not has_function_privilege('anon','public.event_report_view(text)','execute') and not has_function_privilege('public','public.event_report_view(text)','execute')
  and not has_function_privilege('authenticated','public.event_report_view(text)','execute'),'only the edge function''s service role opens a report');
select ok(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('public',f,'execute') and not has_function_privilege('service_role',f,'execute'),'only signed-in admins (checked inside) call '||f)
  from unnest(array['public.get_admin_campaign_report(uuid)','public.add_admin_campaign_ledger(uuid,jsonb)','public.issue_admin_report_link(uuid)',
    'public.revoke_admin_report_link(uuid)','public.save_admin_campaign_report(uuid,jsonb)','public.get_admin_campaign_live(uuid)']) f;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call '||f) from unnest(array['public','anon','authenticated','service_role']) r,
  unnest(array['private.campaign_report(uuid,boolean)','private.campaign_alerts(uuid)','private.event_link_campaign(text,text)']) f;
select ok(p.prosecdef and p.proconfig=array['search_path=""'],p.oid::regprocedure::text||' runs as its owner with an empty search path')
  from pg_proc p where p.oid in ('private.campaign_report(uuid,boolean)'::regprocedure,'public.event_report_view(text)'::regprocedure,
    'public.get_admin_campaign_report(uuid)'::regprocedure,'public.add_admin_campaign_ledger(uuid,jsonb)'::regprocedure,
    'public.issue_admin_report_link(uuid)'::regprocedure,'public.revoke_admin_report_link(uuid)'::regprocedure,
    'public.save_admin_campaign_report(uuid,jsonb)'::regprocedure,'private.campaign_alerts(uuid)'::regprocedure,'public.get_admin_campaign_live(uuid)'::regprocedure);
select ok(not has_table_privilege(r,t,'select') and not has_table_privilege(r,t,'insert'),r||' has no access to '||t)
  from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.partnership_reports','private.partnership_metrics_live','private.partnership_metrics']) t;
select ok((select relrowsecurity from pg_class where oid='private.partnership_reports'::regclass),'row level security is on for the report table');
select is((select relowner::regrole::text from pg_class where oid='private.partnership_metrics_live'::regclass),'postgres','the live view belongs to postgres');

-- Day s is the start; today is day 30 (s+29), the first day the report can be fixed.
create temp table d on commit drop as select (clock_timestamp() at time zone 'America/Vancouver')::date today,
  (clock_timestamp() at time zone 'America/Vancouver')::date-29 s,null::text h1,null::text h2,null::text h3,null::text t2,null::text t3;
grant select on d to authenticated,service_role;
insert into public.cities values('report-city','리포트 도시','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('e1900000-0000-0000-0000-000000000001','report-admin@example.test','{"role":"admin"}'),
 ('e1900000-0000-0000-0000-000000000002','report-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('e1900000-0000-0000-0000-000000000001','리포트관리','report-city'),('e1900000-0000-0000-0000-000000000002','리포트회원','report-city');
insert into auth.sessions(id,user_id,aal) values
 ('e1960000-0000-0000-0000-000000000001','e1900000-0000-0000-0000-000000000001','aal2'),
 ('e1960000-0000-0000-0000-000000000002','e1900000-0000-0000-0000-000000000001','aal1');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind)
  values('e1920000-0000-0000-0000-000000000001','리포트 식당','report-city','trial','granted','동의 확인','business');
-- The report campaign has closed: its report link still opens.
insert into private.partnership_campaigns(id,merchant_id,title,status,minimum_views,ends_on) values
 ('e1930000-0000-0000-0000-000000000001','e1920000-0000-0000-0000-000000000001','리포트 이벤트','closed',1000,current_date-5),
 ('e1930000-0000-0000-0000-000000000002','e1920000-0000-0000-0000-000000000001','다른 리포트','open',null,current_date+20);
insert into private.partnership_creators(id,display_name,city_id,profile_url,status)
  select ('e1910000-0000-0000-0000-00000000000'||n)::uuid,(array['Alpha Secret','Bravo Secret','Charlie Secret','Delta Secret','Echo Secret','Foxtrot Secret'])[n],
    'report-city','https://www.instagram.com/report.'||(array['alpha','bravo','charlie','delta','echo','foxtrot'])[n]||'/','active'
  from generate_series(1,6) n;
-- 1 posted, visited · 2 confirmed, visited · 3 candidate · 4 hold · 5 dropped · 6 selected but left out with a reason; 7 is in the other campaign.
insert into private.partnership_participations(id,campaign_id,creator_id,stage,outreach_stage,visited_at,content_url,drop_reason)
  select ('e1950000-0000-0000-0000-00000000000'||n)::uuid,case when n=7 then 'e1930000-0000-0000-0000-000000000002' else 'e1930000-0000-0000-0000-000000000001' end::uuid,
    ('e1910000-0000-0000-0000-00000000000'||case when n=7 then 1 else n end)::uuid,case when n=6 then 'selected' else 'applied' end,
    (array['posted','confirmed','candidate','hold','dropped','confirmed','candidate'])[n],
    case when n in (1,2) then now()-interval '20 days' end,case when n=1 then 'https://www.instagram.com/reel/RptReelA1/' else '' end,
    case when n=6 then '안 옴' end
  from generate_series(1,7) n;
insert into private.partnership_campaign_links(id,campaign_id,kind,token_sha256,expires_on)
  values('e1970000-0000-0000-0000-000000000001','e1930000-0000-0000-0000-000000000001','store',repeat('a',64),current_date+30);
-- Six counter checks over three of the business's days, and one that was undone.
insert into private.partnership_store_uses(campaign_id,link_id,creator_id,participation_id,kind,used_at,cancelled_at)
  select 'e1930000-0000-0000-0000-000000000001','e1970000-0000-0000-0000-000000000001',('e1910000-0000-0000-0000-00000000000'||v.n)::uuid,
    ('e1950000-0000-0000-0000-00000000000'||v.n)::uuid,v.kind,((d.s+v.day)+v.at) at time zone 'America/Vancouver',
    case when v.undone then ((d.s+v.day)+v.at+interval '5 minutes') at time zone 'America/Vancouver' end
  from d,(values (1,'winner',2,time '19:00',false),(3,'discount',2,time '19:00',false),(4,'discount',2,time '19:00',false),
    (2,'winner',3,time '12:00',false),(3,'discount',3,time '12:00',false),(5,'discount',3,time '18:00',true),(6,'discount',5,time '20:00',false)) v(n,kind,day,at,undone);
insert into private.partnership_metrics(id,campaign_id,participation_id,subject,metric,value,url,period_start,period_end,observed_at,source,confirmed,note)
  select ('e1980000-0000-0000-0000-0000000000'||v.m)::uuid,('e1930000-0000-0000-0000-00000000000'||v.c)::uuid,('e1950000-0000-0000-0000-00000000000'||v.p)::uuid,
    v.subject,v.metric,v.value,v.url,d.s+v.ps,d.s+v.pe,((d.s+v.at)+time '12:00') at time zone 'America/Vancouver',v.source,v.ok,v.note
  from d,(values
   ('01',1,'1','creator_content','views',100,'https://www.instagram.com/reel/RptReelA1/',null::int,null::int,3,'graph_api',true,''),
   ('02',1,'1','creator_content','views',900,'https://www.instagram.com/reel/RptReelA1/',null,null,5,'graph_api',true,''),
   ('03',1,'1','creator_content','likes',40,'https://www.instagram.com/reel/RptReelA1/',null,null,5,'creator_capture',false,''),
   ('04',1,'1','creator_content','views',300,'https://www.instagram.com/p/RptPostA2/',null,null,6,'graph_api',true,''),
   ('05',1,'2','creator_content','views',5000,'https://www.instagram.com/reel/RptReelB1/',null,null,4,'owner',true,'secret-note-typo'),
   ('06',1,null,'our_post','views',700,'https://www.instagram.com/p/RptOurs01/',null,null,1,'owner',true,''),
   ('07',1,null,'our_post','shares',99,'https://www.instagram.com/p/RptOurs01/',null,null,1,'owner',true,''),
   ('08',1,null,'store','ig_followers',1200,null,-31,-1,-1,'owner',true,'secret-note-before'),
   ('09',1,null,'store','discount_total_cents',45000,null,0,27,28,'store_report',true,'secret-note-discount'),
   ('10',1,null,'store','hosted_meals_cents',30000,null,0,27,28,'store_report',false,''),
   ('11',1,null,'gling','minutes_setup',90,null,-2,-1,-1,'owner',true,''),
   ('12',1,null,'gling','minutes_outreach',45,null,0,1,1,'owner',true,''),
   ('13',2,null,'store','google_calls',3,null,0,1,1,'store_report',true,''),
   ('14',1,'1','creator_content','views',50000,'https://www.instagram.com/reel/RptReelA1/',null,null,7,'owner',true,''),
   ('15',2,null,'store','google_directions',4,null,0,1,1,'store_report',true,''),
   ('16',2,null,'store','customers',10,null,0,1,1,'store_report',true,''),
   ('17',1,null,'store','guest_sales_cents',120000,null,0,27,28,'store_report',true,'')) v(m,c,p,subject,metric,value,url,ps,pe,at,source,ok,note);

-- The log's new rules, straight on the table.
create function pg_temp.row(subject text,metric text,value bigint,period boolean,corrects uuid default null,withdrawn boolean default false) returns void
language sql as $$
  insert into private.partnership_metrics(campaign_id,subject,metric,value,period_start,period_end,source,corrects,withdrawn)
  values('e1930000-0000-0000-0000-000000000002',subject,metric,value,case when period then current_date end,case when period then current_date end,
    'owner',corrects,withdrawn) $$;
select throws_ok(format('select pg_temp.row(%L,%L,%s,%L,%L,%L)',v.subject,v.metric,v.value,v.period,v.corrects,v.withdrawn),'23514',null,'refused: '||v.why)
  from (values ('gling','minutes_setup',10,false,null,false,'our minutes without a period'),
    ('gling','google_calls',10,true,null,false,'a gling row that is not minutes'),
    ('store','minutes_visit',10,true,null,false,'minutes on a store row'),
    ('our_post','minutes_visit',10,true,null,false,'minutes on our post'),
    ('store','google_calls',0,true,null,true,'a withdrawal that corrects nothing'),
    ('store','google_calls',5,true,'e1980000-0000-0000-0000-000000000016',true,'a withdrawal that is not 0'),
    ('gling','guest_sales_cents',10,true,null,false,'guest sales on our minutes row')) v(subject,metric,value,period,corrects,withdrawn,why);
select throws_ok($$insert into private.partnership_metrics(campaign_id,subject,metric,value,url,period_start,period_end,source)
  values('e1930000-0000-0000-0000-000000000002','gling','minutes_setup',5,'https://www.instagram.com/p/RptOurs01/',current_date,current_date,'owner')$$,
  '23514',null,'refused: our minutes with a link');
select throws_ok(format($$insert into private.partnership_metrics(campaign_id,participation_id,subject,metric,value,url,source)
  values('e1930000-0000-0000-0000-000000000001',%L,%L,'guest_sales_cents',5,%L,'owner')$$,v.p,v.subject,v.url),'23514',null,'refused: guest sales on '||v.subject)
  from (values ('e1950000-0000-0000-0000-000000000001','creator_content','https://www.instagram.com/reel/RptReelA1/'),
    (null,'our_post','https://www.instagram.com/p/RptOurs01/')) v(p,subject,url);
select lives_ok($$select pg_temp.row('gling','minutes_exceptions',20,true)$$,'our minutes with a period are kept');
select lives_ok($$select pg_temp.row('store','hosted_meals_cents',15000,true)$$,'the store''s hosted meals are kept');
select lives_ok($$insert into private.partnership_metrics(campaign_id,subject,metric,value,period_start,period_end,source)
  values('e1930000-0000-0000-0000-000000000002','store','sales_cents',5000,current_date,current_date,'pos')$$,'POS numbers are kept');
-- One correction per row; a correction can itself be corrected, and only the last one counts. A withdrawal voids its row.
insert into private.partnership_metrics(id,campaign_id,subject,metric,value,period_start,period_end,source,corrects) values
 ('e1990000-0000-0000-0000-000000000001','e1930000-0000-0000-0000-000000000002','store','google_calls',5,current_date,current_date,'store_report','e1980000-0000-0000-0000-000000000013');
select throws_ok($$insert into private.partnership_metrics(campaign_id,subject,metric,value,period_start,period_end,source,corrects)
  values('e1930000-0000-0000-0000-000000000002','store','google_calls',6,current_date,current_date,'store_report','e1980000-0000-0000-0000-000000000013')$$,
  '23505',null,'a row is corrected at most once');
insert into private.partnership_metrics(id,campaign_id,subject,metric,value,period_start,period_end,source,corrects,withdrawn) values
 ('e1990000-0000-0000-0000-000000000002','e1930000-0000-0000-0000-000000000002','store','google_calls',7,current_date,current_date,'store_report','e1990000-0000-0000-0000-000000000001',false),
 ('e1990000-0000-0000-0000-000000000003','e1930000-0000-0000-0000-000000000002','store','google_directions',0,current_date,current_date,'owner','e1980000-0000-0000-0000-000000000015',true);
select is((select array_agg(id order by id) from private.partnership_metrics_live where campaign_id='e1930000-0000-0000-0000-000000000002'
    and metric in ('google_calls','google_directions','customers')),
  array['e1980000-0000-0000-0000-000000000016','e1990000-0000-0000-0000-000000000002']::uuid[],
  'the live view keeps the last correction and untouched rows, and drops corrected, withdrawn and withdrawal rows');
select is((select count(*)::int from private.partnership_metrics_live),(select count(*)::int from private.partnership_metrics m
    where not withdrawn and not exists(select 1 from private.partnership_metrics x where x.corrects=m.id)),
  'the live view is exactly: not a withdrawal and corrected by no row');
select throws_ok($$select public.get_admin_campaign_report('e1930000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','a call without a signed-in admin is refused');

-- Forged claims and AAL1 sessions are refused everywhere.
select set_config('request.jwt.claims','{"sub":"e1900000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(q,'P0001','ADMIN_REQUIRED','a forged admin claim cannot '||why) from (values
 ($$select public.get_admin_campaign_report('e1930000-0000-0000-0000-000000000001')$$,'read the report'),
 ($$select public.add_admin_campaign_ledger('e1930000-0000-0000-0000-000000000001','{"subject":"store","metric":"google_calls","value":1,"period_start":"2026-11-03","period_end":"2026-11-03","source":"owner"}')$$,'add a number'),
 ($$select public.issue_admin_report_link('e1930000-0000-0000-0000-000000000001')$$,'issue a report link'),
 ($$select public.revoke_admin_report_link('e1930000-0000-0000-0000-000000000001')$$,'revoke a report link'),
 ($$select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000001','{"lessons":"x"}')$$,'save the report')) v(q,why);
reset role;
select set_config('request.jwt.claims','{"sub":"e1900000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"e1960000-0000-0000-0000-000000000002","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(q,'P0001','ADMIN_REQUIRED','an AAL1 administrator cannot '||why) from (values
 ($$select public.get_admin_campaign_report('e1930000-0000-0000-0000-000000000001')$$,'read the report'),
 ($$select public.issue_admin_report_link('e1930000-0000-0000-0000-000000000001')$$,'issue a report link'),
 ($$select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000001','{"fix":true}')$$,'fix the report')) v(q,why);
reset role;
select is((select count(*)::int from private.partnership_campaign_links where kind='report'),0,'refused calls made no link');
select set_config('request.jwt.claims','{"sub":"e1900000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"e1960000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;

-- Adding to the log: only typed sources, only known keys of the right type, people of this campaign.
select throws_ok(format('select public.add_admin_campaign_ledger(%L,%L)',v.campaign,v.entry),'P0001',v.code,'entry refused: '||v.why) from (values
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":1,"url":"https://www.instagram.com/p/RptOurs01/","source":"graph_api"}','INVALID_PARTNERSHIP','an API count typed by hand'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":1,"url":"https://www.instagram.com/p/RptOurs01/"}','INVALID_PARTNERSHIP','no source'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":1,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner","admin":true}','INVALID_PARTNERSHIP','an unknown key'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":"1","url":"https://www.instagram.com/p/RptOurs01/","source":"owner"}','INVALID_PARTNERSHIP','a value sent as text'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":1.5,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner"}','INVALID_PARTNERSHIP','a value that is not whole'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":-1,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner"}','INVALID_PARTNERSHIP','a negative value'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":1,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner","confirmed":"yes"}','INVALID_PARTNERSHIP','confirmed sent as text'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":1,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner","observed_at":"infinity"}','INVALID_PARTNERSHIP','a time that never comes'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"store","metric":"google_calls","value":1,"period_start":"2026-02-30","period_end":"2026-03-01","source":"owner"}','INVALID_PARTNERSHIP','a day that does not exist'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"store","metric":"minutes_visit","value":1,"period_start":"2026-11-03","period_end":"2026-11-03","source":"owner"}','INVALID_PARTNERSHIP','minutes on a store row'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"gling","metric":"minutes_visit","value":1,"source":"owner"}','INVALID_PARTNERSHIP','our minutes without a period'),
 ('e1930000-0000-0000-0000-000000000001','["not","an","object"]','INVALID_PARTNERSHIP','an entry that is not an object'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"creator_content","metric":"views","value":1,"url":"https://www.instagram.com/reel/RptReelA1/","source":"owner","participation_id":"e1950000-0000-0000-0000-000000000007"}','PARTNERSHIP_NOT_FOUND','a person from another campaign'),
 ('e1930000-0000-0000-0000-0000000000ff','{"subject":"our_post","metric":"views","value":1,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner"}','PARTNERSHIP_NOT_FOUND','an unknown campaign'),
 -- Corrections keep the original's campaign, subject, metric and person; withdrawals hold 0 and need a row to void.
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000013","value":4,"source":"owner"}','PARTNERSHIP_NOT_FOUND','correcting another campaign''s row'),
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000005","metric":"likes","value":4,"source":"owner"}','INVALID_PARTNERSHIP','a correction with another metric'),
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000006","subject":"creator_content","participation_id":"e1950000-0000-0000-0000-000000000001","value":4,"source":"owner"}','INVALID_PARTNERSHIP','a correction with another subject'),
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000005","participation_id":"e1950000-0000-0000-0000-000000000001","value":4,"source":"owner"}','INVALID_PARTNERSHIP','a correction for another person'),
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000005","source":"owner"}','INVALID_PARTNERSHIP','a correction without a value'),
 ('e1930000-0000-0000-0000-000000000001','{"subject":"store","metric":"google_calls","value":0,"period_start":"2026-11-03","period_end":"2026-11-03","source":"owner","withdrawn":true}','INVALID_PARTNERSHIP','a withdrawal that voids nothing'),
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000007","withdrawn":true,"value":99,"source":"owner"}','INVALID_PARTNERSHIP','a withdrawal that is not 0'),
 ('e1930000-0000-0000-0000-000000000001','{"corrects":"e1990000-0000-0000-0000-0000000000ff","value":4,"source":"owner"}','PARTNERSHIP_NOT_FOUND','correcting a row that does not exist')) v(campaign,entry,code,why);

-- The typo'd 5000 views become 500 from the creator's capture; the discount total becomes the POS number; two rows are voided.
create temp table added on commit drop as select n,public.add_admin_campaign_ledger('e1930000-0000-0000-0000-000000000001',e) r from (values
 (1,(select jsonb_build_object('corrects','e1980000-0000-0000-0000-000000000005','value',500,'source','creator_capture','note','secret-note-capture',
    'observed_at',((s+4)+time '13:00') at time zone 'America/Vancouver') from d)),
 (2,'{"corrects":"e1980000-0000-0000-0000-000000000009","value":40000,"source":"pos","note":"secret-note-pos"}'::jsonb),
 (3,'{"corrects":"e1980000-0000-0000-0000-000000000007","withdrawn":true,"source":"owner"}'),
 (4,'{"corrects":"e1980000-0000-0000-0000-000000000014","withdrawn":true,"source":"owner","confirmed":false}'),
 (5,(select jsonb_build_object('subject','gling','metric','minutes_report','value',30,'period_start',s+27,'period_end',s+28,'source','owner') from d)),
 (6,'{"corrects":"e1980000-0000-0000-0000-000000000017","value":125000,"source":"pos"}')) v(n,e);
select is((select r-array['id','observed_at','created_at'] from added where n=1),'{"campaign_id":"e1930000-0000-0000-0000-000000000001",
  "participation_id":"e1950000-0000-0000-0000-000000000002","subject":"creator_content","metric":"views","value":500,"url":"https://www.instagram.com/reel/RptReelB1/",
  "period_start":null,"period_end":null,"source":"creator_capture","confirmed":true,"note":"secret-note-capture","corrects":"e1980000-0000-0000-0000-000000000005","withdrawn":false}'::jsonb,
  'a correction takes the person and link from the row it corrects');
select is((select jsonb_build_object('value',r->'value','start',r->'period_start','end',r->'period_end','source',r->'source') from added where n=2),
  (select jsonb_build_object('value',40000,'start',s,'end',s+27,'source','pos') from d),'a store correction keeps the period and records the POS source');
select is((select jsonb_build_object('value',r->'value','withdrawn',r->'withdrawn','url',r->'url','metric',r->'metric') from added where n=3),
  '{"value":0,"withdrawn":true,"url":"https://www.instagram.com/p/RptOurs01/","metric":"shares"}'::jsonb,'a withdrawal holds 0 for the voided row');
select ok((select (r->>'observed_at')::timestamptz>=now() from added where n=5),'a number without a measured time is measured now');
select throws_ok($$select public.add_admin_campaign_ledger('e1930000-0000-0000-0000-000000000001','{"corrects":"e1980000-0000-0000-0000-000000000005","value":600,"source":"owner"}')$$,
  'P0001','PARTNERSHIP_CHANGED','a row already corrected cannot be corrected again; correct the correction');
select lives_ok(format('select public.add_admin_campaign_ledger(%L,%L)','e1930000-0000-0000-0000-000000000002',
  jsonb_build_object('corrects','e1990000-0000-0000-0000-000000000002','value',8,'source','store_report')),'the latest correction can be corrected');
reset role;
select is((select count(*)::int from private.partnership_events where action='campaign_ledger_added'),7,'each added row is logged');
select is((select count(*)::int from private.partnership_events where action='campaign_ledger_added' and details::text like '%secret-note%'),0,
  'the log event leaves the note out');
select is((select details-'kind'-'campaign_id' from private.partnership_events where action='campaign_ledger_added' and resource_id=(select (r->>'id')::uuid from added where n=4)),
  '{"subject":"creator_content","metric":"views","value":0,"source":"owner","corrects":"e1980000-0000-0000-0000-000000000014","withdrawn":true}'::jsonb,
  'a withdrawal is logged with the row it voids');

-- The live dashboard reads the same live view, so a voided typo no longer hides a low count.
set local role authenticated;
create temp table board on commit drop as select public.get_admin_campaign_live('e1930000-0000-0000-0000-000000000001') l;
reset role;
select is((select array_agg((x->>'id')::uuid order by x->>'id') from board,jsonb_array_elements(l->'metrics') x),
  (select array_agg(id order by id::text) from private.partnership_metrics_live where campaign_id='e1930000-0000-0000-0000-000000000001'),
  'the dashboard lists only live numbers');
select is((select count(*)::int from board,jsonb_array_elements(l->'metrics') x
    where x->>'id' in ('e1980000-0000-0000-0000-000000000005','e1980000-0000-0000-0000-000000000009','e1980000-0000-0000-0000-000000000014',
      'e1980000-0000-0000-0000-000000000017')),0,
  'corrected and voided numbers are gone from the dashboard');
select is((select jsonb_agg(jsonb_build_object('name',p->>'name','views',(p->>'views')::int) order by p->>'views') from board,jsonb_array_elements(l->'alerts') a,
    jsonb_array_elements(a->'people') p where a->>'kind'='content_low_views'),
  '[{"name":"Alpha Secret","views":300},{"name":"Bravo Secret","views":500}]'::jsonb,'the alerts take the latest live count, not a voided one');

-- The report row: permission needs its day and proof, and day 30 comes 29 days after the start.
set local role authenticated;
select throws_ok(format('select public.save_admin_campaign_report(%L,%L)','e1930000-0000-0000-0000-000000000001',v.fields),'P0001','INVALID_PARTNERSHIP','report refused: '||v.why)
  from (values ('{"title":"x"}','an unknown key'),('{"starts_on":"11/03/2026"}','a start not written YYYY-MM-DD'),('{"starts_on":"2026-02-30"}','a start that does not exist'),
    ('{"consent":"open"}','showing the result without the day and proof'),('{"consent":"anon","consent_on":"2026-11-03"}','permission without proof'),
    ('{"consent":"public","consent_on":"2026-11-03","consent_evidence":"DM"}','an unknown permission'),('{"fix":"yes"}','fix sent as text'),
    ('{"lessons":7}','lessons that are not text')) v(fields,why);
select throws_ok(format('select public.save_admin_campaign_report(%L,%L)','e1930000-0000-0000-0000-000000000001',jsonb_build_object('lessons',repeat('가',1001))),
  'P0001','INVALID_PARTNERSHIP','lessons over 1000 characters are refused');
select throws_ok($$select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000002','{"fix":true}')$$,'P0001','REPORT_NOT_DUE','no fix without a start date');
select lives_ok(format('select public.save_admin_campaign_report(%L,%L)','e1930000-0000-0000-0000-000000000001',(select jsonb_build_object('starts_on',s+1) from d)),'a start date is saved');
select throws_ok($$select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000001','{"fix":true}')$$,'P0001','REPORT_NOT_DUE','day 29 is too early to fix');
create temp table saved on commit drop as select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000001',
  (select jsonb_build_object('starts_on',s,'consent','anon','consent_on',today,'consent_evidence','DM 캡처 · 운영 폴더','lessons','시작 전 값을 먼저 적자') from d)) r;
select is((select r-'updated_at' from saved),(select jsonb_build_object('starts_on',s,'fixed_at',null,'fixed',null,'lessons','시작 전 값을 먼저 적자','consent','anon',
  'consent_on',today,'consent_evidence','DM 캡처 · 운영 폴더') from d),'start, permission with its day and proof, and lessons are saved');

-- The report link: 43 characters shown once, kept only as a hash; issuing again turns the old one off.
create temp table issued on commit drop as select 1 n,public.issue_admin_report_link('e1930000-0000-0000-0000-000000000001') t;
insert into issued select 2,public.issue_admin_report_link('e1930000-0000-0000-0000-000000000001');
reset role;
update d set h1=encode(sha256(convert_to((select t->>'token' from issued where n=1),'UTF8')),'hex'),
  h2=encode(sha256(convert_to((select t->>'token' from issued where n=2),'UTF8')),'hex'),t2=(select t->>'token' from issued where n=2);
select ok((select bool_and(t->>'token' ~ '^[A-Za-z0-9_-]{43}$') from issued),'the token is 43 base64url characters, the form the edge function accepts');
select is((select array_agg(distinct (t->>'expires_on')::date) from issued),(select array[today+365] from d),'a report link works for a year');
select is((select array_agg(k order by k) from issued,jsonb_object_keys(t) k where n=1),array['expires_on','token'],'issuing answers only the token and its expiry');
select is((select count(*)::int from private.partnership_campaign_links l,d where l.kind='report' and l.token_sha256 in (d.h1,d.h2)),2,'only the hash of each token is stored');
select is((select count(*)::int from issued i where exists(select 1 from private.partnership_campaign_links l where to_jsonb(l)::text like '%'||(i.t->>'token')||'%')
    or exists(select 1 from private.partnership_events e where e.details::text like '%'||(i.t->>'token')||'%')
    or exists(select 1 from public.admin_access_logs a where to_jsonb(a)::text like '%'||(i.t->>'token')||'%')),0,'no table, event or access log holds a token');
select is((select array_agg(revoked_at is null order by created_at) from private.partnership_campaign_links where kind='report'),array[false,true],
  'issuing again turned the first link off');
select is((select array_agg(action order by id) from private.partnership_events where details->>'link_kind'='report'),
  array['campaign_link_created','campaign_link_revoked','campaign_link_created'],'link changes are logged without the token');
select throws_ok($$insert into private.partnership_campaign_links(campaign_id,kind,token_sha256,expires_on) values('e1930000-0000-0000-0000-000000000001','report',repeat('c',64),current_date)$$,
  '23505',null,'a campaign has one live report link');
select throws_ok($$insert into private.partnership_campaign_links(campaign_id,kind,slug,token_sha256,expires_on) values('e1930000-0000-0000-0000-000000000002','report','report-slug',repeat('c',64),current_date)$$,
  '23514',null,'a report link has no public slug');
set local role service_role;
select is(public.event_report_view((select h1 from d)),null,'the first link no longer opens');
select is(public.event_report_view((select h2 from d))->>'title','리포트 이벤트','the new link opens the closed campaign''s report');
select is(public.event_report_view((select t2 from d)),null,'the raw token is never accepted in place of its hash');
select is(public.event_report_view(repeat('a',64)),null,'a store link does not open the report');
select is(public.event_store_view((select h2 from d)),null,'and a report link does not open the store page');
reset role;
set local role authenticated;
select ok(public.revoke_admin_report_link('e1930000-0000-0000-0000-000000000001'),'the report link is turned off');
select ok(not public.revoke_admin_report_link('e1930000-0000-0000-0000-000000000001'),'turning it off twice changes nothing');
select throws_ok($$select public.revoke_admin_report_link('e1930000-0000-0000-0000-0000000000ff')$$,'P0001','PARTNERSHIP_NOT_FOUND','an unknown campaign has no link');
insert into issued select 3,public.issue_admin_report_link('e1930000-0000-0000-0000-000000000001');
reset role;
update d set h3=encode(sha256(convert_to((select t->>'token' from issued where n=3),'UTF8')),'hex'),t3=(select t->>'token' from issued where n=3);
set local role service_role;
select is(public.event_report_view((select h2 from d)),null,'a revoked link opens nothing');
create temp table biz on commit drop as select public.event_report_view((select h3 from d)) b;
reset role;

-- What the business sees: its live numbers, nothing private.
select is((select array_agg(k order by k) from biz,jsonb_object_keys(b) k),
  array['business','contents','currency','fix_on','fixed_at','guests','money','people','starts_on','store','synced_at','title','views_total'],'the business report has only its own fields');
select is((select b-'synced_at'-'guests'-'money'-'contents'-'store'-'people' from biz),(select jsonb_build_object('title','리포트 이벤트','business','리포트 식당',
  'currency','CAD','starts_on',s,'fix_on',s+29,'fixed_at',null,'views_total',2400) from d),'title, business, currency (CAD when unset), start, fix day and total views');
select ok((select (b->>'synced_at')::timestamptz>=now() from biz),'and when it was read');
select is((select b->'guests' from biz),(select jsonb_build_object('total',6,'discount',4,'winner',2,'by_day',jsonb_build_array(
  jsonb_build_object('day',s+2,'n',3),jsonb_build_object('day',s+3,'n',2),jsonb_build_object('day',s+5,'n',1))) from d),
  'guests are the counter checks not undone, by the business''s day');
select is((select b->'money' from biz),'{"discount_total_cents":40000,"hosted_meals_cents":30000,"guest_sales_cents":125000,"store_spend_cents":70000,
    "per_guest_cents":11667,"confirmed":false}'::jsonb,
  'money has exactly these keys: guest sales are the corrected POS total and stay apart from what the store spent (corrected discount plus hosted meals, '
  'per guest), and an estimate makes the money unconfirmed');
select is((select b->'contents' from biz),(select jsonb_build_array(
  jsonb_build_object('label','A','kind','creator_content','reel',true,'first_seen',s+3,'views',900,
    'views_at',((s+5)+time '12:00') at time zone 'America/Vancouver','likes',40,'comments',null,'shares',null,'saves',null,'confirmed',false),
  jsonb_build_object('label','A','kind','creator_content','reel',false,'first_seen',s+6,'views',300,
    'views_at',((s+6)+time '12:00') at time zone 'America/Vancouver','likes',null,'comments',null,'shares',null,'saves',null,'confirmed',true),
  jsonb_build_object('label','B','kind','creator_content','reel',true,'first_seen',s+4,'views',500,
    'views_at',((s+4)+time '13:00') at time zone 'America/Vancouver','likes',null,'comments',null,'shares',null,'saves',null,'confirmed',true),
  jsonb_build_object('label','우리 글 1','kind','our_post','reel',false,'first_seen',s+1,'views',700,
    'views_at',((s+1)+time '12:00') at time zone 'America/Vancouver','likes',null,'comments',null,'shares',null,'saves',null,'confirmed',true)) from d),
  'each link shows its latest live numbers and whether it is a reel; creators are letters in the order they first appeared, our posts are numbered');
select is((select b->'store' from biz),(select jsonb_build_array(
  jsonb_build_object('metric','ig_followers','value',1200,'period_start',s-31,'period_end',s-1,'source','owner','confirmed',true,'before_start',true),
  jsonb_build_object('metric','discount_total_cents','value',40000,'period_start',s,'period_end',s+27,'source','pos','confirmed',true,'before_start',false),
  jsonb_build_object('metric','guest_sales_cents','value',125000,'period_start',s,'period_end',s+27,'source','pos','confirmed',true,'before_start',false),
  jsonb_build_object('metric','hosted_meals_cents','value',30000,'period_start',s,'period_end',s+27,'source','store_report','confirmed',false,'before_start',false)) from d),
  'store numbers are the live ones, and a period ending before the start is a base value');
select is((select b->'people' from biz),'{"reviewed":6,"confirmed":2,"visited":2,"posted":2}'::jsonb,
  'people are head counts only: every creator the board weighed, nobody left out counts as confirmed, and a posted link counts as posted');
select is((select count(*)::int from biz,unnest(array['Alpha Secret','Bravo Secret','Charlie','report.alpha','report.bravo','secret-note','"note"','"handle"',
    '"participation_id"','"minutes"','"alerts"','"id"','candidate','hold','e1950000-','e1980000-','e1990000-','instagram.com','"url"']) s where position(s in b::text)>0),0,
  'no creator name, handle or link, note, row or entry id, minutes, alert or board stage reaches the business');

-- What the admin sees on top: who each letter is, store notes and row ids, our minutes, the whole log and the link without its token.
set local role authenticated;
create temp table adm on commit drop as select public.get_admin_campaign_report('e1930000-0000-0000-0000-000000000001') a;
select throws_ok($$select public.get_admin_campaign_report('e1930000-0000-0000-0000-0000000000ff')$$,'P0001','PARTNERSHIP_NOT_FOUND','an unknown campaign has no report');
reset role;
select is((select array_agg(k order by k) from adm,jsonb_object_keys(a) k),array['ledger','link','report','report_row'],'the admin report has four parts');
select is((select jsonb_agg(jsonb_build_object('label',x->>'label','handle',x->>'handle','entry',x->>'participation_id') order by n) from adm,
    jsonb_array_elements(a->'report'->'contents') with ordinality c(x,n)),
  '[{"label":"A","handle":"report.alpha","entry":"e1950000-0000-0000-0000-000000000001"},{"label":"A","handle":"report.alpha","entry":"e1950000-0000-0000-0000-000000000001"},
    {"label":"B","handle":"report.bravo","entry":"e1950000-0000-0000-0000-000000000002"},{"label":"우리 글 1","handle":null,"entry":null}]'::jsonb,
  'the admin sees who each letter is');
select is((select jsonb_agg(x->>'url' order by n) from adm,jsonb_array_elements(a->'report'->'contents') with ordinality c(x,n)),
  '["https://www.instagram.com/reel/RptReelA1/","https://www.instagram.com/p/RptPostA2/","https://www.instagram.com/reel/RptReelB1/","https://www.instagram.com/p/RptOurs01/"]'::jsonb,
  'and keeps each link');
select is((select jsonb_agg(x->>'note' order by n) from adm,jsonb_array_elements(a->'report'->'store') with ordinality s(x,n)),
  '["secret-note-before","secret-note-pos","",""]'::jsonb,'the admin sees the live store notes');
select is((select a->'report'->'minutes' from adm),'{"total":165,"by_step":{"minutes_setup":90,"minutes_outreach":45,"minutes_report":30}}'::jsonb,
  'our minutes per step and in total');
select is((select (a->'report')-'minutes'-'synced_at'-'contents'-'store' from adm),(select b-'synced_at'-'contents'-'store' from biz),
  'everything else matches what the business sees');
select is((select jsonb_array_length(a->'ledger') from adm),20,'the log lists every row, corrected and voided ones too');
select is((select jsonb_object_agg(right(x->>'id',2),right(x->>'corrected_by',2)) from adm,jsonb_array_elements(a->'ledger') x
    where x->>'corrected_by' is not null),
  (select jsonb_object_agg(right(corrects::text,2),right(id::text,2)) from private.partnership_metrics
    where corrects in ('e1980000-0000-0000-0000-000000000005','e1980000-0000-0000-0000-000000000007','e1980000-0000-0000-0000-000000000009','e1980000-0000-0000-0000-000000000014',
      'e1980000-0000-0000-0000-000000000017')),
  'each corrected or voided row points at the row that replaced it');
select is((select (a->'link')-'created_at' from adm),(select jsonb_build_object('expires_on',today+365,'revoked_at',null) from d),'the live link''s expiry');
select is((select count(*)::int from adm,d where position(d.t3 in a::text)>0 or position(d.h3 in a::text)>0),0,'the admin report never holds the token or its hash');
select is((select a->'report_row'->>'consent' from adm),'anon','and the report row');

-- Day 30: the snapshot is what the business saw, and later numbers no longer change its page.
set local role authenticated;
create temp table fixed on commit drop as select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000001','{"fix":true}') r;
select throws_ok($$select public.save_admin_campaign_report('e1930000-0000-0000-0000-000000000001','{"fix":true}')$$,'P0001','REPORT_ALREADY_FIXED','a fixed report stays fixed');
select throws_ok(format('select public.save_admin_campaign_report(%L,%L)','e1930000-0000-0000-0000-000000000001',(select jsonb_build_object('starts_on',s+1) from d)),
  'P0001','REPORT_ALREADY_FIXED','a fixed report keeps its start date');
select lives_ok($$select public.add_admin_campaign_ledger('e1930000-0000-0000-0000-000000000001','{"subject":"our_post","metric":"views","value":9999,"url":"https://www.instagram.com/p/RptOurs01/","source":"owner"}')$$,
  'numbers can still be added after the fix');
select lives_ok(format('select public.save_admin_campaign_report(%L,%L)','e1930000-0000-0000-0000-000000000001',(select jsonb_build_object('starts_on',s,'lessons','30일 뒤에 다시 보자',
  'consent','open','consent_on',today,'consent_evidence','DM 캡처 · 운영 폴더') from d)),'the same start date again, lessons and permission still save');
reset role;
select is((select jsonb_build_object('starts_on',starts_on,'lessons',lessons,'consent',consent) from private.partnership_reports where campaign_id='e1930000-0000-0000-0000-000000000001'),
  (select jsonb_build_object('starts_on',s,'lessons','30일 뒤에 다시 보자','consent','open') from d),'and they are saved');
select ok((select (r->>'fixed_at') is not null and (r->'fixed')-'synced_at'=(select b-'synced_at' from biz) from fixed),'the snapshot is the business view at the fix');
set local role service_role;
create temp table after on commit drop as select public.event_report_view((select h3 from d)) b;
reset role;
select is((select b-'synced_at'-'fixed_at' from after),(select b-'synced_at'-'fixed_at' from biz),'after the fix the business keeps seeing the fixed numbers');
select is((select (b->>'fixed_at')::timestamptz from after),(select fixed_at from private.partnership_reports where campaign_id='e1930000-0000-0000-0000-000000000001'),
  'with the day it was fixed');
select is((private.campaign_report('e1930000-0000-0000-0000-000000000001',false)->>'views_total')::int,11699,'while the admin report keeps counting');
select is((select count(*)::int from private.partnership_events where action='campaign_report_fixed' and details->>'fixed'='true'),1,'the fix is logged once');

-- A report link stops with its expiry or a deleted business, like the store link.
update private.partnership_campaign_links set expires_on=(select today-1 from d) where token_sha256=(select h3 from d);
select is(public.event_report_view((select h3 from d)),null,'an expired link opens nothing');
update private.partnership_campaign_links set expires_on=(select today+365 from d) where token_sha256=(select h3 from d);
update private.merchants set deleted_at=now() where id='e1920000-0000-0000-0000-000000000001';
select is(public.event_report_view((select h3 from d)),null,'a deleted business''s report closes');
-- Apply links still need an open campaign.
insert into private.partnership_campaign_links(campaign_id,kind,slug,expires_on) values('e1930000-0000-0000-0000-000000000001','apply','report-closed-apply',current_date+5);
update private.merchants set deleted_at=null where id='e1920000-0000-0000-0000-000000000001';
select is(private.event_link_campaign('apply','report-closed-apply'),null,'an apply link of a closed campaign still opens nothing');
select isnt(private.event_link_campaign('report',(select h3 from d)),null,'while its report link does');

-- Who applied: someone the board added counts only once they send the form through the link, on the report and the store page.
insert into private.partnership_apply_settings(campaign_id,visit_dates,time_slots,party_max) select 'e1930000-0000-0000-0000-000000000002',array[today+3],array['18:00'],4 from d;
insert into private.partnership_campaign_links(campaign_id,kind,slug,token_sha256,expires_on) values
 ('e1930000-0000-0000-0000-000000000002','apply','report-open-apply',null,current_date+10),('e1930000-0000-0000-0000-000000000002','store',null,repeat('b',64),current_date+30);
set local role authenticated;
select is(public.add_admin_event_candidates('e1930000-0000-0000-0000-000000000002',array['e1910000-0000-0000-0000-000000000002','e1910000-0000-0000-0000-000000000003',
  'e1910000-0000-0000-0000-000000000004','e1910000-0000-0000-0000-000000000005']::uuid[]),4,'the board adds four candidates to the open campaign');
reset role;
-- Bravo is left as a candidate, Charlie was messaged, Delta was confirmed, and Echo then sends the form through the link.
update private.partnership_participations p set outreach_stage=v.stage,contacted=true
  from (values ('e1910000-0000-0000-0000-000000000003'::uuid,'proposed'),('e1910000-0000-0000-0000-000000000004'::uuid,'confirmed')) v(creator,stage)
  where p.campaign_id='e1930000-0000-0000-0000-000000000002' and p.creator_id=v.creator;
set local role service_role;
select is(public.event_apply('report-open-apply','report.echo',(select jsonb_build_array(jsonb_build_object('date',to_char(today+3,'YYYY-MM-DD'),'time','18:00')) from d),
  2,null,5,'en',null),'{"ok":true,"already":true}'::jsonb,'Echo, already on the board, applies through the link');
reset role;
select is((select jsonb_object_agg(r.display_name,private.event_applicant(p)) from private.partnership_participations p
    join private.partnership_creators r on r.id=p.creator_id where p.campaign_id='e1930000-0000-0000-0000-000000000002'),
  '{"Alpha Secret":false,"Bravo Secret":false,"Charlie Secret":false,"Delta Secret":false,"Echo Secret":true}'::jsonb,
  'only someone who sent the apply form is an applicant; rows an admin or the board added are not, whatever their stage');
select is(private.campaign_report('e1930000-0000-0000-0000-000000000002',true)->'people','{"reviewed":5,"confirmed":1,"visited":0,"posted":0}'::jsonb,
  'the report counts every creator the board weighed, and the confirmed board candidate as confirmed');
set local role service_role;
select is((public.event_store_view(repeat('b',64))->>'applicant_count')::int,1,'the store page counts the one link applicant');
select is((public.event_store_view(repeat('a',64))->>'applicant_count')::int,0,'and nobody on the closed campaign, where nobody used the link');
reset role;

-- Guest sales on the open campaign, whose other money number (hosted meals) is confirmed: an estimate makes the money unconfirmed
-- until the POS total corrects it, and what the store spent never moves with it.
select is(private.campaign_report('e1930000-0000-0000-0000-000000000002',true)->'money','{"discount_total_cents":null,"hosted_meals_cents":15000,"guest_sales_cents":null,
    "store_spend_cents":15000,"per_guest_cents":null,"confirmed":true}'::jsonb,'with no guest sales row the total is empty');
set local role authenticated;
create temp table guest on commit drop as select public.add_admin_campaign_ledger('e1930000-0000-0000-0000-000000000002',jsonb_build_object('subject','store',
  'metric','guest_sales_cents','value',8000,'period_start',today,'period_end',today,'source','store_report','confirmed',false)) r from d;
reset role;
select is(jsonb_build_object('business',private.campaign_report('e1930000-0000-0000-0000-000000000002',true)->'money','admin',private.campaign_report('e1930000-0000-0000-0000-000000000002',false)->'money'),
  jsonb_build_object('business',m,'admin',m),'an estimated guest sales total reaches the business and the admin money, unconfirmed')
  from (select '{"discount_total_cents":null,"hosted_meals_cents":15000,"guest_sales_cents":8000,"store_spend_cents":15000,"per_guest_cents":null,
    "confirmed":false}'::jsonb m) x;
set local role authenticated;
select lives_ok(format('select public.add_admin_campaign_ledger(%L,%L)','e1930000-0000-0000-0000-000000000002',(select jsonb_build_object('corrects',r->>'id','value',9000,'source','pos') from guest)),
  'the POS total corrects the estimate');
reset role;
select is(private.campaign_report('e1930000-0000-0000-0000-000000000002',true)->'money','{"discount_total_cents":null,"hosted_meals_cents":15000,"guest_sales_cents":9000,
    "store_spend_cents":15000,"per_guest_cents":null,"confirmed":true}'::jsonb,'after the correction the total is the POS number, confirmed');
select * from finish();
rollback;
