begin;
set local search_path=public,extensions;
select no_plan();
-- Runs with and without the admin board's outreach_stage column (scripts/check-event-links.py runs both).
create function pg_temp.board() returns boolean language sql as $$
  select exists(select 1 from information_schema.columns where table_schema='private' and table_name='partnership_participations' and column_name='outreach_stage')
$$;
create function pg_temp.sha(value text) returns text language sql as $$ select encode(sha256(convert_to(value,'UTF8')),'hex') $$;
create function pg_temp.ip(n integer) returns text language sql as $$ select pg_temp.sha('ip-'||n) $$;

insert into public.cities values('event-link-test','이벤트 링크 검사 도시','BC','America/Vancouver',true);
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind) values
 ('e1520000-0000-0000-0000-000000000001','링크 검사 가게','event-link-test','trial','granted','동의 확인','business');
create temp table today as select (clock_timestamp() at time zone 'America/Vancouver')::date d;
insert into private.partnership_campaigns(id,merchant_id,title,status,terms,terms_confirmed,ends_on,deadline_note)
select v.id::uuid,'e1520000-0000-0000-0000-000000000001',v.title,v.status,'Post one reel',true,d+v.days,'Apply by Friday' from today,(values
 ('e1530000-0000-0000-0000-000000000001','Open event','open',10),
 ('e1530000-0000-0000-0000-000000000002','Closed event','closed',10),
 ('e1530000-0000-0000-0000-000000000003','Ended event','open',-1),
 ('e1530000-0000-0000-0000-000000000004','Draft event','draft',10),
 ('e1530000-0000-0000-0000-000000000005','No settings event','open',10)) v(id,title,status,days);
-- A visit slot `days` from today; pg_temp.apply is a valid entry (first choice tomorrow 18:00, two people, no allergies, reel in 5 days).
create function pg_temp.pick(days integer,at text) returns jsonb language sql as $$
  select jsonb_build_object('date',to_char((select d from today)+days,'YYYY-MM-DD'),'time',at) $$;
create function pg_temp.apply(slug text,handle text,ip integer) returns jsonb language sql as $$
  select public.event_apply(slug,handle,jsonb_build_array(pg_temp.pick(1,'18:00')),2,null,5,'en',pg_temp.ip(ip)) $$;
-- Settings go through the script's RPC: dates and times come back sorted without repeats, yesterday included to see it drop off.
select public.set_event_apply_settings(v.id::uuid,array[d+2,d+1,d+2,d-1],array['19:00','18:00','19:00'],4,7,
  '[{"key":"meal","covered":true,"note_en":"Dinner for two","note_ko":"2인 식사"},{"key":"parking","covered":false}]',' @Galbi.House ') from today,(values
 ('e1530000-0000-0000-0000-000000000001'),('e1530000-0000-0000-0000-000000000002'),('e1530000-0000-0000-0000-000000000003'),
 ('e1530000-0000-0000-0000-000000000004')) v(id);
select is((select jsonb_build_object('dates',visit_dates,'times',time_slots,'instagram',instagram) from private.partnership_apply_settings where campaign_id='e1530000-0000-0000-0000-000000000001'),
  (select jsonb_build_object('dates',array[d-1,d+1,d+2],'times',array['18:00','19:00'],'instagram','galbi.house') from today),'settings are stored sorted without repeats, the handle as Instagram writes it');
select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005',array[current_date],array['18:00'],2);
select is((select jsonb_build_object('reel',reel_days_max,'support',support,'instagram',instagram) from private.partnership_apply_settings where campaign_id='e1530000-0000-0000-0000-000000000005'),
  '{"reel":7,"support":[],"instagram":null}'::jsonb,'a Reel is due within 7 days unless set shorter');
