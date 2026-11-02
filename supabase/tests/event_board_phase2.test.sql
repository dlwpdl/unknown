begin;
set local search_path=public,extensions;
select no_plan();
-- Event board step 2. Runs after both event-link migrations, with and without the admin board's outreach_stage column
-- (scripts/check-event-links.py). The two-session claim race is checked there, on committed rows.
create function pg_temp.board() returns boolean language sql as $$
  select exists(select 1 from information_schema.columns where table_schema='private' and table_name='partnership_participations' and column_name='outreach_stage')
$$;
create function pg_temp.sha(value text) returns text language sql as $$ select encode(sha256(convert_to(value,'UTF8')),'hex') $$;
create function pg_temp.ip(n integer) returns text language sql as $$ select pg_temp.sha('board-ip-'||n) $$;
create temp table today as select (clock_timestamp() at time zone 'America/Vancouver')::date d;

insert into public.cities values('event-board-test','이벤트 보드 검사 도시','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('e2500000-0000-0000-0000-000000000001','event-board-admin@example.test','{"role":"admin"}'),
 ('e2500000-0000-0000-0000-000000000002','event-board-member@example.test','{}'),
 ('e2500000-0000-0000-0000-000000000003','event-board-owner@example.test','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id) values
 ('e2500000-0000-0000-0000-000000000001','보드관리검사','event-board-test'),
 ('e2500000-0000-0000-0000-000000000002','보드회원검사','event-board-test'),
 ('e2500000-0000-0000-0000-000000000003','보드사장검사','event-board-test');
insert into auth.sessions(id,user_id,aal) values('e2560000-0000-0000-0000-000000000001','e2500000-0000-0000-0000-000000000001','aal2');
-- Runs one statement as the administrator (AAL2 session), the way the board calls these.
create function pg_temp.admin(q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims','{"sub":"e2500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"e2560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
  execute 'set local role authenticated';
  execute q into r;
  execute 'reset role';
  return r;
end $$;

-- A business with a public logo, so its apply page opens.
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,avatar_path,owner_id,owner_verified_at) values
 ('e2520000-0000-0000-0000-000000000001','보드 검사 가게','event-board-test','trial','granted','동의 확인','business',
  'e2590000-0000-0000-0000-000000000001/e2520000-0000-0000-0000-000000000001_e2590000-0000-0000-0000-000000000002.webp',
  'e2500000-0000-0000-0000-000000000003',clock_timestamp());
-- The deadline (ends_on) was yesterday: the apply link still takes entries, and they count as late.
insert into private.partnership_campaigns(id,merchant_id,title,status,terms,terms_confirmed,ends_on)
select v.id::uuid,'e2520000-0000-0000-0000-000000000001',v.title,'open','Post one reel',true,d+v.days from today,(values
 ('e2530000-0000-0000-0000-000000000001','Late event',-1),('e2530000-0000-0000-0000-000000000002','Other event',10)) v(id,title,days);
select public.set_event_apply_settings('e2530000-0000-0000-0000-000000000001',array[d+1,d+2],array['18:00'],4,7,'[]') from today;
insert into private.partnership_campaign_links(campaign_id,kind,slug,token_sha256,expires_on)
select 'e2530000-0000-0000-0000-000000000001',v.kind,v.slug,v.token,d+10 from today,(values
 ('apply','late-event',null),('store',null,pg_temp.sha('board-store'))) v(kind,slug,token);
insert into private.partnership_benefits(id,merchant_id,campaign_id,title,audience,status,discount_percent,terms,terms_confirmed,expires_on)
select 'e2550000-0000-0000-0000-000000000001','e2520000-0000-0000-0000-000000000001','e2530000-0000-0000-0000-000000000001',
  'Applicant discount','creators','active',15,'Dine-in only',true,d+20 from today;
insert into private.partnership_creators(id,display_name,city_id,profile_url)
select ('e2510000-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,h,'event-board-test',
  case when h='admin.added' then 'https://www.tiktok.com/@admin.added' else 'https://www.instagram.com/'||h||'/' end
from unnest(array['win.stage','win.group','on.time','reason.out','board.out','admin.added','sent.before','dropped.winner','other.event','scratch'])
  with ordinality x(h,n);
insert into private.partnership_participations(id,campaign_id,creator_id,stage,applied_via,language,applied_at,dm_group,dm_channel,dm_status,dm_sent_at,drop_reason)
select gen_random_uuid(),case when r.display_name='other.event' then 'e2530000-0000-0000-0000-000000000002'::uuid else 'e2530000-0000-0000-0000-000000000001' end,
  r.id,v.stage,v.via,v.lang,case when v.days is not null then clock_timestamp()-make_interval(days=>v.days) end,v.grp,v.channel,v.status,
  case when v.status='sent' then clock_timestamp() end,v.reason
from private.partnership_creators r join (values
 ('win.stage','selected','admin',null,null,null,null,null,null),
 ('win.group','applied','apply_link','en',3,'winner','instagram',null,null),
 ('on.time','applied','apply_link','en',3,null,'instagram',null,null),
 ('reason.out','applied','apply_link','en',3,null,'instagram',null,'Lives in Seattle'),
 ('board.out','applied','admin',null,null,null,null,null,null),
 ('admin.added','applied','admin',null,null,null,null,null,null),
 ('sent.before','applied','admin',null,null,'sorry','instagram','sent',null),
 ('dropped.winner','selected','admin',null,null,null,null,null,'Cancelled the visit'),
 ('other.event','applied','admin',null,null,'discount',null,null,null),
 ('scratch','applied','admin',null,null,null,null,null,null)) v(handle,stage,via,lang,days,grp,channel,status,reason) on v.handle=r.display_name;
do $$ begin
  if pg_temp.board() then
    execute $u$update private.partnership_participations p set outreach_stage='dropped' from private.partnership_creators r
      where r.id=p.creator_id and r.display_name='board.out'$u$;
  end if;
end $$;
create function pg_temp.pid(handle text) returns uuid language sql as $$
  select p.id from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id where r.display_name=handle $$;
create function pg_temp.groups() returns jsonb language sql as $$
  select jsonb_object_agg(r.display_name,p.dm_group) from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
  where p.campaign_id='e2530000-0000-0000-0000-000000000001' $$;
create function pg_temp.lookup(handle text) returns text language sql as $$
  select public.event_store_lookup(pg_temp.sha('board-store'),handle)->>'status' $$;

-- Late entries: a live link takes them after the deadline; a repeat keeps the first entry time.
select is(public.event_apply('late-event','late.one',jsonb_build_array(jsonb_build_object('date',to_char(d+1,'YYYY-MM-DD'),'time','18:00')),2,null,5,'ko',pg_temp.ip(1)),
  '{"ok":true,"already":false}'::jsonb,'past the deadline the apply link still takes an entry') from today;
select is((select jsonb_build_object('via',applied_via,'channel',dm_channel,'language',language,'status',dm_status,'attempts',dm_attempts,'check',needs_check)
  from private.partnership_participations where id=pg_temp.pid('late.one')),
  '{"via":"apply_link","channel":"instagram","language":"ko","status":null,"attempts":0,"check":false}'::jsonb,'an apply-link entry is reached on Instagram');
select is(public.event_apply('late-event','on.time',jsonb_build_array(jsonb_build_object('date',to_char(d+2,'YYYY-MM-DD'),'time','18:00')),1,null,3,'en',pg_temp.ip(1)),
  '{"ok":true,"already":true}'::jsonb,'an on-time applicant sends the form again after the deadline') from today;
select is((select jsonb_build_object('party',party_size,'early',applied_at<clock_timestamp()-interval '2 days') from private.partnership_participations where id=pg_temp.pid('on.time')),
  '{"party":1,"early":true}'::jsonb,'the repeat refreshes the picks but keeps the first entry time');
select is((select jsonb_object_agg(r.display_name,private.event_entry_late(p)) from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id
  where r.display_name in ('late.one','on.time','admin.added')),'{"late.one":true,"on.time":false,"admin.added":false}'::jsonb,
  'late means entered through the link after ends_on; people added by hand are never late');

-- Column rules.
select throws_ok(format('update private.partnership_participations set %s where id=%L',v.change,pg_temp.pid('scratch')),'23514',null,'participation refused: '||v.why)
  from (values ($$drop_reason=''$$,'an empty drop reason'),($$drop_reason=repeat('x',201)$$,'a drop reason over 200'),
  ($$dm_group='maybe'$$,'an unknown DM group'),($$dm_channel='tiktok'$$,'a channel we cannot DM'),
  ($$dm_status='sending',dm_group='sorry',dm_channel='instagram'$$,'an unknown DM status'),
  ($$dm_status='queued'$$,'a queued DM without group and channel'),
  ($$dm_status='sent',dm_group='sorry',dm_channel='instagram'$$,'sent without a sent time'),
  ($$dm_sent_at=now()$$,'a sent time without sent'),
  ($$dm_status='queued',dm_group='sorry',dm_channel='instagram',dm_error='x'$$,'an error note on a DM that did not fail'),
  ($$dm_status='failed',dm_group='sorry',dm_channel='instagram',dm_error=repeat('x',301)$$,'an error note over 300'),
  ($$dm_claimed_at=now()$$,'a lease on a DM that is not queued'),($$dm_attempts=-1$$,'negative tries')) v(change,why);
select throws_ok(format('update private.partnership_participations set needs_check=null where id=%L',pg_temp.pid('scratch')),'23502',null,'needs_check is always true or false');
select throws_ok(format('update private.partnership_creators set %s where id=%L',v.change,'e2510000-0000-0000-0000-000000000010'),'23514',null,'creator refused: '||v.why)
  from (values ('followers_count=-1','negative followers'),('recent_reel_avg_views=-1','negative views'),
  ($$profile_checked_at='infinity'$$,'an endless check time')) v(change,why);
select throws_ok(format('update private.partnership_benefits set %s where id=%L',v.change,'e2550000-0000-0000-0000-000000000001'),'23514',null,'benefit refused: '||v.why)
  from (values ($$weekdays='{}'$$,'no weekdays (null means every day)'),($$weekdays='{0}'$$,'weekday 0'),($$weekdays='{8}'$$,'weekday 8'),
  ($$weekdays='{1,null}'$$,'a missing weekday'),('max_discount_cents=0','a zero cap'),($$checkout_note=repeat('x',201)$$,'a checkout note over 200'),
  ($$checkout_note=' '$$,'a blank checkout note'),('starts_on=expires_on+1','starting after it ends')) v(change,why);
select is((select dine_in_only from private.partnership_benefits where id='e2550000-0000-0000-0000-000000000001'),false,'dine-in only is off unless set');
select throws_ok(format('insert into private.merchant_event_profiles(merchant_id,instagram,ig_location_id,ig_location_name) values(%L,%s)',
  'e2520000-0000-0000-0000-000000000001',v.vals),'23514',null,'event profile refused: '||v.why)
  from (values ($$'Galbi.House',null,null$$,'a handle not written the way Instagram does'),($$'bad handle',null,null$$,'not a handle'),
  ($$null,'12a',null$$,'a place id that is not digits'),($$null,'123',null$$,'a place id without its name'),
  ($$null,'123',repeat('x',121)$$,'a place name over 120')) v(vals,why);
select throws_ok(format('insert into private.partnership_dm_templates(campaign_id,dm_group,language,body,approved_sha256,approved_at) values(%L,%s)',
  'e2530000-0000-0000-0000-000000000002',v.vals),'23514',null,'DM text refused: '||v.why)
  from (values ($$'sorry','fr','Hi',null,null$$,'a language the page does not have'),($$'sorry','en',repeat('x',2001),null,null$$,'a text over 2000'),
  ($$'sorry','en',' Hi',null,null$$,'a text with spaces around it'),
  ($$'sorry','en','Hi',repeat('0',64),now()$$,'an approval of some other text'),
  ($$'sorry','en','Hi',encode(sha256(convert_to('Hi','UTF8')),'hex'),null$$,'an approval without its time')) v(vals,why);
select throws_ok(format('insert into private.partnership_result_posts(campaign_id,status,permalink,media_id,published_at) values(%L,%s)',
  'e2530000-0000-0000-0000-000000000002',v.vals),'23514',null,'results post refused: '||v.why)
  from (values ($$'live',null,null,null$$,'an unknown status'),($$'published',null,null,now()$$,'published without its link'),
  ($$'published','https://example.com/p/abc/','123',now()$$,'a link that is not an Instagram post'),
  ($$'published','https://www.instagram.com/p/abc/','12a',now()$$,'a media id that is not digits'),
  ($$'draft','https://www.instagram.com/p/abc/',null,null$$,'a link on a post not yet published')) v(vals,why);
insert into private.partnership_result_posts(campaign_id) values('e2530000-0000-0000-0000-000000000002');
select throws_ok($$insert into private.partnership_result_posts(campaign_id,status) values('e2530000-0000-0000-0000-000000000002','approved')$$,
  '23505',null,'one open results post per event');

-- Who may call what.
select ok(has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('authenticated',f,'execute'),
  'only service_role may execute '||f) from unnest(array['public.set_creator_profile_stats(uuid,integer,boolean,integer,boolean)',
  'public.claim_event_dms(integer)','public.finish_event_dm(uuid,text,text)','public.set_result_post(uuid,text,text,text)']) f;
select ok(has_function_privilege('authenticated',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('service_role',f,'execute'),
  'only signed-in callers may reach '||f) from unnest(array['public.save_event_benefit_terms(uuid,date,integer,smallint[],boolean,text,timestamptz)',
  'public.save_merchant_event_profile(uuid,text,text,text)','public.set_participation_review(uuid,text,boolean,timestamptz)','public.request_event_result(uuid)',
  'public.save_event_dm_template(uuid,text,text,text)','public.approve_event_dm_template(uuid,text,text,text)','public.queue_event_dms(uuid,uuid[],text)']) f;
select ok(not has_function_privilege(r,'private.event_dm_channel(text)','execute'),r||' cannot execute private.event_dm_channel') from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_table_privilege(r,t,'select') and not has_table_privilege(r,t,'insert') and not has_table_privilege(r,t,'update'),r||' has no access to '||t)
  from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.merchant_event_profiles','private.partnership_dm_templates','private.partnership_result_posts']) t;
select ok((select relrowsecurity from pg_class where oid=t::regclass),'row level security is on for '||t)
  from unnest(array['private.merchant_event_profiles','private.partnership_dm_templates','private.partnership_result_posts']) t;
set local role anon;
select throws_ok($$select public.claim_event_dms(1)$$,'42501',null,'anon cannot take DMs');
select throws_ok($$select public.request_event_result(gen_random_uuid())$$,'42501',null,'anon cannot request results');
reset role;
select set_config('request.jwt.claims','{"sub":"e2500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.claim_event_dms(1)$$,'42501',null,'members cannot take DMs');
select throws_ok($$select public.finish_event_dm(gen_random_uuid(),'sent')$$,'42501',null,'members cannot mark DMs sent');
select throws_ok($$select public.set_creator_profile_stats(gen_random_uuid(),1,false,1,true)$$,'42501',null,'members cannot write profile stats');
select throws_ok($$select public.set_result_post(gen_random_uuid(),'approved')$$,'42501',null,'members cannot move the results post');
reset role;
-- Board functions refuse anyone who is not an administrator with a live AAL2 session, before reading anything.
create temp table board_calls(name text,call text);
insert into board_calls values
 ('save_event_benefit_terms',$$select public.save_event_benefit_terms(gen_random_uuid(),null,null,null,false,null,now())$$),
 ('save_merchant_event_profile',$$select public.save_merchant_event_profile(gen_random_uuid(),'x',null,null)$$),
 ('set_participation_review',$$select public.set_participation_review(gen_random_uuid(),null,false,now())$$),
 ('request_event_result',$$select public.request_event_result(gen_random_uuid())$$),
 ('save_event_dm_template',$$select public.save_event_dm_template(gen_random_uuid(),'sorry','en','Hi')$$),
 ('approve_event_dm_template',$$select public.approve_event_dm_template(gen_random_uuid(),'sorry','en',repeat('0',64))$$),
 ('queue_event_dms',$$select public.queue_event_dms(gen_random_uuid(),array[gen_random_uuid()],'sorry')$$);
grant select on board_calls to authenticated;
select set_config('request.jwt.claims','{"sub":"e2500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(call,'P0001','ADMIN_REQUIRED','a member with a forged admin claim cannot call '||name) from board_calls;
reset role;
select set_config('request.jwt.claims','{"sub":"e2500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"e2560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(call,'P0001','ADMIN_REQUIRED','an AAL1 administrator cannot call '||name) from board_calls;
reset role;

-- The business's event profile: one place for its handle and place tag; the apply page reads the handle.
select is(pg_temp.admin($$select public.save_merchant_event_profile('e2520000-0000-0000-0000-000000000001',' @Galbi.House ',' 1234567 ','  Galbi House Vancouver ')$$),
  'e2520000-0000-0000-0000-000000000001','the administrator saves the event profile');
select is((select to_jsonb(e)-'updated_at'-'merchant_id' from private.merchant_event_profiles e where merchant_id='e2520000-0000-0000-0000-000000000001'),
  '{"instagram":"galbi.house","ig_location_id":"1234567","ig_location_name":"Galbi House Vancouver"}'::jsonb,'stored the way Instagram writes it, trimmed');
select is(public.event_apply_info('late-event')->>'instagram','galbi.house','the apply page names the business handle');
select is((select count(*) from private.partnership_events where action='merchant_event_profile_saved' and resource_id='e2520000-0000-0000-0000-000000000001'),1::bigint,'the change is logged');
select throws_ok(format('select pg_temp.admin(%L)',v.call),'P0001',v.code,'event profile refused: '||v.why) from (values
 ($$select public.save_merchant_event_profile('e2520000-0000-0000-0000-000000000001','bad handle',null,null)$$,'INVALID_PARTNERSHIP','not a handle'),
 ($$select public.save_merchant_event_profile('e2520000-0000-0000-0000-000000000001','galbi','12a','Galbi')$$,'INVALID_PARTNERSHIP','a place id that is not digits'),
 ($$select public.save_merchant_event_profile('e2520000-0000-0000-0000-000000000001','galbi','123','')$$,'INVALID_PARTNERSHIP','a place id without its name'),
 ($$select public.save_merchant_event_profile(gen_random_uuid(),'galbi',null,null)$$,'PARTNERSHIP_NOT_FOUND','an unknown business')) v(call,code,why);
select is(pg_temp.admin($$select public.save_merchant_event_profile('e2520000-0000-0000-0000-000000000001',' ','','')$$),'e2520000-0000-0000-0000-000000000001','blank values clear the profile');
select is(public.event_apply_info('late-event')->>'instagram',null,'without a handle the page names the business again');

-- Benefit conditions, shared by the DMs, the results post and the store page.
select is(pg_temp.admin(format('select public.save_event_benefit_terms(%L,%L,2500,%L,true,%L,%L)','e2550000-0000-0000-0000-000000000001',d+1,'{5,1,5}',
  '  Show the Instagram you applied with  ',(select updated_at from private.partnership_benefits where id='e2550000-0000-0000-0000-000000000001'))),
  'e2550000-0000-0000-0000-000000000001','the administrator saves the benefit conditions') from today;
select is((select jsonb_build_object('starts',starts_on=d+1,'cap',max_discount_cents,'days',weekdays,'dine_in',dine_in_only,'note',checkout_note)
  from private.partnership_benefits,today where id='e2550000-0000-0000-0000-000000000001'),
  '{"starts":true,"cap":2500,"days":[1,5],"dine_in":true,"note":"Show the Instagram you applied with"}'::jsonb,'weekdays are sorted without repeats and the note trimmed');
select is((select b-'title'-'discount_percent'-'expires_on'-'terms'-'starts_on' from jsonb_array_elements(public.event_store_view(pg_temp.sha('board-store'))->'benefits') b),
  '{"max_discount_cents":2500,"weekdays":[1,5],"dine_in_only":true,"checkout_note":"Show the Instagram you applied with"}'::jsonb,'the store page shows the same conditions');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.save_event_benefit_terms(%L,null,null,null,false,null,%L)',
  'e2550000-0000-0000-0000-000000000001','2000-01-01 00:00+00')),'P0001','PARTNERSHIP_CHANGED','a stale form does not overwrite newer conditions');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.save_event_benefit_terms(%L,%s,null,%L,false,%L,%L)',
  'e2550000-0000-0000-0000-000000000001',v.starts,v.days,v.note,(select updated_at from private.partnership_benefits where id='e2550000-0000-0000-0000-000000000001'))),
  'P0001','INVALID_PARTNERSHIP','benefit conditions refused: '||v.why) from (values
 ('null','{0}','','weekday 0'),('null','{1,null}','','a missing weekday'),('null',null,repeat('x',201),'a checkout note over 200'),
 ($$current_date+365$$,null,'','starting after the benefit ends')) v(starts,days,note,why);
select is(pg_temp.admin(format('select public.save_event_benefit_terms(%L,null,null,%L,false,%L,%L)','e2550000-0000-0000-0000-000000000001','{}','',
  (select updated_at from private.partnership_benefits where id='e2550000-0000-0000-0000-000000000001'))),'e2550000-0000-0000-0000-000000000001','conditions can be cleared');
select is((select jsonb_build_object('days',weekdays,'note',checkout_note,'dine_in',dine_in_only) from private.partnership_benefits where id='e2550000-0000-0000-0000-000000000001'),
  '{"days":null,"note":null,"dine_in":false}'::jsonb,'no weekdays means every day');
select is((select count(*) from private.partnership_events where action='benefit_terms_saved' and resource_id='e2550000-0000-0000-0000-000000000001'),2::bigint,'each save is logged');

-- Leaving someone out with a reason, and the "needs a look" flag.
select is(pg_temp.admin(format('select public.set_participation_review(%L,%L,true,%L)',pg_temp.pid('scratch'),'  Not in Vancouver  ',
  (select updated_at from private.partnership_participations where id=pg_temp.pid('scratch')))),pg_temp.pid('scratch')::text,'the administrator records a reason');
select is((select jsonb_build_object('reason',drop_reason,'check',needs_check) from private.partnership_participations where id=pg_temp.pid('scratch')),
  '{"reason":"Not in Vancouver","check":true}'::jsonb,'reason trimmed, flag set');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.set_participation_review(%L,null,false,%L)',pg_temp.pid('scratch'),'2000-01-01 00:00+00')),
  'P0001','PARTNERSHIP_CHANGED','a stale board does not overwrite a newer review');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.set_participation_review(%L,%L,false,now())',pg_temp.pid('scratch'),repeat('x',201))),
  'P0001','INVALID_PARTNERSHIP','a reason over 200 is refused');
