begin;
select no_plan();
select has_table('private','account_security_events','security events stay private');
select has_table('private','account_security_sessions','login registration has a private baseline');
select has_function('public','register_security_device',array['uuid','uuid'],'device registration is protected');
insert into auth.users(id,email,encrypted_password) values
 ('15300000-0000-4000-8000-000000000001','security-owner@example.test','first-hash'),
 ('15300000-0000-4000-8000-000000000002','security-other@example.test','other-hash');
insert into public.profiles(id,nickname,city_id) values
 ('15300000-0000-4000-8000-000000000001','보안검사본인','vancouver'),
 ('15300000-0000-4000-8000-000000000002','보안검사다른계정','vancouver');
insert into auth.sessions(id,user_id) values
 ('15390000-0000-4000-8000-000000000001','15300000-0000-4000-8000-000000000001');
-- Model an already-existing session bootstrapped when the migration was applied.
update private.account_security_sessions set baseline=true where session_id='15390000-0000-4000-8000-000000000001';
insert into public.notification_preferences(user_id,push_enabled) values ('15300000-0000-4000-8000-000000000001',true);
insert into private.push_devices(user_id,session_id,token) values
 ('15300000-0000-4000-8000-000000000001','15390000-0000-4000-8000-000000000001','ExpoPushToken[security_notification_fixture]');
select set_config('request.jwt.claims','{"sub":"15300000-0000-4000-8000-000000000001","role":"authenticated","session_id":"15390000-0000-4000-8000-000000000001"}',true);
create temp table security_device(id uuid);
grant all on security_device to authenticated;
set local role authenticated;
insert into security_device select public.register_security_device(null,'15300000-0000-4000-8000-000000000001');
select ok((select id is not null from security_device),'server generates the installation identifier');
select throws_ok($$select public.register_security_device(null,'15300000-0000-4000-8000-000000000002')$$,'P0001','AUTH_CONTEXT_CHANGED','a stale account request cannot target a different account');
reset role;
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),0,'baseline session creates no historical alert');
select ok(not has_table_privilege('authenticated','private.account_security_devices','select'),'members cannot inspect device history');
select ok(not has_table_privilege('service_role','private.account_security_devices','select'),'worker cannot directly inspect history');
select ok(not has_function_privilege('anon','public.register_security_device(uuid,uuid)','execute'),'guests cannot register security devices');
select ok(not has_function_privilege('authenticated','private.flush_account_security_logins(timestamptz)','execute'),'clients cannot forge login delivery');

insert into auth.sessions(id,user_id) values ('15390000-0000-4000-8000-000000000002','15300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"15300000-0000-4000-8000-000000000001","role":"authenticated","session_id":"15390000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select lives_ok($$select public.register_security_device((select id from security_device),'15300000-0000-4000-8000-000000000001')$$,'known installation can log in again');
reset role;
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),0,'same installation login is silent');
insert into auth.sessions(id,user_id) values ('15390000-0000-4000-8000-000000000003','15300000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"15300000-0000-4000-8000-000000000001","role":"authenticated","session_id":"15390000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select public.register_security_device('15370000-0000-4000-8000-000000000003','15300000-0000-4000-8000-000000000001');
select public.register_security_device('15370000-0000-4000-8000-000000000003','15300000-0000-4000-8000-000000000001');
reset role;
select private.flush_account_security_logins();
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),1,'new browser has one alert, repeat registration has none');
select ok((select body like '%새 기기%' and route='/profile/settings' and actor_id is null from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security' limit 1),'new device payload is generic and internal');
select ok(not private.notification_target_visible('15300000-0000-4000-8000-000000000002','account_security',(select target_id from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security' limit 1)),'another user cannot read the security event');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.user_id='15300000-0000-4000-8000-000000000001' and n.kind='account_security'),1,'security events use the existing push queue');
update auth.sessions set refreshed_at=now() where id='15390000-0000-4000-8000-000000000003';
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),1,'token refresh does not send login alerts');
update auth.users set email_change='pending-address@example.test' where id='15300000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),1,'pending email change is not a confirmed change');
create function pg_temp.fail_security_queue() returns trigger language plpgsql as $$ begin
  if new.kind='account_security' then raise exception 'TEST_QUEUE_FAILURE'; end if;
  return new;
end $$;
create trigger zz_security_queue_fixture before insert on public.notifications for each row execute function pg_temp.fail_security_queue();
set local role supabase_auth_admin;
update auth.users set email='confirmed-address@example.test',encrypted_password='changed-hash' where id='15300000-0000-4000-8000-000000000001';
reset role;
select is((select encrypted_password::text from auth.users where id='15300000-0000-4000-8000-000000000001'),'changed-hash','Auth can commit changes despite a broken notification queue');
select throws_ok($$select private.flush_account_security_logins()$$,'P0001','TEST_QUEUE_FAILURE','delivery failure stays outside authentication changes');
select is((select count(*)::int from private.account_security_events where user_id='15300000-0000-4000-8000-000000000001' and delivered_at is null),2,'failed delivery leaves both security events durable for retry');
drop trigger zz_security_queue_fixture on public.notifications;
select private.flush_account_security_logins();
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),3,'confirmed email and password changes each notify owner');
select ok(not exists(select 1 from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and (body like '%@%' or body like '%hash%' or body like '%1539%')),'credentials, emails and sessions never enter push text');
insert into auth.sessions(id,user_id) values ('15390000-0000-4000-8000-000000000004','15300000-0000-4000-8000-000000000001');
select private.flush_account_security_logins(now()+interval '2 minutes');
select private.flush_account_security_logins(now()+interval '3 minutes');
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),4,'unregistered genuine login receives one fallback alert');
select ok(exists(select 1 from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and body like '%새 로그인%'),'fallback never pretends to identify physical hardware');
update public.notification_preferences set account_security=false where user_id='15300000-0000-4000-8000-000000000001';
select ok(not private.push_notification_eligible((select id from private.push_devices where user_id='15300000-0000-4000-8000-000000000001'),(select id from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security' limit 1)),'latest security opt-out cancels pending push');
update auth.users set encrypted_password='another-hash' where id='15300000-0000-4000-8000-000000000001';
select private.flush_account_security_logins();
select is((select count(*)::int from public.notifications where user_id='15300000-0000-4000-8000-000000000001' and kind='account_security'),4,'opt-out also prevents new inbox alerts');
delete from auth.sessions where id='15390000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.register_security_device(null,'15300000-0000-4000-8000-000000000001')$$,'P0001','INVALID_SECURITY_SESSION','revoked session cannot register a device');
reset role;
select finish();
rollback;
