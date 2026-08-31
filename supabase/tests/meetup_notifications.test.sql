begin;

select plan(16);

select has_table('public', 'meetup_requests', 'meetup requests table exists');
select has_table('public', 'notifications', 'in-app notifications table exists');
select has_function('public', 'request_meetup_join', array['uuid', 'text'], 'meetup request RPC exists');
select has_function('public', 'respond_meetup_request', array['uuid', 'text'], 'host response RPC exists');
select has_function('public', 'moderate_report', array['uuid', 'text', 'text'], 'admin moderation RPC exposes explicit actions');

insert into auth.users (id, email, raw_app_meta_data)
values
  ('61111111-1111-1111-1111-111111111111', 'meet-host@example.com', '{}'),
  ('62222222-2222-2222-2222-222222222222', 'meet-guest@example.com', '{}'),
  ('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'meet-admin@example.com', '{"role":"admin"}');

insert into public.profiles (id, nickname, city_id, verification_level)
values
  ('61111111-1111-1111-1111-111111111111', '모임호스트', 'vancouver', 2),
  ('62222222-2222-2222-2222-222222222222', '모임신청자', 'vancouver', 2),
  ('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '모임관리자', 'vancouver', 3);

create temporary table meetup_state (post_id uuid, request_id uuid, conversation_id uuid, report_id uuid);
grant select, insert, update on meetup_state to authenticated;

select set_config('request.jwt.claims', '{"sub":"61111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into meetup_state (post_id)
select public.create_post(
  'vancouver',
  (select id from public.tags where slug = 'meetup'),
  '승인형 모임',
  '호스트가 신청을 보고 승인합니다.',
  array['모임'],
  array[]::text[],
  '{"capacity":4,"verifiedOnly":true}'::jsonb
);

reset role;
select set_config('request.jwt.claims', '{"sub":"62222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
update meetup_state
set request_id = public.request_meetup_join(post_id, '주말에는 시간 조정 가능합니다.');

select results_eq(
  $$select status from public.meetup_requests where id = (select request_id from meetup_state)$$,
  array['pending'],
  'request waits for host approval'
);
select is_empty(
  $$select id from public.conversations where '61111111-1111-1111-1111-111111111111'::uuid in (user_low_id, user_high_id) and '62222222-2222-2222-2222-222222222222'::uuid in (user_low_id, user_high_id)$$,
  'requesting does not open a conversation'
);
reset role;
select results_eq(
  $$select kind from public.notifications where user_id = '61111111-1111-1111-1111-111111111111' and target_id = (select request_id from meetup_state)$$,
  array['meetup_request'],
  'host receives a meetup request notification'
);

select set_config('request.jwt.claims', '{"sub":"61111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
update meetup_state
set conversation_id = public.respond_meetup_request(request_id, 'approved');

select results_eq(
  $$select status from public.meetup_requests where id = (select request_id from meetup_state)$$,
  array['approved'],
  'host can approve a pending request'
);
select results_eq(
  $$select count(*)::integer from public.conversations where id = (select conversation_id from meetup_state)$$,
  array[1],
  'approval creates exactly one conversation'
);
reset role;
select results_eq(
  $$select kind from public.notifications where user_id = '62222222-2222-2222-2222-222222222222' and target_id = (select request_id from meetup_state) order by created_at desc limit 1$$,
  array['meetup_approved'],
  'requester receives the approval notification'
);
select set_config('request.jwt.claims', '{"sub":"61111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$select (room_preview ->> 'memberCount')::integer from public.posts where id = (select post_id from meetup_state)$$,
  array[2],
  'approval updates the meetup member count'
);

select public.send_message((select conversation_id from meetup_state), '승인 후 첫 메시지');
reset role;
select results_eq(
  $$select kind from public.notifications where user_id = '62222222-2222-2222-2222-222222222222' and kind = 'message' order by created_at desc limit 1$$,
  array['message'],
  'new messages create an in-app notification'
);

select set_config('request.jwt.claims', '{"sub":"62222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.post_reactions (post_id, user_id, kind)
select post_id, '62222222-2222-2222-2222-222222222222', 'like' from meetup_state;
delete from public.post_reactions
where post_id = (select post_id from meetup_state)
  and user_id = '62222222-2222-2222-2222-222222222222';
insert into public.post_reactions (post_id, user_id, kind)
select post_id, '62222222-2222-2222-2222-222222222222', 'like' from meetup_state;
reset role;
select results_eq(
  $$select count(*)::integer from public.notifications where user_id = '61111111-1111-1111-1111-111111111111' and actor_id = '62222222-2222-2222-2222-222222222222' and kind = 'post_like' and target_id = (select post_id from meetup_state)$$,
  array[1],
  're-liking a post does not duplicate its notification'
);

select set_config('request.jwt.claims', '{"sub":"62222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
update meetup_state
set report_id = public.create_report('post', post_id, 'other', '관리자 조치 테스트');

reset role;
select set_config('request.jwt.claims', '{"sub":"6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}', true);
set local role authenticated;
select lives_ok(
  $$select public.moderate_report((select report_id from meetup_state), 'warned', '커뮤니티 가이드를 확인해주세요.')$$,
  'admin can confirm a warning action'
);
select results_eq(
  $$select kind from public.notifications where user_id = '61111111-1111-1111-1111-111111111111' and kind = 'moderation_warning' order by created_at desc limit 1$$,
  array['moderation_warning'],
  'confirmed warning reaches the reported account'
);

select * from finish();
rollback;
