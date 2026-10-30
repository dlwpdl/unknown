begin;
set local search_path=public,extensions;
select no_plan();
-- 1 owner (free plan) · 2 co-manager · 3 member · 4 admin
insert into auth.users(id,email,raw_app_meta_data) select
 ('b1d00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'admin-as-business-'||n||'@example.test',
 case when n=4 then '{"role":"admin"}'::jsonb else '{"merchant_enabled":true}'::jsonb end from generate_series(1,4)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select ('b1d00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'관리자비즈니스검사'||n,'vancouver',now(),now(),now(),'test' from generate_series(1,4)n;
insert into auth.sessions(id,user_id,aal) values('b1d90000-0000-4000-8000-000000000004','b1d00000-0000-4000-8000-000000000004','aal2');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,owner_id,owner_verified_at)
 values('b1d10000-0000-4000-8000-000000000001','지모코한도검사','vancouver','','lead','granted','synthetic fixture','business','b1d00000-0000-4000-8000-000000000001',now());
insert into private.merchant_operators(merchant_id,user_id,created_by) values('b1d10000-0000-4000-8000-000000000001','b1d00000-0000-4000-8000-000000000002','b1d00000-0000-4000-8000-000000000004');
select is((private.business_membership_details('b1d10000-0000-4000-8000-000000000001')->>'postLimit')::int,1,'fixture business is on the free one-post plan');

-- The business's own post uses up its one free post.
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('b1d20000-0000-4000-8000-000000000001','b1d00000-0000-4000-8000-000000000001','vancouver',1,'비즈니스 첫 글','합성 비즈니스 글 하나'),
 ('b1d20000-0000-4000-8000-000000000002','b1d00000-0000-4000-8000-000000000001','vancouver',1,'비즈니스 둘째 글','합성 비즈니스 글 둘'),
 ('b1d20000-0000-4000-8000-000000000003','b1d00000-0000-4000-8000-000000000002','vancouver',1,'공동관리자 글','합성 공동관리자 글'),
 ('b1d20000-0000-4000-8000-000000000004','b1d00000-0000-4000-8000-000000000004','vancouver',1,'관리자 행사 글','합성 관리자 행사 글'),
 ('b1d20000-0000-4000-8000-000000000005','b1d00000-0000-4000-8000-000000000004','vancouver',1,'관리자 개인 글','합성 관리자 개인 글'),
 ('b1d20000-0000-4000-8000-000000000006','b1d00000-0000-4000-8000-000000000003','vancouver',1,'회원 글','합성 회원 글'),
 ('b1d20000-0000-4000-8000-000000000007','b1d00000-0000-4000-8000-000000000004','vancouver',1,'관리자 예전 연결 글','합성 관리자 예전 연결 글');
select set_config('request.jwt.claims','{"sub":"b1d00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into private.merchant_posts(post_id,merchant_id,published_as_business) values('b1d20000-0000-4000-8000-000000000001','b1d10000-0000-4000-8000-000000000001',true);
select is((private.business_membership_details('b1d10000-0000-4000-8000-000000000001')->>'postsUsed')::int,1,'the free post is used');

-- Owner and co-manager stay capped, and cannot reach the admin RPC.
select throws_ok($$insert into private.merchant_posts(post_id,merchant_id,published_as_business) values('b1d20000-0000-4000-8000-000000000002','b1d10000-0000-4000-8000-000000000001',true)$$,
 'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','business owner past the cap is still blocked');
select set_config('request.jwt.claims','{"sub":"b1d00000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$insert into private.merchant_posts(post_id,merchant_id,published_as_business) values('b1d20000-0000-4000-8000-000000000003','b1d10000-0000-4000-8000-000000000001',true)$$,
 'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','co-manager past the cap is still blocked');
set local role authenticated;
select throws_ok($$select public.link_admin_merchant_post('b1d10000-0000-4000-8000-000000000001','b1d20000-0000-4000-8000-000000000003','https://example.com/event')$$,
 'P0001','ADMIN_REQUIRED','co-manager cannot use the admin link');
reset role;
select set_config('request.jwt.claims','{"sub":"b1d00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.link_admin_merchant_post('b1d10000-0000-4000-8000-000000000001','b1d20000-0000-4000-8000-000000000002','https://example.com/event')$$,
 'P0001','ADMIN_REQUIRED','business owner cannot use the admin link');
reset role;
-- A spoofed client claim without a live elevated admin session is not admin.
select set_config('request.jwt.claims','{"sub":"b1d00000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.link_admin_merchant_post('b1d10000-0000-4000-8000-000000000001','b1d20000-0000-4000-8000-000000000002','https://example.com/event')$$,
 'P0001','ADMIN_REQUIRED','forged admin claims are rejected');
reset role;
select ok(not has_function_privilege('anon','public.link_admin_merchant_post(uuid,uuid,text)','execute'),'anon cannot call the admin link');

-- The elevated admin links its own post past the business's cap: business authorship, managed usage.
select set_config('request.jwt.claims','{"sub":"b1d00000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","session_id":"b1d90000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.link_admin_merchant_post('b1d10000-0000-4000-8000-000000000001','b1d20000-0000-4000-8000-000000000004','https://example.com/event')$$,
 'admin links its own post to the business past the cap');
select lives_ok($$select public.link_admin_merchant_post('b1d10000-0000-4000-8000-000000000001','b1d20000-0000-4000-8000-000000000006','https://example.com/member')$$,
 'admin can still curate a member post');
reset role;
select is((select business_author_id from public.posts where id='b1d20000-0000-4000-8000-000000000004'),'b1d10000-0000-4000-8000-000000000001'::uuid,'admin post now appears as the business');
select is((select author_id from public.posts where id='b1d20000-0000-4000-8000-000000000004'),'b1d00000-0000-4000-8000-000000000004'::uuid,'real admin author stays recorded for moderation');
select ok((select managed from private.merchant_membership_usage where post_id='b1d20000-0000-4000-8000-000000000004'),'admin link is recorded as managed usage');
select is((private.business_membership_details('b1d10000-0000-4000-8000-000000000001')->>'postsUsed')::int,1,'admin link does not use the business''s own monthly posts');
select is((select business_author_id from public.posts where id='b1d20000-0000-4000-8000-000000000006'),null::uuid,'member post linked by admin never impersonates the business');
select is((select business_author_id from public.posts where id='b1d20000-0000-4000-8000-000000000005'),null::uuid,'admin post with no business link stays under the admin profile');
select ok(exists(select 1 from public.admin_access_logs where actor_id='b1d00000-0000-4000-8000-000000000004'),'admin link is audited');

-- An earlier curated link of the admin's own post is upgraded by linking again.
insert into private.merchant_posts(post_id,merchant_id,original_url) values('b1d20000-0000-4000-8000-000000000007','b1d10000-0000-4000-8000-000000000001','https://example.com/old');
select is((select business_author_id from public.posts where id='b1d20000-0000-4000-8000-000000000007'),null::uuid,'old curated link was not business-authored');
set local role authenticated;
select lives_ok($$select public.link_admin_merchant_post('b1d10000-0000-4000-8000-000000000001','b1d20000-0000-4000-8000-000000000007','https://example.com/old')$$,'admin re-links its earlier post');
reset role;
select is((select business_author_id from public.posts where id='b1d20000-0000-4000-8000-000000000007'),'b1d10000-0000-4000-8000-000000000001'::uuid,'re-link moves the admin post to the business profile');
select * from finish();
rollback;