select is((select details from private.partnership_events where action='participation_reviewed' and resource_id=pg_temp.pid('scratch')),
  jsonb_build_object('kind','participation','campaign_id','e2530000-0000-0000-0000-000000000001','creator_id','e2510000-0000-0000-0000-000000000010',
    'drop_reason','Not in Vancouver','needs_check',true),'the review is logged');
delete from private.partnership_participations where id=pg_temp.pid('scratch');

-- "결과 발표": a draft results post and everyone's DM group.
create temp table post as select pg_temp.admin($$select public.request_event_result('e2530000-0000-0000-0000-000000000001')$$)::uuid id;
select is((select status from private.partnership_result_posts where id=(select id from post)),'draft','a draft results post is made');
select is(pg_temp.groups(),jsonb_build_object('win.stage','winner','win.group','winner','on.time','discount','late.one','sorry','reason.out',null,
  'board.out',case when pg_temp.board() then null else 'discount' end,'admin.added','discount','sent.before','sorry','dropped.winner',null),
  'winners by stage or board group; left out get none; on time gets the discount, late gets sorry; a sent DM keeps its group');
select is((select details->'groups' from private.partnership_events where action='event_result_grouped' and resource_id='e2530000-0000-0000-0000-000000000001'),
  (select jsonb_object_agg(g,n) from (select coalesce(dm_group,'none') g,count(*) n from private.partnership_participations
    where campaign_id='e2530000-0000-0000-0000-000000000001' group by 1) x),'the grouping is logged with its counts');
