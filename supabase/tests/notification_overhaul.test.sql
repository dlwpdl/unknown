begin;
select no_plan();
-- Fixtures: owner (recipient), two likers, an admin. Everything rolls back.
insert into auth.users(id,email,raw_app_meta_data) values
 ('92000000-0000-4000-8000-000000000001','overhaul-owner@example.test','{}'),
 ('92000000-0000-4000-8000-000000000002','overhaul-a@example.test','{}'),
 ('92000000-0000-4000-8000-000000000003','overhaul-b@example.test','{}'),
 ('92000000-0000-4000-8000-000000000004','overhaul-c@example.test','{}'),
 ('92000000-0000-4000-8000-000000000009','overhaul-admin@example.test','{"role":"admin"}');
insert into public.profiles(id,nickname,city_id) values
 ('92000000-0000-4000-8000-000000000001','알림주인','vancouver'),
 ('92000000-0000-4000-8000-000000000002','민지','vancouver'),
 ('92000000-0000-4000-8000-000000000003','서준','vancouver'),
 ('92000000-0000-4000-8000-000000000004','하린','vancouver'),
 ('92000000-0000-4000-8000-000000000009','요약관리자','vancouver');
insert into auth.sessions(id,user_id,aal) values
 ('92100000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',null),
 ('92100000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002',null),
 ('92100000-0000-4000-8000-000000000009','92000000-0000-4000-8000-000000000009','aal2');
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('92200000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','vancouver',1,'좋아요 묶기 글','본문');

select has_column('public','notification_preferences','push_muted','per-category push mute is stored');
select has_function('public','register_push_device',array['text','uuid','text','text'],'locale-aware registration exists');
select has_function('public','register_push_device',array['text','uuid','text'],'timezone registration still exists');
select has_function('public','register_push_device',array['text','uuid'],'oldest registration still exists');

-- 1, 2. Preferences: push_muted and locked account security.
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000001","session_id":"92100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_notification_preferences()->'push_muted','[]'::jsonb,'missing preferences report no muted push');
select is(public.update_notification_preferences('{"push_enabled":true,"push_muted":["messages","account_security","unknown_future","messages"],"account_security":false}')->'push_muted',
 '["messages"]'::jsonb,'unknown categories and account security are dropped from push_muted');
select is(public.get_notification_preferences()->'account_security','true'::jsonb,'account security stays on');
select throws_ok($$select public.update_notification_preferences('{"push_muted":"messages"}')$$,'P0001','INVALID_PREFERENCES','push_muted must be an array');
select throws_ok($$select public.update_notification_preferences('{"push_muted":[1]}')$$,'P0001','INVALID_PREFERENCES','push_muted entries must be strings');
select is(public.update_notification_preferences('{"replies":true}')->'push_muted','["messages"]'::jsonb,'other updates keep push_muted');

-- 3. Locale: 4-argument registration; old calls stay Korean.
select lives_ok($$select public.register_push_device('ExpoPushToken[overhaulOwner12345]',auth.uid(),'America/Vancouver','en-CA')$$,'locale registration works');
reset role;
select is((select locale from private.push_devices where token='ExpoPushToken[overhaulOwner12345]'),'en','region suffix is normalised');
set local role authenticated;
select public.register_push_device('ExpoPushToken[overhaulOwner12345]',auth.uid(),'America/Vancouver','fr');
select public.register_push_device('ExpoPushToken[overhaulOwner12345]',auth.uid(),'America/Vancouver');
reset role;
select is((select locale from private.push_devices where token='ExpoPushToken[overhaulOwner12345]'),'en','unknown or missing locale keeps the stored value');
select ok(not has_function_privilege('anon','public.register_push_device(text,uuid,text,text)','execute'),'guests cannot register');

-- Muted category: in-app row stays, push is skipped.
insert into public.conversations(id,user_low_id,user_high_id,status) values
 ('92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','active');
insert into public.messages(id,conversation_id,sender_id,body) values
 ('92400000-0000-4000-8000-000000000001','92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','첫 메시지');
