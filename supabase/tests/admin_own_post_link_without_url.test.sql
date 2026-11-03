begin;
set local search_path=public,extensions;
select no_plan();
-- 1 admin · 2 member
insert into auth.users(id,email,raw_app_meta_data) select
 ('b2f00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'no-url-link-'||n||'@example.test',
 case when n=1 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,2)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select ('b2f00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'링크없는연결검사'||n,'toronto',now(),now(),now(),'test' from generate_series(1,2)n;
insert into auth.sessions(id,user_id,aal) values('b2f90000-0000-4000-8000-000000000001','b2f00000-0000-4000-8000-000000000001','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind) values
 ('b2f10000-0000-4000-8000-000000000001','링크없는구인식당','toronto','','lead','pending','','business');
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('b2f20000-0000-4000-8000-000000000001','b2f00000-0000-4000-8000-000000000001','toronto',1,'구인 옮긴 글','합성 구인 글'),
 ('b2f20000-0000-4000-8000-000000000002','b2f00000-0000-4000-8000-000000000001','toronto',1,'다른 옮긴 글','합성 다른 글'),
 ('b2f20000-0000-4000-8000-000000000003','b2f00000-0000-4000-8000-000000000002','toronto',1,'회원 글','합성 회원 글');

select set_config('request.jwt.claims','{"sub":"b2f00000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b2f90000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.link_admin_merchant_post('b2f10000-0000-4000-8000-000000000001','b2f20000-0000-4000-8000-000000000001',null)$$,
  'admin links its own copied post without a public link');
select throws_ok($$select public.link_admin_merchant_post('b2f10000-0000-4000-8000-000000000001','b2f20000-0000-4000-8000-000000000002','http://example.com/x')$$,
  'INVALID_ORIGINAL_URL','a given link must still be valid https');
select throws_ok($$select public.link_admin_merchant_post('b2f10000-0000-4000-8000-000000000001','b2f20000-0000-4000-8000-000000000003',null)$$,
  'INVALID_ORIGINAL_URL','someone else''s post still needs its original link');
select is(public.get_public_post_businesses(array['b2f20000-0000-4000-8000-000000000001']::uuid[])->0->>'business_name','링크없는구인식당',
  'the copied post shows under the business');
reset role;
select is((select original_url from private.merchant_posts where post_id='b2f20000-0000-4000-8000-000000000001'),null,'no link is stored');
select ok((select body from public.posts where id='b2f20000-0000-4000-8000-000000000001') like '%글링에서 옮겨 게시한 안내입니다.','pending line is added');
select * from finish();
rollback;
