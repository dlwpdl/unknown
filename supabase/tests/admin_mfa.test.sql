begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
('11800000-0000-0000-0000-000000000001','mfa-admin@example.com','{"role":"admin"}'),
('11800000-0000-0000-0000-000000000002','mfa-member@example.com','{}');
insert into auth.sessions(id,user_id,aal) values('11860000-0000-0000-0000-000000000001','11800000-0000-0000-0000-000000000001','aal2');
insert into public.profiles(id,nickname,city_id) values
('11800000-0000-0000-0000-000000000001','2차인증검사','vancouver'),
('11800000-0000-0000-0000-000000000002','2차인증회원','vancouver');
select set_config('request.jwt.claims','{"sub":"11800000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"11860000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(private.is_admin(),false,'first factor alone cannot enter admin');
select throws_ok($$select public.get_admin_merchants()$$,'P0001','ADMIN_REQUIRED','merchant API refuses first factor');
select throws_ok($$select public.log_admin_access('analytics')$$,'P0001','ADMIN_REQUIRED','shared admin audit boundary refuses first factor');
reset role;
select set_config('request.jwt.claims','{"sub":"11800000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"11860000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(private.is_admin(),true,'admin plus second factor accepted');
select lives_ok($$select public.get_admin_merchants()$$,'merchant API accepts two factor admin');
reset role;
delete from auth.sessions where id='11860000-0000-0000-0000-000000000001';
set local role authenticated;
select is(private.is_admin(),false,'signed out session cannot use a remaining access token');
reset role;
insert into auth.sessions(id,user_id,aal) values('11860000-0000-0000-0000-000000000001','11800000-0000-0000-0000-000000000001','aal2');
update auth.users set raw_app_meta_data='{}' where id='11800000-0000-0000-0000-000000000001';
set local role authenticated;
select is(private.is_admin(),false,'revoked admin role fails despite previous JWT');
reset role;
select set_config('request.jwt.claims','{"sub":"11800000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2","app_metadata":{}}',true);
set local role authenticated;
select is(private.is_admin(),false,'second factor never promotes a member');
reset role;
select * from finish();
rollback;
