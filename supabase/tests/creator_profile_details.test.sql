begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values('creator-details-test','Creator detail test city','BC','America/Vancouver',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('b1500000-0000-0000-0000-000000000001','creator-detail-admin@example.test','{"role":"admin"}'),
 ('b1500000-0000-0000-0000-000000000002','creator-detail-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('b1500000-0000-0000-0000-000000000001','Detail admin','creator-details-test'),
 ('b1500000-0000-0000-0000-000000000002','Detail member','creator-details-test');
insert into auth.sessions(id,user_id,aal) values
 ('b1560000-0000-0000-0000-000000000001','b1500000-0000-0000-0000-000000000001','aal2');
create function pg_temp.creator_doc(rid uuid) returns jsonb language sql security definer set search_path='' as $$
 select to_jsonb(r) from private.partnership_creators r where id=rid
$$;
create function pg_temp.save_creator(rid uuid,patch jsonb) returns uuid language sql as $$
 select public.save_admin_partnership('creator',patch||jsonb_build_object('id',rid),(pg_temp.creator_doc(rid)->>'updated_at')::timestamptz)
$$;
create function pg_temp.invalid_platforms(value jsonb) returns uuid language sql as $$
 select public.save_admin_partnership('creator',jsonb_build_object('id',gen_random_uuid(),'display_name','Rejected details','city_id','creator-details-test','profile_url','https://example.com/new-creator','platforms',value))
$$;
select set_config('request.jwt.claims','{"sub":"b1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select pg_temp.save_creator('b1510000-0000-0000-0000-000000000001','{"display_name":"Legacy Creator","city_id":"creator-details-test","profile_url":"https://www.instagram.com/legacy-details/","category":"Food","contact":"creator@example.test","metrics_note":"Original observed sample","notes":"Uncontacted prospect"}')$$,'original registration payload still creates a creator');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->'platforms','[]'::jsonb,'legacy create defaults to no extra linked accounts');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->>'contact_name','','legacy create defaults to no contact name');
select lives_ok($$select pg_temp.save_creator('b1510000-0000-0000-0000-000000000001','{"platforms":[{"platform":"Instagram","url":"https://www.instagram.com/detail-secondary/","followers":"1.4만","checked_on":"2026-10-15"},{"platform":"YouTube","url":"https://www.youtube.com/@detail-channel","followers":"12.3K","checked_on":null},{"platform":"Website","url":"https://example.com/creator-site"}],"contact_name":"Creator Liaison","content_summary":"Food and neighbourhood cafe videos","activity_regions":"Richmond · Burnaby"}')$$,'creator can add linked accounts and details without changing representative profile');
select is(public.get_admin_partnerships('creators','',0,'b1510000-0000-0000-0000-000000000001')->'record'->'platforms','[{"platform":"Instagram","url":"https://www.instagram.com/detail-secondary/","followers":"1.4만","checked_on":"2026-10-15"},{"platform":"YouTube","url":"https://www.youtube.com/@detail-channel","followers":"12.3K","checked_on":null},{"platform":"Website","url":"https://example.com/creator-site"}]'::jsonb,'detail readback retains every platform URL, raw rounded label and nullable observation date');
select is(public.get_admin_partnerships('creators')->'rows'->0->>'contact_name','Creator Liaison','list projection includes new contact name');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->>'profile_url','https://www.instagram.com/legacy-details/','legacy representative profile need not occur in extra platforms');
select lives_ok($$select pg_temp.save_creator('b1510000-0000-0000-0000-000000000001','{"category":"Food and travel"}')$$,'old client partial update still works after enrichment');
select is(jsonb_array_length(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->'platforms'),3,'old client update preserves extra accounts');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->>'content_summary','Food and neighbourhood cafe videos','old client update preserves new content details');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->>'metrics_note','Original observed sample','enrichment preserves existing observed evidence');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->>'notes','Uncontacted prospect','enrichment preserves outreach facts');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"b1510000-0000-0000-0000-000000000001","contact_name":"Stale overwrite"}','2000-01-01')$$,'P0001','PARTNERSHIP_CHANGED','stale detail revision cannot overwrite another edit');
select is(pg_temp.creator_doc('b1510000-0000-0000-0000-000000000001')->>'contact_name','Creator Liaison','rejected stale edit retains saved contact');
select is(jsonb_array_length(public.get_admin_partnerships('creators',query)->'rows'),1,label)
from (values ('liaison','search includes contact name'),('creator@example.test','search includes contact details'),('neighbourhood','search includes content summary'),('burnaby','search includes activity regions'),('detail-secondary','search includes secondary account URL')) search(query,label);
select throws_ok(format('select pg_temp.invalid_platforms(%L::jsonb)',value::text),'P0001','INVALID_PARTNERSHIP',label)
from (values
 ('null'::jsonb,'null account collection refused'),
 ('{}'::jsonb,'non-array account collection refused'),
 ('[null]'::jsonb,'null account entry refused'),
 ('["Instagram"]'::jsonb,'scalar account entry refused'),
 ('[{"url":"https://example.com/a"}]'::jsonb,'platform name required'),
 ('[{"platform":"Instagram"}]'::jsonb,'account URL required'),
 ('[{"platform":1,"url":"https://example.com/a"}]'::jsonb,'numeric platform name refused'),
 ('[{"platform":" ","url":"https://example.com/a"}]'::jsonb,'blank platform name refused'),
 (jsonb_build_array(jsonb_build_object('platform',repeat('x',41),'url','https://example.com/a')),'oversized platform name refused'),
 ('[{"platform":"Instagram","url":1}]'::jsonb,'numeric account URL refused'),
 ('[{"platform":"Instagram","url":"http://example.com/a"}]'::jsonb,'HTTP account URL refused'),
 ('[{"platform":"Instagram","url":"https://127.0.0.1/a"}]'::jsonb,'loopback account URL refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","followers":123}]'::jsonb,'numeric audience values must not replace observed labels'),
 ('[{"platform":"Instagram","url":"https://example.com/a","followers":null}]'::jsonb,'null audience label refused'),
 (jsonb_build_array(jsonb_build_object('platform','Instagram','url','https://example.com/a','followers',repeat('x',81))),'oversized audience label refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","checked_on":123}]'::jsonb,'numeric observation date refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","checked_on":"2026-02-30"}]'::jsonb,'nonexistent calendar date refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","checked_on":"2026-2-3"}]'::jsonb,'non-ISO observation date refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","checked_on":"infinity"}]'::jsonb,'infinite observation date refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","checked_on":"0000-01-01"}]'::jsonb,'year zero observation date refused'),
 ('[{"platform":"Instagram","url":"https://example.com/a","private_token":"secret"}]'::jsonb,'unknown account fields refused'),
 ('[{"platform":"Instagram","url":"https://www.instagram.com/CaseHandle/"},{"platform":"Other","url":"https://instagram.com/casehandle?utm_source=x"}]'::jsonb,'normalized duplicate account URLs refused'),
 ('[{"platform":"Threads","url":"https://threads.net/@creator"},{"platform":"Threads","url":"https://threads.com/@Creator/"}]'::jsonb,'legacy Threads domain duplicate refused'),
 ((select jsonb_agg(jsonb_build_object('platform','Website','url','https://example.com/account-'||i)) from generate_series(1,21)i),'more than twenty accounts refused')
) invalid(value,label);
select throws_ok(format('select pg_temp.save_creator(''b1510000-0000-0000-0000-000000000001'',%L::jsonb)',patch::text),'P0001','INVALID_PARTNERSHIP',label)
from (values
 (jsonb_build_object('contact_name',repeat('x',121)),'oversized contact name refused'),
 (jsonb_build_object('content_summary',repeat('x',2001)),'oversized content summary refused'),
 (jsonb_build_object('activity_regions',repeat('x',501)),'oversized activity region refused'),
 ('{"contact_name":null}'::jsonb,'null contact name refused'),
 ('{"content_summary":[]}'::jsonb,'non-text content summary refused')
) invalid(patch,label);
select lives_ok($$select pg_temp.save_creator('b1510000-0000-0000-0000-000000000002',jsonb_build_object('display_name','Twenty accounts','city_id','creator-details-test','profile_url','https://example.com/twenty-accounts','platforms',(select jsonb_agg(jsonb_build_object('platform','Website','url','https://example.com/account-'||i,'followers','','checked_on','2024-02-29')) from generate_series(1,20)i)))$$,'twenty accounts, empty observed labels and leap-day observation are accepted');
select is(jsonb_array_length(public.get_admin_partnerships('creators','',0,'b1510000-0000-0000-0000-000000000002')->'record'->'platforms'),20,'all twenty platform records round trip');
reset role;
select ok(not has_table_privilege('authenticated','private.partnership_creators','SELECT'),'authenticated clients cannot read creator table directly');
select ok(not has_table_privilege('anon','private.partnership_creators','SELECT'),'anonymous clients cannot read creator table directly');
select ok(not has_table_privilege('service_role','private.partnership_creators','SELECT'),'service role is not granted direct creator contact access');
select ok(not has_function_privilege('authenticated','private.valid_creator_platforms(jsonb)','EXECUTE'),'private channel validator is not granted to clients');
select ok((select relrowsecurity from pg_class where oid='private.partnership_creators'::regclass),'private creator RLS remains enabled');
update auth.sessions set aal='aal1' where id='b1560000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"b1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"b1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('creators','',0,'b1510000-0000-0000-0000-000000000001')$$,'P0001','ADMIN_REQUIRED','AAL1 admin cannot read contact and channel details');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"b1510000-0000-0000-0000-000000000001","contact_name":"Denied"}','2000-01-01')$$,'P0001','ADMIN_REQUIRED','AAL1 admin cannot save contact details');
reset role;
select set_config('request.jwt.claims','{"sub":"b1500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_partnerships('creators','creator@example.test')$$,'P0001','ADMIN_REQUIRED','ordinary member cannot search private contacts with forged admin claim');
select throws_ok($$select public.save_admin_partnership('creator','{"id":"b1510000-0000-0000-0000-000000000001","contact_name":"Denied"}','2000-01-01')$$,'P0001','ADMIN_REQUIRED','ordinary member cannot save private creator details');
reset role;
select * from finish();
rollback;
