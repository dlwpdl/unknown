begin;
set local search_path=public,extensions;
select no_plan();
select has_function('public','search_public_directory',array['text','text','text','integer','jsonb'],'bounded unified directory read exists');
insert into public.cities values('search-a','Search A','BC','America/Vancouver',true),('search-b','Search B','ON','America/Toronto',true),('search-closed','Closed','BC','America/Vancouver',false),('search-us','Outside Canada','WA','America/Vancouver',true);
insert into public.tags(id,slug,label,kind) values(1,'life','Life','post'),(18,'jobs','Jobs','post') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) values
 ('e2350000-0000-4000-8000-000000000001','search-owner@example.test','{}'),
 ('e2350000-0000-4000-8000-000000000002','search-member@example.test','{"merchant_enabled":true}'),
 ('e2350000-0000-4000-8000-000000000003','search-other@example.test','{}');
insert into public.profiles(id,nickname,city_id) values
 ('e2350000-0000-4000-8000-000000000001','Ndl235','search-a'),
 ('e2350000-0000-4000-8000-000000000002','Ndl235 Member','search-a'),
 ('e2350000-0000-4000-8000-000000000003','A Ndl235 Toronto','search-b');
insert into auth.users(id,email) select ('e2350000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'search-hidden-'||n||'@example.test' from generate_series(4,6)n;
insert into public.profiles(id,nickname,city_id) values
 ('e2350000-0000-4000-8000-000000000004','Ndl235 Outside','search-us'),
 ('e2350000-0000-4000-8000-000000000005','Ndl235 Closed','search-closed'),
 ('e2350000-0000-4000-8000-000000000006','Ndl235 Inactive','search-a');
update public.profiles set account_status='suspended' where id='e2350000-0000-4000-8000-000000000006';
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind,owner_id,owner_verified_at,contact) values
 ('e2351000-0000-4000-8000-000000000001','Jimoco Ndl235','search-a','trial','granted','Synthetic fixture','business','e2350000-0000-4000-8000-000000000002',now(),'PRIVATE_CONTACT'),
 ('e2351000-0000-4000-8000-000000000002','Jimoco Ndl235 Toronto','search-b','trial','granted','Synthetic fixture','business','e2350000-0000-4000-8000-000000000002',now(),'PRIVATE_CONTACT'),
 ('e2351000-0000-4000-8000-000000000003','Ndl235 Paused','search-a','paused','granted','Synthetic fixture','business','e2350000-0000-4000-8000-000000000002',now(),'PRIVATE_CONTACT'),
 ('e2351000-0000-4000-8000-000000000004','Ndl235 No Consent','search-a','trial','revoked','Synthetic fixture','business','e2350000-0000-4000-8000-000000000002',now(),'PRIVATE_CONTACT');
update private.merchants set industry='Café / coffee shop' where id::text like 'e2351000-%';
insert into private.webshop_place_links(place_key,city_id,merchant_id) values('osm:node:235001','search-a','e2351000-0000-4000-8000-000000000001'),('osm:node:235002','search-a','e2351000-0000-4000-8000-000000000003');
insert into public.posts(id,author_id,city_id,tag_id,title,body,hashtags) values
 ('e2352000-0000-4000-8000-000000000001','e2350000-0000-4000-8000-000000000002','search-a',1,'Ndl235 public post','PRIVATE_BODY_CONTACT',array['SearchHash']),
 ('e2352000-0000-4000-8000-000000000002','e2350000-0000-4000-8000-000000000002','search-a',(select id from public.tags where slug='jobs'),'Ndl235 job','PRIVATE_JOB_BODY','{}'),
 ('e2352000-0000-4000-8000-000000000003','e2350000-0000-4000-8000-000000000003','search-b',1,'Ndl235 Toronto post','PRIVATE_BODY','{}');
