begin;
set local search_path=public,extensions;
select no_plan();
delete from private.push_delivery_queue;
insert into auth.users(id,email,raw_app_meta_data)
select ('d6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'post-preview-'||n||'@example.test','{}' from generate_series(1,12) n;
insert into auth.sessions(id,user_id) values('d6120000-0000-4000-8000-000000000002','d6100000-0000-4000-8000-000000000002');
insert into public.profiles(id,nickname,city_id)
select id,'알림검사'||right(id::text,2),case when right(id::text,2)='11' then 'toronto' else 'vancouver' end
from auth.users where email like 'post-preview-%@example.test';
insert into public.notification_preferences(user_id,weekly_ranking,trending,push_enabled)
values('d6100000-0000-4000-8000-000000000012',false,false,false);
insert into public.posts(id,author_id,city_id,tag_id,title,body)
select ('d6110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d6100000-0000-4000-8000-000000000001','vancouver',
  (select id from public.tags where slug='life'),'원래 제목 '||n,E'첫 문장\n\n'||repeat('😀',200) from generate_series(1,6) n;
update public.posts set author_id='d6100000-0000-4000-8000-000000000010' where id='d6110000-0000-4000-8000-000000000005';
insert into public.blocks(blocker_id,blocked_id) values
 ('d6100000-0000-4000-8000-000000000003','d6100000-0000-4000-8000-000000000001'),
 ('d6100000-0000-4000-8000-000000000004','d6100000-0000-4000-8000-000000000010');
insert into public.post_views(post_id,user_id)
select ('d6110000-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,('d6100000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid
from generate_series(1,6) p cross join generate_series(2,8) u where u<=9-p;
delete from public.weekly_rankings where city_id='vancouver' and week_start=date_trunc('week',now() at time zone 'America/Toronto')::date;
select private.publish_weekly_ranking();
select is((select count(*)::int from public.notifications where kind='weekly_ranking' and user_id between
 'd6100000-0000-4000-8000-000000000002' and 'd6100000-0000-4000-8000-000000000010'),9,'one weekly recommendation per eligible reader');
select ok(not exists(select 1 from public.notifications n join public.weekly_rankings r on r.post_id=n.target_id and r.city_id='vancouver'
 where n.kind='weekly_ranking' and n.user_id::text like 'd6100000-%' and r.rank>5),'only the top five are eligible');
select ok((select count(distinct target_id)>1 from public.notifications where kind='weekly_ranking' and user_id::text like 'd6100000-%'),'recommendations are not all limited to the winner');
select is((select target_id from public.notifications where kind='weekly_ranking' and user_id='d6100000-0000-4000-8000-000000000003'),
 'd6110000-0000-4000-8000-000000000005'::uuid,'weekly selection falls back to a readable top-five author');
select ok((select target_id<>'d6110000-0000-4000-8000-000000000005'::uuid from public.notifications
 where kind='weekly_ranking' and user_id='d6100000-0000-4000-8000-000000000004'),'weekly selection excludes the recipient blocked author');
select is((select count(*)::int from public.notifications where kind='weekly_ranking' and user_id='d6100000-0000-4000-8000-000000000012'),0,'weekly opt-out is preserved');
select is((select count(*)::int from public.notifications where kind='weekly_ranking' and user_id='d6100000-0000-4000-8000-000000000011'
 and target_id::text like 'd6110000-%'),0,'another city does not receive these posts');
create temp table first_recommendations as select user_id,target_id from public.notifications where kind='weekly_ranking' and user_id::text like 'd6100000-%';
select private.publish_weekly_ranking();
select results_eq($$select user_id,target_id from public.notifications where kind='weekly_ranking' and user_id::text like 'd6100000-%' order by user_id,target_id$$,
 $$select user_id,target_id from first_recommendations order by user_id,target_id$$,'retries neither duplicate nor change weekly recommendations');

delete from public.notifications where user_id::text like 'd6100000-%';
delete from private.trending_sent where city_id='vancouver';
update private.trending_config set enabled=true,quiet_start_hour=0,quiet_end_hour=0,min_score=4,max_per_city_per_day=1;
create temp table trending_pool as select * from private.trending_candidates('vancouver',5);
select private.send_trending_notifications();
select is((select count(*)::int from public.notifications where kind='trending_post' and user_id='d6100000-0000-4000-8000-000000000002'),1,'trending sends one post, not five banners');
select ok(exists(select 1 from public.notifications n join trending_pool p on p.post_id=n.target_id
 where n.kind='trending_post' and n.user_id='d6100000-0000-4000-8000-000000000002' and p.score>=4),'trending chooses a top-five post above the configured score floor');
select is((select count(*)::int from public.notifications where kind='trending_post' and user_id='d6100000-0000-4000-8000-000000000012'),0,'trending opt-out is preserved');
select private.send_trending_notifications();
select is((select count(*)::int from private.trending_sent where city_id='vancouver'),1,'trending retries preserve the configured city delivery limit');
delete from public.notifications where user_id::text like 'd6100000-%';
delete from private.trending_sent where city_id='vancouver';
update private.trending_config set min_score=1000000;
select private.send_trending_notifications();
select is((select count(*)::int from private.trending_sent where city_id='vancouver'),0,'a city without a qualifying post does not send');

delete from public.notifications where user_id::text like 'd6100000-%';
select set_config('request.jwt.claims','{"sub":"d6100000-0000-4000-8000-000000000002","session_id":"d6120000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_device('ExpoPushToken[postpreviewabcdefghijkl]','d6100000-0000-4000-8000-000000000002');
select public.update_notification_preferences('{"push_enabled":true}');
reset role;
select private.create_notification('d6100000-0000-4000-8000-000000000002','weekly_ranking',null,'post',
 'd6110000-0000-4000-8000-000000000001','old queued title','/post/d6110000-0000-4000-8000-000000000001');
update public.posts set title='현재 제목',body=E'현재\n본문  '||repeat('😀',200) where id='d6110000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temp table claimed_preview as select * from public.claim_push_notifications('send',100);
select is((select count(*)::int from claimed_preview),1,'a readable recommendation is claimed once');
select is((select to_jsonb(c)->>'post_title' from claimed_preview c),'현재 제목','claim uses the current title');
select ok((select to_jsonb(c)->>'post_preview' like '현재 본문 %' from claimed_preview c),'claim previews current body and normalizes whitespace');
select is((select char_length(to_jsonb(c)->>'post_preview') from claimed_preview c),181,'Unicode excerpt is bounded with an ellipsis');
select is((select body from claimed_preview),'old queued title','legacy body remains compatible');
select is((select route from claimed_preview),'/post/d6110000-0000-4000-8000-000000000001','preview opens its actual post');
select public.complete_push_notification(id,lease_id,'ticket','d6130000-0000-4000-8000-000000000001') from claimed_preview;
update private.push_delivery_queue set next_attempt_at=now();
create temp table preview_receipt as select * from public.claim_push_notifications('receipt',100);
select ok((select token is null and (to_jsonb(c)->>'post_title') is null and (to_jsonb(c)->>'post_preview') is null from preview_receipt c),'receipt polling does not disclose post preview or device token');
select ok(not has_function_privilege('anon','public.claim_push_notifications(text,integer)','execute')
 and not has_function_privilege('authenticated','public.claim_push_notifications(text,integer)','execute')
 and has_function_privilege('service_role','public.claim_push_notifications(text,integer)','execute'),'claim and preview remain service-only');

delete from public.notifications where user_id::text like 'd6100000-%';
select private.create_notification('d6100000-0000-4000-8000-000000000002','weekly_ranking',null,'post',
 'd6110000-0000-4000-8000-000000000001','blocked queued title','/post/d6110000-0000-4000-8000-000000000001');
select is((select count(*)::int from private.push_delivery_queue where status='pending'),1,'privacy check starts with an already queued recommendation');
insert into public.blocks(blocker_id,blocked_id) values('d6100000-0000-4000-8000-000000000002','d6100000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.claim_push_notifications('send',100)),0,'a blocked author cannot leak a title or excerpt');
delete from public.blocks where blocker_id='d6100000-0000-4000-8000-000000000002';
delete from public.notifications where user_id::text like 'd6100000-%';
select private.create_notification('d6100000-0000-4000-8000-000000000002','weekly_ranking',null,'post',
 'd6110000-0000-4000-8000-000000000001','hidden queued title','/post/d6110000-0000-4000-8000-000000000001');
update public.posts set status='removed' where id='d6110000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.claim_push_notifications('send',100)),0,'a post hidden after queuing cannot leak a preview');
update public.posts set status='published' where id='d6110000-0000-4000-8000-000000000001';
delete from public.notifications where user_id::text like 'd6100000-%';
select private.create_notification('d6100000-0000-4000-8000-000000000002','weekly_ranking',null,'post',
 'd6110000-0000-4000-8000-000000000001','opted-out queued title','/post/d6110000-0000-4000-8000-000000000001');
update public.notification_preferences set weekly_ranking=false where user_id='d6100000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.claim_push_notifications('send',100)),0,'turning recommendations off before delivery cancels the preview');
select * from finish();
rollback;
