begin;

select plan(20);

select col_type_is('public', 'profiles', 'account_status', 'text', 'profiles expose an account lifecycle state');
select has_function('public', 'delete_my_account', array['text'], 'account deletion is server controlled');
select has_function('public', 'set_account_status', array['uuid', 'text', 'text'], 'admin can release account locks');
select has_function('public', 'reactivate_profile', array['text', 'text'], 'released users can create a fresh public profile');

insert into auth.users (id, email, raw_app_meta_data)
values
  ('71111111-1111-1111-1111-111111111111', 'delete-user@example.com', '{}'),
  ('72222222-2222-2222-2222-222222222222', 'delete-peer@example.com', '{}'),
  ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delete-admin@example.com', '{"role":"admin"}');

insert into public.profiles (id, nickname, city_id)
values
  ('71111111-1111-1111-1111-111111111111', '탈퇴테스트', 'vancouver'),
  ('72222222-2222-2222-2222-222222222222', '상대사용자', 'vancouver'),
  ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '탈퇴관리자', 'vancouver');

insert into public.posts (id, author_id, city_id, tag_id, title, body, posted_on, view_count, share_count)
values
  ('73111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111', 'vancouver', (select id from public.tags where slug = 'life'), '탈퇴 전 글', '탈퇴하면 삭제됩니다.', current_date, 1, 1),
  ('73222222-2222-2222-2222-222222222222', '72222222-2222-2222-2222-222222222222', 'vancouver', (select id from public.tags where slug = 'life'), '남아야 할 글', '상대 사용자의 글입니다.', current_date, 1, 1);

insert into public.comments (id, post_id, author_id, body)
values
  ('74111111-1111-1111-1111-111111111111', '73222222-2222-2222-2222-222222222222', '71111111-1111-1111-1111-111111111111', '삭제할 댓글'),
  ('74222222-2222-2222-2222-222222222222', '73111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222', '삭제될 글의 댓글'),
  ('74333333-3333-3333-3333-333333333333', '73222222-2222-2222-2222-222222222222', '72222222-2222-2222-2222-222222222222', '남아야 할 댓글');

insert into public.post_reactions (post_id, user_id, kind)
values
  ('73222222-2222-2222-2222-222222222222', '71111111-1111-1111-1111-111111111111', 'like'),
  ('73111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222', 'like');
insert into public.comment_likes (comment_id, user_id)
values
  ('74333333-3333-3333-3333-333333333333', '71111111-1111-1111-1111-111111111111'),
  ('74111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222');
insert into public.post_views (post_id, user_id)
values
  ('73222222-2222-2222-2222-222222222222', '71111111-1111-1111-1111-111111111111'),
  ('73111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222');
insert into public.post_shares (post_id, user_id)
values
  ('73222222-2222-2222-2222-222222222222', '71111111-1111-1111-1111-111111111111'),
  ('73111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222');

insert into public.blocks (blocker_id, blocked_id)
values ('71111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222');
insert into public.conversations (id, user_low_id, user_high_id)
values ('75111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222');
insert into public.messages (id, conversation_id, sender_id, body)
values
  ('76111111-1111-1111-1111-111111111111', '75111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111', '삭제할 메시지'),
  ('76222222-2222-2222-2222-222222222222', '75111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222', '같은 대화방 메시지');
insert into public.reports (id, reporter_id, reported_user_id, target_type, target_id, reason_code)
values
  ('77111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222', 'message', '76222222-2222-2222-2222-222222222222', 'other'),
  ('77222222-2222-2222-2222-222222222222', '72222222-2222-2222-2222-222222222222', '71111111-1111-1111-1111-111111111111', 'message', '76111111-1111-1111-1111-111111111111', 'other');
insert into public.moderation_actions (report_id, actor_id, action)
values ('77222222-2222-2222-2222-222222222222', '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'warned');
insert into public.meetup_requests (id, post_id, host_id, requester_id, message)
values ('79111111-1111-1111-1111-111111111111', '73111111-1111-1111-1111-111111111111', '71111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222', '참여 요청');
insert into public.notifications (user_id, kind, actor_id, target_type, target_id, body)
values
  ('71111111-1111-1111-1111-111111111111', 'message', '72222222-2222-2222-2222-222222222222', 'message', '76222222-2222-2222-2222-222222222222', '받은 알림'),
  ('72222222-2222-2222-2222-222222222222', 'comment', '71111111-1111-1111-1111-111111111111', 'comment', '74111111-1111-1111-1111-111111111111', '보낸 알림');
insert into private.action_rate_events (user_id, action)
values ('71111111-1111-1111-1111-111111111111', 'message');
insert into private.ai_draft_usage (user_id, usage_date, request_count)
values ('71111111-1111-1111-1111-111111111111', current_date, 1);
insert into public.admin_access_logs (actor_id, scope, subject_user_id)
values ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user_detail', '71111111-1111-1111-1111-111111111111');

select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$select public.delete_my_account('잘못된 확인')$$,
  'P0001',
  'CONFIRMATION_REQUIRED',
  'account deletion requires the exact confirmation phrase'
);
select lives_ok(
  $$select public.delete_my_account('탈퇴합니다')$$,
  'confirmed account deletion succeeds'
);

