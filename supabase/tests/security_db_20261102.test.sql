begin;
set local search_path=public,extensions;
select no_plan();
-- The disposable check DB is schema-only; the shared rows these checks need are idempotent here.
insert into public.cities values('vancouver','밴쿠버','BC','America/Vancouver',true) on conflict do nothing;
insert into storage.buckets(id,name,public) values('avatars','avatars',false) on conflict do nothing;

-- operator, post author, member, blocker, admin, suspended, new signup, reporter, reactivated member
insert into auth.users(id,email,raw_app_meta_data) values
 ('5ec50000-0000-4000-8000-000000000001','secdb-operator@example.test','{"merchant_enabled":true}'),
 ('5ec50000-0000-4000-8000-000000000002','secdb-poster@example.test','{}'),
 ('5ec50000-0000-4000-8000-000000000003','secdb-member@example.test','{}'),
 ('5ec50000-0000-4000-8000-000000000004','secdb-blocker@example.test','{}'),
 ('5ec50000-0000-4000-8000-000000000005','secdb-admin@example.test','{"role":"admin"}'),
 ('5ec50000-0000-4000-8000-000000000006','secdb-suspended@example.test','{}'),
 ('5ec50000-0000-4000-8000-000000000007','secdb-signup@example.test','{}'),
 ('5ec50000-0000-4000-8000-000000000008','secdb-reporter@example.test','{}'),
 ('5ec50000-0000-4000-8000-000000000009','secdb-locked@example.test','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'보안검사'||right(id::text,2),'vancouver',now(),now(),now(),'test' from auth.users
 where id::text like '5ec50000-%' and id<>'5ec50000-0000-4000-8000-000000000007';
insert into auth.sessions(id,user_id,aal,created_at,updated_at)
 values('5ec5a000-0000-4000-8000-000000000005','5ec50000-0000-4000-8000-000000000005','aal2',now(),now());
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('5ec5b000-0000-4000-8000-000000000001','보안검사 비즈니스','vancouver','c','lead','granted','Synthetic rollback-only test',
  '5ec50000-0000-4000-8000-000000000001',now(),'business');
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('5ec5c000-0000-4000-8000-000000000001','5ec50000-0000-4000-8000-000000000002','vancouver',1,'보안 점검 글','댓글을 받는 글이에요.'),
 ('5ec5c000-0000-4000-8000-000000000002','5ec50000-0000-4000-8000-000000000004','vancouver',1,'차단한 사람 글','차단 관계에서는 안 보여야 해요.');
insert into public.comments(id,post_id,author_id,body,created_at) values
 ('5ec5d000-0000-4000-8000-000000000002','5ec5c000-0000-4000-8000-000000000001','5ec50000-0000-4000-8000-000000000003','개인 댓글이에요.',now()-interval '3 minutes'),
 ('5ec5d000-0000-4000-8000-000000000003','5ec5c000-0000-4000-8000-000000000001','5ec50000-0000-4000-8000-000000000003','내가 지울 댓글이에요.',now()-interval '2 minutes'),
 ('5ec5d000-0000-4000-8000-000000000004','5ec5c000-0000-4000-8000-000000000001','5ec50000-0000-4000-8000-000000000009','정지로 숨겨질 댓글이에요.',now()-interval '2 minutes'),
 ('5ec5d000-0000-4000-8000-000000000005','5ec5c000-0000-4000-8000-000000000001','5ec50000-0000-4000-8000-000000000004','차단한 사람 댓글이에요.',now()-interval '2 minutes');
create temporary table secdb_state(business_comment uuid, business_report uuid, personal_report uuid);
insert into secdb_state default values;
grant select,update on secdb_state to authenticated;

-- 1. Business comment: the operator replies to the member's comment as the business.
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
update secdb_state set business_comment=public.create_thread_comment('5ec5c000-0000-4000-8000-000000000001','비즈니스로 단 답글이에요.',
  '5ec5d000-0000-4000-8000-000000000002','5ec5b000-0000-4000-8000-000000000001');
select is((select author_id from public.comments where id=(select business_comment from secdb_state)),'5ec50000-0000-4000-8000-000000000001'::uuid,
  'the operator still reads their own business comment row');
with edited as (update public.comments set body='비즈니스 답글을 고쳤어요.' where id=(select business_comment from secdb_state) returning 1)
  select is((select count(*)::int from edited),1,'the operator can still edit the business comment directly');

select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.comments where id=(select business_comment from secdb_state)),0,
  'another member cannot read the business comment row (operator id) directly');