delete from private.partnership_apply_settings where campaign_id='e1530000-0000-0000-0000-000000000005';
select throws_ok(format($$select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005',array[current_date],array[%L],%s,%s,%L)$$,v.at,v.party,v.reel,v.support),
  v.code,null,'settings refused: '||v.why) from (values
 ('18:00',11,7,'[]','23514','eleven people'),('18:00',4,0,'[]','23514','reel within zero days'),('18:00',4,8,'[]','23514','reel later than 7 days'),
 ('25:00',4,7,'[]','23514','a time that does not exist'),('6pm',4,7,'[]','23514','a time not written HH:MM'),
 ('18:00',4,7,'[{"key":"spa","covered":true}]','23514','an item the page has no label for'),
 ('18:00',4,7,'[{"key":"meal","covered":true},{"key":"meal","covered":false}]','23514','the same item twice'),
 ('18:00',4,7,'[{"key":"meal","covered":"yes"}]','23514','covered that is not true or false'),
 ('18:00',4,7,'[{"key":"meal","covered":true,"price":20}]','23514','an extra field'),
 ('18:00',4,7,'[{"key":"meal","covered":true,"note_en":7}]','23514','a note that is not text'),
 ('18:00',4,7,'["meal"]','23514','an item that is not an object'),('18:00',4,7,'{"key":"meal"}','23514','support that is not a list')) v(at,party,reel,support,code,why);
select throws_ok($$select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005','{2030-01-01}','{18:00}',4,7,'[]','not a handle')$$,'23514',null,'settings refused: a business handle Instagram would not accept');
select throws_ok($$select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005','{}','{18:00}',4,7,'[]')$$,'23502',null,'settings refused: no visit dates');
select throws_ok($$select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005','{2030-01-01}','{}',4,7,'[]')$$,'23502',null,'settings refused: no times');
select is((select count(*) from private.partnership_apply_settings where campaign_id='e1530000-0000-0000-0000-000000000005'),0::bigint,'refused settings write nothing');
insert into private.partnership_campaign_links(campaign_id,kind,slug,token_sha256,expires_on,revoked_at)
select v.campaign::uuid,v.kind,v.slug,case when v.token<>'' then pg_temp.sha(v.token) end,d+v.days,case when v.revoked then clock_timestamp() end from today,(values
 ('e1530000-0000-0000-0000-000000000001','apply','open-event','',10,false),
 ('e1530000-0000-0000-0000-000000000001','apply','expired-link','',-1,false),
 ('e1530000-0000-0000-0000-000000000001','apply','soon-link','',3,false),
 ('e1530000-0000-0000-0000-000000000001','apply','revoked-link','',10,true),
 ('e1530000-0000-0000-0000-000000000002','apply','closed-event','',10,false),
 ('e1530000-0000-0000-0000-000000000003','apply','ended-event','',10,false),
 ('e1530000-0000-0000-0000-000000000004','apply','draft-event','',10,false),
 ('e1530000-0000-0000-0000-000000000005','apply','no-settings','',10,false),
 ('e1530000-0000-0000-0000-000000000001','store',null,'good-token',10,false),
 ('e1530000-0000-0000-0000-000000000001','store',null,'expired-token',-1,false),
 ('e1530000-0000-0000-0000-000000000001','store',null,'revoked-token',10,true),
 ('e1530000-0000-0000-0000-000000000002','store',null,'closed-store',10,false)) v(campaign,kind,slug,token,days,revoked);

select throws_ok($$insert into private.partnership_campaign_links(campaign_id,kind,slug,token_sha256,expires_on) values('e1530000-0000-0000-0000-000000000001','store','with-slug',pg_temp.sha('x'),current_date)$$,'23514',null,'a store link cannot also carry a public slug');
select throws_ok($$insert into private.partnership_campaign_links(campaign_id,kind,token_sha256,expires_on) values('e1530000-0000-0000-0000-000000000001','store','raw-token',current_date)$$,'23514',null,'only a sha256 hex digest is stored for a store link');

-- Nobody but the edge function's service role may call these.
select ok(has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute') and not has_function_privilege('authenticated',f,'execute'),
  'only service_role may execute '||f) from unnest(array['public.event_apply_info(text)','public.event_apply(text,text,jsonb,integer,text,integer,text,text)','public.event_store_view(text)',
  'public.event_store_lookup(text,text)','public.create_event_link(uuid,text,text,text,date)',
  'public.set_event_apply_settings(uuid,date[],text[],integer,integer,jsonb,text)','public.revoke_event_link(uuid)']) f;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot execute '||f) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.event_handle(text)','private.event_link_campaign(text,text)','private.event_winner(private.partnership_participations)',
    'private.event_support_ok(jsonb)','private.event_slots_ok(jsonb,date[],text[],date)']) f;
select ok(not has_table_privilege(r,t,'select') and not has_table_privilege(r,t,'insert'),r||' has no access to '||t) from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['private.partnership_campaign_links','private.partnership_apply_attempts','private.partnership_apply_settings']) t;
select ok((select relrowsecurity from pg_class where oid=t::regclass),'row level security is on for '||t)
  from unnest(array['private.partnership_campaign_links','private.partnership_apply_attempts','private.partnership_apply_settings']) t;
set local role anon;
select throws_ok($$select public.event_apply_info('open-event')$$,'42501',null,'anon cannot read apply info');
select throws_ok($$select public.event_apply('open-event','someone','[]',1,null,1,'en',pg_temp.ip(1))$$,'42501',null,'anon cannot apply directly');
select throws_ok($$select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005','{2030-01-01}','{18:00}',4,7,'[]')$$,'42501',null,'anon cannot change settings');
select throws_ok($$select public.event_store_view(pg_temp.sha('good-token'))$$,'42501',null,'anon cannot open the store view');
select throws_ok($$select public.event_store_lookup(pg_temp.sha('good-token'),'someone')$$,'42501',null,'anon cannot look up a handle');
select throws_ok($$select public.create_event_link('e1530000-0000-0000-0000-000000000001','apply','anon-made',null,current_date)$$,'42501',null,'anon cannot make links');
select throws_ok($$select * from private.partnership_campaign_links$$,'42501',null,'anon cannot read links');
reset role;
set local role authenticated;
select throws_ok($$select public.event_apply_info('open-event')$$,'42501',null,'members cannot read apply info');
select throws_ok($$select public.event_apply('open-event','someone','[]',1,null,1,'en',pg_temp.ip(1))$$,'42501',null,'members cannot apply directly');
select throws_ok($$select public.event_store_view(pg_temp.sha('good-token'))$$,'42501',null,'members cannot open the store view');
select throws_ok($$select public.event_store_lookup(pg_temp.sha('good-token'),'someone')$$,'42501',null,'members cannot look up a handle');
select throws_ok($$select public.revoke_event_link(gen_random_uuid())$$,'42501',null,'members cannot revoke links');
reset role;

-- The page always shows the business's real logo: without a public one there is no apply page and no new apply link.
select is(public.event_apply_info('open-event'),null,'a business without a logo has no apply page');
select throws_ok($$select public.create_event_link('e1530000-0000-0000-0000-000000000001','apply','no-logo-link',null,current_date+3)$$,
  'P0001','BUSINESS_LOGO_REQUIRED','no apply link without a business logo');
select isnt(public.create_event_link('e1530000-0000-0000-0000-000000000001','store',null,pg_temp.sha('logo-free-store'),current_date+3),null,
  'a store link does not need the logo');
update private.merchants set avatar_path='e1590000-0000-0000-0000-000000000001/e1520000-0000-0000-0000-000000000001_e1590000-0000-0000-0000-000000000002.webp'
  where id='e1520000-0000-0000-0000-000000000001';
select is(public.event_apply_info('open-event'),null,'a logo still hides while the business profile is not public');
select throws_ok($$select public.create_event_link('e1530000-0000-0000-0000-000000000001','apply','no-logo-link',null,current_date+3)$$,
  'P0001','BUSINESS_LOGO_REQUIRED','a logo nobody can see does not count');
-- A verified, enabled owner makes the business profile public, the same rule the business profile page uses.
insert into auth.users(id,email,raw_app_meta_data) values('e1500000-0000-0000-0000-000000000001','event-link-owner@example.test','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id) values('e1500000-0000-0000-0000-000000000001','링크검사사장','event-link-test');
update private.merchants set owner_id='e1500000-0000-0000-0000-000000000001',owner_verified_at=clock_timestamp() where id='e1520000-0000-0000-0000-000000000001';
select isnt(public.get_merchant_profile('e1520000-0000-0000-0000-000000000001'),null,'fixture business has a public profile');
select is(public.event_apply_info('open-event')->>'avatar',public.get_merchant_profile('e1520000-0000-0000-0000-000000000001')->>'avatar_path','apply info reuses the public profile avatar path');
select is(public.event_apply_info('open-event')->>'avatar','business-profile/e1520000-0000-0000-0000-000000000001/avatar/'||md5('e1590000-0000-0000-0000-000000000001/e1520000-0000-0000-0000-000000000001_e1590000-0000-0000-0000-000000000002.webp'),
  'the avatar is the hashed public path, never the storage path');
update private.merchants set consent='pending' where id='e1520000-0000-0000-0000-000000000001';
select is(public.event_apply_info('open-event'),null,'a business whose profile turns private loses its apply page');
update private.merchants set consent='granted' where id='e1520000-0000-0000-0000-000000000001';
select isnt(public.create_event_link('e1530000-0000-0000-0000-000000000001','apply','new-apply',null,current_date+3),null,'with a public logo the apply link is made');
select isnt(public.event_apply_info('new-apply'),null,'and it opens');
-- No dates and times to pick from, no apply link and no page.
select throws_ok($$select public.create_event_link('e1530000-0000-0000-0000-000000000005','apply','settings-less',null,current_date+3)$$,
  'P0001','APPLY_SETTINGS_REQUIRED','no apply link without apply settings');
select is(public.event_apply_info('no-settings'),null,'a campaign without apply settings has no page');
select is(pg_temp.apply('no-settings','someone',3)->>'error','not_found','and takes no entries');
select public.set_event_apply_settings('e1530000-0000-0000-0000-000000000005',array[d-1],array['18:00'],2,3,'[]') from today;
select throws_ok($$select public.create_event_link('e1530000-0000-0000-0000-000000000005','apply','settings-less',null,current_date+3)$$,
  'P0001','APPLY_SETTINGS_REQUIRED','visit dates all in the past count as none');
select is(public.event_apply_info('no-settings'),null,'and the page closes when the last visit date passes');
select isnt(public.create_event_link('e1530000-0000-0000-0000-000000000005','store',null,pg_temp.sha('settings-free-store'),current_date+3),null,
  'a store link needs no apply settings');

-- The edge function's real role can call them; the rest of the checks run as the test owner so they can read private rows.
set local role service_role;
select is(public.event_apply_info('open-event')->>'business','링크 검사 가게','open campaign link shows its event and business');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'nobody'),'{"status":"none"}'::jsonb,'service role can look up a handle');
reset role;
select is(public.event_apply_info('open-event')->>'terms','Post one reel','apply info carries the terms');
select is((select array_agg(k order by k) from jsonb_object_keys(public.event_apply_info('open-event')) k),
  array['avatar','business','closes_on','deadline_note','instagram','party_max','reel_days_max','support','terms','time_slots','title','visit_dates'],'apply info shows only public event fields');
select is(public.event_apply_info('open-event')->>'instagram','galbi.house','the business handle for the hosted-by line');
select is(public.event_apply_info('open-event')->'visit_dates',(select to_jsonb(array[d+1,d+2]) from today),'visit dates already past are not offered');
select is(public.event_apply_info('open-event')->'time_slots','["18:00","19:00"]'::jsonb,'times to pick from');
select is((select jsonb_build_object('party',i->'party_max','reel',i->'reel_days_max') from public.event_apply_info('open-event') i),'{"party":4,"reel":7}'::jsonb,'party and reel limits');
select is(public.event_apply_info('open-event')->'support',
  '[{"key":"meal","covered":true,"note_en":"Dinner for two","note_ko":"2인 식사"},{"key":"parking","covered":false}]'::jsonb,'what the event covers and does not');
select is((public.event_apply_info('open-event')->>'closes_on')::date,(select d+10 from today),'applications close when the campaign ends');
select is((public.event_apply_info('soon-link')->>'closes_on')::date,(select d+3 from today),'or sooner, when the link expires first');
select is(public.event_apply_info('closed-event'),null,'closed campaign link is not found');
select is(public.event_apply_info('ended-event'),null,'campaign past its end date is not found');
select is(public.event_apply_info('draft-event'),null,'draft campaign is not found');
select is(public.event_apply_info('expired-link'),null,'expired link is not found');
select is(public.event_apply_info('revoked-link'),null,'revoked link is not found');
select is(public.event_apply_info('no-such-link'),null,'unknown slug is not found');

select is(pg_temp.apply('closed-event','someone',1)->>'error','not_found','closed campaign refuses entries');
select is(pg_temp.apply('expired-link','someone',1)->>'error','not_found','expired link refuses entries');
select is(pg_temp.apply('revoked-link','someone',1)->>'error','not_found','revoked link refuses entries');
select is(pg_temp.apply('open-event',h,2)->>'error','invalid','bad handle refused: '||coalesce(h,'null'))
  from unnest(array['','  ','@','bad handle','.dot','dot.','two..dots','<script>','a1234567890123456789012345678901',null]) h;
select is(public.event_apply('open-event','someone',jsonb_build_array(pg_temp.pick(1,'18:00')),2,null,5,'fr',pg_temp.ip(3))->>'error','invalid','unsupported language refused');
-- Every choice is checked against the campaign's own settings (4 people, reel within 7 days, tomorrow and the day after, 18:00 and 19:00).
select is(public.event_apply('open-event','someone',v.slots,v.party,v.allergies,v.reel,'en',pg_temp.ip((8+v.n/9)::integer))->>'error','invalid','entry refused: '||v.why)
  from (select row_number() over () n,* from (values
 (jsonb_build_array(pg_temp.pick(5,'18:00')),2,null,5,'a date the business did not offer'),
 (jsonb_build_array(pg_temp.pick(-1,'18:00')),2,null,5,'an offered date already past'),
 (jsonb_build_array(pg_temp.pick(1,'20:00')),2,null,5,'a time the business did not offer'),
 ('[]'::jsonb,2,null,5,'no first choice'),
 (jsonb_build_array(pg_temp.pick(1,'18:00'),pg_temp.pick(2,'18:00'),pg_temp.pick(2,'19:00')),2,null,5,'three choices'),
 (jsonb_build_array(pg_temp.pick(1,'18:00'),pg_temp.pick(1,'18:00')),2,null,5,'the same slot twice'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')||'{"note":"x"}'),2,null,5,'a slot with extra fields'),
 ('["tomorrow"]'::jsonb,2,null,5,'a slot that is not an object'),
 (pg_temp.pick(1,'18:00'),2,null,5,'a slot that is not in a list'),
 (null,2,null,5,'no slots at all'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),0,null,5,'nobody coming'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),5,null,5,'more people than the business allows'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),null,null,5,'no party size'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),2,'',5,'an empty allergy answer'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),2,'   ',5,'a blank allergy answer'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),2,repeat('x',201),5,'a long allergy answer'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),2,null,0,'reel within zero days'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),2,null,8,'reel later than the business allows'),
 (jsonb_build_array(pg_temp.pick(1,'18:00')),2,null,null,'no reel day')) x(slots,party,allergies,reel,why)) v;
