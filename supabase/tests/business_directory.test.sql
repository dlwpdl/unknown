begin;
set local search_path=public,extensions;
select no_plan();
insert into public.tags(id,slug,label,sort_order,kind) values (24000,'directory-test','Directory fixture',24000,'post');
insert into public.cities values ('directory-test','Directory','BC','America/Vancouver',true),('directory-closed','Closed','BC','America/Vancouver',false);
insert into auth.users(id,email,raw_app_meta_data) values
 ('d2400000-0000-4000-8000-000000000001','directory-owner@example.test','{"merchant_enabled":true}'),
 ('d2400000-0000-4000-8000-000000000002','directory-reader@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('d2400000-0000-4000-8000-000000000001','DirectoryOwner','directory-test'),
 ('d2400000-0000-4000-8000-000000000002','DirectoryReader','directory-test');
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at,industry,services,address,contact)
 select ('d2410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Business '||lpad(n::text,2,'0'),'directory-test','trial','granted','Synthetic fixture','business',
 'd2400000-0000-4000-8000-000000000001',now(),case when n<=25 then '음식' else '' end,'Coffee','Vancouver','PRIVATE_CONTACT'
 from generate_series(1,27)n;
update private.merchants set name='100% Coffee',services='literal_under_score',address=E'back\\slash' where id='d2410000-0000-4000-8000-000000000001';
update private.merchants set industry='   ' where id='d2410000-0000-4000-8000-000000000027';
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at,industry)
 values ('d2410000-0000-4000-8000-000000000028','Hidden paused','directory-test','paused','granted','Fixture','business','d2400000-0000-4000-8000-000000000001',now(),'비공개'),
 ('d2410000-0000-4000-8000-000000000029','Hidden consent','directory-test','trial','pending','','business','d2400000-0000-4000-8000-000000000001',now(),'비공개'),
 ('d2410000-0000-4000-8000-000000000030','Hidden source','directory-test','lead','granted','Fixture','source','d2400000-0000-4000-8000-000000000001',now(),'비공개'),
 ('d2410000-0000-4000-8000-000000000031','Hidden registration','directory-test','trial','granted','Fixture','business',null,null,'비공개'),
 ('d2410000-0000-4000-8000-000000000032','Closed business','directory-closed','trial','granted','Fixture','business','d2400000-0000-4000-8000-000000000001',now(),'음식');
insert into private.webshops(merchant_id,enabled,url) values
 ('d2410000-0000-4000-8000-000000000001',true,'https://www.order.store/ca/store/test-branch/ZFgz2GjZSAuhlUYeO1fupA'),
 ('d2410000-0000-4000-8000-000000000002',false,null);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.get_public_business_directory('directory-test')->'items'),20,'20 visible registrations per page without posts');
