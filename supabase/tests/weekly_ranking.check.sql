insert into auth.users(id,email) values
  ('53000000-0000-0000-0000-000000000001','r-author@example.test'),
  ('53000000-0000-0000-0000-000000000002','r-reader@example.test'),
  ('53000000-0000-0000-0000-000000000003','r-seed@seed.gling.invalid');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version) values
  ('53000000-0000-0000-0000-000000000001','랭킹작성자','vancouver',now(),now(),now(),'test'),
  ('53000000-0000-0000-0000-000000000002','랭킹독자','vancouver',now(),now(),now(),'test'),
  ('53000000-0000-0000-0000-000000000003','시드계정','vancouver',now(),now(),now(),'test');

-- 기존 운영 글은 활동 기록을 지워 결정적으로 만든다
delete from private.post_view_pulse;
select set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'1등 글','본문','{}','{}');
reset role;
select set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'2등 글','본문','{}','{}');
reset role;
select set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.create_post('vancouver',(select id from public.tags where slug='life'),'시드 글','본문','{}','{}');
reset role;

insert into private.post_view_pulse(post_id,bucket,views)
 select id, date_bin(interval '10 minutes', now(),'2000-01-01'::timestamptz),
   case title when '1등 글' then 500 when '2등 글' then 200 else 9000 end
 from public.posts where title in ('1등 글','2등 글','시드 글');

do $$
declare made integer; rank1 text;
begin
  made := private.publish_weekly_ranking();
  assert made >= 1, 'a ranking is published';
  select p.title into rank1 from public.weekly_rankings r join public.posts p on p.id=r.post_id
    where r.city_id='vancouver' and r.rank=1;
  assert rank1 = '1등 글', format('the most active post leads, got %s', rank1);
  assert not exists (
    select 1 from public.weekly_rankings r join public.posts p on p.id=r.post_id where p.title='시드 글'),
    'seed accounts are kept out even with the highest numbers';
end $$;

-- 같은 주에 다시 돌려도 덮어쓰지 않는다 (순위가 고정이어야 의미가 있다)
do $$
declare before_count integer;
begin
  select count(*) into before_count from public.weekly_rankings;
  perform private.publish_weekly_ranking();
  assert (select count(*) from public.weekly_rankings) = before_count, 'a second run in the same week changes nothing';
end $$;

-- 독자에게 알림이 갔다
do $$ begin
  assert exists (select 1 from public.notifications
    where user_id='53000000-0000-0000-0000-000000000002' and body like '이번 주 인기 글%'),
    'the city hears about it';
  assert not exists (select 1 from public.notifications
    where user_id='53000000-0000-0000-0000-000000000003' and body like '이번 주 인기 글%'),
    'seed accounts are not notified';
end $$;

-- 피드가 읽는 모양
do $$
declare r jsonb;
begin
  r := public.get_weekly_ranking('vancouver');
  assert jsonb_array_length(r->'entries') >= 2, 'the feed can read the entries';
  assert (r->'entries'->0->>'rank')::int = 1, 'ordered by rank';
  assert r->'entries'->0->>'title' = '1등 글', 'with the winner first';
  assert (r->'entries'->0->>'views')::int = 500, 'and the numbers behind it';
  assert public.get_weekly_ranking('toronto') = '{}'::jsonb, 'a city with no ranking returns empty';
end $$;

-- 내려간 글은 순위에서 빠진다
select set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
update public.posts set status='removed' where title='1등 글';
reset role;
do $$ begin
  assert (public.get_weekly_ranking('vancouver')->'entries'->0->>'title') = '2등 글',
    'a post taken down drops out of the published ranking';
end $$;

select 'WEEKLY RANKING CHECKS PASSED' as result;