select is((select count(*) from private.partnership_creators where city_id='event-link-test'),0::bigint,'refused entries create nobody');
select throws_ok($$select public.event_apply('open-event','someone','[]',1,null,1,'en','not-a-hash')$$,'P0001','INVALID_EVENT_LINK','the function only accepts a hashed IP');

select is(public.event_apply('open-event',' @Gling.Tester ',jsonb_build_array(pg_temp.pick(1,'18:00'),pg_temp.pick(2,'19:00')),3,'  Peanuts ',7,'ko',pg_temp.ip(4)),
  '{"ok":true,"already":false}'::jsonb,'first entry is accepted');
select is((select to_jsonb(r)-array['id','created_at','updated_at','platforms','contact_name','content_summary','activity_regions','category','contact','reference_url','reference_views','metrics_note','notes','member_id'] from private.partnership_creators r where city_id='event-link-test'),
  '{"display_name":"gling.tester","city_id":"event-link-test","profile_url":"https://www.instagram.com/gling.tester/","status":"active"}'::jsonb,'entry creates the Instagram creator in the business city');
select is((select jsonb_build_object('stage',stage,'via',applied_via,'language',language,'applied',applied_at is not null,'slots',preferred_slots,
    'party',party_size,'has_allergies',has_allergies,'allergies',allergies,'reel',reel_within_days)
  from private.partnership_participations where campaign_id='e1530000-0000-0000-0000-000000000001'),
  jsonb_build_object('stage','applied','via','apply_link','language','ko','applied',true,'slots',jsonb_build_array(pg_temp.pick(1,'18:00'),pg_temp.pick(2,'19:00')),
    'party',3,'has_allergies',true,'allergies','Peanuts','reel',7),'entry lands on the board as an applied candidate with every choice');