select is(jsonb_build_object('win',pg_temp.lookup('win.stage'),'dropped_winner',pg_temp.lookup('dropped.winner'),'on_time',pg_temp.lookup('on.time'),
  'late',pg_temp.lookup('late.one'),'reason',pg_temp.lookup('reason.out')),
  '{"win":"winner","dropped_winner":"none","on_time":"discount","late":"none","reason":"none"}'::jsonb,'the store hears the same verdict as the DM');
select is(pg_temp.admin($$select public.request_event_result('e2530000-0000-0000-0000-000000000001')$$)::uuid,(select id from post),'asking again reuses the open draft');
select is((select count(*) from private.partnership_result_posts where campaign_id='e2530000-0000-0000-0000-000000000001'),1::bigint,'and makes no second post');
select public.set_event_apply_settings('e2530000-0000-0000-0000-000000000001',array[d+1,d+2],array['18:00'],4,7,'[]',true) from today;
select pg_temp.admin($$select public.request_event_result('e2530000-0000-0000-0000-000000000001')$$);
select is(pg_temp.groups()->>'late.one','discount','when the event allows it, late entries get the discount');
select is(pg_temp.lookup('late.one'),'discount','and the store agrees');
select throws_ok($$select pg_temp.admin('select public.request_event_result(gen_random_uuid())')$$,'P0001','PARTNERSHIP_NOT_FOUND','an unknown event is refused');

