begin;
set local search_path=public,extensions;
select no_plan();

-- 01 H Lv2 host · 02 G guest · 03 L Lv1 host with the same record · 04 A admin · 05 R reporter
create function pg_temp.u(n int) returns uuid language sql as $$ select ('d3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.lv(n int) returns int language sql as $$ select verification_level::int from public.profiles where id=pg_temp.u(n) $$;
create function pg_temp.auto(n int) returns text language sql as $$ select state from private.trusted_host_auto where user_id=pg_temp.u(n) $$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(4),'role','authenticated','app_metadata',json_build_object('role','admin'),
    'aal','aal2','session_id','d3900000-0000-4000-8000-000000000001')::text,true) $$;
insert into public.cities(id,name,province,timezone) values('trust-test','Trust test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'trust-test','Trust test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select pg_temp.u(n),'trust-'||n||'@example.invalid',
  case when n=4 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,5) n;
insert into public.profiles(id,nickname,city_id,verification_level,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select pg_temp.u(n),'Trust'||n,'trust-test',case when n=1 then 2 else 1 end,now(),now(),now(),'test',now()-interval '100 days' from generate_series(1,5) n;
insert into auth.sessions(id,user_id,aal) values('d3900000-0000-4000-8000-000000000001',pg_temp.u(4),'aal2');

-- H and L each hosted three ended weekly sessions; host and guest checked in and confirmed each other every time.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview) values
 ('d3100000-0000-4000-8000-000000000001',pg_temp.u(1),'trust-test',31997,'Host H walk','Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}'),
 ('d3100000-0000-4000-8000-000000000003',pg_temp.u(3),'trust-test',31997,'Host L walk','Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}');
insert into private.meetup_sessions(post_id,host_id,starts_at,ends_at)
select p.id,p.author_id,now()-make_interval(days=>w*7)-interval '2 hours',now()-make_interval(days=>w*7)
from public.posts p,generate_series(1,3) w where p.id in('d3100000-0000-4000-8000-000000000001','d3100000-0000-4000-8000-000000000003');
insert into private.meetup_attendance(session_id,user_id,checked_in_at,confirmed_at,confirmation_source)
select s.id,x.user_id,s.starts_at+interval '5 minutes',s.ends_at,'peer'
from private.meetup_sessions s cross join lateral (values(s.host_id),(pg_temp.u(2))) x(user_id) where s.host_id in(pg_temp.u(1),pg_temp.u(3));

-- 1. Rule and standing.
select is((select min_confirmed_meetups from private.trusted_host_rule),3,'Default asks for three confirmed meetups');
select is((private.trusted_host_progress(pg_temp.u(1))->'confirmedMeetups'->>'count')::int,3,'Confirmed attendance is counted');
select is((private.trusted_host_progress(pg_temp.u(1))->'hostedMeetups'->>'count')::int,3,'Hosted meetups with a guest are counted');
select ok((private.trusted_host_progress(pg_temp.u(1))->>'eligible')::boolean,'Lv2 host with the record qualifies');
select ok(not (private.trusted_host_progress(pg_temp.u(3))->>'eligible')::boolean,'Same record at Lv1 does not qualify');

-- 2. Job promotes only Lv2.
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),3,'Qualifying Lv2 host becomes Lv3');
select is(pg_temp.auto(1),'granted','The job records its own grant');
select is(pg_temp.lv(3),1,'Lv1 host stays Lv1');

-- 3. A recent no-show takes the job's badge back; an old one does not count.
insert into private.meetup_absences(session_id,user_id,host_id,post_id,kind,recorded_at)
select id,pg_temp.u(1),pg_temp.u(3),post_id,'no_show',now()-interval '200 days' from private.meetup_sessions where host_id=pg_temp.u(3) order by starts_at limit 1;
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),3,'A no-show older than the window is ignored');
update private.meetup_absences set recorded_at=now()-interval '3 days' where user_id=pg_temp.u(1);
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),2,'A recent no-show returns the auto badge to Lv2');
select is(pg_temp.auto(1),null,'The auto grant row is cleared');
delete from private.meetup_absences where user_id=pg_temp.u(1);
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),3,'The badge comes back once the record is clean');