select is((select to_jsonb(p)->>'outreach_stage' from private.partnership_participations p where campaign_id='e1530000-0000-0000-0000-000000000001'),
  case when pg_temp.board() then 'candidate' end,'board column, when present, starts at candidate');
select is(public.event_apply('open-event','GLING.TESTER',jsonb_build_array(pg_temp.pick(2,'18:00')),1,null,3,'en',pg_temp.ip(4)),'{"ok":true,"already":true}'::jsonb,'same handle again is accepted as a repeat');
select is((select count(*) from private.partnership_participations where campaign_id='e1530000-0000-0000-0000-000000000001'),1::bigint,'repeat entry keeps one row');
select is((select count(*) from private.partnership_creators where city_id='event-link-test'),1::bigint,'repeat entry keeps one creator');
select is((select jsonb_build_object('slots',preferred_slots,'party',party_size,'has_allergies',has_allergies,'allergies',allergies,'reel',reel_within_days,'language',language)
  from private.partnership_participations where campaign_id='e1530000-0000-0000-0000-000000000001'),
  jsonb_build_object('slots',jsonb_build_array(pg_temp.pick(2,'18:00')),'party',1,'has_allergies',false,'allergies',null,'reel',3,'language','en'),'repeat entry refreshes what the person picked');
select is((select count(*) from private.partnership_events where action='participation_applied' and details->>'campaign_id'='e1530000-0000-0000-0000-000000000001'),2::bigint,'every entry is in the audit trail');
insert into private.partnership_creators(id,display_name,city_id,profile_url) values
 ('e1510000-0000-0000-0000-000000000001','Known Creator','event-link-test','https://instagram.com/Known_One');
