begin;

select plan(20);

select has_function('public', 'create_post', array['text', 'smallint', 'text', 'text', 'text[]', 'text[]', 'jsonb'], 'post creation is server controlled');
select has_function('public', 'get_post_quota', array[]::text[], 'daily quota is server calculated');
select has_function('public', 'get_public_post', array['uuid'], 'single public post lookup exists');
select has_function('public', 'record_post_share', array['uuid'], 'share count is server controlled');

insert into auth.users (id, email, raw_app_meta_data)
values
  ('41111111-1111-1111-1111-111111111111', 'flow-one@example.com', '{}'),
  ('42222222-2222-2222-2222-222222222222', 'flow-two@example.com', '{}'),
  ('4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'flow-admin@example.com', '{"role":"admin"}');

insert into public.profiles (id, nickname, city_id)
values
  ('41111111-1111-1111-1111-111111111111', '흐름사용자일', 'vancouver'),
  ('42222222-2222-2222-2222-222222222222', '흐름사용자이', 'vancouver'),
  ('4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '흐름관리자', 'vancouver');

create temporary table flow_state (
  post_id uuid,
  comment_id uuid,
  report_id uuid,
  conversation_id uuid,
  message_id uuid
);
grant select, insert, update on flow_state to authenticated;
grant select on flow_state to anon;

select set_config('request.jwt.claims', '{"sub":"41111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

insert into flow_state (post_id)
select public.create_post(
  'vancouver',
  (select id from public.tags where slug = 'life'),
  'DB에 남는 글',
  '작성부터 관리자 확인까지 이어지는 글입니다.',
  array['일상'],
  array[]::text[],
  null
);

select results_eq(
  $$select title from public.get_public_post((select post_id from flow_state))$$,
  array['DB에 남는 글'],
  'created post is immediately public'
);
select results_eq(
  $$select used_count || '/' || max_count from public.get_post_quota()$$,
  array['1/1'],
  'quota reflects the persisted post'
);
select throws_ok(
  $$select public.create_post(
      'vancouver',
      (select id from public.tags where slug = 'life'),
      '두 번째 글',
      '기본 플랜은 하루 한 편입니다.',
      array[]::text[],
      array[]::text[],
      null
    )$$,
  'P0001',
  'DAILY_POST_LIMIT_REACHED',
  'daily post limit is enforced atomically'
);

insert into public.post_reactions (post_id, user_id, kind)
values ((select post_id from flow_state), '41111111-1111-1111-1111-111111111111', 'like');
select results_eq(
  $$select like_count from public.posts where id = (select post_id from flow_state)$$,
  array[1],
  'post reaction updates the persisted count'
);

update flow_state
set comment_id = public.create_comment(post_id, 'DB 댓글');

select results_eq(
  $$select comment_count from public.posts where id = (select post_id from flow_state)$$,
  array[1],
  'comment updates the persisted count'
);

select results_eq(
  $$select public.record_post_share((select post_id from flow_state))$$,
  array[1],
  'successful share updates the persisted count'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.record_post_share((select post_id from flow_state))$$,
  '42501',
  null,
  'guest shares cannot affect the persisted count'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"42222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

update flow_state
set report_id = public.create_report('post', post_id, 'harassment', '확인이 필요합니다.');
select results_eq(
  $$select status from public.reports where id = (select report_id from flow_state)$$,
  array['open'],
  'user report reaches the moderation queue'
);

update flow_state
set conversation_id = public.start_conversation('41111111-1111-1111-1111-111111111111');
update flow_state
set message_id = public.send_message(conversation_id, '모임에 참여하고 싶어요.');
select results_eq(
  $$select body from public.messages where id = (select message_id from flow_state)$$,
  array['모임에 참여하고 싶어요.'],
  'direct message is persisted'
);

insert into public.blocks (blocker_id, blocked_id)
values ('42222222-2222-2222-2222-222222222222', '41111111-1111-1111-1111-111111111111');
select throws_ok(
  $$select public.send_message((select conversation_id from flow_state), '차단 뒤 메시지')$$,
  'P0001',
  'BLOCKED',
  'blocking stops later messages'
);
select results_eq(
  $$select body from public.messages where id = (select message_id from flow_state)$$,
  array['모임에 참여하고 싶어요.'],
  'blocking preserves the existing conversation log'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"4aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}', true);
set local role authenticated;

select results_eq(
  $$select title from public.posts where id = (select post_id from flow_state)$$,
  array['DB에 남는 글'],
  'admin can inspect the created post'
);
select results_eq(
  $$select body from public.comments where id = (select comment_id from flow_state)$$,
  array['DB 댓글'],
  'admin can inspect the created comment'
);
select results_eq(
  $$select body from public.messages where id = (select message_id from flow_state)$$,
  array['모임에 참여하고 싶어요.'],
  'admin can inspect the conversation message'
);
select lives_ok(
  $$select public.resolve_report((select report_id from flow_state), 'actioned', '확인 완료')$$,
  'admin can resolve the user report'
);
select results_eq(
  $$select status from public.reports where id = (select report_id from flow_state)$$,
  array['actioned'],
  'resolved report remains auditable'
);

select * from finish();
rollback;
