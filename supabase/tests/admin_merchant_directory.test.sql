begin;
set local search_path=public,extensions;
select no_plan();
insert into public.cities values
 ('directory-test','목록 검사 도시','BC','America/Vancouver',true),
 ('directory-test-other','다른 검사 도시','ON','America/Toronto',true);
insert into auth.users(id,email,raw_app_meta_data) values
 ('d1500000-0000-0000-0000-000000000001','directory-admin@example.test','{"role":"admin"}'),
 ('d1500000-0000-0000-0000-000000000002','directory-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('d1500000-0000-0000-0000-000000000001','목록검사관리자','directory-test'),
 ('d1500000-0000-0000-0000-000000000002','목록검사회원','directory-test');
insert into auth.sessions(id,user_id,aal) values
 ('d1560000-0000-0000-0000-000000000001','d1500000-0000-0000-0000-000000000001','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,owner_id,created_at,updated_at) values
 ('d1520000-0000-0000-0000-000000000001','Directory Alpha','directory-test','Instagram @alpha','lead','pending','','business',null,'2020-01-01Z','2026-01-01Z'),
 ('d1520000-0000-0000-0000-000000000002','directory Beta','directory-test-other','beta@example.test','paid','granted','게시 허락','business','d1500000-0000-0000-0000-000000000002','2025-01-01Z','2025-01-01Z'),
 ('d1520000-0000-0000-0000-000000000003','Directory Omega','directory-test','','paused','revoked','','source',null,'2024-01-01Z','2024-01-01Z');
insert into private.merchants(id,name,city_id,status,consent,record_kind,created_at)
 select ('d1530000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Directory Mid'||lpad(i::text,3,'0'),'directory-test','trial','pending','business','2023-01-01Z'
 from generate_series(1,52)i;
insert into private.merchants(id,name,city_id,status,consent,record_kind,deleted_at)
 values('d1520000-0000-0000-0000-000000000004','Directory Hidden','directory-test','paused','revoked','business',now());

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.get_admin_merchants('',0,'{}')$$,'42501',null,'anonymous directory access denied');
reset role;
select ok(not has_function_privilege('service_role','public.get_admin_merchants(text,integer,jsonb)','EXECUTE'),'no service-role directory grant');
select set_config('request.jwt.claims','{"sub":"d1500000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_merchants('',0,'{}')$$,'P0001','ADMIN_REQUIRED','forged admin claim denied');
reset role;
select set_config('request.jwt.claims','{"sub":"d1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"d1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_merchants('',0,'{}')$$,'P0001','ADMIN_REQUIRED','AAL1 admin denied');
reset role;
select set_config('request.jwt.claims','{"sub":"d1500000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"d1560000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((public.get_admin_merchants('Directory',0,'{}')->>'total')::integer,55,'total counts matching active vendors across pages');
select is(jsonb_array_length(public.get_admin_merchants('Directory',0,'{}')->'merchants'),50,'first page is bounded');
select is(public.get_admin_merchants('Directory',0,'{}')->'merchants'->0->>'name','Directory Alpha','default name ascending is global and case insensitive');
select is(public.get_admin_merchants('Directory',0,'{"sort":"name_desc"}')->'merchants'->0->>'name','Directory Omega','descending name sort crosses the old page boundary');
select is(public.get_admin_merchants('Directory',0,'{"sort":"created_desc"}')->'merchants'->0->>'name','directory Beta','newest registration does not sort by updated date');
select is(public.get_admin_merchants('Directory',0,'{"sort":"created_asc"}')->'merchants'->0->>'name','Directory Alpha','oldest registration supported');
select is((public.get_admin_merchants('Directory',0,'{}')->'merchants'->0->>'created_at')::timestamptz,'2020-01-01Z'::timestamptz,'original registration timestamp returned');
select is(jsonb_array_length(public.get_admin_merchants('Directory',50,'{}')->'merchants'),5,'second page contains the remaining matches');
select is(public.get_admin_merchants('Directory',50,'{}')->'more','false'::jsonb,'last page has no next page');
select is(public.get_admin_merchants('Directory',0,'{}')->'more','true'::jsonb,'first page reports more matches');
select is((select count(distinct m->>'id') from jsonb_array_elements((public.get_admin_merchants('Directory',0,'{}')->'merchants')||(public.get_admin_merchants('Directory',50,'{}')->'merchants'))m),55::bigint,'stable pages neither repeat nor omit vendors');
select is((public.get_admin_merchants('Directory',0,'{"status":"paid"}')->>'total')::integer,1,'status filter is applied before pagination');
select is((public.get_admin_merchants('Directory',0,'{"consent":"revoked"}')->>'total')::integer,1,'consent filter excludes archived vendors');
select is((public.get_admin_merchants('Directory',0,'{"record_kind":"source"}')->>'total')::integer,1,'registration kind filter');
select is((public.get_admin_merchants('Directory',0,'{"city_id":"directory-test-other"}')->>'total')::integer,1,'posting city filter');
select is((public.get_admin_merchants('Directory',0,'{"account":"connected"}')->>'total')::integer,1,'connected account filter');
select is((public.get_admin_merchants('Directory',0,'{"account":"unconnected"}')->>'total')::integer,54,'unconnected account filter');
select is((public.get_admin_merchants('Directory',0,'{"city_id":"directory-test","status":"paid"}')->>'total')::integer,0,'different filter dimensions intersect');
select is((public.get_admin_merchants('BETA@EXAMPLE',0,'{}')->>'total')::integer,1,'contact search remains case insensitive');
select lives_ok($$select public.get_admin_merchants('Directory',0)$$,'legacy two-argument callers remain valid');
select throws_ok($$select public.get_admin_merchants('',-1,'{}')$$,'P0001','INVALID_MERCHANT_FILTER','negative page offset rejected');
select throws_ok($$select public.get_admin_merchants('',100001,'{}')$$,'P0001','INVALID_MERCHANT_FILTER','unbounded page offset rejected');
select throws_ok($$select public.get_admin_merchants(repeat('a',121),0,'{}')$$,'P0001','INVALID_MERCHANT_FILTER','oversized search rejected');
select throws_ok($$select public.get_admin_merchants('',0,null)$$,'P0001','INVALID_MERCHANT_FILTER','null filters rejected');
select throws_ok($$select public.get_admin_merchants('',0,'[]')$$,'P0001','INVALID_MERCHANT_FILTER','non-object filters rejected');
select throws_ok($$select public.get_admin_merchants('',0,'{"status":null}')$$,'P0001','INVALID_MERCHANT_FILTER','non-string filter rejected');
select throws_ok($$select public.get_admin_merchants('',0,'{"unknown":"value"}')$$,'P0001','INVALID_MERCHANT_FILTER','unknown filter key rejected');
select throws_ok($$select public.get_admin_merchants('',0,'{"sort":"name; drop table merchants"}')$$,'P0001','INVALID_MERCHANT_FILTER','sort allowlist enforced');
select throws_ok($$select public.get_admin_merchants('',0,'{"status":"wrong"}')$$,'P0001','INVALID_MERCHANT_FILTER','status allowlist enforced');
select throws_ok($$select public.get_admin_merchants('',0,'{"consent":"wrong"}')$$,'P0001','INVALID_MERCHANT_FILTER','consent allowlist enforced');
select throws_ok($$select public.get_admin_merchants('',0,'{"record_kind":"wrong"}')$$,'P0001','INVALID_MERCHANT_FILTER','kind allowlist enforced');
select throws_ok($$select public.get_admin_merchants('',0,'{"city_id":"missing-city"}')$$,'P0001','INVALID_MERCHANT_FILTER','unknown city rejected');
select throws_ok($$select public.get_admin_merchants('',0,'{"account":"wrong"}')$$,'P0001','INVALID_MERCHANT_FILTER','account allowlist enforced');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='d1500000-0000-0000-0000-000000000001' and scope='analytics'),'directory reads are audited');
update public.profiles set account_status='deleted' where id='d1500000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.get_admin_merchants('',0,'{}')$$,'P0001','ADMIN_REQUIRED','inactive administrator denied');
reset role;
select * from finish();
rollback;
