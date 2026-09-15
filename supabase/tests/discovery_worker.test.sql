begin;
select no_plan();
delete from private.discovery_post_queue;
select ok(not has_function_privilege('authenticated','private.process_discovery_posts(integer)','execute'),'clients cannot run fanout');
select ok(not has_function_privilege('anon','private.process_discovery_posts(integer)','execute'),'guests cannot run fanout');
select ok(not has_table_privilege('authenticated','private.discovery_post_queue','select,insert,update,delete'),'clients cannot access queue');
select is((select schedule from cron.job where jobname='gling-discovery-posts'),'10 seconds','existing cron schedules bounded discovery batches');
insert into auth.users(id,email,raw_app_meta_data)
select ('42000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'worker-'||n||'@example.invalid','{}' from generate_series(0,8) n;
insert into public.profiles(id,nickname,city_id)
select id,'worker-'||right(id::text,2),'vancouver' from auth.users where email like 'worker-%@example.invalid';
insert into public.notification_preferences(user_id,interests,interest_tag_ids,push_enabled)
select id,true,array[1],true from public.profiles where nickname like 'worker-%' and id<>'42000000-0000-0000-0000-000000000000';
insert into auth.sessions(id,user_id) values('42000000-0000-0000-0001-000000000001','42000000-0000-0000-0000-000000000001');
insert into private.push_devices(token,user_id,session_id)
values('ExponentPushToken[discovery-worker-test]','42000000-0000-0000-0000-000000000001','42000000-0000-0000-0001-000000000001');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('42000000-0000-0001-0000-000000000001','42000000-0000-0000-0000-000000000000','vancouver',1,'Worker test','A queued discovery post');
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000001'),0,'publish does not synchronously fan out');
select is((select count(*)::integer from public.safety_review_queue where target_id='42000000-0000-0001-0000-000000000001'),1,'every new post still enters safety review');
-- These changes happen after enqueue; current eligibility wins.
update public.notification_preferences set interests=false where user_id='42000000-0000-0000-0000-000000000003';
update public.profiles set city_id='toronto' where id='42000000-0000-0000-0000-000000000004';
insert into public.blocks(blocker_id,blocked_id) values('42000000-0000-0000-0000-000000000005','42000000-0000-0000-0000-000000000000');
update public.profiles set account_status='deleted' where id='42000000-0000-0000-0000-000000000006';
update public.notification_preferences set interest_tag_ids=array[4] where user_id='42000000-0000-0000-0000-000000000007';
update public.notification_preferences set interests=false where user_id='42000000-0000-0000-0000-000000000008';
update public.notification_preferences set interests=true where user_id='42000000-0000-0000-0000-000000000008';
-- An interrupted transaction rolls back both notifications and the cursor.
do $$ begin
  begin perform private.process_discovery_posts(2); raise exception 'simulated interruption';
  exception when raise_exception then null; end;
end $$;
select is((select after_user_id from private.discovery_post_queue limit 1),'00000000-0000-0000-0000-000000000000'::uuid,'interrupted batch preserves cursor');
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000001'),0,'interrupted batch leaves no partial notifications');
select is(private.process_discovery_posts(2),2,'worker respects caller batch bound');
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000001'),2,'first batch delivers only its two candidates');
select is((select count(*)::integer from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.target_id='42000000-0000-0001-0000-000000000001'),1,'existing push trigger enqueues eligible registered device');
select private.process_discovery_posts(500);
select private.process_discovery_posts(500);
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000001'),2,'resume rechecks opt-out, city, blocks, deleted accounts, interest changes and later opt-in');
select is((select count(*)::integer from private.discovery_post_queue),0,'completed work is removed');
select is(private.process_discovery_posts(),0,'rerunning idle worker cannot replay posts');
insert into public.notifications(user_id,kind,actor_id,target_type,target_id,body)
values('42000000-0000-0000-0000-000000000001','interest_post','42000000-0000-0000-0000-000000000000','post','42000000-0000-0001-0000-000000000001','duplicate') on conflict do nothing;
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000001'),2,'database uniqueness prevents duplicate discovery delivery');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('42000000-0000-0001-0000-000000000002','42000000-0000-0000-0000-000000000000','vancouver',1,'Removed post','Removed before processing');
update public.posts set status='removed' where id='42000000-0000-0001-0000-000000000002';
select private.process_discovery_posts();
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000002'),0,'removed posts are discarded at processing time');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('42000000-0000-0001-0000-000000000003','42000000-0000-0000-0000-000000000000','vancouver',1,'Review post','Author changed after enqueue');
update auth.users set raw_app_meta_data='{"review_access":true}' where id='42000000-0000-0000-0000-000000000000';
select private.process_discovery_posts();
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000003'),0,'review accounts are excluded again at processing time');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('42000000-0000-0001-0000-000000000004','42000000-0000-0000-0000-000000000000','vancouver',1,'Review fixture','Never queue an existing review account');
select is((select count(*)::integer from private.discovery_post_queue),0,'review posts are excluded at enqueue time too');
update auth.users set raw_app_meta_data='{}' where id='42000000-0000-0000-0000-000000000000';
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values('42000000-0000-0001-0000-000000000005','42000000-0000-0000-0000-000000000000','vancouver',1,'Inactive author','Author suspended before delivery');
update public.profiles set account_status='suspended' where id='42000000-0000-0000-0000-000000000000';
select private.process_discovery_posts();
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000005'),0,'inactive authors are checked at processing time');
update public.profiles set account_status='active' where id='42000000-0000-0000-0000-000000000000';
update public.notification_preferences set interests=false,nearby=true where user_id='42000000-0000-0000-0000-000000000001';
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview)
values('42000000-0000-0001-0000-000000000006','42000000-0000-0000-0000-000000000000','vancouver',4,'Closed meetup','Closes before discovery','{"capacity":4}');
update public.posts set room_preview=room_preview||'{"closed":true}' where id='42000000-0000-0001-0000-000000000006';
select private.process_discovery_posts();
select is((select count(*)::integer from public.notifications where target_id='42000000-0000-0001-0000-000000000006' and user_id='42000000-0000-0000-0000-000000000001'),0,'nearby eligibility is rechecked after a meetup closes');
select * from finish();
rollback;
