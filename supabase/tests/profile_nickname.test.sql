begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('a1800000-0000-4000-8000-000000000001','nickname-admin@example.test','{"role":"admin"}'),
 ('a1800000-0000-4000-8000-000000000002','nickname-member@example.test','{}'),
 ('a1800000-0000-4000-8000-000000000003','nickname-other@example.test','{}');
insert into public.profiles(id,nickname,city_id,bio) values
 ('a1800000-0000-4000-8000-000000000001','닉네임검사관리자','vancouver','원본 관리자'),
 ('a1800000-0000-4000-8000-000000000002','닉네임검사회원','vancouver','원본 회원'),
 ('a1800000-0000-4000-8000-000000000003','닉네임검사이웃','vancouver','원본 이웃');
insert into auth.sessions(id,user_id,aal) values
 ('a1890000-0000-4000-8000-000000000001','a1800000-0000-4000-8000-000000000001','aal2'),
 ('a1890000-0000-4000-8000-000000000002','a1800000-0000-4000-8000-000000000002','aal1');
select ok(not has_function_privilege('anon','public.change_profile_nickname(uuid,text,text)','EXECUTE'),'anonymous nickname writes denied');
select ok(not has_function_privilege('service_role','public.change_profile_nickname(uuid,text,text)','EXECUTE'),'no service-role nickname path');
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a1890000-0000-4000-8000-000000000002","aal":"aal1"}',true);
set local role authenticated;
select is(public.change_profile_nickname('a1800000-0000-4000-8000-000000000002','  새로운이웃  ','닉네임검사회원')->>'nickname','새로운이웃','self-change trims and returns the exact saved name');
select is(public.change_profile_nickname('a1800000-0000-4000-8000-000000000002','새로운이웃','닉네임검사회원')->>'nickname','새로운이웃','same intended name retry is idempotent');
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000003','다른유저이름','닉네임검사이웃')$$,'P0001','ADMIN_REQUIRED','member cannot change another user');
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000002','덮어쓴이름','닉네임검사회원')$$,'P0001','NICKNAME_CHANGED','stale nickname refuses overwrite');
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000002','닉네임검사이웃','새로운이웃')$$,'P0001','NICKNAME_TAKEN','duplicate name preserves the original');
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000002','a','새로운이웃')$$,'P0001','INVALID_NICKNAME','short name refused');
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000002',repeat('a',21),'새로운이웃')$$,'P0001','INVALID_NICKNAME','long name refused');
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000002',E'이웃\n이름','새로운이웃')$$,'P0001','INVALID_NICKNAME','multiline name refused');
select is(public.change_profile_nickname('a1800000-0000-4000-8000-000000000002',repeat('😀',20),'새로운이웃')->>'nickname',repeat('😀',20),'Unicode length follows database character count');
reset role;
select is((select bio from public.profiles where id='a1800000-0000-4000-8000-000000000002'),'원본 회원','nickname change preserves profile metadata');
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a1890000-0000-4000-8000-000000000001","aal":"aal1","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000003','관리자변경이웃','닉네임검사이웃')$$,'P0001','ADMIN_REQUIRED','admin must elevate before editing another account');
reset role;
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a1890000-0000-4000-8000-000000000001","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.change_profile_nickname('a1800000-0000-4000-8000-000000000003','관리자변경이웃','닉네임검사이웃')->>'nickname','관리자변경이웃','elevated admin can change the reviewed member');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='a1800000-0000-4000-8000-000000000001' and subject_user_id='a1800000-0000-4000-8000-000000000003'),'admin change is attributable');
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='a1890000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000003','만료된변경','관리자변경이웃')$$,'P0001','ADMIN_REQUIRED','expired session cannot change a member');
reset role;
update public.profiles set account_status='suspended' where id='a1800000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"a1800000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a1890000-0000-4000-8000-000000000002","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.change_profile_nickname('a1800000-0000-4000-8000-000000000002','정지계정변경',repeat('😀',20))$$,'P0001','ACCOUNT_LOCKED','inactive self-change denied');
reset role;
select * from finish();
rollback;