select is((select count(*)::int from public.notifications where target_id='92400000-0000-4000-8000-000000000001'),1,'muted messages keep the in-app row');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.target_id='92400000-0000-4000-8000-000000000001'),0,'muted messages are not pushed');

-- 10. Chat burst: one push per conversation per minute.
update public.notification_preferences set push_muted='{}' where user_id='92000000-0000-4000-8000-000000000001';
update public.notifications set created_at=created_at-interval '5 minutes' where kind='message';
insert into public.messages(id,conversation_id,sender_id,body) values
 ('92400000-0000-4000-8000-000000000002','92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','둘째'),
 ('92400000-0000-4000-8000-000000000003','92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','셋째');
select is((select count(*)::int from public.notifications where kind='message' and user_id='92000000-0000-4000-8000-000000000001'),3,'every message keeps its in-app row');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='message'),1,'a same-minute burst pushes once');
update public.notifications set created_at=created_at-interval '2 minutes' where kind='message';
insert into public.messages(id,conversation_id,sender_id,body) values
 ('92400000-0000-4000-8000-000000000004','92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','넷째');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='message'),2,'a message after a quiet minute pushes again');

-- 9. Claim exposes kind, locale and the unread badge.
create temporary table overhaul_claim as select * from public.claim_push_notifications('send',100);
select is((select kind from overhaul_claim limit 1),'message','claim returns the kind');
select is((select locale from overhaul_claim limit 1),'en','claim returns the device locale');
select is((select badge from overhaul_claim limit 1),(select count(*)::int from public.notifications where user_id='92000000-0000-4000-8000-000000000001' and read_at is null),'claim badge is the unread count');
select public.complete_push_notification(id,lease_id,'failed') from overhaul_claim;
update public.notifications set read_at=now() where kind='message';

-- 10. Message reactions: re-toggling reuses one row, with the actor's name.
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000002","session_id":"92100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.set_message_reaction(id,true) from (values ('92400000-0000-4000-8000-000000000001'::uuid)) v(id);
reset role;
insert into public.messages(id,conversation_id,sender_id,body) select ('92500000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid,
 '92300000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','반응 대상' from generate_series(1,12) i;
set local role authenticated;
select public.set_message_reaction('92500000-0000-4000-8000-000000000001',true);
select public.set_message_reaction('92500000-0000-4000-8000-000000000001',false);
select public.set_message_reaction('92500000-0000-4000-8000-000000000001',true);
reset role;
select is((select count(*)::int from public.notifications where kind='message_reaction' and target_id='92500000-0000-4000-8000-000000000001'),1,'toggling a heart keeps one notification');
select is((select body from public.notifications where kind='message_reaction' and target_id='92500000-0000-4000-8000-000000000001'),'민지님이 내 메시지에 공감했어요.','reaction copy names the actor');
set local role authenticated;
select public.set_message_reaction(('92500000-0000-4000-8000-0000000000'||lpad(i::text,2,'0'))::uuid,true) from generate_series(2,12) i;
reset role;
select is((select count(*)::int from public.notifications where kind='message_reaction' and actor_id='92000000-0000-4000-8000-000000000002'),10,'one actor creates at most 10 reaction notifications an hour');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='message_reaction'),0,'reactions still never push');

-- 5. Likes: the first like on a target pushes, later likes wait for the evening summary.
insert into public.post_reactions(post_id,user_id,kind) values ('92200000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','like');
update public.notifications set created_at=created_at-interval '1 hour' where kind='post_like';
insert into public.post_reactions(post_id,user_id,kind) values
 ('92200000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000003','like');
update public.notifications set created_at=created_at-interval '1 minute' where kind='post_like' and actor_id='92000000-0000-4000-8000-000000000003';
insert into public.post_reactions(post_id,user_id,kind) values
 ('92200000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000004','like');
