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
select public.create_post('vancouver',(select id from public.tags where slug='life'),'지금 뜨는 글','본문','{}','{}');
reset role;

select set_config('test.post_id',(select id::text from public.posts where title='지금 뜨는 글'),true);
-- 기존 운영 글은 나이로 후보에서 빼고 이 글만 남겨 결정적으로 만든다 (트랜잭션은 롤백된다).
update public.posts set created_at = now() - interval '90 days' where id <> current_setting('test.post_id')::uuid;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.record_post_view(current_setting('test.post_id')::uuid);
reset role;

do $$ begin
  assert (select view_count from public.posts where id=current_setting('test.post_id')::uuid) = 1, 'anon view must increment';
  assert (select count(*) from public.post_views where post_id=current_setting('test.post_id')::uuid) = 0, 'anon view must not store a visitor row';
end $$;

update private.post_view_pulse set views = 60;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select public.record_post_view(current_setting('test.post_id')::uuid);
reset role;
do $$ begin
  assert (select view_count from public.posts where id=current_setting('test.post_id')::uuid) = 1, 'capped bucket must stop counting';
end $$;

update public.posts set view_count=100, like_count=10, comment_count=5 where id=current_setting('test.post_id')::uuid;
do $$ begin
  assert (select score from private.trending_candidates('vancouver',1)) > 10, 'hot post must clear the floor';
  assert (select count(*) from private.trending_candidates('toronto',5)) = 0, 'other city must have no candidate';
  assert private.send_trending_notifications() = 1, 'one city must send one post';
  assert (select count(*) from public.notifications where kind='trending_post'
    and user_id in ('49000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000002','49000000-0000-0000-0000-000000000003')) = 1,
    'exactly one test profile is notified';
  assert exists (select 1 from public.notifications where kind='trending_post' and user_id='49000000-0000-0000-0000-000000000002'), 'vancouver reader receives it';
  assert not exists (select 1 from public.notifications where kind='trending_post' and user_id='49000000-0000-0000-0000-000000000003'), 'toronto reader is skipped';
  assert not exists (select 1 from public.notifications where kind='trending_post' and user_id='49000000-0000-0000-0000-000000000001'), 'author is skipped';
  assert (select category from public.notifications where kind='trending_post' limit 1) = 'trending', 'category derived automatically';
  assert (select recipients from private.trending_sent) > 0, 'audience size recorded';
  assert private.send_trending_notifications() = 0, 'same post never announced twice';
end $$;

delete from private.trending_sent;
delete from public.notifications where kind='trending_post';
update private.trending_config set min_score = 100000 where id = true;
do $$ begin
  assert private.send_trending_notifications() = 0, 'below the floor must send nothing';
  assert (select count(*) from public.notifications where kind='trending_post') = 0, 'nothing delivered below floor';
end $$;
select 'ALL TRENDING CHECKS PASSED' as result;
