begin;

select plan(6);

select has_function('public', 'claim_safety_reviews', array['integer'], 'worker can atomically claim safety work');
select has_function('public', 'complete_safety_review', array['bigint', 'numeric', 'text', 'jsonb', 'text'], 'worker can persist a safety result');
select has_function('public', 'raise_safety_alert', array['bigint'], 'worker can alert admins for high-risk content');

insert into auth.users (id, email, raw_app_meta_data)
values ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'safety-admin@example.com', '{"role":"admin"}');
insert into public.profiles (id, nickname, city_id)
values ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '안전관리자', 'vancouver');

create temporary table safety_worker_state (queue_id bigint);
grant select, insert, update on safety_worker_state to service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into safety_worker_state (queue_id)
select id from public.claim_safety_reviews(1);

select lives_ok(
  $$select public.complete_safety_review((select queue_id from safety_worker_state), 0.95, 'critical', '["credible_threat"]'::jsonb, null)$$,
  'service worker stores a critical result'
);
select lives_ok(
  $$select public.raise_safety_alert((select queue_id from safety_worker_state))$$,
  'critical result creates an admin alert'
);

reset role;
select results_eq(
  $$select kind from public.notifications where user_id = '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and kind = 'safety_alert'$$,
  array['safety_alert'],
  'admin receives the safety alert in the notification center'
);

select * from finish();
rollback;