select is((select count(*)::int from public.comments where id='5ec5d000-0000-4000-8000-000000000002'),1,'personal comments stay directly readable');
select is((select author_id::text||'|'||author_nickname||'|'||business_id::text from public.get_public_comments_page('5ec5c000-0000-4000-8000-000000000001')
  where id=(select business_comment from secdb_state)),'5ec5b000-0000-4000-8000-000000000001|보안검사 비즈니스|5ec5b000-0000-4000-8000-000000000001',
  'post detail still lists the business comment under the business');
select is((select author_id from public.get_comment_thread_page('5ec5c000-0000-4000-8000-000000000001','5ec5d000-0000-4000-8000-000000000002')
  where id=(select business_comment from secdb_state)),'5ec5b000-0000-4000-8000-000000000001'::uuid,'the reply thread shows the business too');
select is((select author_id::text||'|'||author_nickname from public.get_public_comments(array['5ec5c000-0000-4000-8000-000000000001'::uuid])
  where id=(select business_comment from secdb_state)),'5ec5b000-0000-4000-8000-000000000001|보안검사 비즈니스','the legacy batch endpoint masks the operator');
select ok(not exists(select 1 from public.get_public_comments(array['5ec5c000-0000-4000-8000-000000000001'::uuid])
  where author_id='5ec50000-0000-4000-8000-000000000001'),'no comment endpoint returns the operator id');
select is((select count(*)::int from jsonb_array_elements(public.get_public_comment_businesses(array[(select business_comment from secdb_state)]))),1,
  'the inbox business lookup still resolves the business name');
select lives_ok($$insert into public.comment_likes(comment_id,user_id) select business_comment,'5ec50000-0000-4000-8000-000000000003' from secdb_state$$,
  'members can still like a business comment');
reset role;
select is((select like_count from public.comments where id=(select business_comment from secdb_state)),1,'the like counted');
select ok(exists(select 1 from public.notifications where target_type='comment' and target_id=(select business_comment from secdb_state)
    and user_id='5ec50000-0000-4000-8000-000000000002' and kind='comment' and body like '보안검사 비즈니스님이%')
  and exists(select 1 from public.notifications where target_type='comment' and target_id=(select business_comment from secdb_state)
    and user_id='5ec50000-0000-4000-8000-000000000003' and kind='reply'),'the post author and the replied member are still notified');
select is((select count(*)::int from public.notifications where target_type='comment' and target_id=(select business_comment from secdb_state)
  and actor_id='5ec50000-0000-4000-8000-000000000001'),0,'business comment notifications store no operator id');
-- Rows stored before this migration: the backfill clears them the same way.
alter table public.notifications disable trigger business_notification_identity;
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body,route)
 select '5ec50000-0000-4000-8000-000000000002','comment','5ec50000-0000-4000-8000-000000000001','comment',business_comment,'old','/post' from secdb_state;
alter table public.notifications enable trigger business_notification_identity;
update public.notifications n set actor_id=n.actor_id from public.comments c
  where n.target_type='comment' and c.id=n.target_id and c.business_author_id is not null and n.actor_id=c.author_id;
select is((select count(*)::int from public.notifications where target_id=(select business_comment from secdb_state)
  and actor_id='5ec50000-0000-4000-8000-000000000001'),0,
  'the migration backfill clears operator ids already stored');

select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
update secdb_state set business_report=public.create_report('comment',business_comment,'spam',null);
select is((select count(*)::int from public.reports where id=(select business_report from secdb_state)),0,
  'the reporter cannot read the operator id back from their business comment report');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000008","role":"authenticated"}',true);