update public.posts set room_preview='{"id":"room","title":"Ndl235 meetup","memberCount":2,"capacity":8,"verifiedOnly":false,"eventKind":"group","cadence":"PUBLIC_SCHEDULE","hostContact":"PRIVATE_HOST"}' where id='e2352000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(jsonb_array_length(public.search_public_directory('ndl235','search-a','business')->'items'),1,'city search returns only the eligible local branch');
select is(jsonb_array_length(public.search_public_directory('ndl235',null,'business')->'items'),2,'explicit Canada includes distinct visible branches');
select is(jsonb_array_length(public.search_public_directory(query,'search-a','business')->'items'),1,'public cafe industry is searchable with '||query||' while paused/revoked records stay hidden') from unnest(array['카페','cafe','café','커피']) query;
select is(jsonb_array_length(public.search_public_directory('coffee shop',null,'business')->'items'),2,'literal public industry search retains explicit Canada scope');
select is(public.search_public_directory('지모코','search-a','business')->'items'->0->>'id','e2351000-0000-4000-8000-000000000001','approved Korean Jimoco alias resolves without translation');
select is(public.search_public_directory('ndl235','search-a','person')->'items'->0->>'title','Ndl235','exact nickname precedes prefixes and partial matches');
select is(jsonb_array_length(public.search_public_directory('ndl235',null,'person')->'items'),3,'Canada excludes real closed-city, non-Canadian and inactive target rows');
select is(public.search_public_directory('ndl235','search-a','post')->'items'->0->>'id','e2352000-0000-4000-8000-000000000001','regular post returns safe metadata');
select is(public.search_public_directory('ndl235','search-a','meetup')->'items'->0->>'id','e2352000-0000-4000-8000-000000000002','meetup uses existing post destination identity');
select is(jsonb_array_length(public.search_public_directory('PRIVATE_BODY_CONTACT',null)->'items'),0,'private body and contacts are never searched');
select is(jsonb_array_length(public.search_public_directory('PRIVATE_CONTACT',null)->'items'),0,'business private contacts are never searched');
select is(jsonb_array_length(public.search_public_directory('searchhash','search-a','post')->'items'),1,'existing public hashtags remain searchable');
select is(jsonb_array_length(public.search_public_directory('%','search-a')->'items'),0,'percent is a literal rather than a wildcard');
select is(jsonb_array_length(public.search_public_directory('_','search-a')->'items'),0,'underscore is a literal rather than a wildcard');
select ok(public.search_public_directory('ndl235','search-a')::text !~ 'PRIVATE_|owner_id|author_id|image_path|hostContact|applicationQuestion|email|phone','DTO contains no raw actor, body, contact or storage keys');
select is(jsonb_array_length(public.search_public_directory('park','search-a','all',0,'[{"cityId":"search-a","placeId":"osm:node:235001","rank":0}]')->'items'),1,'a linked curated-name match contributes the visible canonical business');
select is(jsonb_array_length(public.search_public_directory('park','search-a','all',0,'[{"cityId":"search-a","placeId":"osm:node:235001","rank":0}]')->'links'),1,'one batch resolves only matching submitted keys');
select is(public.search_public_directory('park','search-a','all',0,'[{"cityId":"search-a","placeId":"osm:node:235002","rank":0}]')->'links','[]'::jsonb,'hidden branch links do not expose merchant identities');
select throws_ok($$select public.search_public_directory('x','missing')$$,'P0001','INVALID_UNIFIED_SEARCH_CITY','unknown cities rejected');
select throws_ok($$select public.search_public_directory('x','search-closed')$$,'P0001','INVALID_UNIFIED_SEARCH_CITY','closed cities rejected');
select throws_ok($$select public.search_public_directory('x','search-us')$$,'P0001','INVALID_UNIFIED_SEARCH_CITY','outside-Canada cities rejected');
select throws_ok($$select public.search_public_directory('x','search-a','all',0,'[{"cityId":"search-b","placeId":"osm:node:1","rank":0}]')$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','other-city candidate injection rejected');
select throws_ok($$select public.search_public_directory('x',null,'all',0,'[{"cityId":"missing","placeId":"osm:node:1","rank":0}]')$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','Canada still rejects unknown candidate cities');
select throws_ok($$select public.search_public_directory('x','search-a','all',0,'[{"cityId":"search-a","placeId":"osm:node:1","rank":0},{"cityId":"search-a","placeId":"osm:node:1","rank":1}]')$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','duplicate city/place keys rejected');
select throws_ok($$select public.search_public_directory('x','search-a','all',0,'[{"cityId":"search-a","placeId":"osm:node:1","rank":1.5}]')$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','fractional rank rejected');
select throws_ok($$select public.search_public_directory('x','search-a','all',0,'{}')$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','candidate object cannot replace the array');
select throws_ok($$select public.search_public_directory('x','search-a','all',0,'[{"cityId":"search-a","placeId":"osm:node:1","rank":0,"path":"PRIVATE"}]')$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','unexpected candidate fields rejected');
select throws_ok($$select public.search_public_directory('x','search-a','all',0,(select jsonb_agg(jsonb_build_object('cityId','search-a','placeId','osm:node:'||n,'rank',0)) from generate_series(1,2201)n))$$,'P0001','INVALID_UNIFIED_SEARCH_PLACES','2200 candidate cap is enforced');
reset role;
select set_config('request.jwt.claims','{"sub":"e2350000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.blocks(blocker_id,blocked_id) values('e2350000-0000-4000-8000-000000000002','e2350000-0000-4000-8000-000000000001');
set local role authenticated;
select is(jsonb_array_length(public.search_public_directory('ndl235','search-a','business')->'items'),0,'reverse block hides verified-owner business just as current profile');
select is(jsonb_array_length(public.search_public_directory('ndl235','search-a','post')->'items'),0,'reverse block hides personal post');
select is(jsonb_array_length(public.search_public_directory('ndl235','search-a','meetup')->'items'),0,'reverse block hides meetup');
reset role;
delete from public.blocks where blocker_id='e2350000-0000-4000-8000-000000000002' and blocked_id='e2350000-0000-4000-8000-000000000001';
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code,details) values('e2350000-0000-4000-8000-000000000001','e2350000-0000-4000-8000-000000000002','user','e2350000-0000-4000-8000-000000000002','other','Synthetic hide');
set local role authenticated;
select is(jsonb_array_length(public.search_public_directory('ndl235','search-a','business')->'items'),0,'report hides business owner-only publication path');
select is(jsonb_array_length(public.search_public_directory('ndl235','search-a','person')->'items'),1,'reported person is excluded while the current public owner remains');
reset role;
delete from public.reports where reporter_id='e2350000-0000-4000-8000-000000000001' and target_id='e2350000-0000-4000-8000-000000000002';
insert into private.merchants(id,name,city_id,status,consent,consent_note,record_kind) values('e2351000-0000-4000-8000-000000000005','Legacy fixture','search-a','paid','granted','Synthetic public legacy','business');
insert into public.posts(id,author_id,city_id,tag_id,title,body) values('e2352000-0000-4000-8000-000000000004','e2350000-0000-4000-8000-000000000003','search-a',1,'Legacy fixture post','PRIVATE_LEGACY_BODY');
insert into private.merchant_posts(post_id,merchant_id,creation_request_id) values('e2352000-0000-4000-8000-000000000004','e2351000-0000-4000-8000-000000000005','e2354000-0000-4000-8000-000000000001');
set local role authenticated;
select is(jsonb_array_length(public.search_public_directory('Legacy fixture','search-a','business')->'items'),1,'legacy visible publication admits the same branch as current profile');
select ok(public.get_merchant_profile('e2351000-0000-4000-8000-000000000005') is not null,'legacy search eligibility agrees with current profile');
reset role;
insert into public.posts(id,author_id,city_id,tag_id,title,body,business_author_id,image_paths) values('e2352000-0000-4000-8000-000000000005','e2350000-0000-4000-8000-000000000003','search-a',1,'Official fixture post','PRIVATE_OFFICIAL_BODY','e2351000-0000-4000-8000-000000000005',array['PRIVATE_ACTOR/first.webp']);
set local role authenticated;
select is(public.search_public_directory('Official fixture','search-a','post')->'items'->0->>'id','e2352000-0000-4000-8000-000000000005','official business post remains findable');
select ok(public.search_public_directory('Official fixture','search-a','post')::text !~ 'e2350000|PRIVATE_|author|storage|image|body','official search DTO masks real actor and all private media/body fields');
reset role;
update private.merchants set status='paused' where id='e2351000-0000-4000-8000-000000000005';
set local role authenticated;
select is(jsonb_array_length(public.search_public_directory('Official fixture','search-a','post')->'items'),0,'paused business cannot reappear through official post search');
reset role;
insert into public.posts(id,author_id,city_id,tag_id,title,body)
 select ('e2353000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e2350000-0000-4000-8000-000000000003','search-a',1,'Paging '||lpad(n::text,3,'0'),'PRIVATE' from generate_series(1,43)n;
set local role authenticated;
select set_config('search.page1',public.search_public_directory('paging','search-a','post')::text,true);
select set_config('search.page2',public.search_public_directory('paging','search-a','post',20)::text,true);
select is(jsonb_array_length(current_setting('search.page1')::jsonb->'items'),20,'first page is bounded at twenty');
select is(jsonb_array_length(current_setting('search.page2')::jsonb->'items'),20,'second page remains bounded');
select is(current_setting('search.page1')::jsonb->>'hasMore','true','lookahead proves more rows');
select is(current_setting('search.page2')::jsonb->'items'->0->>'title','Paging 021','stable ordering reaches exact next row');
select is(jsonb_array_length(public.search_public_directory('paging','search-a','post',40)->'items'),3,'final page is complete without a guessed cap');
select is(public.search_public_directory('paging','search-a','post',40)->>'hasMore','false','last page correctly ends pagination');
select is(jsonb_array_length(public.search_public_directory('paging','search-a','all')->'items'),3,'All returns only three of each kind');
select ok(not has_function_privilege('anon','private.unified_search_rank(text,text)','execute'),'private normalization helper is not public');
select ok(has_function_privilege('anon','public.search_public_directory(text,text,text,integer,jsonb)','execute'),'public search remains an anonymous safe projection');
select * from finish();
rollback;
