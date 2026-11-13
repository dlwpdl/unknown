begin;
set local search_path=public,extensions;
select no_plan();

-- 렌트 신뢰: A posts a room, R1–R3 report it, K signed up today, M is an MFA admin, S already has fraud confirmations,
-- O is someone else. Everyone but K signed up a month ago.
insert into auth.users(id,email) values
 ('f7100000-0000-4000-8000-000000000001','rent-a@example.test'),('f7100000-0000-4000-8000-000000000002','rent-r1@example.test'),
 ('f7100000-0000-4000-8000-000000000003','rent-r2@example.test'),('f7100000-0000-4000-8000-000000000004','rent-r3@example.test'),
 ('f7100000-0000-4000-8000-000000000005','rent-k@example.test'),('f7100000-0000-4000-8000-000000000006','rent-m@example.test'),
 ('f7100000-0000-4000-8000-000000000007','rent-s@example.test'),('f7100000-0000-4000-8000-000000000008','rent-o@example.test');
update auth.users set created_at=case when id='f7100000-0000-4000-8000-000000000005' then now() else now()-interval '30 days' end
  where id between 'f7100000-0000-4000-8000-000000000001' and 'f7100000-0000-4000-8000-000000000008';
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='f7100000-0000-4000-8000-000000000006';
insert into public.profiles(id,nickname,city_id) values
 ('f7100000-0000-4000-8000-000000000001','RentA','vancouver'),('f7100000-0000-4000-8000-000000000002','RentR1','vancouver'),
 ('f7100000-0000-4000-8000-000000000003','RentR2','vancouver'),('f7100000-0000-4000-8000-000000000004','RentR3','vancouver'),
 ('f7100000-0000-4000-8000-000000000005','RentK','vancouver'),('f7100000-0000-4000-8000-000000000006','RentM','vancouver'),
 ('f7100000-0000-4000-8000-000000000007','RentS','vancouver'),('f7100000-0000-4000-8000-000000000008','RentO','vancouver');
insert into auth.sessions(id,user_id,aal) values('f7160000-0000-4000-8000-000000000006','f7100000-0000-4000-8000-000000000006','aal2');
-- H1 a 부동산 room, H2 A's second room, G1 an ordinary post, S1–S3 S's earlier rooms.
insert into public.posts(id,author_id,city_id,tag_id,title,body,price,kind,listing_status,expires_at,listing_details) values
 ('f7110000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where slug='housing'),
   '킷실라노 1베드','킷실라노 1베드 내놓아요',1250,'listing','open',now()+interval '30 days','{"type":"housing","deal":"rent_offer","rooms":"1b","area":"kitsilano"}'),
 ('f7110000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where slug='housing'),
   '방 하나 더','방 하나 더 있어요',900,'listing','open',now()+interval '30 days','{"type":"housing","deal":"rent_offer","rooms":"room"}'),
 ('f7110000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000001','vancouver',(select id from public.tags where slug not in ('housing','jobs','used') order by id limit 1),
   '그냥 글','오늘 날씨 좋네요',null,'story',null,null,null),
 ('f7110000-0000-4000-8000-000000000011','f7100000-0000-4000-8000-000000000007','vancouver',(select id from public.tags where slug='housing'),'방1','방1',null,'story',null,null,null),
 ('f7110000-0000-4000-8000-000000000012','f7100000-0000-4000-8000-000000000007','vancouver',(select id from public.tags where slug='housing'),'방2','방2',null,'story',null,null,null),
 ('f7110000-0000-4000-8000-000000000013','f7100000-0000-4000-8000-000000000007','vancouver',(select id from public.tags where slug='housing'),'방3','방3',null,'story',null,null,null);

select ok(not has_table_privilege('authenticated','private.listing_photo_checks','select'),'members cannot read photo checks directly');
select ok(not has_column_privilege('authenticated','public.posts','held_at','update') and not has_column_privilege('authenticated','public.posts','fraud_confirmed_at','update'),
  'members cannot set or clear the hold or fraud marks');
select ok(not has_function_privilege('anon','public.submit_listing_photo_check(uuid,text)','execute'),'visitors cannot submit a photo check');
select is((select public from storage.buckets where id='listing-checks'),false,'the check photo bucket is private');

set local role authenticated;
-- The new reason works; an unknown one still fails.
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select lives_ok($$select public.create_report('post','f7110000-0000-4000-8000-000000000001','scam','돈부터 보내래요')$$,'허위 매물·사기 is a report reason');
select throws_ok($$select public.create_report('post','f7110000-0000-4000-8000-000000000001','fake','x')$$,'P0001','INVALID_REASON','other reasons are still rejected');
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.create_report('post','f7110000-0000-4000-8000-000000000001','scam',null);
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.create_report('post','f7110000-0000-4000-8000-000000000001','other',null);
reset role;
select is((select status from public.posts where id='f7110000-0000-4000-8000-000000000001'),'published',
  'two older accounts and one made today are not enough: the new account is not counted');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select public.create_report('post','f7110000-0000-4000-8000-000000000001','spam',null);
