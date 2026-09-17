begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('62000000-0000-0000-0000-000000000001','reporter62@example.test','{}'),
 ('62000000-0000-0000-0000-000000000002','author62@example.test','{}'),
 ('62000000-0000-0000-0000-000000000003','other62@example.test','{}'),
 ('62000000-0000-0000-0000-000000000004','admin62@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'검토회원'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '62000000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on) values
 ('62000000-0000-0000-0000-000000000011','62000000-0000-0000-0000-000000000002','vancouver',1,'검토 글 하나','보존할 원본',current_date),
 ('62000000-0000-0000-0000-000000000012','62000000-0000-0000-0000-000000000002','vancouver',1,'검토 글 둘','다른 본문',current_date - 1);
insert into public.comments(id,post_id,author_id,body) values
 ('62000000-0000-0000-0000-000000000021','62000000-0000-0000-0000-000000000012','62000000-0000-0000-0000-000000000002','보존할 댓글');
insert into public.conversations(id,user_low_id,user_high_id,status) values
 ('62000000-0000-0000-0000-000000000030','62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002','active');
insert into public.messages(id,conversation_id,sender_id,body) values
 ('62000000-0000-0000-0000-000000000031','62000000-0000-0000-0000-000000000030','62000000-0000-0000-0000-000000000002','보존할 메시지');

select set_config('request.jwt.claims','{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.create_report('post','62000000-0000-0000-0000-000000000011','spam','검토 요청')$$,'report succeeds');
select is_empty($$select id from public.get_public_post('62000000-0000-0000-0000-000000000011')$$,'reporter cannot reopen the reported post');
select is_empty($$select id from public.get_public_feed_page_v2('vancouver') where id='62000000-0000-0000-0000-000000000011'$$,'reporter feed hides reported post');
select is((select count(*)::integer from public.get_public_post('62000000-0000-0000-0000-000000000012')),1,'another post remains before blocking');
select throws_ok($$select public.moderate_report((select id from public.reports limit 1),'hidden','')$$,'P0001','ADMIN_REQUIRED','ordinary user cannot hide globally');
reset role;
select set_config('test.report',(select id::text from public.reports where reporter_id='62000000-0000-0000-0000-000000000001'),true);
select is((select count(*)::integer from public.notifications where user_id='62000000-0000-0000-0000-000000000004' and route='/admin?section=reports'),1,'admin notified');
update public.posts set body='작성자가 수정한 본문' where id='62000000-0000-0000-0000-000000000011';
select is((select evidence->>'body' from public.reports where id=current_setting('test.report')::uuid),'보존할 원본','report keeps original version');
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code) values
 ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002','comment','62000000-0000-0000-0000-000000000021','spam'),
 ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002','message','62000000-0000-0000-0000-000000000031','spam');
-- Keep report-and-block association deterministic despite this transaction's equal timestamps.
update public.reports set created_at=now()-interval '10 minutes' where target_type in ('comment','message') and reporter_id='62000000-0000-0000-0000-000000000001';
set local role authenticated;
select is_empty($$select id from public.get_comment_thread_page('62000000-0000-0000-0000-000000000012')$$,'reported comment disappears before blocking');
select is_empty($$select id from public.messages where id='62000000-0000-0000-0000-000000000031'$$,'reported message disappears before blocking');
select is(public.get_conversation_inbox()->'items'->0->>'latest_body',null::text,'reported message is also absent from inbox preview');
select lives_ok($$insert into public.blocks(blocker_id,blocked_id) values('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002')$$,'block succeeds');
select ok((select blocked_at is not null from public.reports where id=current_setting('test.report')::uuid),'report records accompanying block');
select is_empty($$select id from public.get_public_post('62000000-0000-0000-0000-000000000012')$$,'block hides all author posts');
reset role;
select set_config('request.jwt.claims','{"sub":"62000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.get_public_post('62000000-0000-0000-0000-000000000011')),1,'another user still sees reported content');
select is_empty($$select id from public.reports where id=current_setting('test.report')::uuid$$,'other users cannot read report evidence');
select lives_ok($$insert into public.blocks(blocker_id,blocked_id) values('62000000-0000-0000-0000-000000000003','62000000-0000-0000-0000-000000000002')$$,'standalone block succeeds');
select is((select source from public.reports where reporter_id='62000000-0000-0000-0000-000000000003'),'block','standalone block enters admin queue');
reset role;
update public.reports set status='dismissed', resolved_at=now()
where reporter_id='62000000-0000-0000-0000-000000000003';
set local role authenticated;
delete from public.blocks where blocker_id='62000000-0000-0000-0000-000000000003';
select lives_ok($$insert into public.blocks(blocker_id,blocked_id,created_at) values('62000000-0000-0000-0000-000000000003','62000000-0000-0000-0000-000000000002',now()+interval '1 second')$$,'reblocking succeeds without duplicate report failure');
select is((select status from public.reports where reporter_id='62000000-0000-0000-0000-000000000003'),'open','reblock reopens review queue');
reset role;
select is((select count(*)::integer from public.notifications where user_id='62000000-0000-0000-0000-000000000004' and route='/admin?section=reports'),6,'reports, accompanying block, direct block and reblock notify admin');
select set_config('request.jwt.claims','{"sub":"62000000-0000-0000-0000-000000000004","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select lives_ok($$select public.moderate_report(current_setting('test.report')::uuid,'hidden','확인 후 전체 숨김')$$,'admin can hide content without suspending author');
select is((select body from public.posts where id='62000000-0000-0000-0000-000000000011'),'작성자가 수정한 본문','admin retains full original row');
select is((select account_status from public.profiles where id='62000000-0000-0000-0000-000000000002'),'active','content-only action does not suspend account');
select lives_ok($$select public.moderate_report(id,'hidden','검토 완료') from public.reports where reporter_id='62000000-0000-0000-0000-000000000001' and target_type in ('comment','message')$$,'admin hides comments and messages');
select is((select body from public.comments where id='62000000-0000-0000-0000-000000000021'),'보존할 댓글','admin retains hidden comment');
select is((select body from public.messages where id='62000000-0000-0000-0000-000000000031'),'보존할 메시지','admin retains hidden message');
select is((select count(*)::integer from public.admin_access_logs where actor_id='62000000-0000-0000-0000-000000000004' and scope='reports'),3,'each moderation action is audited');
reset role;
select set_config('request.jwt.claims','{"sub":"62000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is_empty($$select id from public.messages where id='62000000-0000-0000-0000-000000000031'$$,'global hide also excludes message from sender');
select is_empty($$select id from public.get_comment_thread_page('62000000-0000-0000-0000-000000000012')$$,'global hide also excludes comment from author');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is_empty($$select id from public.get_public_post('62000000-0000-0000-0000-000000000011')$$,'global moderation hides post even for guests');
reset role;
select * from finish();
rollback;
