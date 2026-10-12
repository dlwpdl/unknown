begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data) values
 ('9e000000-0000-4000-8000-000000000001','gated-owner@example.invalid','{"merchant_enabled":true}'),
 ('9e000000-0000-4000-8000-000000000002','gated-viewer@example.invalid','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'공개경계'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '9e000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,image_paths,room_preview,posted_on)
values
 ('9e100000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000001','vancouver',1,'공유할 이야기','body-private-sentinel',
  array['9e000000-0000-4000-8000-000000000001/cover.webp','9e000000-0000-4000-8000-000000000001/details.webp'],null,current_date),
 ('9e100000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where kind='meetup' limit 1),'함께 갈 모임','venue-private-sentinel',
  '{}','{"eventKind":"group","cadence":"매주 토요일","capacity":8,"memberCount":1,"applicationQuestion":"question-private-sentinel","location":"location-private-sentinel","custom":"custom-private-sentinel"}',current_date);
insert into public.comments(id,post_id,author_id,body) values
 ('9e200000-0000-4000-8000-000000000001','9e100000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002','comment-private-sentinel');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,trial_ends_at)
values('9e300000-0000-4000-8000-000000000001','공유 검사 업체','vancouver','','trial','granted','local fixture','9e000000-0000-4000-8000-000000000001',now(),current_date+1);
insert into private.merchant_posts(post_id,merchant_id,original_url)
values('9e100000-0000-4000-8000-000000000001','9e300000-0000-4000-8000-000000000001',null);
insert into storage.objects(bucket_id,name) values
 ('post-images','9e000000-0000-4000-8000-000000000001/cover.webp'),
 ('post-images','9e000000-0000-4000-8000-000000000001/details.webp');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select body from public.get_public_feed('vancouver') where id='9e100000-0000-4000-8000-000000000001'),'','legacy discovery never reveals an anonymous body');
select is((select body from public.get_public_feed_page('vancouver') where id='9e100000-0000-4000-8000-000000000001'),'','paged discovery never reveals an anonymous body');
select is((select body from public.get_public_feed_page_v2('vancouver') where id='9e100000-0000-4000-8000-000000000001'),'','current discovery never reveals an anonymous body');
select is((select body from public.get_public_post('9e100000-0000-4000-8000-000000000001')),'','direct detail RPC does not bypass the login gate');
select is((select body from public.get_public_author_posts('9e000000-0000-4000-8000-000000000001') where id='9e100000-0000-4000-8000-000000000001'),'','author history never reveals an anonymous body');
select is(public.get_public_user_activity('9e000000-0000-4000-8000-000000000001','story')->0->>'body','','security definer user history still obeys the inner redaction');
select is(public.get_merchant_profile_posts('9e300000-0000-4000-8000-000000000001')->'posts'->0->>'body','','security definer company history still obeys the inner redaction');
select is((select title from public.get_public_post('9e100000-0000-4000-8000-000000000001')),'공유할 이야기','title metadata remains discoverable');
select is((select image_paths from public.get_public_post('9e100000-0000-4000-8000-000000000001')),array['9e000000-0000-4000-8000-000000000001/cover.webp'],'only the cover path appears before login');
select is((select room_preview->>'cadence' from public.get_public_post('9e100000-0000-4000-8000-000000000002')),'매주 토요일','public schedule remains discoverable');
select ok(not(select room_preview ?| array['applicationQuestion','location','custom'] from public.get_public_post('9e100000-0000-4000-8000-000000000002')),'room redaction is an allowlist and hides unknown private fields');
select is_empty($$select id from public.get_public_feed_page('vancouver',null::smallint,'body-private-sentinel') where id='9e100000-0000-4000-8000-000000000001'$$,'legacy search cannot infer hidden body text');
select is_empty($$select id from public.get_public_feed_page_v2('vancouver',null::smallint,'body-private-sentinel') where id='9e100000-0000-4000-8000-000000000001'$$,'current search cannot infer hidden body text');
select ok(public.is_public_post_image('9e000000-0000-4000-8000-000000000001/cover.webp'),'anonymous cover signing remains allowed');
select ok(not public.is_public_post_image('9e000000-0000-4000-8000-000000000001/details.webp'),'anonymous attachment signing cannot bypass the gate');
select results_eq($$select name from storage.objects where bucket_id='post-images' and name like '9e000000-%'$$,
 array['9e000000-0000-4000-8000-000000000001/cover.webp'],'storage RLS reveals the anonymous cover only');
