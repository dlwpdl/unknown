begin;
set local search_path=public,extensions;
select no_plan();
select has_table('private','creator_deals','agreement history has its own private table');
select has_function('public','record_admin_creator_deal',array['jsonb'],'agreement append RPC exists');
select has_function('public','get_admin_creator_directory',array['text','integer','uuid','integer','text','text'],'directory has server sorting');
insert into public.cities values('creator-deal-test','Creator deal test city','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('d1500000-0000-0000-0000-000000000001','creator-deal-admin@example.test','{"role":"admin"}'),
 ('d1500000-0000-0000-0000-000000000002','creator-deal-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('d1500000-0000-0000-0000-000000000001','Deal admin','creator-deal-test'),
 ('d1500000-0000-0000-0000-000000000002','Deal member','creator-deal-test');
insert into auth.sessions(id,user_id,aal) values ('d1560000-0000-0000-0000-000000000001','d1500000-0000-0000-0000-000000000001','aal2');
select set_config('request.jwt.claims','{"sub":"d1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"d1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.save_admin_partnership('creator',jsonb_build_object('id',('d1510000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'display_name','Deal fixture '||i,'city_id','creator-deal-test','profile_url','https://example.com/deal-fixture-'||i,'notes','Preserve existing history')) from generate_series(1,55)i;
create function pg_temp.deal(rid uuid,creator uuid,fee integer,support integer,day date default '2026-10-01',cur text default 'CAD') returns jsonb language sql as $$
 select jsonb_build_object('id',rid,'creator_id',creator,'merchant_id',null,'agreed_on',day,'currency',cur,'ad_fee_cents',fee,'meal_support_cents',support,'deliverables','One Reel','source_url','https://example.com/agreement','notes','Owner verified; support is a limit, not a payment')
$$;
select lives_ok($$select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000001','d1510000-0000-0000-0000-000000000055',0,15000))$$,'a zero advertising fee and meal support ceiling are recorded');
select lives_ok($$select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000001','d1510000-0000-0000-0000-000000000055',0,15000))$$,'an identical request can be retried');
select throws_ok($$select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000001','d1510000-0000-0000-0000-000000000055',1,15000))$$,'P0001','PARTNERSHIP_CHANGED','request ID cannot overwrite history');
select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000002','d1510000-0000-0000-0000-000000000001',10000,null));
select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000003','d1510000-0000-0000-0000-000000000002',null,25000));
select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000004','d1510000-0000-0000-0000-000000000055',99900,0,'2026-10-02','USD'));
select is(public.get_admin_creator_directory('Deal fixture',0,null,0,'fee_asc','CAD')->'rows'->0->>'id','d1510000-0000-0000-0000-000000000055','ascending fee sorts globally, including a creator beyond the old page boundary');
select is(public.get_admin_creator_directory('Deal fixture',0,null,0,'fee_desc','CAD')->'rows'->0->>'id','d1510000-0000-0000-0000-000000000001','descending fee leaves unknown amounts after confirmed fees');
select is(public.get_admin_creator_directory('Deal fixture',0,null,0,'support_desc','CAD')->'rows'->0->>'id','d1510000-0000-0000-0000-000000000002','support sorts independently of advertising fee');
select is(public.get_admin_creator_directory('Deal fixture',0,null,0,'support_asc','CAD')->'rows'->0->>'id','d1510000-0000-0000-0000-000000000055','ascending support preserves nulls last');
select is(public.get_admin_creator_directory('Deal fixture',0,null,0,'fee_desc','USD')->'rows'->0->'latest_deal'->>'ad_fee_cents','99900','USD uses a separate latest agreement');
select is(public.get_admin_creator_directory('Deal fixture',0,null,0,'fee_asc','CAD')->'rows'->0->'latest_deal'->>'ad_fee_cents','0','newer USD agreement does not replace the CAD reference');
select is(jsonb_array_length(public.get_admin_creator_directory('Deal fixture',0,null,0,'fee_asc','CAD')->'rows'),50,'first directory page is bounded');
select is(jsonb_array_length(public.get_admin_creator_directory('Deal fixture',50,null,0,'fee_asc','CAD')->'rows'),5,'second page keeps the server order');
select is(public.get_admin_creator_directory('Deal fixture',50,null,0,'fee_asc','CAD')->>'more','false','last page reports no extra rows');
select is(public.get_admin_creator_directory('',0,'d1510000-0000-0000-0000-000000000055')->'record'->>'notes','Preserve existing history','profile notes are preserved');
select is(jsonb_array_length(public.get_admin_creator_directory('',0,'d1510000-0000-0000-0000-000000000055')->'deals'),2,'history includes both currencies');
select is(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001')->>'ad_fee_cents','0','exact saved record round trips zero');
select is(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000002')->'meal_support_cents','null'::jsonb,'unknown support stays null');
select throws_ok($$select public.get_admin_creator_directory('',0,null,0,'fee;drop','CAD')$$,'P0001','INVALID_PARTNERSHIP','sort is allowlisted');
select throws_ok($$select public.get_admin_creator_directory('',0,null,0,'fee_asc','EUR')$$,'P0001','INVALID_PARTNERSHIP','unsupported currency cannot be compared');
select throws_ok(format('select public.record_admin_creator_deal(%L::jsonb)',(pg_temp.deal(gen_random_uuid(),'d1510000-0000-0000-0000-000000000001',0,0)||patch)::text),'P0001','INVALID_PARTNERSHIP',label) from (values
 ('{"ad_fee_cents":-1}'::jsonb,'negative fee refused'),
 ('{"ad_fee_cents":1.1}'::jsonb,'fractional cents refused'),
 ('{"ad_fee_cents":"150"}'::jsonb,'numeric strings refused'),
 ('{"ad_fee_cents":100000000}'::jsonb,'oversized amount refused'),
 ('{"currency":"EUR"}'::jsonb,'unsupported currency refused'),
 ('{"agreed_on":"2026-02-30"}'::jsonb,'invalid calendar date refused'),
 ('{"agreed_on":"infinity"}'::jsonb,'infinite date refused'),
 ('{"collaboration_on":"2026-02-30"}'::jsonb,'invalid collaboration calendar date refused'),
 ('{"collaboration_on":true}'::jsonb,'non-date collaboration value refused'),
 ('{"agreed_on":"2099-01-01"}'::jsonb,'future agreement date refused'),
 ('{"deliverables":""}'::jsonb,'content commitment required'),
 ('{"notes":""}'::jsonb,'conditions and evidence required'),
 ('{"source_url":"javascript:alert(1)"}'::jsonb,'unsafe source refused'),
 ('{"creator_id":null}'::jsonb,'creator required'),
 ('{"created_by":"d1500000-0000-0000-0000-000000000002"}'::jsonb,'actor cannot be supplied')
) invalid(patch,label);
select public.record_admin_creator_deal(pg_temp.deal(gen_random_uuid(),'d1510000-0000-0000-0000-000000000055',i,0,'2025-01-01'::date+i)) from generate_series(1,51)i;
select public.record_admin_creator_deal(pg_temp.deal('d1520000-0000-0000-0000-000000000099','d1510000-0000-0000-0000-000000000055',1,0,'2000-01-01'));
select is(jsonb_array_length(public.get_admin_creator_directory('',0,'d1510000-0000-0000-0000-000000000055')->'deals'),50,'visible agreement history is bounded');
select is(public.get_admin_creator_directory('',0,'d1510000-0000-0000-0000-000000000055')->>'children_more','true','older agreements have a next history page');
select is(jsonb_array_length(public.get_admin_creator_directory('',0,'d1510000-0000-0000-0000-000000000055',50)->'deals'),4,'history pages retain older agreements');
select is(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000099')->>'agreed_on','2000-01-01','exact backdated readback works outside the first history page');
reset role;
select is((select count(*)::integer from private.creator_deals where id='d1520000-0000-0000-0000-000000000001'),1,'identical retries create one row');
select is((select count(*)::integer from private.partnership_events where resource_id='d1520000-0000-0000-0000-000000000001' and action='creator_deal_recorded'),1,'identical retries create one audit event');
select ok((select relrowsecurity from pg_class where oid='private.creator_deals'::regclass),'history has RLS');
select ok(not has_table_privilege(role_name,'private.creator_deals','SELECT,INSERT,UPDATE,DELETE'),'no direct history access for '||role_name) from unnest(array['anon','authenticated','service_role']) role_name;
select ok(not has_function_privilege('anon','public.record_admin_creator_deal(jsonb)','EXECUTE'),'anonymous callers cannot append');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind) values
 ('d1530000-0000-0000-0000-000000000001','Vendor one','creator-deal-test','lead','pending','Fixture only','business'),
 ('d1530000-0000-0000-0000-000000000002','Vendor two','creator-deal-test','lead','pending','Fixture only','business');
set local role authenticated;
create temp table deal_before as select public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001') value;
select lives_ok($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001','d1530000-0000-0000-0000-000000000001','2026-12-01',(select (value->>'updated_at')::timestamptz from deal_before))$$,'existing history can be linked to a vendor and a future planned collaboration date');
select is(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001')->>'merchant_name','Vendor one','linked vendor name is canonical');
select is(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001')->>'collaboration_on','2026-12-01','collaboration date is separate from agreement date');
select is(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001')-array['merchant_id','merchant_name','collaboration_on','updated_at'],(select value-array['merchant_id','merchant_name','collaboration_on','updated_at'] from deal_before),'linking preserves every cost, evidence and original creator/date field');
select lives_ok($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001','d1530000-0000-0000-0000-000000000001','2026-12-01',(select (value->>'updated_at')::timestamptz from deal_before))$$,'same link retry is idempotent despite the original revision');
select throws_ok($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001','d1530000-0000-0000-0000-000000000002','2026-12-01',(select (value->>'updated_at')::timestamptz from deal_before))$$,'P0001','PARTNERSHIP_CHANGED','a stale editor cannot change the saved vendor');
select throws_ok($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001',null,null,now())$$,'P0001','INVALID_PARTNERSHIP','an empty vendor cannot unlink existing history');
select throws_ok($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001','d1530000-0000-0000-0000-000000000001','infinity',now())$$,'P0001','INVALID_PARTNERSHIP','infinite collaboration date refused');
select throws_like($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001','d1530000-0000-0000-0000-000000000001','10000-01-01',(public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001')->>'updated_at')::timestamptz)$$,'%creator_deals_collaboration_date_range%','dates beyond the supported four-digit calendar range are refused');
select throws_ok($$select public.link_admin_creator_deal_merchant('d1520000-0000-0000-0000-000000000001','d1530000-0000-0000-0000-000000000099',null,now())$$,'P0001','INVALID_PARTNERSHIP','missing vendor refused');
reset role;
select is((select count(*)::integer from private.creator_deals where id='d1520000-0000-0000-0000-000000000001'),1,'linking does not invent a second collaboration');
select is((select count(*)::integer from private.partnership_events where resource_id='d1520000-0000-0000-0000-000000000001' and action='creator_deal_merchant_linked'),1,'link retry keeps one audited change');
select ok(not has_function_privilege('anon','public.link_admin_creator_deal_merchant(uuid,uuid,date,timestamptz)','EXECUTE'),'anonymous callers cannot link vendors');
update auth.sessions set aal='aal1' where id='d1560000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_admin_creator_directory()$$,'P0001','ADMIN_REQUIRED','AAL1 session cannot read costs');
select throws_ok($$select public.get_admin_creator_deal('d1520000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','AAL1 session cannot read exact history');
select throws_ok($$select public.link_admin_creator_deal_merchant(null,null,null,null)$$,'P0001','ADMIN_REQUIRED','AAL1 cannot link vendors');
select throws_ok($$select public.record_admin_creator_deal('{}')$$,'P0001','ADMIN_REQUIRED','authorization precedes payload parsing');
reset role;
select set_config('request.jwt.claims','{"sub":"d1500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_creator_directory()$$,'P0001','ADMIN_REQUIRED','ordinary member cannot read with forged claims');
reset role;
select * from finish();
rollback;