-- DM texts: saving clears an approval unless the text is unchanged; approval names the exact text.
create temp table sha as select pg_temp.admin($$select public.save_event_dm_template('e2530000-0000-0000-0000-000000000001','discount','en','  Thanks for applying! Show this at the counter.  ')$$) en;
select is((select en from sha),pg_temp.sha('Thanks for applying! Show this at the counter.'),'saving returns the hash of the trimmed text');
select is((select approved_sha256 from private.partnership_dm_templates where dm_group='discount' and language='en'),null,'a new text is not approved');
-- Not approved yet: nothing can be queued.
select throws_ok(format('select pg_temp.admin(%L)',format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',
  array[pg_temp.pid('on.time'),pg_temp.pid('late.one'),pg_temp.pid('admin.added')],'discount')),'P0001','DM_TEMPLATE_NOT_APPROVED','no DMs queue without an approved text');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.approve_event_dm_template(%L,%L,%L,%L)','e2530000-0000-0000-0000-000000000001','discount','en',pg_temp.sha('Other text'))),
  'P0001','PARTNERSHIP_CHANGED','approving a text other than the saved one is refused');
select is(pg_temp.admin(format('select public.approve_event_dm_template(%L,%L,%L,%L)','e2530000-0000-0000-0000-000000000001','discount','en',(select en from sha))),
  (select en from sha),'the confirmed text is approved');