select is((select count(*)::int from public.notifications where kind='post_like'),3,'every like keeps its in-app row');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='post_like'),1,'only the first like on a target pushes');
create function pg_temp.vancouver_next(p_time interval) returns timestamptz language sql as $$
  select case when t>now() then t else t+interval '1 day' end
  from (select ((now() at time zone 'America/Vancouver')::date+p_time) at time zone 'America/Vancouver' t) x;
$$;
select is(private.send_like_summaries(pg_temp.vancouver_next('12:30')),0,'summaries wait for 19:00 local');
select is(private.send_like_summaries(pg_temp.vancouver_next('19:30')),1,'held likes become one summary');
select is((select body from public.notifications where kind='like_summary'),'하린님 외 1명이 내 글을 좋아해요.','summary names the latest liker and the rest');
select is((select category||' '||route from public.notifications where kind='like_summary'),'post_likes /post/92200000-0000-4000-8000-000000000001','summary keeps the like category and target route');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='like_summary'),1,'summary is pushed');
select is(private.send_like_summaries(pg_temp.vancouver_next('19:30')),0,'a summary is not repeated');
select is(private.notification_category('like_summary','comment'),'comment_likes','comment summaries use the comment like category');

-- 6. Admin digest twice a day; individual signups stop pushing.
insert into public.notification_preferences(user_id,push_enabled) values ('92000000-0000-4000-8000-000000000009',true);
insert into private.push_devices(user_id,session_id,token,timezone) values
 ('92000000-0000-4000-8000-000000000009','92100000-0000-4000-8000-000000000009','ExpoPushToken[overhaulAdmin12345]','America/Vancouver');
insert into public.notifications(user_id,kind,target_type,target_id,body,route) values
 ('92000000-0000-4000-8000-000000000009','admin_signup','user','92000000-0000-4000-8000-000000000002','민지님이 밴쿠버에 새로 가입했어요.','/admin?section=users'),
 ('92000000-0000-4000-8000-000000000009','admin_signup','user','92000000-0000-4000-8000-000000000003','서준님이 밴쿠버에 새로 가입했어요.','/admin?section=users'),
 ('92000000-0000-4000-8000-000000000009','admin_error_spike','client_error','92000000-0000-4000-8000-000000000003','오류가 늘었어요.','/admin?section=errors');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_signup'),0,'signups no longer push one by one');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_error_spike'),1,'urgent admin alerts still push immediately');
select is(private.send_admin_digests(pg_temp.vancouver_next('12:30')),0,'no digest outside 09:00 and 18:00');
select is(private.send_admin_digests(pg_temp.vancouver_next('09:30')),1,'09:00 digest is created');
select is((select body||' '||route||' '||category from public.notifications where kind='admin_digest'),'새로 가입한 사람이 2명 있어요. /admin system','digest counts sign-ups and opens the dashboard');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_digest'),1,'digest is pushed');
select is(private.send_admin_digests(pg_temp.vancouver_next('09:45')),0,'one digest per slot');
select is(private.send_admin_digests(pg_temp.vancouver_next('09:30')+interval '9 hours'),0,'nothing new means no 18:00 digest');

-- 8. Admin dashboard origin is server-side and admin-only.
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000009","session_id":"92100000-0000-4000-8000-000000000009","aal":"aal2","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is(public.get_admin_dashboard_origin(),'https://cayden-macbookpro.tailb6648f.ts.net','admins get the dashboard origin');
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000001","session_id":"92100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_admin_dashboard_origin(),null,'members get nothing');
reset role;
select ok(not has_function_privilege('anon','public.get_admin_dashboard_origin()','execute'),'guests cannot ask');

-- 7. Trending hashtag rows open the hashtag feed.
select ok((select prosrc like '%''/?hashtag='' || regexp_replace(hashtag.hashtag%' from pg_proc where oid='public.send_trending_topic_notifications()'::regprocedure),'hashtag rows route to the hashtag feed');
select ok((select count(*)=2 from cron.job where jobname in ('gling-like-summaries','gling-admin-digest')),'summary jobs are scheduled');

select * from finish();
rollback;
