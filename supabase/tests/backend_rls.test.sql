begin;

select plan(17);

select has_table('public', 'conversations', 'direct conversations table exists');
select has_table('public', 'reports', 'reports table exists');
select has_function(
  'public',
  'create_report',
  array['text', 'uuid', 'text', 'text'],
  'report creation is server controlled'
);

insert into auth.users (id, email, raw_app_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'one@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'two@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'outsider@example.com', '{}'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@example.com', '{"role":"admin"}');

insert into public.profiles (id, nickname, city_id)
values
  ('11111111-1111-1111-1111-111111111111', '사용자일', 'vancouver'),
  ('22222222-2222-2222-2222-222222222222', '사용자이', 'vancouver'),
  ('33333333-3333-3333-3333-333333333333', '외부사용자', 'vancouver'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '관리자', 'vancouver');

set local role anon;
select throws_ok(
  $$select * from public.profiles$$,
  '42501',
  null,
  'anonymous users cannot read profiles'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$update public.profiles set bio = '내 소개' where id = '11111111-1111-1111-1111-111111111111'$$,
  'users update their own profile'
);
select results_eq(
  $$update public.profiles set bio = '탈취' where id = '22222222-2222-2222-2222-222222222222' returning id$$,
  array[]::uuid[],
  'users cannot update another profile'
);

select lives_ok(
  $$select public.create_post(
      'vancouver',
      (select id from public.tags where slug = 'life'),
      '오늘의 글',
      '밴쿠버의 평범한 하루',
      array[]::text[],
      array[]::text[],
      null
    )$$,
  'users create their own daily post'
);
select throws_ok(
  $$select public.create_post(
      'vancouver',
      (select id from public.tags where slug = 'life'),
      '두 번째 글',
      '같은 날에는 허용되지 않는다',
      array[]::text[],
      array[]::text[],
      null
    )$$,
  'P0001',
  'DAILY_POST_LIMIT_REACHED',
  'daily post limit is enforced by the database'
);

create temporary table test_state (
  conversation_id uuid,
  message_id uuid,
  report_id uuid
);

insert into test_state (conversation_id)
select public.start_conversation('22222222-2222-2222-2222-222222222222');

update test_state
set message_id = public.send_message(conversation_id, '검증할 대화');

select results_eq(
  $$select body from public.messages where id = (select message_id from test_state)$$,
  array['검증할 대화'],
  'conversation members read messages'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
  true
);
set local role authenticated;
select is_empty(
  $$select id from public.messages where id = (select message_id from test_state)$$,
  'non-members cannot read messages'
);
select throws_ok(
  $$select public.create_report(
      'message',
      (select message_id from test_state),
      'other',
      '볼 수 없는 메시지'
    )$$,
  'P0001',
  'TARGET_NOT_FOUND',
  'non-members cannot report or probe private messages'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;
update test_state
set report_id = public.create_report(
  'message',
  message_id,
  'harassment',
  '신고 상세'
);

select results_eq(
  $$select reported_user_id from public.reports where id = (select report_id from test_state)$$,
  array['11111111-1111-1111-1111-111111111111'::uuid],
  'reported user is derived from the target message'
);
select ok(
  not has_table_privilege('authenticated', 'public.reports', 'insert'),
  'clients cannot forge report rows directly'
);
select throws_ok(
  $$select public.resolve_report((select report_id from test_state), 'actioned', '권한 없음')$$,
  'P0001',
  'ADMIN_REQUIRED',
  'non-admins cannot resolve reports'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}',
  true
);
set local role authenticated;
select results_eq(
  $$select body from public.messages where id = (select message_id from test_state)$$,
  array['검증할 대화'],
  'admins can inspect reported conversations'
);
select lives_ok(
  $$select public.resolve_report((select report_id from test_state), 'actioned', '경고 처리')$$,
  'admins resolve reports atomically'
);
select results_eq(
  $$select action from public.moderation_actions where report_id = (select report_id from test_state)$$,
  array['warned'],
  'report resolution leaves an audit trail'
);

select * from finish();
rollback;