select is(pg_temp.apply('open-event','known_one',5)->>'ok','true','a creator already on file can apply');
select is((select count(*) from private.partnership_creators where city_id='event-link-test'),2::bigint,'existing creator is reused by profile key, not duplicated');
select is((select display_name from private.partnership_creators where id='e1510000-0000-0000-0000-000000000001'),'Known Creator','applying does not rename an existing creator');

-- Ten tries an hour per IP, bad tries included.
select is(pg_temp.apply('open-event','spam'||n,6)->>'ok','true','try '||n||' within the hourly cap') from generate_series(1,9) n;
select is(pg_temp.apply('open-event','bad handle',6)->>'error','invalid','a bad try also counts');
select is(pg_temp.apply('open-event','spam11',6)->>'error','rate_limited','eleventh try in an hour is refused');
select is((select count(*) from private.partnership_creators where display_name='spam11'),0::bigint,'refused try writes nothing');
select is(pg_temp.apply('open-event','other_ip',7)->>'ok','true','another IP is not affected');
update private.partnership_apply_attempts set created_at=created_at-interval '61 minutes' where ip_sha256=pg_temp.ip(6);
select is(pg_temp.apply('open-event','spam11',6)->>'ok','true','the cap resets after an hour');
select is((select count(*) from private.partnership_apply_attempts where created_at<clock_timestamp()-interval '1 hour'),0::bigint,'old attempts are pruned');

