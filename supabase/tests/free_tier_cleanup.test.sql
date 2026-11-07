begin;
select no_plan();

-- Run history keeps seven days, including a run that never recorded its end.
select is((select schedule from cron.job where jobname='gling-cron-history-retention'),'47 8 * * *','run history is trimmed daily');
insert into cron.job_run_details(runid,jobid,command,status,start_time,end_time) values
  (-1,-1,'old','succeeded',now()-interval '8 days',now()-interval '8 days'),
  (-2,-1,'old, never ended','failed',now()-interval '8 days',null),
  (-3,-1,'recent','succeeded',now()-interval '6 days',now()-interval '6 days');
do $$ begin execute (select command from cron.job where jobname='gling-cron-history-retention'); end $$;
select is((select array_agg(runid) from cron.job_run_details where jobid=-1),array[-3::bigint],'only runs newer than seven days stay');

select is((select count(*)::integer from cron.job where jobname='gling-discovery-posts'),1,'the discovery job was replaced, not duplicated');

-- Every branch of the timezone check. Abbreviations and POSIX strings work in AT TIME ZONE, so they must stay rejected here.
insert into auth.users(id,email,raw_app_meta_data) values('14000000-0000-0000-0000-000000000001','free-tier@example.test','{}');
insert into public.profiles(id,nickname,city_id) values('14000000-0000-0000-0000-000000000001','free-tier-tz','vancouver');
insert into auth.sessions(id,user_id,created_at) values('14000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001',now());
delete from private.push_devices where timezone in ('Asia/Kathmandu','Pacific/Chatham');
select set_config('request.jwt.claims','{"sub":"14000000-0000-0000-0000-000000000001","session_id":"14000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'Asia/Kathmandu')$$,'a valid zone no device holds yet is accepted');
select lives_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'Asia/Kathmandu')$$,'a zone a device already holds is accepted');
select lives_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),null)$$,'an unknown device zone stays allowed');
select lives_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'Pacific/Chatham','en')$$,'the app''s four-argument call still validates and registers');
select throws_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'Invalid/Timezone')$$,'P0001','INVALID_TIMEZONE','a made-up name is rejected');
select throws_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'PST')$$,'P0001','INVALID_TIMEZONE','an abbreviation is rejected');
select throws_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'<+03>-3')$$,'P0001','INVALID_TIMEZONE','a POSIX string is rejected');
select throws_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'America/Foo3')$$,'P0001','INVALID_TIMEZONE','a name that parses as POSIX is rejected');
select throws_ok($$select public.register_push_device('ExpoPushToken[free_tier_tz_12345]',auth.uid(),'america/vancouver')$$,'P0001','INVALID_TIMEZONE','a wrongly cased name is rejected');
reset role;

select * from finish();
rollback;
