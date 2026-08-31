begin;

select plan(15);

select has_table('public', 'post_shares', 'authenticated shares are deduplicated');
select has_table('private', 'action_rate_events', 'server rate events exist');
select has_function('public', 'create_comment', array['uuid', 'text'], 'comments use a rate-limited RPC');
select has_function('public', 'get_trending_hashtags', array['text', 'smallint', 'integer', 'integer'], 'trending hashtags are server calculated');

insert into auth.users (id, email, raw_app_meta_data)
values
  ('51111111-1111-1111-1111-111111111111', 'abuse-one@example.com', '{}'),
  ('52222222-2222-2222-2222-222222222222', 'abuse-two@example.com', '{}');

insert into public.profiles (id, nickname, city_id, daily_post_limit)
values
  ('51111111-1111-1111-1111-111111111111', '제한사용자일', 'vancouver', 4),
  ('52222222-2222-2222-2222-222222222222', '제한사용자이', 'vancouver', 4);

create temporary table abuse_state (post_id uuid, conversation_id uuid);
grant select, insert, update on abuse_state to authenticated;
grant select on abuse_state to anon;

select set_config('request.jwt.claims', '{"sub":"51111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

insert into abuse_state (post_id)
select public.create_post(
  'vancouver',
  (select id from public.tags where slug = 'life'),
  '어뷰징 방지 글',
  '공유와 입력 경계를 확인합니다.',
  array['#coquitlam', '코퀴틀럼', 'coquitlam'],
  array[]::text[],
  null
);

select results_eq(
  $$select hashtags from public.posts where id = (select post_id from abuse_state)$$,
  $$values (array['코퀴틀람']::text[])$$,
  'aliases and duplicate hashtags are canonicalized at the database boundary'
);

select results_eq(
  $$select public.record_post_share((select post_id from abuse_state))$$,
  array[1],
  'first authenticated share increments the count'
);
select results_eq(
  $$select public.record_post_share((select post_id from abuse_state))$$,
  array[1],
  'repeat shares by the same account do not increment the count'
);
reset role;
select results_eq(
  $$select count(*)::integer from public.post_shares where post_id = (select post_id from abuse_state)$$,
  array[1],
  'only one share receipt is stored per account and post'
);

select set_config('request.jwt.claims', '{"sub":"51111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select public.create_post(
    'vancouver',
    (select id from public.tags where slug = 'life'),
    '긴 태그',
    '태그 길이를 확인합니다.',
    array[repeat('가', 31)],
    array[]::text[],
    null
  )$$,
  'P0001',
  'INVALID_HASHTAG',
  'oversized hashtags are rejected by the database'
);

select lives_ok(
  $$select public.create_comment((select post_id from abuse_state), '첫 댓글')$$,
  'first comment is accepted'
);
select throws_ok(
  $$select public.create_comment((select post_id from abuse_state), '즉시 반복 댓글')$$,
  'P0001',
  'RATE_LIMITED',
  'comment cooldown is enforced server-side'
);

reset role;
update public.safety_review_queue
set status = 'reviewed', reviewed_at = now()
where target_type = 'post' and target_id = (select post_id from abuse_state);

select set_config('request.jwt.claims', '{"sub":"51111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
update public.posts set body = '수정된 본문은 다시 검토됩니다.' where id = (select post_id from abuse_state);

reset role;
select results_eq(
  $$select status from public.safety_review_queue where target_type = 'post' and target_id = (select post_id from abuse_state)$$,
  array['pending'],
  'editing content requeues it for safety review'
);

select set_config('request.jwt.claims', '{"sub":"51111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select public.create_post(
  'vancouver',
  (select id from public.tags where slug = 'life'),
  '두 번째 태그 글',
  '같은 작성자의 태그는 한 표입니다.',
  array['코퀴틀람'],
  array[]::text[],
  null
);

reset role;
select set_config('request.jwt.claims', '{"sub":"52222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select public.create_post(
  'vancouver',
  (select id from public.tags where slug = 'life'),
  '다른 작성자 태그 글',
  '다른 작성자는 한 표를 더합니다.',
  array['coquitlam'],
  array[]::text[],
  null
);

select results_eq(
  $$select author_count from public.get_trending_hashtags('vancouver', (select id from public.tags where slug = 'life'), 7, 10) where hashtag = '코퀴틀람'$$,
  array[2],
  'trending hashtags count unique authors rather than repeated posts'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.record_post_share((select post_id from abuse_state))$$,
  '42501',
  null,
  'anonymous users cannot record shares'
);

reset role;
select ok(
  not has_table_privilege('authenticated', 'public.comments', 'insert'),
  'clients cannot bypass comment rate limits with direct inserts'
);

select * from finish();
rollback;