update secdb_state set personal_report=public.create_report('comment','5ec5d000-0000-4000-8000-000000000002','spam',null);
select is((select reported_user_id from public.reports where id=(select personal_report from secdb_state)),'5ec50000-0000-4000-8000-000000000003'::uuid,
  'personal comment reports stay readable to the reporter');

select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"5ec5a000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
select ok(private.is_admin(),'the fixture admin has an aal2 admin session');
select is((select author_id from public.comments where id=(select business_comment from secdb_state)),'5ec50000-0000-4000-8000-000000000001'::uuid,
  'admins still see the real operator');
select is((select reported_user_id from public.reports where id=(select business_report from secdb_state)),'5ec50000-0000-4000-8000-000000000001'::uuid,
  'admins still see who wrote the reported business comment');

-- 2. Hidden comments stay hidden: report moderation and suspension both set deleted_at.
select lives_ok($$select public.moderate_report((select personal_report from secdb_state),'hidden',null)$$,'admin hides the reported comment');
reset role;
select ok((select deleted_at is not null from public.comments where id='5ec5d000-0000-4000-8000-000000000002'),'the reported comment is hidden');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.comments set deleted_at=null$$,'P0001','COMMENT_RESTORE_NOT_ALLOWED',
  'the author cannot clear an admin hide (unfiltered update)');
with restored as (update public.comments set deleted_at=null where id='5ec5d000-0000-4000-8000-000000000002' returning 1)
  select is((select count(*)::int from restored),0,'a targeted restore does not reach the hidden row either');
with deleted as (update public.comments set deleted_at=now() where id='5ec5d000-0000-4000-8000-000000000003' returning 1)
  select is((select count(*)::int from deleted),1,'members still delete their own comment');
select throws_ok($$insert into public.comment_likes(comment_id,user_id) values('5ec5d000-0000-4000-8000-000000000003','5ec50000-0000-4000-8000-000000000003')$$,
  '42501',null,'likes still need a visible comment');
reset role;
select ok((select deleted_at is not null from public.comments where id='5ec5d000-0000-4000-8000-000000000002'),'the hidden comment stayed hidden');
select private.lock_account_content('5ec50000-0000-4000-8000-000000000009');
update public.profiles set account_status='active' where id='5ec50000-0000-4000-8000-000000000009';
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000009","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.comments set deleted_at=null$$,'P0001','COMMENT_RESTORE_NOT_ALLOWED',
  'a member cannot bring back comments hidden by their suspension after being reinstated');
reset role;
-- Members never had an admin restore path on comments (update RLS is author-only); server functions still restore.
update public.comments set deleted_at=null where id='5ec5d000-0000-4000-8000-000000000004';
select ok((select deleted_at is null from public.comments where id='5ec5d000-0000-4000-8000-000000000004'),'server-side restores still work');

-- 3. Blocking hides each other's profile row and avatar, in both directions.
insert into public.blocks(blocker_id,blocked_id) values('5ec50000-0000-4000-8000-000000000004','5ec50000-0000-4000-8000-000000000003');
insert into storage.objects(bucket_id,name,owner_id) values
 ('avatars','5ec50000-0000-4000-8000-000000000004/avatar.jpg','5ec50000-0000-4000-8000-000000000004'),
 ('avatars','5ec50000-0000-4000-8000-000000000003/avatar.jpg','5ec50000-0000-4000-8000-000000000003'),
 ('avatars','5ec5-legacy/avatar.jpg',null);
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id='5ec50000-0000-4000-8000-000000000004'),0,'the blocked member cannot read the blocker profile');
select is((select count(*)::int from storage.objects where bucket_id='avatars' and name like '5ec50000-0000-4000-8000-000000000004/%'),0,
  'the blocked member cannot read the blocker avatar');