select throws_ok($$select * from public.get_public_comments(array['9e100000-0000-4000-8000-000000000001']::uuid[])$$,'42501',null,'flat comment RPC requires login');
select throws_ok($$select * from public.get_public_comments_page('9e100000-0000-4000-8000-000000000001')$$,'42501',null,'paged comment RPC requires login');
select throws_ok($$select * from public.get_comment_thread_page('9e100000-0000-4000-8000-000000000001')$$,'42501',null,'thread comment RPC requires login');
select throws_ok($$select * from public.get_comment_thread_context('9e100000-0000-4000-8000-000000000001','9e200000-0000-4000-8000-000000000001')$$,'42501',null,'thread context RPC requires login');
reset role;
select ok(not has_table_privilege('anon','public.posts','select'),'anonymous posts table access remains closed');
select ok(not has_table_privilege('anon','public.comments','select'),'anonymous comments table access remains closed');
select ok(not has_table_privilege('anon','public.messages','select'),'anonymous conversation content remains closed');

select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
select is_empty($$select id from public.get_comment_thread_page('9e100000-0000-4000-8000-000000000001')$$,'comment visibility requires a real authenticated user id');
reset role;
select ok(private.comment_visible_to('9e200000-0000-4000-8000-000000000001','9e000000-0000-4000-8000-000000000002'),'server notifications keep explicit recipient visibility without an auth session');

select set_config('request.jwt.claims','{"sub":"9e000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select body from public.get_public_feed('vancouver') where id='9e100000-0000-4000-8000-000000000001'),'body-private-sentinel','authenticated legacy feed keeps the body');
select is((select body from public.get_public_feed_page('vancouver') where id='9e100000-0000-4000-8000-000000000001'),'body-private-sentinel','authenticated paged feed keeps the body');
select is((select body from public.get_public_feed_page_v2('vancouver') where id='9e100000-0000-4000-8000-000000000001'),'body-private-sentinel','authenticated current feed keeps the body');
select is((select body from public.get_public_post('9e100000-0000-4000-8000-000000000001')),'body-private-sentinel','authenticated detail keeps the body');
select is((select body from public.get_public_author_posts('9e000000-0000-4000-8000-000000000001') where id='9e100000-0000-4000-8000-000000000001'),'body-private-sentinel','authenticated author history keeps the body');
select is((select cardinality(image_paths) from public.get_public_post('9e100000-0000-4000-8000-000000000001')),2,'login reveals the remaining image paths');
select is((select count(*)::integer from storage.objects where bucket_id='post-images' and name like '9e000000-%'),2,
 'existing authenticated storage access still includes full attachments');
select is((select room_preview->>'applicationQuestion' from public.get_public_post('9e100000-0000-4000-8000-000000000002')),'question-private-sentinel','login retains the existing application flow');
select is((select body from public.get_comment_thread_page('9e100000-0000-4000-8000-000000000001')),'comment-private-sentinel','login restores normal thread access');
select is((select count(*)::integer from public.get_public_feed_page_v2('vancouver',null::smallint,'body-private-sentinel') where id='9e100000-0000-4000-8000-000000000001'),1,'authenticated search still includes body text');
select public.create_report('post','9e100000-0000-4000-8000-000000000001','other','본문 로그인 경계 검사');
select is_empty($$select id from public.get_public_post('9e100000-0000-4000-8000-000000000001')$$,'login does not bypass the existing report hide');
insert into public.blocks(blocker_id,blocked_id) values('9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000001');
select is_empty($$select id from public.get_public_post('9e100000-0000-4000-8000-000000000002')$$,'login does not bypass the existing author block');
reset role;
select is((select count(*)::integer from public.meetup_requests where post_id='9e100000-0000-4000-8000-000000000002'),0,'preview and login do not approve or join a meetup');
select * from finish();
rollback;
