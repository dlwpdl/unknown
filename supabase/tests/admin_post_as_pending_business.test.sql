begin;
set local search_path=public,extensions;
select no_plan();
-- 1 admin · 2 member author · 3 viewer
insert into auth.users(id,email,raw_app_meta_data) select
 ('b1f00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pending-business-'||n||'@example.test',
 case when n=1 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,3)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select ('b1f00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'동의전비즈니스검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,aal) values('b1f90000-0000-4000-8000-000000000001','b1f00000-0000-4000-8000-000000000001','aal2');
-- 1 pending (no owner, every field filled) · 2 revoked · 3 granted (no owner) · 4 pending with no posts
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,industry,services,address,public_phone,business_hours,avatar_path,banner_path,map_photo_path) values
 ('b1f10000-0000-4000-8000-000000000001','동의전검사식당','vancouver','owner@example.test','lead','pending','','business','식당','비공개 소개','1 Private St','604-555-0101','매일 9-5',
  'b1f00000-0000-4000-8000-000000000001/b1f10000-0000-4000-8000-000000000001_b1f30000-0000-4000-8000-000000000001.webp','b1f00000-0000-4000-8000-000000000001/b1f10000-0000-4000-8000-000000000001_b1f30000-0000-4000-8000-000000000002.webp','b1f00000-0000-4000-8000-000000000001/b1f10000-0000-4000-8000-000000000001_b1f30000-0000-4000-8000-000000000003.webp'),
 ('b1f10000-0000-4000-8000-000000000002','철회검사식당','vancouver','','paused','revoked','','business','식당','','','','',null,null,null),
 ('b1f10000-0000-4000-8000-000000000003','동의검사식당','vancouver','','lead','granted','synthetic fixture','business','식당','','','','',null,null,null),
 ('b1f10000-0000-4000-8000-000000000004','글없는동의전식당','vancouver','','lead','pending','','business','식당','','','','',null,null,null);
insert into private.webshop_place_links(place_key,merchant_id,city_id) values('osm:node:771001','b1f10000-0000-4000-8000-000000000001','vancouver');
insert into storage.buckets(id,name,public) values('merchant-profile-images','merchant-profile-images',false) on conflict(id) do nothing;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('merchant-profile-images','b1f00000-0000-4000-8000-000000000001/b1f10000-0000-4000-8000-000000000001_b1f30000-0000-4000-8000-000000000003.webp',
 'b1f00000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":24}'::jsonb);
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('b1f20000-0000-4000-8000-000000000001','b1f00000-0000-4000-8000-000000000001','vancouver',1,'동의전 식당 소개','합성 동의전 식당 소개 글'),
 ('b1f20000-0000-4000-8000-000000000002','b1f00000-0000-4000-8000-000000000001','vancouver',1,'철회 식당 소개','합성 철회 식당 소개 글'),
 ('b1f20000-0000-4000-8000-000000000003','b1f00000-0000-4000-8000-000000000001','vancouver',1,'동의 식당 소개','합성 동의 식당 소개 글'),
 ('b1f20000-0000-4000-8000-000000000004','b1f00000-0000-4000-8000-000000000002','vancouver',1,'회원 식당 후기','합성 회원 식당 후기 글');

select set_config('request.jwt.claims','{"sub":"b1f00000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1f90000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.link_admin_merchant_post('b1f10000-0000-4000-8000-000000000001','b1f20000-0000-4000-8000-000000000001','https://example.com/pending')$$,
 'admin links its own post to a business that has not answered yet');
select throws_ok($$select public.link_admin_merchant_post('b1f10000-0000-4000-8000-000000000002','b1f20000-0000-4000-8000-000000000002','https://example.com/revoked')$$,
 'P0001','MERCHANT_CONSENT_REQUIRED','a business that withdrew is refused');
select lives_ok($$select public.link_admin_merchant_post('b1f10000-0000-4000-8000-000000000001','b1f20000-0000-4000-8000-000000000004','https://example.com/member')$$,
 'admin can still curate a member post for the pending business');
select lives_ok($$select public.link_admin_merchant_post('b1f10000-0000-4000-8000-000000000003','b1f20000-0000-4000-8000-000000000003','https://example.com/granted')$$,
 'admin links its own post to a granted business with no owner');
select lives_ok($$select public.link_admin_merchant_post('b1f10000-0000-4000-8000-000000000001','b1f20000-0000-4000-8000-000000000001','https://example.com/pending')$$,
 'linking the same post again is allowed');
reset role;

select is((select business_author_id from public.posts where id='b1f20000-0000-4000-8000-000000000001'),'b1f10000-0000-4000-8000-000000000001'::uuid,'admin post now belongs to the pending business');
select is((select business_author_id from public.posts where id='b1f20000-0000-4000-8000-000000000003'),'b1f10000-0000-4000-8000-000000000003'::uuid,'admin post belongs to the granted business without an owner');
select is((select business_author_id from public.posts where id='b1f20000-0000-4000-8000-000000000004'),null::uuid,'member post stays under its author');
select ok(not exists(select 1 from private.merchant_posts where post_id='b1f20000-0000-4000-8000-000000000002'),'nothing is linked to the withdrawn business');
select is((select body from public.posts where id='b1f20000-0000-4000-8000-000000000001'),
 '합성 동의전 식당 소개 글'||E'\n\n'||'비즈니스가 공개한 내용을 글링에서 옮겨 게시한 안내입니다.','pending business post carries the copied-from-public line once');
