update private.trending_config set quiet_start_hour=0, quiet_end_hour=0, min_score=1,
  window_hours=48, repeat_after_hours=168, anon_view_weight=1 where id=true;
insert into auth.users(id,email) values
  ('4f000000-0000-0000-0000-000000000001','w-old@example.test'),
  ('4f000000-0000-0000-0000-000000000002','w-new@example.test'),
  ('4f000000-0000-0000-0000-000000000003','w-reader@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('4f000000-0000-0000-0000-000000000001','옛글쓴이','vancouver',now(),now(),now(),'test'),
  ('4f000000-0000-0000-0000-000000000002','새글쓴이','vancouver',now(),now(),now(),'test'),
  ('4f000000-0000-0000-0000-000000000003','독자','vancouver',now(),now(),now(),'test');

select set_config('request.jwt.claims','{"sub":"4f000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'옛날에 크게 터진 글','본문','{}','{}');
reset role;
select set_config('request.jwt.claims','{"sub":"4f000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'지금 반응 오는 글','본문','{}','{}');
reset role;
select set_config('test.old',(select id::text from public.posts where title='옛날에 크게 터진 글'),true);
select set_config('test.new',(select id::text from public.posts where title='지금 반응 오는 글'),true);
update public.posts set created_at=now()-interval '200 days', sort_at=now()-interval '200 days'
  where id not in (current_setting('test.old')::uuid, current_setting('test.new')::uuid);

-- 옛 글: 누적 조회 100만, 그런데 전부 30일 전 활동
update public.posts set view_count=1000000, like_count=5000 where id=current_setting('test.old')::uuid;
insert into private.post_view_pulse(post_id,bucket,views)
  values (current_setting('test.old')::uuid, date_bin(interval '10 minutes', now()-interval '30 days','2000-01-01'::timestamptz), 60);
-- 새 글: 누적은 작지만 지금 활동
update public.posts set view_count=40 where id=current_setting('test.new')::uuid;
insert into private.post_view_pulse(post_id,bucket,views)
  values (current_setting('test.new')::uuid, date_bin(interval '10 minutes', now(),'2000-01-01'::timestamptz), 40);

do $$
declare top_title text;
begin
  select title into top_title from public.posts
    where id = (select post_id from private.trending_candidates('vancouver',1));
  assert top_title = '지금 반응 오는 글',
    format('recent activity must win over lifetime totals, got %s', top_title);
  assert (select authed_views + anon_views from private.trending_candidates('vancouver',1)) = 40,
    'only the activity inside the window counts';
  assert not exists (
    select 1 from private.trending_candidates('vancouver',5) c
    where c.post_id = current_setting('test.old')::uuid and c.score > 0),
    'a post with no recent activity scores nothing';
end $$;

-- 알린 뒤에는 대기 시간 동안 빠지고, 지나면 돌아온다
do $$ begin
  assert private.send_trending_notifications() = 1, 'the fresh post is announced';
  assert not exists (select 1 from private.trending_candidates('vancouver',5)
    where post_id = current_setting('test.new')::uuid), 'it leaves the pool right after';
end $$;
update private.trending_sent set sent_at = now() - interval '8 days' where post_id=current_setting('test.new')::uuid;
do $$ begin
  assert exists (select 1 from private.trending_candidates('vancouver',5)
    where post_id = current_setting('test.new')::uuid), 'it returns once the wait has passed';
end $$;

-- 집계 구간을 넓히면 보관 기간도 함께 넓어져 그 구간의 활동이 잡힌다.
-- (반대로 이미 보관 기간을 넘겨 지워진 기록은 되살아나지 않는다 - 위 발송에서 30일 전 기록이 정리됐다.)
insert into private.post_view_pulse(post_id,bucket,views)
  values (current_setting('test.old')::uuid, date_bin(interval '10 minutes', now()-interval '30 days','2000-01-01'::timestamptz), 60);
update private.trending_config set window_hours = 24*40 where id = true;
do $$ begin
  assert (select anon_views from private.trending_candidates('vancouver',5)
    where post_id=current_setting('test.old')::uuid) = 60, 'a wider window counts the older activity';
end $$;
-- 넓힌 구간에서는 보관 정리가 그 기록을 지우지 않는다
select private.send_trending_notifications();
do $$ begin
  assert (select coalesce(sum(views),0) from private.post_view_pulse
    where post_id=current_setting('test.old')::uuid) = 60, 'retention keeps everything inside the window';
end $$;

select 'ROLLING WINDOW CHECKS PASSED' as result;