-- Store view: winners, applicant count and active benefits only.
insert into private.partnership_creators(id,display_name,city_id,profile_url) values
 ('e1510000-0000-0000-0000-000000000011','Winner One','event-link-test','https://www.instagram.com/winner.one/'),
 ('e1510000-0000-0000-0000-000000000012','Cancelled One','event-link-test','https://www.instagram.com/cancelled.one/'),
 ('e1510000-0000-0000-0000-000000000013','Coupon Only','event-link-test','https://www.instagram.com/coupon.only/'),
 ('e1510000-0000-0000-0000-000000000014','Board Confirmed','event-link-test','https://www.instagram.com/board.ok/'),
 ('e1510000-0000-0000-0000-000000000015','Board Dropped','event-link-test','https://www.instagram.com/board.dropped/'),
 ('e1510000-0000-0000-0000-000000000016','TikTok Winner','event-link-test','https://www.tiktok.com/@tiktok.winner');
insert into private.partnership_participations(id,campaign_id,creator_id,stage,scheduled_at,party_size,has_allergies,allergies) values
 (gen_random_uuid(),'e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000011','selected','2030-01-02 19:00+00',2,true,'Shellfish'),
 (gen_random_uuid(),'e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000012','cancelled','2030-01-03 19:00+00',null,null,null),
 (gen_random_uuid(),'e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000014','applied',null,null,null,null),
 (gen_random_uuid(),'e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000015','selected',null,null,null,null),
 (gen_random_uuid(),'e1530000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000016','visited','2030-01-01 19:00+00',null,null,null);