select pg_temp.admin($$select public.save_event_dm_template('e2530000-0000-0000-0000-000000000001','discount','en','Thanks for applying! Show this at the counter.')$$);
select is((select approved_sha256 from private.partnership_dm_templates where dm_group='discount' and language='en'),(select en from sha),'saving the same text keeps the approval');
-- late.one wrote in Korean; there is no approved Korean text yet.
select throws_ok(format('select pg_temp.admin(%L)',format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',
  array[pg_temp.pid('on.time'),pg_temp.pid('late.one'),pg_temp.pid('admin.added')],'discount')),'P0001','DM_TEMPLATE_NOT_APPROVED','each person needs an approved text in their language');
select pg_temp.admin(format('select public.approve_event_dm_template(%L,%L,%L,%L)','e2530000-0000-0000-0000-000000000001','discount','ko',
  pg_temp.admin($$select public.save_event_dm_template('e2530000-0000-0000-0000-000000000001','discount','ko','신청해 주셔서 고마워요. 계산할 때 보여 주세요.')$$)));
select throws_ok(format('select pg_temp.admin(%L)',format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',array[pg_temp.pid('win.stage')],'discount')),
  'P0001','PARTNERSHIP_CHANGED','someone outside the group is refused');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',array[pg_temp.pid('other.event')],'discount')),
  'P0001','PARTNERSHIP_NOT_FOUND','someone from another event is refused');