reset role;
-- The same three people report an ordinary post (written directly: reports from one person are 5 seconds apart).
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code)
 select r,'f7100000-0000-4000-8000-000000000001','post','f7110000-0000-4000-8000-000000000003','spam'
 from unnest(array['f7100000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000004']::uuid[]) r;
select is((select status from public.posts where id='f7110000-0000-4000-8000-000000000001'),'removed','the third older reporter takes the room down for everyone');
select ok((select held_at is not null from public.posts where id='f7110000-0000-4000-8000-000000000001'),'and marks it as held for review');
select is((select status from public.posts where id='f7110000-0000-4000-8000-000000000003'),'published','three reports on an ordinary post do not hide it');

-- The author cannot bring it back; only an admin decides.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$update public.posts set status='published' where id='f7110000-0000-4000-8000-000000000001'$$,'P0001','POST_RESTORE_NOT_ALLOWED','the author cannot republish a held room');
select throws_ok($$select public.get_admin_held_listings()$$,'P0001','ADMIN_REQUIRED','members cannot list held posts');
select throws_ok($$select public.resolve_held_listing('f7110000-0000-4000-8000-000000000001','restore')$$,'P0001','ADMIN_REQUIRED','members cannot resolve them');

select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2","session_id":"f7160000-0000-4000-8000-000000000006","app_metadata":{"role":"admin"}}',true);
select is(jsonb_array_length(public.get_admin_held_listings()),1,'the admin sees the one held room');
select is(public.get_admin_held_listings()->0->>'id','f7110000-0000-4000-8000-000000000001','with its id');
select is(jsonb_array_length(public.get_admin_held_listings()->0->'reports'),4,'and its four open reports');
select throws_ok($$select public.resolve_held_listing('f7110000-0000-4000-8000-000000000001','delete')$$,'P0001','INVALID_HELD_ACTION','unknown actions are rejected');
select throws_ok($$select public.resolve_held_listing('f7110000-0000-4000-8000-000000000003','restore')$$,'P0001','HELD_LISTING_NOT_FOUND','a post that was never held cannot be resolved');
select lives_ok($$select public.resolve_held_listing('f7110000-0000-4000-8000-000000000001','restore')$$,'the admin restores it');
reset role;
select is((select status||':'||(held_at is null)::text from public.posts where id='f7110000-0000-4000-8000-000000000001'),'published:true','it is back for everyone');
select is((select count(*)::int from public.reports where target_id='f7110000-0000-4000-8000-000000000001' and status='dismissed' and resolved_by='f7100000-0000-4000-8000-000000000006'),4,
  'and its reports are closed as dismissed');
select ok(exists(select 1 from public.admin_access_logs where actor_id='f7100000-0000-4000-8000-000000000006' and scope='reports' and resource_id='f7110000-0000-4000-8000-000000000001'),
  'the decision is logged');

-- 사기 확정: three confirmations block S from 부동산 only.
update public.posts set status='removed', held_at=now() where author_id='f7100000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2","session_id":"f7160000-0000-4000-8000-000000000006","app_metadata":{"role":"admin"}}',true);
select public.resolve_held_listing('f7110000-0000-4000-8000-000000000011','fraud');
select public.resolve_held_listing('f7110000-0000-4000-8000-000000000012','fraud');
reset role;
select lives_ok($$insert into public.posts(author_id,city_id,tag_id,title,body) values('f7100000-0000-4000-8000-000000000007','vancouver',(select id from public.tags where slug='housing'),'방4','방4')$$,
  'two confirmations do not block yet');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2","session_id":"f7160000-0000-4000-8000-000000000006","app_metadata":{"role":"admin"}}',true);
select public.resolve_held_listing('f7110000-0000-4000-8000-000000000013','fraud');
select is(jsonb_array_length(public.get_admin_held_listings()),0,'resolved posts leave the held list');
reset role;
select is((select status from public.posts where id='f7110000-0000-4000-8000-000000000013'),'removed','a fraud room stays down');
select throws_ok($$insert into public.posts(author_id,city_id,tag_id,title,body) values('f7100000-0000-4000-8000-000000000007','vancouver',(select id from public.tags where slug='housing'),'방5','방5')$$,
  'P0001','RENT_POSTING_BLOCKED','the third confirmation blocks new 부동산 posts');
select lives_ok($$insert into public.posts(author_id,city_id,tag_id,title,body) values('f7100000-0000-4000-8000-000000000007','vancouver',(select id from public.tags where slug='jobs'),'일','일')$$,
  'other categories stay open');

