-- Run by scripts/check-minute-jobs.py on stubbed queues, vault, pg_net and pg_cron.
begin;
select plan(24);

select is((select count(*) from cron.job where jobname in ('gling-safety-monitor-every-minute', 'gling-discovery-posts', 'gling-push-delivery',
  'gling-chilling-expiry', 'gling-meetup-reminders', 'gling-meetup-convenience', 'gling-meetup-announcements')), 0::bigint, 'the seven per-minute jobs are gone');
select is((select array_agg(jobname order by jobname) from cron.job), array['gling-cron-history-retention', 'gling-meetup-tidy', 'gling-minute-jobs'],
  'other jobs stay and one minute job is added');
select is((select schedule || ' ' || command from cron.job where jobname = 'gling-minute-jobs'), '* * * * * select private.run_minute_jobs()', 'still every minute');

-- Idle minute: every producer runs in order, nothing wakes an edge function.
select private.run_minute_jobs();
select is((select array_agg(step order by id) from private.minute_calls),
  array['discovery', 'chilling', 'reminders', 'waitlist', 'announcements', 'flush'], 'all steps run in order');
select is((select count(*) from net.calls), 0::bigint, 'no work, no edge function call');

-- Push work wakes only the push function, with today's URL, secret header, body and timeout.
truncate private.minute_calls, net.calls;
insert into private.push_delivery_queue(status, next_attempt_at) values ('pending', now() - interval '1 second');
select private.run_minute_jobs();
select is((select array_agg(url) from net.calls), array['https://push.supabase.co/functions/v1/push-notifications'], 'due push wakes push only');
select is((select headers->>'x-push-secret' || ' ' || body::text || ' ' || timeout_ms from net.calls), 'push-secret {} 20000', 'push request unchanged');

truncate private.push_delivery_queue, net.calls;
insert into private.push_delivery_queue(status, lease_until) values ('pending', now() + interval '1 minute');
insert into private.push_delivery_queue(status, next_attempt_at) values ('pending', now() + interval '1 minute'), ('provider_accepted', now() - interval '1 day');
select private.run_minute_jobs();
select is((select count(*) from net.calls), 0::bigint, 'leased, future and finished rows do not wake push');

truncate private.push_delivery_queue, net.calls;
insert into private.push_delivery_queue(status) values ('ticket');
select private.run_minute_jobs();
select is((select count(*) from net.calls), 1::bigint, 'a due receipt wakes push');

truncate private.push_delivery_queue, net.calls;
insert into private.push_delivery_queue(status, created_at) values ('provider_accepted', now() - interval '8 days');
select private.run_minute_jobs();
select is((select count(*) from net.calls), 1::bigint, 'rows due for the 7-day purge wake push');

-- A security-login alert flushed this minute is delivered this minute.
truncate private.push_delivery_queue, net.calls;
set local test.flush_enqueues = 'on';
select private.run_minute_jobs();
set local test.flush_enqueues = 'off';
select is((select count(*) from net.calls), 1::bigint, 'flush runs before the push check');

-- Safety work wakes only the safety function; its scope follows claim_safety_reviews_v2.
truncate private.push_delivery_queue, net.calls;
insert into public.safety_review_queue(target_type, status) values ('post', 'pending');
select private.run_minute_jobs();
select is((select array_agg(url) from net.calls), array['https://safety.supabase.co/functions/v1/safety-monitor'], 'due review wakes safety only');
select is((select headers->>'x-safety-secret' || ' ' || body::text || ' ' || timeout_ms from net.calls), 'safety-secret {"limit": 20} 20000', 'safety request unchanged');

truncate public.safety_review_queue, net.calls;
insert into public.safety_review_queue(target_type, status, attempts, next_attempt_at) values ('comment', 'failed', 2, now() - interval '1 second');
select private.run_minute_jobs();
select is((select count(*) from net.calls), 1::bigint, 'a failed review due for retry wakes safety');

truncate public.safety_review_queue, net.calls;
insert into public.safety_review_queue(target_type, status, attempts, next_attempt_at) values
  ('post', 'failed', 5, null), ('post', 'pending', 0, now() + interval '1 minute'), ('post', 'done', 0, null),
  ('post', 'processing', 1, null), ('message', 'processing', 1, null);
select private.run_minute_jobs();
select is((select count(*) from net.calls), 0::bigint, 'exhausted, future, finished and fresh leases do not wake safety');

update public.safety_review_queue set updated_at = now() - interval '6 minutes' where target_type = 'post' and status = 'processing';
select private.run_minute_jobs();
select is((select count(*) from net.calls), 0::bigint, 'v2 reclaims only message leases, so an old post lease does not wake');

update public.safety_review_queue set updated_at = now() - interval '6 minutes' where target_type = 'message';
select private.run_minute_jobs();
select is((select count(*) from net.calls), 1::bigint, 'an abandoned message lease wakes safety');

-- One failing step neither stops nor rolls back the others.
truncate public.safety_review_queue, private.minute_calls, net.calls;
insert into private.push_delivery_queue(status) values ('pending');
insert into public.safety_review_queue(target_type, status) values ('message', 'pending');
set local test.fail = 'discovery';
select private.run_minute_jobs();
select is((select array_agg(step order by id) from private.minute_calls),
  array['chilling', 'reminders', 'waitlist', 'announcements', 'flush'], 'failed step rolls back alone, the rest run');
select is((select count(*) from net.calls), 2::bigint, 'both edge functions still wake after a producer fails');

truncate private.minute_calls, net.calls;
set local test.fail = 'flush';
select private.run_minute_jobs();
select is((select count(*) from net.calls), 2::bigint, 'a failed flush does not stop push or safety');
set local test.fail = '';

truncate net.calls;
set local test.fail_http = 'push-notifications';
select private.run_minute_jobs();
set local test.fail_http = '';
select is((select array_agg(url) from net.calls), array['https://safety.supabase.co/functions/v1/safety-monitor'], 'a failed push call does not stop safety');

-- Client roles cannot run the job or probe the queues.
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r
  cross join unnest(array['private.run_minute_jobs()', 'private.push_work_due()', 'private.safety_work_due()']) f
  where has_function_privilege(r, f, 'execute')), 0::bigint, 'no client role can execute the new functions');

-- Secret rotation no longer recreates the separate jobs.
select public.configure_push_delivery('https://abc.supabase.co', repeat('p', 32));
select public.configure_safety_monitor('https://abc.supabase.co', repeat('s', 32));
select is((select array_agg(jobname order by jobname) from cron.job), array['gling-cron-history-retention', 'gling-meetup-tidy', 'gling-minute-jobs'],
  'configure functions keep the single job');
select is((select count(*) from vault.secrets where name like 'gling_%' and secret in ('https://abc.supabase.co', repeat('p', 32), repeat('s', 32))), 4::bigint,
  'configure functions still store the secrets');

select * from finish();
rollback;