select throws_ok(format('select pg_temp.admin(%L)',format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001','{}','discount')),
  'P0001','INVALID_PARTNERSHIP','an empty pick is refused');
select is(pg_temp.admin(format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',
  array[pg_temp.pid('on.time'),pg_temp.pid('late.one'),pg_temp.pid('admin.added')],'discount'))::jsonb,'{"queued":2,"skipped":1}'::jsonb,
  'two queued; the TikTok-only person has nowhere to DM and is skipped');
select is((select jsonb_object_agg(r.display_name,jsonb_build_object('status',p.dm_status,'channel',p.dm_channel,'attempts',p.dm_attempts))
  from private.partnership_participations p join private.partnership_creators r on r.id=p.creator_id where r.display_name in ('on.time','late.one','admin.added')),
  '{"on.time":{"status":"queued","channel":"instagram","attempts":0},"late.one":{"status":"queued","channel":"instagram","attempts":0},"admin.added":{"status":null,"channel":null,"attempts":0}}'::jsonb,
  'queued rows wait for the sender');
select is((select count(*) from private.partnership_events where action='participation_dm_queued'),2::bigint,'each queued DM is logged');
select is(pg_temp.admin(format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',array[pg_temp.pid('sent.before')],'sorry'))::jsonb,
  '{"queued":0,"skipped":1}'::jsonb,'someone already sent a DM is skipped');
-- Rows already queued or sent keep their group when results are asked for again.
update private.partnership_benefits set status='paused' where id='e2550000-0000-0000-0000-000000000001';
select pg_temp.admin($$select public.request_event_result('e2530000-0000-0000-0000-000000000001')$$);
select is(pg_temp.groups()-'win.stage'-'win.group'-'reason.out'-'dropped.winner'-'board.out',
  '{"on.time":"discount","late.one":"discount","admin.added":"sorry","sent.before":"sorry"}'::jsonb,
  'without an active creator benefit the rest get sorry, while queued and sent DMs keep theirs');
update private.partnership_benefits set status='active' where id='e2550000-0000-0000-0000-000000000001';

-- The sender: claims lease rows, so the same DM is not handed out twice.
select throws_ok($$select public.claim_event_dms(0)$$,'P0001','INVALID_EVENT_DM','a claim takes 1 to 20');
select throws_ok($$select public.claim_event_dms(21)$$,'P0001','INVALID_EVENT_DM','and no more than 20');
create temp table first_claim as select public.claim_event_dms(1) j;
select is(jsonb_array_length((select j from first_claim)),1,'one DM handed out');
select is((select array_agg(k order by k) from jsonb_object_keys((select j->0 from first_claim)) k),
  array['attempt','body','body_sha256','campaign_id','creator_id','display_name','dm_channel','dm_group','language','participation_id','profile_url'],'with what the sender needs');
select is((select jsonb_build_object('attempt',j->0->'attempt','group',j->0->>'dm_group','approved',j->0->>'body_sha256'=pg_temp.sha(j->0->>'body')) from first_claim),
  '{"attempt":1,"group":"discount","approved":true}'::jsonb,'the approved text in the person''s language, first try');
create temp table second_claim as select public.claim_event_dms(20) j;
select is(jsonb_array_length((select j from second_claim)),1,'the next claim gets the other DM');
select isnt((select j->0->>'participation_id' from second_claim),(select j->0->>'participation_id' from first_claim),'never the same one');
select is(public.claim_event_dms(20),'[]'::jsonb,'claimed DMs are not handed out again');
select is(public.finish_event_dm((select (j->0->>'participation_id')::uuid from first_claim),'sent'),true,'the sender reports a sent DM');
select is((select jsonb_build_object('status',dm_status,'sent',dm_sent_at is not null,'lease',dm_claimed_at) from private.partnership_participations
  where id=(select (j->0->>'participation_id')::uuid from first_claim)),'{"status":"sent","sent":true,"lease":null}'::jsonb,'sent with its time');
select is(public.finish_event_dm((select (j->0->>'participation_id')::uuid from first_claim),'sent'),false,'a DM that is not out with a sender cannot be finished again');
select throws_ok(format('select public.finish_event_dm(%L,%L,%L)',(select j->0->>'participation_id' from second_claim),v.status,v.note),'P0001','INVALID_EVENT_DM','finish refused: '||v.why)
  from (values ('failed',null,'failed without a note'),('sent','oops','a note on a sent DM'),('queued',null,'not a result'),('failed',repeat('x',301),'a note over 300')) v(status,note,why);
-- A lost sender's lease runs out and the DM is handed out again with the try counted.
update private.partnership_participations set dm_claimed_at=dm_claimed_at-interval '16 minutes' where id=(select (j->0->>'participation_id')::uuid from second_claim);
select is((select jsonb_build_object('n',jsonb_array_length(j),'attempt',j->0->'attempt') from (select public.claim_event_dms(20) j) x),'{"n":1,"attempt":2}'::jsonb,
  'after 15 minutes an unfinished DM is handed out again');
-- Changing the text pulls the approval, and queued DMs wait for the new one.
select pg_temp.admin(format('select public.save_event_dm_template(%L,%L,%L,%L)','e2530000-0000-0000-0000-000000000001','discount',
  (select j->0->>'language' from second_claim),'New text'));
update private.partnership_participations set dm_claimed_at=dm_claimed_at-interval '16 minutes' where id=(select (j->0->>'participation_id')::uuid from second_claim);
select is(public.claim_event_dms(20),'[]'::jsonb,'an edited text is not sent until it is approved again');
select pg_temp.admin(format('select public.approve_event_dm_template(%L,%L,%L,%L)','e2530000-0000-0000-0000-000000000001','discount',
  (select j->0->>'language' from second_claim),pg_temp.sha('New text')));
select is((select jsonb_build_object('body',j->0->>'body','attempt',j->0->'attempt') from (select public.claim_event_dms(20) j) x),'{"body":"New text","attempt":3}'::jsonb,
  'once approved again the new text goes out');
select is(public.finish_event_dm((select (j->0->>'participation_id')::uuid from second_claim),'failed','  Message request limit  '),true,'the sender reports a failure');
select is((select jsonb_build_object('status',dm_status,'error',dm_error,'sent',dm_sent_at) from private.partnership_participations
  where id=(select (j->0->>'participation_id')::uuid from second_claim)),'{"status":"failed","error":"Message request limit","sent":null}'::jsonb,'failed with its note');
select is(pg_temp.admin(format('select public.queue_event_dms(%L,%L,%L)','e2530000-0000-0000-0000-000000000001',array[(select j->0->>'participation_id' from second_claim)],'discount'))::jsonb,
  '{"queued":1,"skipped":0}'::jsonb,'a failed DM can be queued again');
select is((select jsonb_build_object('status',dm_status,'error',dm_error,'attempts',dm_attempts) from private.partnership_participations
  where id=(select (j->0->>'participation_id')::uuid from second_claim)),'{"status":"queued","error":null,"attempts":0}'::jsonb,'with a fresh try count');
-- Three tries without a result: marked failed for the board instead of retried forever.
update private.partnership_participations set dm_attempts=3,dm_claimed_at=clock_timestamp()-interval '16 minutes' where id=(select (j->0->>'participation_id')::uuid from second_claim);
select is(public.claim_event_dms(20),'[]'::jsonb,'a DM out of tries is not handed out');
select is((select jsonb_build_object('status',dm_status,'error',dm_error,'lease',dm_claimed_at) from private.partnership_participations
  where id=(select (j->0->>'participation_id')::uuid from second_claim)),'{"status":"failed","error":"No result after 3 tries","lease":null}'::jsonb,
  'it goes to the board''s check column');
select is((select count(*) from private.partnership_events where action='participation_dm_finished'),3::bigint,'every outcome is logged');

-- Profile stats from the discovery automation.
select is(public.set_creator_profile_stats('e2510000-0000-0000-0000-000000000003',1520,false,4300,true),true,'profile stats are saved');
select is((select jsonb_build_object('followers',followers_count,'private',is_private,'views',recent_reel_avg_views,'korean',uses_korean,'checked',profile_checked_at is not null)
  from private.partnership_creators where id='e2510000-0000-0000-0000-000000000003'),'{"followers":1520,"private":false,"views":4300,"korean":true,"checked":true}'::jsonb,
  'with the time they were checked');
select is(public.set_creator_profile_stats(gen_random_uuid(),1,false,1,false),false,'an unknown creator changes nothing');
select throws_ok($$select public.set_creator_profile_stats('e2510000-0000-0000-0000-000000000003',-1,false,1,false)$$,'23514',null,'negative followers are refused');
select is((select count(*) from private.partnership_events where action='creator_profile_checked'),1::bigint,'the check is logged');

-- The results post: draft → approved → published, or failed and tried again.
select throws_ok(format('select public.set_result_post(%L,%L)',(select id from post),'published'),'P0001','INVALID_EVENT_RESULT','a draft cannot be published before approval');
select is(public.set_result_post((select id from post),'approved'),true,'the confirmed draft is approved');
select throws_ok(format('select public.set_result_post(%L,%L)',(select id from post),'published'),'23514',null,'published needs its link and media id');
select is(public.set_result_post((select id from post),'failed'),true,'a failed publish is recorded');
select is(public.set_result_post((select id from post),'published','https://www.instagram.com/p/DAbc_12-x/','17890000000000001'),true,'then the post is published');
select is((select jsonb_build_object('status',status,'link',permalink,'media',media_id,'at',published_at is not null) from private.partnership_result_posts where id=(select id from post)),
  '{"status":"published","link":"https://www.instagram.com/p/DAbc_12-x/","media":"17890000000000001","at":true}'::jsonb,'with its link, media id and time');
select throws_ok(format('select public.set_result_post(%L,%L)',(select id from post),'failed'),'P0001','INVALID_EVENT_RESULT','a published post stays published');
select throws_ok($$select public.set_result_post(gen_random_uuid(),'approved')$$,'P0001','INVALID_EVENT_RESULT','an unknown post is refused');
select is((select array_agg(action order by id) from private.partnership_events where resource_id=(select id from post)),
  array['result_post_requested','result_post_approved','result_post_failed','result_post_published'],'every step is logged');
select isnt(pg_temp.admin($$select public.request_event_result('e2530000-0000-0000-0000-000000000001')$$)::uuid,(select id from post),'after publishing, a new request starts a new draft');
select * from finish();
rollback;
