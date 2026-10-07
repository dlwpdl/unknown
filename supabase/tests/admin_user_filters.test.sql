begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data)
select ('74800000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  'directory-filter-'||n||case when n=56 then '@seed.gling.invalid' else '@example.test' end,
  case n when 57 then '{"role":"admin"}'::jsonb when 58 then '{"review_access":true}'::jsonb else '{}'::jsonb end
from generate_series(1,58) n;
insert into public.profiles(id,nickname,city_id)
select id,'필터검사'||right(id::text,3),'vancouver' from auth.users where email like 'directory-filter-%';
-- Age comes only from consented personal info: 만 24·32·45·17·63세 for members 1-5, everyone else unknown.
insert into private.personal_info(user_id,full_name,date_of_birth,gender,consent_version)
select ('74800000-0000-0000-0000-'||lpad(t.n::text,12,'0'))::uuid,'필터검사'||t.n,
  (now() at time zone 'utc')::date - make_interval(years=>t.years),t.gender,'2026-09-12'
from (values (1,24,'female'),(2,32,'male'),(3,45,'other'),(4,17,null),(5,63,'female')) as t(n,years,gender);
select set_config('request.jwt.claims','{"sub":"74800000-0000-0000-0000-000000000057","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.search_admin_users('directory-filter-',0,'all')->>'total','58','all includes internal accounts');
select is(public.search_admin_users('directory-filter-')->>'total','58','legacy search remains compatible');
select is(public.search_admin_users('directory-filter-',0,'example')->>'total','1','created accounts use the seed classification');
select is(public.search_admin_users('directory-filter-',0,'member')->>'total','55','real members exclude seed, admin and review accounts');
create temp table filter_first as select public.search_admin_users('directory-filter-',0,'member') data;
create temp table filter_next as select public.search_admin_users('directory-filter-',50,'member') data;
select is(jsonb_array_length((select data->'rows' from filter_first)),50,'first page has 50 matching members');
select is(jsonb_array_length((select data->'rows' from filter_next)),5,'second page has remaining matching members');
select is((select data->>'total' from filter_next),'55','pagination preserves the filtered total');
select is((select count(distinct row->>'id')::integer from (select jsonb_array_elements(data->'rows') row from filter_first union all select jsonb_array_elements(data->'rows') from filter_next) pages),55,'pages contain every matching member exactly once');
select ok((select bool_and(row->>'account_type'='member') from (select jsonb_array_elements(data->'rows') row from filter_first union all select jsonb_array_elements(data->'rows') from filter_next) pages),'no internal account leaks into member pages');
select is(public.search_admin_users('directory-filter-56@seed.gling.invalid',0,'member')->>'total','0','query and account filter intersect');
select is(public.search_admin_users('directory-filter-56@seed.gling.invalid',0,'example')->>'total','1','query finds a matching created account');
select throws_ok($$select public.search_admin_users('',0,'unknown')$$,'P0001','INVALID_ADMIN_FILTER','unknown account filter rejected');
select throws_ok($$select public.search_admin_users('',0,null)$$,'P0001','INVALID_ADMIN_FILTER','null account filter rejected');
select throws_ok($$select public.search_admin_users('',-1,'member')$$,'P0001','INVALID_ADMIN_FILTER','invalid offset rejected');
select ok(exists(select 1 from public.admin_access_logs where actor_id=auth.uid() and scope='users'),'filtered access remains audited');
reset role;
select set_config('request.jwt.claims','{"sub":"74800000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.search_admin_users('',0,'member')$$,'P0001','ADMIN_REQUIRED','ordinary members cannot search');
reset role;
set local role anon;
select throws_ok($$select public.search_admin_users('',0,'example')$$,'42501',null,'anonymous search denied');
reset role;
select set_config('request.jwt.claims','{"sub":"74800000-0000-0000-0000-000000000057","role":"authenticated","app_metadata":{"role":"admin"}}',true);
update public.profiles set city_id='toronto' where id::text like '74800000-%' and right(id::text,12)::bigint % 2=1;
update public.profiles set created_at=now()-interval '100 days' where id='74800000-0000-0000-0000-000000000001';
update public.profiles set account_status='suspended' where id='74800000-0000-0000-0000-000000000003';
insert into auth.identities(provider_id,user_id,identity_data,provider)
select id::text,id,'{}','google' from auth.users where id in ('74800000-0000-0000-0000-000000000002','74800000-0000-0000-0000-000000000056');
set local role authenticated;
select is(public.search_admin_users('directory-filter-',0,'{}'::jsonb)->>'total','58','empty filters include all accounts');
select is(public.search_admin_users('directory-filter-',0,'{"account_types":["example","member"]}'::jsonb)->>'total','56','account types combine with OR');
select is(public.search_admin_users('directory-filter-',0,'{"account_types":["member"],"cities":["vancouver","toronto"]}'::jsonb)->>'total','55','cities combine with OR');
select is(public.search_admin_users('directory-filter-',0,'{"account_types":["member"],"cities":["vancouver"],"statuses":["active"],"providers":["google"]}'::jsonb)->>'total','1','dimensions combine with AND');
select is(public.search_admin_users('directory-filter-',0,'{"account_types":["member"],"joined_days":"30"}'::jsonb)->>'total','54','join period excludes old accounts');
select is(public.search_admin_users('directory-filter-',0,'{"sort":"oldest"}'::jsonb)#>>'{rows,0,id}','74800000-0000-0000-0000-000000000001','oldest sort runs before pagination');
select is(jsonb_array_length(public.search_admin_users('directory-filter-',50,'{"account_types":["member"]}'::jsonb)->'rows'),5,'combined filter reaches second page');
select is(public.search_admin_users('directory-filter-',0,'{"cities":["no-such-city"]}'::jsonb)->>'total','0','unmatched filters produce empty results');
select throws_ok($$select public.search_admin_users('',0,'{"statuses":"active"}'::jsonb)$$,'P0001','INVALID_ADMIN_FILTER','non-array facets rejected');
select throws_ok($$select public.search_admin_users('',0,'{"account_types":["invalid"]}'::jsonb)$$,'P0001','INVALID_ADMIN_FILTER','unknown type rejected');
select throws_ok($$select public.search_admin_users('',0,'{"sort":"invalid"}'::jsonb)$$,'P0001','INVALID_ADMIN_FILTER','unknown sort rejected');
select is(public.search_admin_users('directory-filter-',0,'{"ages":["18-24"]}'::jsonb)->>'total','1','age bucket matches consented birth dates');
select is(public.search_admin_users('directory-filter-',0,'{"ages":["under18","18-24","30-39","40-49","50plus"]}'::jsonb)->>'total','5','age buckets combine with OR');
select is(public.search_admin_users('directory-filter-',0,'{"ages":["unknown"],"account_types":["member"]}'::jsonb)->>'total','50','members without personal info stay unknown');
select is(public.search_admin_users('directory-filter-',0,'{"ages":["18-24"],"cities":["vancouver"]}'::jsonb)->>'total','0','age combines with other dimensions');
select throws_ok($$select public.search_admin_users('',0,'{"ages":["90plus"]}'::jsonb)$$,'P0001','INVALID_ADMIN_FILTER','unknown age bucket rejected');
select is(public.search_admin_users('directory-filter-',0,'{"genders":["female"]}'::jsonb)->>'total','2','gender facet matches consenting members');
select is(public.search_admin_users('directory-filter-',0,'{"genders":["male","other"]}'::jsonb)->>'total','2','gender buckets combine with OR');
select is(public.search_admin_users('directory-filter-',0,'{"genders":["unknown"],"account_types":["member"]}'::jsonb)->>'total','51','members without a stated gender stay unknown');
select throws_ok($$select public.search_admin_users('',0,'{"genders":["secret"]}'::jsonb)$$,'P0001','INVALID_ADMIN_FILTER','unknown gender rejected');
reset role;
select set_config('request.jwt.claims','{"sub":"74800000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.search_admin_users('',0,'{}'::jsonb)$$,'P0001','ADMIN_REQUIRED','multi-filter search requires admin');
reset role;
set local role anon;
select throws_ok($$select public.search_admin_users('',0,'{}'::jsonb)$$,'42501',null,'anonymous multi-filter search denied');
reset role;
select * from finish();
rollback;