select is((select body from public.posts where id='b1f20000-0000-4000-8000-000000000003'),
 '합성 동의 식당 소개 글'||E'\n\n'||'비즈니스의 허락을 받아 글링에서 대신 게시한 안내입니다.','granted business post keeps the permission line');
select is((select body from public.posts where id='b1f20000-0000-4000-8000-000000000004'),'합성 회원 식당 후기 글','member post body is untouched');

-- A viewer sees the pending business as the author, with only name, city, industry and its posts.
select set_config('request.jwt.claims','{"sub":"b1f00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_public_post_businesses(array['b1f20000-0000-4000-8000-000000000001','b1f20000-0000-4000-8000-000000000004']::uuid[]),
 jsonb_build_array(jsonb_build_object('post_id','b1f20000-0000-4000-8000-000000000001','business_id','b1f10000-0000-4000-8000-000000000001',
   'business_name','동의전검사식당','avatar_path',null)),'feed shows the pending business name without its photo; the member post has no business');
select is((select author_nickname::text from public.get_public_post('b1f20000-0000-4000-8000-000000000001')),'동의전검사식당','post detail shows the business as author');
select is((select author_id from public.get_public_post('b1f20000-0000-4000-8000-000000000001')),'b1f10000-0000-4000-8000-000000000001'::uuid,'post detail opens the business profile');
select is(public.get_merchant_profile('b1f10000-0000-4000-8000-000000000001')-'saved'-'notifications_enabled',
 jsonb_build_object('id','b1f10000-0000-4000-8000-000000000001','name','동의전검사식당','city_id','vancouver','city_name',(select name from public.cities where id='vancouver'),
   'industry','식당','services','','address','','public_phone','','business_hours','','avatar_path',null,'banner_path',null,'review_post_id',null,
   'source_urls','[]'::jsonb,'can_message',false,'can_business_message',false),'pending profile has only name, city and industry');
select is((public.get_merchant_profile_posts('b1f10000-0000-4000-8000-000000000001','posts',0)->>'post_count')::int,1,'pending profile lists its post');
select is(public.get_merchant_profile_posts('b1f10000-0000-4000-8000-000000000001','posts',0)->'posts'->0->>'id','b1f20000-0000-4000-8000-000000000001','the listed post is the admin copy');
select is(public.get_merchant_profile('b1f10000-0000-4000-8000-000000000004'),null::jsonb,'a pending business with no such post stays private');
select is(public.get_merchant_profile('b1f10000-0000-4000-8000-000000000002'),null::jsonb,'a withdrawn business stays private');
select ok(not exists(select 1 from jsonb_array_elements(public.get_public_business_directory('vancouver','',null,0)->'items') i
 where i->>'id'='b1f10000-0000-4000-8000-000000000001'),'pending business stays out of the directory');
select ok(exists(select 1 from jsonb_array_elements(public.get_public_business_directory('vancouver','',null,0)->'items') i
 where i->>'id'='b1f10000-0000-4000-8000-000000000003'),'granted business is in the directory');
select ok(not exists(select 1 from jsonb_array_elements(public.search_public_directory('동의전검사식당','vancouver','all',0,'[]'::jsonb)->'items') i
 where i->>'id'='b1f10000-0000-4000-8000-000000000001'),'pending business stays out of search');
select is(public.get_city_business_links('vancouver'),'[]'::jsonb,'pending business place stays off the map');
select is(public.get_city_business_map_photos('vancouver'),'[]'::jsonb,'pending business map photo stays off the map');
reset role;
select is(public.get_business_public_media('b1f10000-0000-4000-8000-000000000001','avatar',0,null),null::jsonb,'pending business avatar is not served');
select is(public.get_business_public_media('b1f10000-0000-4000-8000-000000000001','map',0,null),null::jsonb,'pending business map photo is not served');

-- Once the business agrees, the same posts stay under it and its own fields become public; the line is not rewritten.
update private.merchants set consent='granted',consent_note='synthetic fixture' where id='b1f10000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_merchant_profile('b1f10000-0000-4000-8000-000000000001')->>'address','1 Private St','agreed business shows its own fields');
select is(jsonb_array_length(public.get_city_business_map_photos('vancouver')),1,'agreed business map photo shows');
reset role;
select ok(public.get_business_public_media('b1f10000-0000-4000-8000-000000000001','avatar',0,null) is not null,'agreed business avatar is served');
select ok((select body from public.posts where id='b1f20000-0000-4000-8000-000000000001') like '%옮겨 게시한 안내입니다.','earlier line stays as it was');

-- A business that later withdraws takes its posts' business identity down with it.
update private.merchants set consent='revoked' where id='b1f10000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_merchant_profile('b1f10000-0000-4000-8000-000000000001'),null::jsonb,'withdrawn business profile is private');
select is(public.get_public_post_businesses(array['b1f20000-0000-4000-8000-000000000001']::uuid[]),'[]'::jsonb,'withdrawn business no longer shows as author');
reset role;
select * from finish();
rollback;