-- 4. An upheld report blocks; a dismissed one does not.
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values(pg_temp.u(5),pg_temp.u(1),'user',pg_temp.u(1),'spam');
update public.reports set status='dismissed',resolved_at=now() where reported_user_id=pg_temp.u(1);
select ok((private.trusted_host_progress(pg_temp.u(1))->>'eligible')::boolean,'Dismissed report does not count');
update public.reports set status='actioned' where reported_user_id=pg_temp.u(1);
select ok(not (private.trusted_host_progress(pg_temp.u(1))->'goodConduct'->>'met')::boolean,'Upheld report fails conduct');
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),2,'Upheld report takes the auto badge back');
update public.reports set status='dismissed' where reported_user_id=pg_temp.u(1);
select private.refresh_trusted_hosts();

-- 5. Admin taking a 3 away holds it; an admin 3 is never removed by the job.
select pg_temp.as_admin(); set local role authenticated;
select lives_ok($$select public.set_admin_verification_level('d3000000-0000-4000-8000-000000000001',2::smallint)$$,'Admin lowers the auto Lv3');
reset role;
select is(pg_temp.auto(1),'held','Admin removal is held');
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),2,'Job does not give a held badge back');
select pg_temp.as_admin(); set local role authenticated;
select lives_ok($$select public.set_admin_verification_level('d3000000-0000-4000-8000-000000000001',3::smallint)$$,'Admin grants Lv3');
select lives_ok($$select public.set_admin_verification_level('d3000000-0000-4000-8000-000000000003',3::smallint)$$,'Admin grants Lv3 without the record');
reset role;
select is(pg_temp.auto(1),null,'Admin grant clears the hold');
update public.reports set status='actioned' where reported_user_id=pg_temp.u(1);
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),3,'Job never removes an admin Lv3');
select is(pg_temp.lv(3),3,'Admin Lv3 without the record stays');

-- 6. Turning the rule off returns only auto badges.
update public.reports set status='dismissed' where reported_user_id=pg_temp.u(1);
update public.profiles set verification_level=2 where id=pg_temp.u(1);
select private.refresh_trusted_hosts();
select is(pg_temp.auto(1),'granted','Fixture: auto grant again');
update private.trusted_host_rule set enabled=false;
select private.refresh_trusted_hosts();
select is(pg_temp.lv(1),2,'Disabled rule returns auto Lv3 to Lv2');
select is(pg_temp.lv(3),3,'Disabled rule leaves admin Lv3');
update private.trusted_host_rule set enabled=true;

-- 7. Own checklist only; anonymous callers and other accounts' rows stay closed.
select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(1),'role','authenticated')::text,true);
set local role authenticated;
select is((public.get_my_trust_progress()->'confirmedMeetups'->>'count')::int,3,'Owner reads their own counts');
select throws_ok($$select private.trusted_host_progress('d3000000-0000-4000-8000-000000000003')$$,'42501',null,'Members cannot read another account');
select throws_ok($$select * from private.trusted_host_auto$$,'42501',null,'Members cannot read the badge table');
reset role;
set local role anon;
select throws_ok($$select public.get_my_trust_progress()$$,'42501',null,'Anonymous callers are refused');
reset role;

-- 8. Account deletion drops the flag.
select private.refresh_trusted_hosts();
select is(pg_temp.auto(1),'granted','Fixture: auto grant before deletion');
update public.profiles set account_status='deleted' where id=pg_temp.u(1);
select is(pg_temp.auto(1),null,'Deleted account loses its trusted-host row');

-- 9. Known synthetic seed Lv2 returns to Lv1; an audited admin Lv2 stays (20261030210100).
update public.profiles set verification_level=2 where id='10000000-0000-0000-0000-000000000134';
update public.profiles set verification_level=1 where id='10000000-0000-0000-0000-000000000141';
select pg_temp.as_admin(); set local role authenticated;
select lives_ok($$select public.set_admin_verification_level('10000000-0000-0000-0000-000000000141',2::smallint)$$,'Fixture: audited admin Lv2');
reset role;
\ir ../migrations/20261030210100_remove_unearned_synthetic_l2.sql
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000134'),1,'Unearned synthetic Lv2 returns to Lv1');
select is((select verification_level::int from public.profiles where id='10000000-0000-0000-0000-000000000141'),2,'Audited admin Lv2 is preserved');

select * from finish();
rollback;
