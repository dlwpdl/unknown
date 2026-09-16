begin;
select no_plan();

select has_function('public','get_admin_trending_config',array[]::text[],'admin config reader exists');
select has_function('public','set_admin_trending_config',array['jsonb'],'admin config writer exists');

-- 조용한 시간대를 꺼서 실행 시각과 무관하게 돌도록 한다.
update private.trending_config set quiet_start_hour = 0, quiet_end_hour = 0 where id = true;

insert into auth.users(id,email) values
  ('49000000-0000-0000-0000-000000000001','trend-author@example.test'),
  ('49000000-0000-0000-0000-000000000002','trend-reader@example.test'),
  ('49000000-0000-0000-0000-000000000003','trend-other-city@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('49000000-0000-0000-0000-000000000001','뜨는글쓴이','vancouver',now(),now(),now(),'test'),
  ('49000000-0000-0000-0000-000000000002','밴쿠버독자','vancouver',now(),now(),now(),'test'),
  ('49000000-0000-0000-0000-000000000003','토론토독자','toronto',now(),now(),now(),'test');

select set_config('request.jwt.claims','{"sub":"49000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_post('vancouver',(select id from public.tags where slug='life'),'지금 뜨는 글','본문','{}','{}')$$,
  'author publishes the post');
reset role;

select set_config('test.post_id',(select id::text from public.posts where title='지금 뜨는 글'),true);
-- 다른 글은 나이로 후보에서 빼서 이 글만 남긴다.
update public.posts set created_at = now() - interval '90 days' where id <> current_setting('test.post_id')::uuid;

-- 비로그인 조회도 집계된다 --------------------------------------------------
-- anon 은 posts 를 직접 읽지 못하므로 (실제 앱도 RPC 로만 접근한다) id 를 미리 잡아둔다.
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select lives_ok($$select public.record_post_view(current_setting('test.post_id')::uuid)$$,
  'anonymous reader can record a view');
reset role;
select is((select view_count from public.posts where id=current_setting('test.post_id')::uuid),1,
  'anonymous view increments the counter');
select is((select count(*)::int from public.post_views where post_id=current_setting('test.post_id')::uuid),0,
  'anonymous view stores no per-visitor row');

update private.post_view_pulse set views = 60;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select lives_ok($$select public.record_post_view(current_setting('test.post_id')::uuid)$$,
  'a view past the cap still succeeds');
reset role;
select is((select view_count from public.posts where id=current_setting('test.post_id')::uuid),1,
  'a capped bucket stops inflating the counter');

-- 점수와 발송 ---------------------------------------------------------------
update public.posts set view_count=100, like_count=10, comment_count=5 where id=current_setting('test.post_id')::uuid;

select ok((select score from private.trending_candidates('vancouver',1)) > 10,'hot post scores above the floor');
select is((select count(*)::int from private.trending_candidates('toronto',5)),0,'another city has no candidate');

select is(private.send_trending_notifications(),1,'one city sends one post');
select is((select count(*)::int from public.notifications where kind='trending_post'
  and user_id in ('49000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000002',
                  '49000000-0000-0000-0000-000000000003')),1,'exactly one test profile is notified');
select ok(exists(select 1 from public.notifications where kind='trending_post'
  and user_id='49000000-0000-0000-0000-000000000002'),'the same-city reader receives it');
select ok(not exists(select 1 from public.notifications where kind='trending_post'
  and user_id='49000000-0000-0000-0000-000000000003'),'the other city is skipped');
select ok(not exists(select 1 from public.notifications where kind='trending_post'
  and user_id='49000000-0000-0000-0000-000000000001'),'the author is skipped');
select is((select category from public.notifications where kind='trending_post' limit 1),'trending',
  'category is derived automatically');
-- 설정 행은 알림 화면을 연 뒤에야 생긴다. 행이 없어도 기본값으로 받아야 한다.
select ok((select recipients from private.trending_sent) > 0,'readers without a preference row still receive it');

select is(private.send_trending_notifications(),0,'the same post is never announced twice');

-- 기준선 아래면 아무것도 보내지 않는다
delete from private.trending_sent;
delete from public.notifications where kind='trending_post';
update private.trending_config set min_score = 100000 where id = true;
select is(private.send_trending_notifications(),0,'a score below the floor sends nothing');
select is((select count(*)::int from public.notifications where kind='trending_post'),0,
  'nothing is delivered below the floor');

-- 어드민만 설정을 본다 -------------------------------------------------------
select set_config('request.jwt.claims','{"sub":"49000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_admin_trending_config()$$,'ADMIN_REQUIRED','a non-admin cannot read the config');
reset role;

select * from finish();
rollback;
