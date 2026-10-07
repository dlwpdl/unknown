begin;
select plan(18);

insert into auth.users(id,email,raw_app_meta_data,is_anonymous) values
('77771000-0000-0000-0000-000000000001','signup-admin-1@example.test','{"role":"admin"}',false),
('77771000-0000-0000-0000-000000000002','signup-admin-2@example.test','{"role":"admin"}',false),
('77771000-0000-0000-0000-000000000003','signup-admin-blocked@example.test','{"role":"admin"}',false),
('77771000-0000-0000-0000-000000000004','signup-member@example.test','{}',false),
('77771000-0000-0000-0000-000000000005','signup-incomplete@example.test','{}',false),
('77771000-0000-0000-0000-000000000006','signup-seed@seed.gling.invalid','{}',false),
('77771000-0000-0000-0000-000000000007','signup-anonymous@example.test','{}',true),
('77771000-0000-0000-0000-000000000008','signup-rollback@example.test','{}',false);
insert into public.profiles(id,nickname,city_id,account_status) values
('77771000-0000-0000-0000-000000000001','가입관리자1','vancouver','active'),
('77771000-0000-0000-0000-000000000002','가입관리자2','vancouver','active'),
('77771000-0000-0000-0000-000000000003','가입관리자3','vancouver','suspended');
insert into public.notification_preferences(user_id,push_enabled)
values ('77771000-0000-0000-0000-000000000001',true),('77771000-0000-0000-0000-000000000002',false)
on conflict(user_id) do update set push_enabled=excluded.push_enabled;
insert into auth.sessions(id,user_id,not_after) values
('77771100-0000-0000-0000-000000000001','77771000-0000-0000-0000-000000000001',now()+interval '1 day'),
('77771100-0000-0000-0000-000000000002','77771000-0000-0000-0000-000000000002',now()+interval '1 day');
insert into private.push_devices(user_id,session_id,token)
values ('77771000-0000-0000-0000-000000000001','77771100-0000-0000-0000-000000000001','ExponentPushToken[signup-admin-one]'),
('77771000-0000-0000-0000-000000000002','77771100-0000-0000-0000-000000000002','ExponentPushToken[signup-admin-two]');

select set_config('request.jwt.claims','{"sub":"77771000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select public.create_profile_with_consent('가입새회원','vancouver',null,'2026-09-02');
select is((select count(*)::int from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000004' and user_id in ('77771000-0000-0000-0000-000000000001','77771000-0000-0000-0000-000000000002')),2,'both active admins receive completed signup');
select is((select count(*)::int from public.notifications where kind='admin_signup' and user_id='77771000-0000-0000-0000-000000000003'),0,'blocked admin receives no signup');
select is((select count(*)::int from public.notifications where kind='admin_signup' and user_id='77771000-0000-0000-0000-000000000004'),0,'new member receives no admin notification');
select is((select min(category) from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000004'),'system','existing system notification handling applies');
select is((select min(route) from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000004'),'/admin?section=users','existing allowlisted admin route applies');
select ok((select bool_and(body like '%가입새회원%' and body not like '%@%' and body not like '%77771000%') from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000004'),'body includes nickname and no email or UUID');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_signup' and n.target_id='77771000-0000-0000-0000-000000000004' and n.user_id='77771000-0000-0000-0000-000000000001'),1,'enabled admin device gets one existing push job');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_signup' and n.target_id='77771000-0000-0000-0000-000000000004' and n.user_id='77771000-0000-0000-0000-000000000002'),0,'push opt-out is preserved while in-app notification remains');
select public.create_profile_with_consent('가입새회원','vancouver',null,'2026-09-02');
update public.profiles set bio='수정',nickname='가입닉변경' where id='77771000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000004' and user_id in ('77771000-0000-0000-0000-000000000001','77771000-0000-0000-0000-000000000002')),2,'repeated signup RPC and profile edits do not repeat signup');
select throws_ok($$insert into public.notifications(user_id,kind,target_type,target_id,body,route) values('77771000-0000-0000-0000-000000000001','admin_signup','user','77771000-0000-0000-0000-000000000004','중복','/admin?section=users')$$,'23505',null,'database guarantees one signup per admin and profile');
insert into public.profiles(id,nickname,city_id) values('77771000-0000-0000-0000-000000000005','가입미완료','vancouver');
select is((select count(*)::int from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000005'),0,'incomplete profile does not announce a signup');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at) values
('77771000-0000-0000-0000-000000000006','가입시드','vancouver',now(),now(),now()),
('77771000-0000-0000-0000-000000000007','가입익명','vancouver',now(),now(),now());
select is((select count(*)::int from public.notifications where kind='admin_signup' and target_id in ('77771000-0000-0000-0000-000000000006','77771000-0000-0000-0000-000000000007')),0,'seed and anonymous accounts are not announced');
savepoint failed_signup;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at) values('77771000-0000-0000-0000-000000000008','가입롤백','vancouver',now(),now(),now());
rollback to failed_signup;
select is((select count(*)::int from public.notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000008'),0,'rolled-back signup leaves no notification');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_signup' and n.target_id='77771000-0000-0000-0000-000000000008'),0,'rolled-back signup leaves no push job');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"77771000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.user_notifications where kind='admin_signup'),0,'member cannot read another user admin inbox');
select throws_ok($$select private.notify_profile_signup()$$,'42501',null,'member cannot call the private signup trigger');
select set_config('request.jwt.claims','{"sub":"77771000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}',true);
select is((select count(*)::int from public.user_notifications where kind='admin_signup' and target_id='77771000-0000-0000-0000-000000000004'),1,'admin personal inbox contains their own signup alert');
select ok(has_function_privilege('authenticated','public.create_profile_with_consent(text,text,text,text)','EXECUTE'),'existing signup permission is preserved');
reset role;
select * from finish();
rollback;