-- 사진 확인: A uploads a note photo for H1. The file lives in A's own folder of the private bucket.
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('listing-checks','f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp','f7100000-0000-4000-8000-000000000001','{"mimetype":"image/webp","size":5000}'),
 ('listing-checks','f7100000-0000-4000-8000-000000000008/f7120000-0000-4000-8000-000000000008.webp','f7100000-0000-4000-8000-000000000008','{"mimetype":"image/webp","size":5000}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000008","role":"authenticated"}',true);
select throws_ok($$select public.submit_listing_photo_check('f7110000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000008/f7120000-0000-4000-8000-000000000008.webp')$$,
  'P0001','PHOTO_CHECK_UNAVAILABLE','someone else cannot attach a check to A''s room');
select is((select count(*)::int from storage.objects where bucket_id='listing-checks'),1,'O sees only O''s own check photo');
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.submit_listing_photo_check('f7110000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000008/f7120000-0000-4000-8000-000000000008.webp')$$,
  'P0001','INVALID_PHOTO_CHECK','A cannot link a file from another member''s folder');
select throws_ok($$select public.submit_listing_photo_check('f7110000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp')$$,
  'P0001','PHOTO_CHECK_UNAVAILABLE','only 부동산 posts take a check photo');
select throws_ok($$select public.submit_listing_photo_check('f7110000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000099.webp')$$,
  'P0001','INVALID_PHOTO_CHECK','a file that was never uploaded cannot be linked');
select lives_ok($$select public.submit_listing_photo_check('f7110000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp')$$,
  'A links the photo to the room');
select ok(public.get_public_post_listing_details(array['f7110000-0000-4000-8000-000000000001'::uuid])->0->'photo_checked_at' = 'null'::jsonb,
  'the post shows no mark while the photo waits for review');
select is((select count(*)::int from storage.objects where bucket_id='listing-checks' and name like 'f7100000-0000-4000-8000-000000000001/%'),1,'A can still see her own photo');
select ok(not private.can_delete_listing_check('f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp'),'a linked photo cannot be deleted by its author');
select ok(private.can_delete_listing_check('f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000002.webp'),'an unlinked upload of hers can be');
select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from storage.objects where bucket_id='listing-checks'),0,'other members never see the photo');
select ok(public.get_public_post_listing_details(array['f7110000-0000-4000-8000-000000000001'::uuid])::text !~ 'listing-checks|f7120000',
  'and nothing public points at it');
select throws_ok($$select public.get_admin_listing_photo_checks()$$,'P0001','ADMIN_REQUIRED','members cannot open the review queue');
select throws_ok($$select public.review_listing_photo_check('f7110000-0000-4000-8000-000000000001',true)$$,'P0001','ADMIN_REQUIRED','or mark a photo');

select set_config('request.jwt.claims','{"sub":"f7100000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2","session_id":"f7160000-0000-4000-8000-000000000006","app_metadata":{"role":"admin"}}',true);
select is(public.get_admin_listing_photo_checks()->0->>'photoPath','f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp','the admin queue has the photo');
select is((select count(*)::int from storage.objects where bucket_id='listing-checks'),1,'the admin can open only the linked photo');
select lives_ok($$select public.review_listing_photo_check('f7110000-0000-4000-8000-000000000001',true)$$,'the admin marks it checked');
select throws_ok($$select public.review_listing_photo_check('f7110000-0000-4000-8000-000000000001',false)$$,'P0001','PHOTO_CHECK_NOT_PENDING','a reviewed photo is not reviewed twice');
select is(jsonb_array_length(public.get_admin_listing_photo_checks()),0,'and leaves the queue');
reset role;
select ok(exists(select 1 from public.admin_access_logs where actor_id='f7100000-0000-4000-8000-000000000006' and scope='evidence' and resource_id='f7110000-0000-4000-8000-000000000001'),
  'opening the photo is logged');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select ok((public.get_public_post_listing_details(array['f7110000-0000-4000-8000-000000000001'::uuid])->0->>'photo_checked_at')::timestamptz <= now(),
  'everyone now sees the checked date on the room');
reset role;

-- Account deletion lists this bucket's folder too.
select is(public.account_image_cleanup_paths('f7100000-0000-4000-8000-000000000001','listing-checks',array['f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp']),
  array['f7100000-0000-4000-8000-000000000001/f7120000-0000-4000-8000-000000000001.webp'],'deleting the account removes the check photo');
select is((select count(*)::int from private.behavior_targets where id in ('compose.rent-check-photo',
  'compose.rent-check-photo.remove','today.newcomer.arrival','today.newcomer.step','today.newcomer.step-link',
  'today.newcomer.arrival-change','today.newcomer.list','today.newcomer.list-hide')),8,'the new app controls are accepted by analytics');
select * from finish();
rollback;