select is(public.get_public_business_directory('directory-test')->>'has_more','true','one visible lookahead enables paging');
select is(public.get_public_business_directory('directory-test')->>'next_offset','20','cursor uses visible page length');
select is(public.get_public_business_directory('directory-test')->'items'->0->>'id','d2410000-0000-4000-8000-000000000026','industry/name/id order is deterministic');
select is(jsonb_array_length(public.get_public_business_directory('directory-test','',null,20)->'items'),7,'next page has remaining visible businesses');
select is(public.get_public_business_directory('directory-test','',null,20)->>'has_more','false','last page has no lookahead');
select is(public.get_public_business_directory('directory-test','',null,20)->>'next_offset','27','last offset exact');
select is(public.get_public_business_directory('directory-test','',null,20)->'items'->0->>'id','d2410000-0000-4000-8000-000000000019','page boundary uses the same deterministic order');
select is(public.get_public_business_directory('directory-test','',null,40)->'items','[]'::jsonb,'exhausted page is empty');
select is(public.get_public_business_directory('directory-test','',null,40)->>'next_offset','40','empty page preserves offset');
select is(public.get_public_business_directory('directory-test')->'industries','["기타","음식"]'::jsonb,'only visible industries, blank mapped to 기타');
select is(public.get_public_business_directory('directory-test','no match','음식')->'industries','["기타","음식"]'::jsonb,'industries independent of query and filter');
select is(jsonb_array_length(public.get_public_business_directory('directory-test','','기타')->'items'),2,'기타 filter includes blank industry');
select is(jsonb_array_length(public.get_public_business_directory('directory-test','%')->'items'),1,'percent search is literal');
select is(jsonb_array_length(public.get_public_business_directory('directory-test','_')->'items'),1,'underscore search is literal');
select is(jsonb_array_length(public.get_public_business_directory('directory-test',E'\\')->'items'),1,'backslash search is literal');
select is(jsonb_array_length(public.get_public_business_directory('directory-test','cOfFeE')->'items'),20,'search ignores case across name and services');
select is(public.get_public_business_directory('directory-test',' 100% ')->>'query','100%','query scope is normalized');
select is(public.get_public_business_directory('directory-test','100%')->'items'->0->>'has_webshop','true','enabled safe public webshop present');
select is(public.get_public_business_directory('directory-test','Business 02')->'items'->0->>'has_webshop','false','disabled webshop absent');
select is(public.get_public_business_directory('directory-closed')->'items','[]'::jsonb,'closed city empty');
select is(public.get_public_business_directory('unknown')->'industries','[]'::jsonb,'unknown city empty');
select ok(public.get_public_business_directory('directory-test')::text !~ 'PRIVATE_CONTACT|owner_id|contact|public_phone|d2400000','directory projects no owner or contact data');
select is((select count(*) from jsonb_object_keys(public.get_public_business_directory('directory-test')->'items'->0)),10::bigint,'exact public item contract');
select ok(has_function_privilege('anon','public.get_public_business_directory(text,text,text,integer)','EXECUTE'),'anon can execute');
select ok(has_function_privilege('authenticated','public.get_public_business_directory(text,text,text,integer)','EXECUTE'),'authenticated can execute');
select ok(not has_function_privilege('service_role','public.get_public_business_directory(text,text,text,integer)','EXECUTE'),'no service role execute grant');
reset role;
select ok(not has_table_privilege('anon','private.merchants','SELECT'),'merchant table remains private');
set local role anon;
select throws_ok($$select public.get_public_business_directory(null)$$,'P0001','INVALID_BUSINESS_DIRECTORY_REQUEST','null city rejected');
select throws_ok($$select public.get_public_business_directory('directory-test','',null,-1)$$,'P0001','INVALID_BUSINESS_DIRECTORY_REQUEST','negative offset rejected');
select throws_ok($$select public.get_public_business_directory('directory-test','',null,10001)$$,'P0001','INVALID_BUSINESS_DIRECTORY_REQUEST','deep offset bounded');
select throws_ok($$select public.get_public_business_directory('directory-test',repeat('x',201))$$,'P0001','INVALID_BUSINESS_DIRECTORY_REQUEST','query bounded');
reset role;
update private.merchants set deleted_at=now() where id='d2410000-0000-4000-8000-000000000003';
update private.merchants set consent='revoked' where id='d2410000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"d2400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into private.business_blocks(user_id,business_id) values ('d2400000-0000-4000-8000-000000000002','d2410000-0000-4000-8000-000000000005');
insert into private.saved_merchants(user_id,merchant_id) values ('d2400000-0000-4000-8000-000000000002','d2410000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_public_business_directory('directory-test','100%')->'items'->0->>'saved','true','saved state scoped to viewer');
select is(public.get_public_business_directory('directory-test','Business 03')->'items','[]'::jsonb,'deleted record hidden');
select is(public.get_public_business_directory('directory-test','Business 04')->'items','[]'::jsonb,'revoked consent hidden');
select is(public.get_public_business_directory('directory-test','Business 05')->'items','[]'::jsonb,'business block obeys profile visibility');
select is(jsonb_array_length(public.get_public_business_directory('directory-test')->'items'),20,'pagination applies after visibility filtering');
select is(jsonb_array_length(public.get_public_business_directory('directory-test','',null,20)->'items'),4,'hidden rows never consume offsets');
reset role;
insert into public.blocks(blocker_id,blocked_id) values ('d2400000-0000-4000-8000-000000000002','d2400000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.get_public_business_directory('directory-test')->'items','[]'::jsonb,'owner block preserved');
select is(public.get_public_business_directory('directory-test')->'industries','[]'::jsonb,'blocked owner industries never leak');
reset role;
delete from public.blocks where blocker_id='d2400000-0000-4000-8000-000000000002';
insert into public.posts(id,author_id,city_id,tag_id,title,body,business_author_id) values
 ('d2420000-0000-4000-8000-000000000001','d2400000-0000-4000-8000-000000000001','directory-test',24000,'Business news one','Synthetic fixture','d2410000-0000-4000-8000-000000000001'),
 ('d2420000-0000-4000-8000-000000000002','d2400000-0000-4000-8000-000000000001','directory-test',24000,'Business news two','Synthetic fixture','d2410000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.get_public_business_directory('directory-test','100%')->'items'),1,'repeated business posts do not duplicate a business');
select is(public.get_public_business_directory('directory-test','100%')->'items'->0->>'saved','false','another viewer never receives saved state');
reset role;
select * from finish();
rollback;
