begin;
select plan(9);
insert into auth.users(id,email,raw_app_meta_data) values
('77770000-0000-0000-0000-000000000001','alert-admin-1@example.test','{"role":"admin"}'),
('77770000-0000-0000-0000-000000000002','alert-admin-2@example.test','{"role":"admin"}'),
('77770000-0000-0000-0000-000000000003','alert-member@example.test','{}');
insert into public.profiles(id,nickname,city_id) select id,'경보검사'||right(id::text,1),'vancouver'
from auth.users where id::text like '77770000-%';
insert into private.action_rate_events(user_id,action,created_at)
select '77770000-0000-0000-0000-000000000003','message_request',now()-make_interval(secs=>n)
from generate_series(1,25) n;
insert into private.client_errors(fingerprint,message,platform,app_version,user_id)
values ('alert-fingerprint','TypeError: undefined is not a function','ios','1.0.2','77770000-0000-0000-0000-000000000003');

select is(public.run_admin_alert_checks() > 0,true,'admin alert checks raise something to review');
select is((select count(*)::int from public.notifications where kind='admin_security' and target_id='77770000-0000-0000-0000-000000000003'),2,'both admins are alerted about the request flood');
select is((select count(*)::int from public.notifications where kind='admin_error_spike' and target_type='client_error'),2,'both admins are alerted about a new client error');
select is((select count(*)::int from public.notifications where user_id='77770000-0000-0000-0000-000000000003'),0,'the member is never alerted about their own signal');
select is((select distinct route from public.notifications where kind='admin_security'),'/admin?section=users','security alerts open the admin screen');
select is((select count(*)::int from public.notifications where kind='admin_multiacct'),0,'a single account with one IP is not a multi-account alert');

-- 같은 대상은 두 번 울리지 않는다
select public.run_admin_alert_checks();
select is((select count(*)::int from public.notifications where kind='admin_security'),2,'repeat checks do not duplicate a security alert');
select is((select count(*)::int from public.notifications where kind='admin_error_spike'),2,'repeat checks do not duplicate an error alert');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77770000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.run_admin_alert_checks()$$,'42501',null,'members cannot run administrator alert checks');
reset role;
select * from finish();
rollback;