reset role;
select results_eq(
  $$select account_status from public.profiles where id = '71111111-1111-1111-1111-111111111111'$$,
  array['deleted'],
  'deleted account remains as an admin-visible tombstone'
);
select results_eq(
  $$select count(*)::integer from public.posts where author_id = '71111111-1111-1111-1111-111111111111'$$,
  array[0],
  'deleted account posts are permanently deleted'
);
select results_eq(
  $$select (nickname::text like '탈퇴회원_%' and city_id is null and neighborhood is null and bio is null and avatar_path is null) from public.profiles where id = '71111111-1111-1111-1111-111111111111'$$,
  array[true],
  'only a non-identifying deleted profile tombstone remains'
);
select results_eq(
  $$select count(*)::integer from public.comments where author_id = '71111111-1111-1111-1111-111111111111' or post_id = '73111111-1111-1111-1111-111111111111'$$,
  array[0],
  'deleted account comments and comments on its posts are removed'
);
select results_eq(
  $$select (select count(*) from public.conversations where '71111111-1111-1111-1111-111111111111' in (user_low_id, user_high_id)) + (select count(*) from public.messages where conversation_id = '75111111-1111-1111-1111-111111111111')$$,
  array[0::bigint],
  'deleted account conversations and messages are removed'
);
select results_eq(
  $$select
      (select count(*) from public.post_reactions where user_id = '71111111-1111-1111-1111-111111111111') +
      (select count(*) from public.comment_likes where user_id = '71111111-1111-1111-1111-111111111111') +
      (select count(*) from public.post_views where user_id = '71111111-1111-1111-1111-111111111111') +
      (select count(*) from public.post_shares where user_id = '71111111-1111-1111-1111-111111111111') +
      (select count(*) from public.blocks where '71111111-1111-1111-1111-111111111111' in (blocker_id, blocked_id)) +
      (select count(*) from public.meetup_requests where '71111111-1111-1111-1111-111111111111' in (host_id, requester_id)) +
      (select count(*) from private.action_rate_events where user_id = '71111111-1111-1111-1111-111111111111') +
      (select count(*) from private.ai_draft_usage where user_id = '71111111-1111-1111-1111-111111111111')$$,
  array[0::bigint],
  'reactions, views, shares, blocks, meetup requests and usage data are removed'
);
select results_eq(
  $$select
      (select count(*) from public.reports where '71111111-1111-1111-1111-111111111111' in (reporter_id, reported_user_id) or resolved_by = '71111111-1111-1111-1111-111111111111') +
      (select count(*) from public.notifications where '71111111-1111-1111-1111-111111111111' in (user_id, actor_id)) +
      (select count(*) from public.safety_review_queue where target_id in ('73111111-1111-1111-1111-111111111111', '74111111-1111-1111-1111-111111111111', '74222222-2222-2222-2222-222222222222', '76111111-1111-1111-1111-111111111111', '76222222-2222-2222-2222-222222222222')) +
      (select count(*) from public.admin_access_logs where subject_user_id = '71111111-1111-1111-1111-111111111111')$$,
  array[0::bigint],
  'reports, notifications, safety copies and user-linked admin logs are removed'
);
select results_eq(
  $$select concat_ws(':', like_count, comment_count, view_count, share_count) from public.posts where id = '73222222-2222-2222-2222-222222222222'$$,
  array['0:1:0:0'],
  'deleting one user preserves peer content and fixes its counters'
);

select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.delete_my_account('탈퇴합니다')$$,
  'a deleted account can retry cleanup without restoring access'
);
select throws_ok(
  $$select public.create_post(
    'vancouver',
    (select id from public.tags where slug = 'life'),
    '차단된 재가입',
    '관리자가 풀기 전에는 쓸 수 없습니다.',
    array[]::text[],
    array[]::text[],
    null
  )$$,
  'P0001',
  'ACCOUNT_LOCKED',
  'deleted account cannot write or re-register itself'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}', true);
set local role authenticated;
select lives_ok(
  $$select public.set_account_status('71111111-1111-1111-1111-111111111111', 'reactivation_pending', '본인 확인 완료')$$,
  'admin can release a deleted account for reactivation'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.reactivate_profile('돌아온사용자', 'toronto')$$,
  'released account can create a fresh profile'
);
select results_eq(
  $$select account_status || ':' || nickname::text || ':' || city_id from public.profiles where id = '71111111-1111-1111-1111-111111111111'$$,
  array['active:돌아온사용자:toronto'],
  'reactivation restores an active public profile'
);

reset role;
delete from auth.users where id = '71111111-1111-1111-1111-111111111111';
select results_eq(
  $$select count(*)::integer from public.profiles where id = '71111111-1111-1111-1111-111111111111'$$,
  array[0],
  'deleting the auth account removes the remaining profile record'
);

select * from finish();
rollback;