select is((select count(*)::int from public.profiles where id='5ec50000-0000-4000-8000-000000000003'),1,'own profile stays readable');
select is((select count(*)::int from storage.objects where bucket_id='avatars' and name like '5ec50000-0000-4000-8000-000000000003/%'),1,'own avatar stays readable');
select is((select count(*)::int from storage.objects where bucket_id='avatars' and name='5ec5-legacy/avatar.jpg'),1,'avatar paths without a member folder are unchanged');
-- Already hidden before this migration: the blocker's posts, comments and public profile page.
select is((select count(*)::int from public.get_public_post('5ec5c000-0000-4000-8000-000000000002')),0,'the blocker post was already hidden');
select ok(not exists(select 1 from public.get_public_comments_page('5ec5c000-0000-4000-8000-000000000001') where id='5ec5d000-0000-4000-8000-000000000005'),
  'the blocker comment was already hidden');
select ok(public.get_public_user_profile('5ec50000-0000-4000-8000-000000000004') is null,'the blocker public profile page was already hidden');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.profiles where id='5ec50000-0000-4000-8000-000000000003'),0,'the blocker cannot read the blocked profile either');
select is((select count(*)::int from storage.objects where bucket_id='avatars' and name like '5ec50000-0000-4000-8000-000000000003/%'),0,
  'nor the blocked avatar');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.profiles where id in('5ec50000-0000-4000-8000-000000000003','5ec50000-0000-4000-8000-000000000004')),2,
  'unrelated members still read both profiles');
select is((select count(*)::int from storage.objects where bucket_id='avatars' and name like '5ec50000-%'),2,'and both avatars');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"5ec5a000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
select is((select count(*)::int from public.profiles where id::text like '5ec50000-%'),8,'admins read every profile');
reset role;

-- 4. Account status notes: owner and admins only.
update public.profiles set account_status='suspended',account_status_note='신고 3건으로 정지' where id='5ec50000-0000-4000-8000-000000000006';
insert into public.conversations(kind,status,user_low_id,user_high_id,requester_id)
 values('direct','active','5ec50000-0000-4000-8000-000000000003','5ec50000-0000-4000-8000-000000000006','5ec50000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id='5ec50000-0000-4000-8000-000000000006'),0,
  'a conversation partner no longer reads the suspended profile carrying a note');
select lives_ok($$select * from public.profiles where id='5ec50000-0000-4000-8000-000000000003'$$,'select * on profiles still works (no column revoke)');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000006","role":"authenticated"}',true);
-- The exact own-profile read in src/lib/auth.tsx (1.4.6/1.4.7).
select is((select account_status||'|'||account_status_note from public.profiles where id='5ec50000-0000-4000-8000-000000000006'),'suspended|신고 3건으로 정지',
  'the suspended member still sees their own note on the locked screen');
select lives_ok($$select id,nickname,city_id,avatar_path,verification_level,account_status,account_status_note,ai_safety_consent_at
  from public.profiles where id='5ec50000-0000-4000-8000-000000000006'$$,'the shipped app profile query still runs');
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal2","session_id":"5ec5a000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}',true);
select is((select account_status_note from public.profiles where id='5ec50000-0000-4000-8000-000000000006'),'신고 3건으로 정지','admins still read the note');
reset role;
update public.profiles set account_status='active',account_status_note=null where id='5ec50000-0000-4000-8000-000000000006';
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id='5ec50000-0000-4000-8000-000000000006'),1,'a reinstated profile without a note is visible again');
reset role;

-- 5. Signing up needs the consent RPC.
select set_config('request.jwt.claims','{"sub":"5ec50000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$insert into public.profiles(id,nickname,city_id) values('5ec50000-0000-4000-8000-000000000007','가입검사','vancouver')$$,
  '42501',null,'a member cannot create a profile directly without consent');
select lives_ok($$select public.create_profile_with_consent('가입검사','vancouver',null,'2026-09-02')$$,'signup through the consent RPC still works');
select ok((select ai_safety_consent_at is not null and terms_accepted_at is not null from public.profiles where id='5ec50000-0000-4000-8000-000000000007'),
  'the new profile carries the consent');
reset role;

select * from finish();
rollback;
