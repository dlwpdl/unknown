begin;

select plan(6);

select has_table('public', 'admin_access_logs', 'admin access log table exists');
select has_function(
  'public',
  'log_admin_access',
  array['text', 'uuid', 'uuid'],
  'admin access logging is server controlled'
);

insert into auth.users (id, email, raw_app_meta_data)
values
  ('44444444-4444-4444-4444-444444444444', 'admin-console-user@example.com', '{}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin-console-admin@example.com', '{"role":"admin"}');

insert into public.profiles (id, nickname, city_id)
values
  ('44444444-4444-4444-4444-444444444444', '관리화면일반', 'vancouver'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '관리화면관리자', 'vancouver');

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$select public.log_admin_access('users', null, null)$$,
  'P0001',
  'ADMIN_REQUIRED',
  'non-admins cannot create admin access logs'
);
select is_empty(
  $$select id from public.admin_access_logs$$,
  'non-admins cannot read admin access logs'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated","app_metadata":{"role":"admin"}}',
  true
);
set local role authenticated;

select lives_ok(
  $$select public.log_admin_access('user_detail', '44444444-4444-4444-4444-444444444444', null)$$,
  'admins can record access before reading user details'
);
select results_eq(
  $$select actor_id::text || ':' || scope || ':' || subject_user_id::text from public.admin_access_logs$$,
  array['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:user_detail:44444444-4444-4444-4444-444444444444'],
  'admin access logs preserve actor, scope, and subject'
);

select * from finish();
rollback;