do $$ begin
  if pg_temp.board() then
    execute $u$update private.partnership_participations set outreach_stage=case creator_id
      when 'e1510000-0000-0000-0000-000000000014' then 'confirmed' else 'dropped' end
      where creator_id in ('e1510000-0000-0000-0000-000000000014','e1510000-0000-0000-0000-000000000015')$u$;
  end if;
end $$;
-- Someone typing a picked or board-confirmed person's handle changes nothing the business sees, and is told nothing different.
select is(public.event_apply('open-event',h,jsonb_build_array(pg_temp.pick(2,'19:00')),1,null,3,'en',pg_temp.ip(20)),'{"ok":true,"already":true}'::jsonb,
  're-entry for '||h||' answers like any repeat') from unnest(array['winner.one','board.ok','board.dropped']) h;
select is((select jsonb_build_object('party',party_size,'has',has_allergies,'allergies',allergies,'slots',preferred_slots,'reel',reel_within_days,'via',applied_via)
  from private.partnership_participations where creator_id='e1510000-0000-0000-0000-000000000011'),
  '{"party":2,"has":true,"allergies":"Shellfish","slots":null,"reel":null,"via":"admin"}'::jsonb,'a winner keeps their party, allergies and visit');
select is((select party_size from private.partnership_participations where creator_id='e1510000-0000-0000-0000-000000000015'),null,'a selected person is left alone too');
-- Without the board, board.ok is still a plain applicant and may update; with it, confirmed people are locked.
select is((select party_size from private.partnership_participations where creator_id='e1510000-0000-0000-0000-000000000014'),
  case when pg_temp.board() then null else 1 end,'a board-confirmed person stays as they are');
select is((select count(*) from private.partnership_events where action='participation_applied'
  and details->>'creator_id' in ('e1510000-0000-0000-0000-000000000011','e1510000-0000-0000-0000-000000000015')),0::bigint,'locked re-entries leave no entry record');
insert into private.partnership_benefits(id,merchant_id,campaign_id,title,audience,status,discount_percent,terms,terms_confirmed,expires_on)
select v.id::uuid,'e1520000-0000-0000-0000-000000000001','e1530000-0000-0000-0000-000000000001',v.title,'creators',v.status,20,'Dine-in only',true,d+10 from today,(values
 ('e1550000-0000-0000-0000-000000000001','Event discount','active'),('e1550000-0000-0000-0000-000000000002','Draft perk','draft')) v(id,title,status);
insert into private.partnership_coupons(id,benefit_id,creator_id,recipient_name,code,expires_on,terms_snapshot)
select gen_random_uuid(),'e1550000-0000-0000-0000-000000000001','e1510000-0000-0000-0000-000000000013','Coupon Only',repeat('c',32),d+5,'{}' from today;

