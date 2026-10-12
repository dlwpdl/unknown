begin;
select plan(11);

insert into auth.users(id,email) values
('15600000-0000-4000-8000-000000000001','avatar-new@example.invalid'),
('15600000-0000-4000-8000-000000000002','avatar-active@example.invalid'),
('15600000-0000-4000-8000-000000000003','avatar-suspended@example.invalid'),
('15600000-0000-4000-8000-000000000004','avatar-deleted@example.invalid');
insert into public.profiles(id,nickname,city_id,account_status) values
('15600000-0000-4000-8000-000000000002','사진활성검사','vancouver','active'),
('15600000-0000-4000-8000-000000000003','사진정지검사','vancouver','suspended'),
('15600000-0000-4000-8000-000000000004','사진탈퇴검사','vancouver','deleted');

select set_config('request.jwt.claims','{"sub":"15600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('avatars','15600000-0000-4000-8000-000000000001/avatar.jpg','15600000-0000-4000-8000-000000000001')$$,
  'new member can upload an avatar before atomic profile creation');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('avatars','15600000-0000-4000-8000-000000000001/avatar.jpg','15600000-0000-4000-8000-000000000001','{"retry":true}')
  on conflict(bucket_id,name) do update set metadata=excluded.metadata$$,
  'avatar upsert retry also works before profile creation');
select is((select metadata->>'retry' from storage.objects where bucket_id='avatars'
  and name='15600000-0000-4000-8000-000000000001/avatar.jpg'),'true','retry changed the owned object');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('avatars','15600000-0000-4000-8000-000000000002/foreign.jpg','15600000-0000-4000-8000-000000000001')$$,
  '42501',null,'onboarding never permits another account folder');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('post-images','15600000-0000-4000-8000-000000000001/post.jpg','15600000-0000-4000-8000-000000000001')$$,
  '42501',null,'onboarding exception does not permit post images');
reset role;
select ok(not exists(select 1 from public.profiles where id='15600000-0000-4000-8000-000000000001'),
  'upload does not create a profile or record consent');

select set_config('request.jwt.claims','{"sub":"15600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('avatars','15600000-0000-4000-8000-000000000002/avatar.jpg','15600000-0000-4000-8000-000000000002')$$,
  'active member avatar upload still works');
reset role;

select set_config('request.jwt.claims','{"sub":"15600000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('avatars','15600000-0000-4000-8000-000000000003/avatar.jpg','15600000-0000-4000-8000-000000000003')$$,
  '42501',null,'suspended account cannot use the onboarding exception');
reset role;

select set_config('request.jwt.claims','{"sub":"15600000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('avatars','15600000-0000-4000-8000-000000000004/avatar.jpg','15600000-0000-4000-8000-000000000004')$$,
  '42501',null,'deleted profile cannot use the onboarding exception');
reset role;

select set_config('request.jwt.claims','{"sub":"15600000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
  ('avatars','15600000-0000-4000-8000-000000000005/avatar.jpg','15600000-0000-4000-8000-000000000005')$$,
  '42501',null,'missing Auth account cannot upload with stale claims');
reset role;

set local role anon;
select throws_ok($$insert into storage.objects(bucket_id,name) values
  ('avatars','15600000-0000-4000-8000-000000000001/anonymous.jpg')$$,
  '42501',null,'anonymous upload stays forbidden');
reset role;
select * from finish();
rollback;