select is(public.event_store_view(pg_temp.sha('wrong-token')),null,'wrong token sees nothing');
select is(public.event_store_view(pg_temp.sha('expired-token')),null,'expired store link sees nothing');
select is(public.event_store_view(pg_temp.sha('revoked-token')),null,'revoked store link sees nothing');
select is(public.event_store_view('good-token'),null,'the raw token is never accepted in place of its hash');
select isnt(public.event_store_view(pg_temp.sha('closed-store')),null,'a store still sees its campaign after applications close');
select is(public.event_store_view(pg_temp.sha('good-token'))->>'business','링크 검사 가게','store view names the business');
select is((public.event_store_view(pg_temp.sha('good-token'))->>'applicant_count')::integer,(select count(*)::integer from private.partnership_participations where campaign_id='e1530000-0000-0000-0000-000000000001'),'applicant count matches the board');
-- Without the board column nobody can be dropped, so the selected "Board Dropped" stays a winner there.
select is((select jsonb_agg(coalesce(w.value->>'handle',w.value->>'name') order by w.n) from jsonb_array_elements(public.event_store_view(pg_temp.sha('good-token'))->'winners') with ordinality w(value,n)),
  case when pg_temp.board() then '["TikTok Winner","winner.one","board.ok"]' else '["TikTok Winner","winner.one","board.dropped"]' end::jsonb,
  'winners are selected or board-confirmed people in visit order, without cancelled or dropped ones');
select is((select jsonb_agg(b->>'title') from jsonb_array_elements(public.event_store_view(pg_temp.sha('good-token'))->'benefits') b),'["Event discount"]'::jsonb,'only active benefits are shown');
select is((select array_agg(k order by k) from jsonb_object_keys(public.event_store_view(pg_temp.sha('good-token'))->'winners'->0) k),
  array['allergies','handle','has_allergies','name','party_size','scheduled_at'],'a winner shows only handle, name, visit time, party and allergies');
select is((select w-'name' from jsonb_array_elements(public.event_store_view(pg_temp.sha('good-token'))->'winners') w where w->>'handle'='winner.one'),
  '{"handle":"winner.one","scheduled_at":"2030-01-02T19:00:00+00:00","party_size":2,"has_allergies":true,"allergies":"Shellfish"}'::jsonb,
  'the business sees the confirmed visit, how many come and their allergies');

select is(public.event_store_lookup(pg_temp.sha('good-token'),'@Winner.One'),'{"status":"winner"}'::jsonb,'selected creator is a winner');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'gling.tester'),'{"status":"discount"}'::jsonb,'applicant gets the discount');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'coupon.only'),'{"status":"discount"}'::jsonb,'issued coupon gets the discount');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'nobody.here'),'{"status":"none"}'::jsonb,'stranger is not on the list');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'bad handle'),'{"status":"none"}'::jsonb,'malformed handle is simply not on the list');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'board.ok'),
  case when pg_temp.board() then '{"status":"winner"}' else '{"status":"discount"}' end::jsonb,'board-confirmed applicant is a winner when the board exists');
select is(public.event_store_lookup(pg_temp.sha('good-token'),'board.dropped'),
  case when pg_temp.board() then '{"status":"none"}' else '{"status":"winner"}' end::jsonb,'dropped from the board loses winner and discount');
select is(public.event_store_lookup(pg_temp.sha('wrong-token'),'winner.one'),null,'wrong token learns nothing about a handle');
select is(public.event_store_lookup(pg_temp.sha('revoked-token'),'winner.one'),null,'revoked token learns nothing about a handle');
select is((select array_agg(k) from jsonb_object_keys(public.event_store_lookup(pg_temp.sha('good-token'),'winner.one')) k),array['status'],'lookup answers with the status alone, never a list');

-- Script-side link making and revoking.
select isnt(public.create_event_link('e1530000-0000-0000-0000-000000000001','store',null,pg_temp.sha('new-token'),(select d+3 from today)),null,'service role makes a store link');
select isnt(public.event_store_view(pg_temp.sha('new-token')),null,'the new link works');
select ok(public.revoke_event_link((select id from private.partnership_campaign_links where token_sha256=pg_temp.sha('new-token'))),'service role revokes it');
select is(public.event_store_view(pg_temp.sha('new-token')),null,'revoked link stops at once');
select ok(not public.revoke_event_link((select id from private.partnership_campaign_links where token_sha256=pg_temp.sha('new-token'))),'revoking twice changes nothing');
select throws_ok($$select public.create_event_link('e1530000-0000-0000-0000-000000000001','apply','open-event',null,current_date)$$,'23505',null,'slugs stay unique');
select * from finish();
rollback;
