begin;
select no_plan();
select has_function('public', 'create_thread_comment', array['uuid','text','uuid'], 'thread comments have an authenticated creation API');
select has_function('public', 'get_comment_thread_page', array['uuid','uuid','timestamp with time zone','uuid','integer'], 'threads support independent keyset pages');
select has_function('public', 'get_notification_preferences', array[]::text[], 'notification preferences have an account-scoped API');
select has_function('public', 'get_comment_thread_context', array['uuid','uuid'], 'comment notification links can resolve an exact visible thread');
select has_view('public', 'user_notifications', 'personal inbox has an account-scoped view separate from admin review');

insert into auth.users (id, email, raw_app_meta_data) values
  ('40111111-1111-1111-1111-111111111111','thread-owner@example.com','{}'),
  ('40222222-2222-2222-2222-222222222222','thread-root@example.com','{}'),
  ('40333333-3333-3333-3333-333333333333','thread-reply@example.com','{}'),
  ('40444444-4444-4444-4444-444444444444','thread-other-city@example.com','{}'),
  ('40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','thread-admin@example.com','{"role":"admin"}');
insert into public.profiles (id,nickname,city_id) values
  ('40111111-1111-1111-1111-111111111111','스레드글쓴이','vancouver'),
  ('40222222-2222-2222-2222-222222222222','스레드원댓글','vancouver'),
  ('40333333-3333-3333-3333-333333333333','스레드답글','vancouver'),
  ('40444444-4444-4444-4444-444444444444','스레드다른도시','toronto'),
  ('40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','스레드관리자','vancouver');
insert into public.posts (id,author_id,city_id,tag_id,title,body) values
  ('40555555-5555-5555-5555-555555555555','40111111-1111-1111-1111-111111111111','vancouver',1,'스레드 테스트','공개 글입니다.'),
  ('40666666-6666-6666-6666-666666666666','40444444-4444-4444-4444-444444444444','toronto',1,'다른 글','다른 도시입니다.');
create temporary table thread_state (root_id uuid, reply_id uuid, nested_id uuid, second_root uuid);
insert into thread_state default values;
grant select,update on thread_state to authenticated;

select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_notification_preferences(),
  '{"post_likes":true,"comment_likes":true,"replies":true,"direct_requests":true,"messages":true,"meetups":true,"interests":false,"nearby":false,"push_enabled":false,"interest_tag_ids":[],"interest_hashtags":[]}'::jsonb,
  'missing preferences enable activity only and require opt-in for discovery and push');
select throws_ok($$select public.update_notification_preferences('{"user_id":"40111111-1111-1111-1111-111111111111"}')$$,
  'P0001','INVALID_PREFERENCES','cannot patch another account or an unknown preference');
select throws_ok($$select public.update_notification_preferences('{"replies":"false"}')$$,
  'P0001','INVALID_PREFERENCES','booleans must be JSON booleans');
select throws_ok($$select public.update_notification_preferences('{"replies":null}')$$,
  'P0001','INVALID_PREFERENCES','null cannot silently restore a category default');
select throws_ok($$select public.update_notification_preferences('{"interest_tag_ids":[99999]}')$$,
  'P0001','INVALID_INTEREST_TAGS','interests must reference an existing category');
select throws_ok($$select public.update_notification_preferences('{"interest_tag_ids":[1.1]}')$$,
  'P0001','INVALID_INTEREST_TAGS','fractional category IDs are rejected');
select throws_ok($$select public.update_notification_preferences('{"interest_hashtags":[""]}')$$,
  'P0001','INVALID_INTEREST_HASHTAGS','empty interest hashtags are rejected');
select lives_ok($$select public.update_notification_preferences(jsonb_build_object('interest_hashtags',jsonb_build_array(repeat('가',50))))$$,
  'interest hashtags accept the client 50-character boundary');
select throws_ok($$select public.update_notification_preferences(jsonb_build_object('interest_hashtags',to_jsonb(array_fill('hiking'::text,array[21]))))$$,
  'P0001','INVALID_PREFERENCES','interest input is limited to 20 submitted hashtags');
select is(public.update_notification_preferences('{"interest_hashtags":["#Hiking","hiking"],"interest_tag_ids":[1,1]}')->'interest_hashtags',
  '["hiking"]'::jsonb,'interest hashtags share canonicalization and case-insensitive matching');
select is(public.get_notification_preferences()->'interest_tag_ids','[1]'::jsonb,'duplicate interest categories collapse');
select throws_ok($$insert into public.notification_preferences(user_id) values ('40111111-1111-1111-1111-111111111111')$$,
  '42501',null,'clients cannot bypass preference validation with table writes');
update thread_state set root_id = public.create_comment('40555555-5555-5555-5555-555555555555','  루트 댓글  ');
select is((select body from public.comments where id=(select root_id from thread_state)),'루트 댓글','legacy creation still trims a root comment');
select ok((select parent_id is null and reply_to_id is null from public.comments where id=(select root_id from thread_state)),
  'legacy create_comment remains a root comment');
select throws_ok($$select public.create_thread_comment('40555555-5555-5555-5555-555555555555','   ',null)$$,
  'P0001','INVALID_COMMENT','blank replies cannot bypass comment validation');
select throws_ok($$select public.create_thread_comment('40555555-5555-5555-5555-555555555555',repeat('가',1001),null)$$,
  'P0001','INVALID_COMMENT','thread bodies retain the 1000 character limit');
select throws_ok($$select public.create_thread_comment('40555555-5555-5555-5555-555555555555','연속 답글',(select root_id from thread_state))$$,
  'P0001','RATE_LIMITED','legacy and threaded comment writes share the same rate limit');
select throws_ok($$update public.comments set parent_id=id where id=(select root_id from thread_state)$$,
  '42501',null,'clients cannot rewrite thread relationships through direct table updates');
reset role;
select is((select category from public.notifications where target_id=(select root_id from thread_state)),'replies','new root comments notify the post owner');
select is((select route from public.notifications where target_id=(select root_id from thread_state)),
  '/post/40555555-5555-5555-5555-555555555555?commentId='||(select root_id::text from thread_state),'comment notifications link directly to their exact comment');

select set_config('request.jwt.claims','{"sub":"40333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select is_empty($$select * from public.notification_preferences$$,'preference RLS hides other accounts');
select throws_ok($$select public.create_thread_comment('40666666-6666-6666-6666-666666666666','다른 글 답글',(select root_id from thread_state))$$,
  'P0001','COMMENT_NOT_FOUND','a reply cannot cross posts');
update thread_state set reply_id = public.create_thread_comment('40555555-5555-5555-5555-555555555555','첫 답글',root_id);
select results_eq($$select parent_id from public.comments where id=(select reply_id from thread_state)$$,
  $$select root_id from thread_state$$,'a reply stores its root parent');
reset role;
select is((select count(*)::integer from public.notifications where target_id=(select reply_id from thread_state)),2,
  'a reply notifies both the post owner and the directly addressed comment owner once');
delete from private.action_rate_events where user_id='40222222-2222-2222-2222-222222222222';
select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
update thread_state set nested_id = public.create_thread_comment('40555555-5555-5555-5555-555555555555','답글에 답글',reply_id);
select results_eq($$select parent_id,reply_to_id from public.comments where id=(select nested_id from thread_state)$$,
  $$select root_id,reply_id from thread_state$$,'replying to a reply keeps one indentation level and its direct recipient');
select is((select reply_to_nickname from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555',(select root_id from thread_state))
  where id=(select nested_id from thread_state)),'스레드답글','thread rows include the direct reply recipient nickname');
select is((select reply_count from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555') where id=(select root_id from thread_state)),2,
  'root counts include both first replies and replies to replies');
select results_eq($$select id from public.get_comment_thread_context('40555555-5555-5555-5555-555555555555',(select nested_id from thread_state))$$,
  $$select root_id from thread_state union all select nested_id from thread_state$$,'exact reply context returns root first and target without unrelated siblings');
select results_eq($$select id from public.get_comment_thread_context('40555555-5555-5555-5555-555555555555',(select root_id from thread_state))$$,
  $$select root_id from thread_state$$,'a root context contains the root only once');
select is_empty($$select * from public.get_comment_thread_context('40666666-6666-6666-6666-666666666666',(select nested_id from thread_state))$$,
  'an exact target cannot cross posts');
select is_empty($$select * from public.get_comment_thread_context('40555555-5555-5555-5555-555555555555','40000000-0000-0000-0000-000000000000')$$,
  'a missing notification target returns no context');
reset role;
select is((select count(*)::integer from public.safety_review_queue where target_type='comment'
  and target_id in (select root_id from thread_state union all select reply_id from thread_state union all select nested_id from thread_state)),3,
  'all root comments and replies enter automated safety monitoring');
update public.comments set created_at='2030-01-01' where id=(select root_id from thread_state);
update public.comments set created_at='2030-01-03' where id in (select reply_id from thread_state union all select nested_id from thread_state);
insert into public.comments(id,post_id,author_id,body,created_at)
  values('40777777-7777-7777-7777-777777777777','40555555-5555-5555-5555-555555555555','40111111-1111-1111-1111-111111111111','둘째 루트','2030-01-02');
update thread_state set second_root='40777777-7777-7777-7777-777777777777';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select results_eq($$select id from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555',null,null,null,1)$$,
  array['40777777-7777-7777-7777-777777777777'::uuid],'guest root pagination orders newest first');
select is((select count(*)::integer from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555',null,'2030-01-02','40777777-7777-7777-7777-777777777777',31)),1,
  'root cursor returns the next root without including replies');
select results_eq($$select id from public.get_comment_thread_context('40555555-5555-5555-5555-555555555555','40777777-7777-7777-7777-777777777777')$$,
  array['40777777-7777-7777-7777-777777777777'::uuid],'guests may resolve visible notification targets');
select throws_ok($$select public.get_notification_preferences()$$,'42501',null,'guests cannot access preference RPCs');
reset role;
select set_config('request.jwt.claims','{"sub":"40111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select results_eq(
  $$select id from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555',(select root_id from thread_state),'2030-01-03',(select greatest(reply_id,nested_id) from thread_state),31)$$,
  $$select least(reply_id,nested_id) from thread_state$$,'reply cursor uses the UUID tie breaker for equal timestamps');
insert into public.comment_likes(comment_id,user_id) select reply_id,'40111111-1111-1111-1111-111111111111' from thread_state;
reset role;
select is((select category from public.notifications where kind='comment_like' and target_id=(select reply_id from thread_state)),
  'comment_likes','replies receive the same like notification category as comments');
select is((select route from public.notifications where kind='comment_like' and target_id=(select reply_id from thread_state)),
  '/post/40555555-5555-5555-5555-555555555555?commentId='||(select reply_id::text from thread_state),'like notifications link directly to the liked reply');
select set_config('request.jwt.claims','{"sub":"40333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
insert into public.comment_likes(comment_id,user_id) select root_id,'40333333-3333-3333-3333-333333333333' from thread_state;
delete from public.comment_likes where comment_id=(select root_id from thread_state) and user_id='40333333-3333-3333-3333-333333333333';
insert into public.comment_likes(comment_id,user_id) select root_id,'40333333-3333-3333-3333-333333333333' from thread_state;
insert into public.comment_likes(comment_id,user_id) select reply_id,'40333333-3333-3333-3333-333333333333' from thread_state;
reset role;
select is((select count(*)::integer from public.notifications where kind='comment_like' and target_id=(select root_id from thread_state)),1,
  'unlike and re-like do not duplicate a comment notification');
select is((select count(*)::integer from public.notifications where actor_id=user_id and actor_id='40333333-3333-3333-3333-333333333333'),0,
  'self actions produce no activity notifications');

select set_config('request.jwt.claims','{"sub":"40333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select public.update_notification_preferences('{"comment_likes":false,"replies":false,"direct_requests":false,"messages":false,"meetups":false,"post_likes":false}');
select is_empty($$select * from public.notifications where category<>'system'$$,'turning a category off immediately filters existing inbox rows on the server');
reset role;
select is(private.create_notification('40333333-3333-3333-3333-333333333333','comment_like','40222222-2222-2222-2222-222222222222',
  'comment',(select reply_id from thread_state),'공감',null),null::uuid,'disabled categories suppress new notification insertion');
select is(private.create_notification('40333333-3333-3333-3333-333333333333','message','40222222-2222-2222-2222-222222222222',
  'user','40222222-2222-2222-2222-222222222222','대화 요청',null),null::uuid,'DM requests obey their own disabled category');
select set_config('request.jwt.claims','{"sub":"40333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select public.update_notification_preferences('{"direct_requests":true}');
reset role;
select private.create_notification('40333333-3333-3333-3333-333333333333','message','40222222-2222-2222-2222-222222222222',
  'user','40222222-2222-2222-2222-222222222222','대화 요청',null);
select is((select category from public.notifications where user_id='40333333-3333-3333-3333-333333333333' and target_type='user'),'direct_requests',
  'legacy message/user request notifications map to direct_requests');
select is(private.create_notification('40333333-3333-3333-3333-333333333333','message','40222222-2222-2222-2222-222222222222',
  'message','40999999-9999-9999-9999-999999999999','메시지',null),null::uuid,'enabling requests does not enable actual message notifications');

insert into public.blocks(blocker_id,blocked_id) values ('40222222-2222-2222-2222-222222222222','40333333-3333-3333-3333-333333333333');
select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select is_empty($$select * from public.notifications where actor_id='40333333-3333-3333-3333-333333333333'$$,'blocking removes existing activity from the inbox');
select is((select reply_count from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555') where id=(select root_id from thread_state)),0,
  'reply counts do not leak blocked authors or direct recipients');
select is_empty($$select * from public.get_public_comments_page('40555555-5555-5555-5555-555555555555') where id=(select nested_id from thread_state)$$,
  'the legacy flat API cannot expose blocked reply context');
select is_empty($$select * from public.get_comment_thread_context('40555555-5555-5555-5555-555555555555',(select nested_id from thread_state))$$,
  'exact context cannot bypass a blocked direct recipient');
select is_empty($$select * from public.comments where id=(select reply_id from thread_state)$$,'direct comment reads enforce block visibility');
select throws_ok($$select public.create_thread_comment('40555555-5555-5555-5555-555555555555','차단 답글',(select reply_id from thread_state))$$,
  'P0001','COMMENT_NOT_FOUND','blocked comment recipients cannot receive new replies');
reset role;
select is(private.create_notification('40222222-2222-2222-2222-222222222222','message','40333333-3333-3333-3333-333333333333',
  'user','40333333-3333-3333-3333-333333333333','차단 요청',null),null::uuid,'blocked actors are filtered at insertion as well as read time');
delete from public.blocks where blocker_id='40222222-2222-2222-2222-222222222222';
update public.comments set deleted_at=now() where id=(select root_id from thread_state);
select set_config('request.jwt.claims','{"sub":"40111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select is_empty($$select * from public.get_comment_thread_page('40555555-5555-5555-5555-555555555555',(select root_id from thread_state))$$,
  'deleted root context is not exposed by requesting its reply page directly');
select is_empty($$select * from public.get_comment_thread_context('40555555-5555-5555-5555-555555555555',(select nested_id from thread_state))$$,
  'exact context cannot bypass a deleted root');
reset role;
update public.comments set deleted_at=null where id=(select root_id from thread_state);

-- New posts notify only explicit opt-ins whose current saved city and interests match.
insert into public.notification_preferences(user_id,interests,nearby,interest_tag_ids,interest_hashtags) values
  ('40444444-4444-4444-4444-444444444444',true,true,array[1],array['hiking']);
select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select public.update_notification_preferences('{"interests":true,"nearby":true}');
reset role;
insert into public.posts(id,author_id,city_id,tag_id,title,body,hashtags,room_preview)
values ('40888888-8888-8888-8888-888888888888','40333333-3333-3333-3333-333333333333','vancouver',1,'관심 모임','관심 모임입니다.',array['HIKING'],'{"capacity":4}');
select results_eq($$select user_id,category from public.notifications where target_id='40888888-8888-8888-8888-888888888888'$$,
  $$values ('40222222-2222-2222-2222-222222222222'::uuid,'interests'::text)$$,
  'matching city and opt-in interests create one discovery alert, even when nearby also matches');
update public.posts set body='편집은 새 알림을 만들지 않습니다.' where id='40888888-8888-8888-8888-888888888888';
select is((select count(*)::integer from public.notifications where target_id='40888888-8888-8888-8888-888888888888'),1,
  'editing existing posts never replays discovery');
select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select public.update_notification_preferences('{"interests":false}');
reset role;
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview)
values ('40999999-9999-9999-9999-999999999999','40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','vancouver',1,'근처 모임','새 모임입니다.','{"capacity":4}');
select results_eq($$select user_id,category from public.notifications where target_id='40999999-9999-9999-9999-999999999999'$$,
  $$values ('40222222-2222-2222-2222-222222222222'::uuid,'nearby'::text)$$,'nearby-only opt-in receives real new meetups in the saved city');
update public.posts set status='removed' where id='40999999-9999-9999-9999-999999999999';
select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select is_empty($$select * from public.notifications where target_id='40999999-9999-9999-9999-999999999999'$$,
  'removed post discovery is no longer visible in the recipient inbox');
reset role;
update public.posts set status='published' where id='40999999-9999-9999-9999-999999999999';
update public.profiles set city_id='toronto' where id='40222222-2222-2222-2222-222222222222';
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview)
values ('40bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','40111111-1111-1111-1111-111111111111','vancouver',1,'도시 변경 후 모임','이전 도시입니다.','{"capacity":4}');
select is((select count(*)::integer from public.notifications where target_id='40bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),0,
  'discovery follows the current saved city instead of a copied preference');
insert into public.posts(id,author_id,city_id,tag_id,title,body)
values ('40cccccc-cccc-cccc-cccc-cccccccccccc','10000000-0000-0000-0000-000000000001','toronto',1,'예시 관심 글','시드 계정이 작성한 예시입니다.');
select is((select count(*)::integer from public.notifications where target_id='40cccccc-cccc-cccc-cccc-cccccccccccc'),0,
  'even newly inserted seed posts never notify interested real accounts');

update public.profiles set account_status='suspended' where id='40333333-3333-3333-3333-333333333333';
select is(private.create_notification('40333333-3333-3333-3333-333333333333','message','40111111-1111-1111-1111-111111111111',
  'user','40111111-1111-1111-1111-111111111111','비활성 요청',null),null::uuid,'inactive recipients do not receive activity');
select is(private.create_notification('40222222-2222-2222-2222-222222222222','message','40333333-3333-3333-3333-333333333333',
  'user','40333333-3333-3333-3333-333333333333','비활성 발신자',null),null::uuid,'inactive actors cannot generate activity');
select private.create_notification('40333333-3333-3333-3333-333333333333','moderation_blocked','40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'user','40333333-3333-3333-3333-333333333333','계정 제재 안내','/profile/settings');
select set_config('request.jwt.claims','{"sub":"40333333-3333-3333-3333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select results_eq($$select category from public.notifications where kind='moderation_blocked'$$,array['system'],
  'sanction notices remain visible to an inactive account despite disabled preferences');
select results_eq($$select category from public.user_notifications where kind='moderation_blocked'$$,array['system'],
  'the personal inbox retains required system notices for inactive accounts');
select throws_ok($$select private.can_receive_notification('40222222-2222-2222-2222-222222222222','nearby',null)$$,
  '42501',null,'internal recipient helper cannot probe another account preferences');
select throws_ok($$select private.notification_target_visible('40222222-2222-2222-2222-222222222222','comment',(select root_id from thread_state))$$,
  '42501',null,'internal target visibility helper is unavailable for cross-account probes');
select throws_ok($$select private.create_notification('40222222-2222-2222-2222-222222222222','message',null,'user','40222222-2222-2222-2222-222222222222','위조',null)$$,
  '42501',null,'clients cannot directly create notification deliveries');
reset role;
select private.create_notification('40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','message','40222222-2222-2222-2222-222222222222',
  'user','40222222-2222-2222-2222-222222222222','관리자 개인 대화 요청','/chat?view=requests');
select set_config('request.jwt.claims','{"sub":"40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select is((select count(*)::integer from public.comments where id=(select reply_id from thread_state)),1,
  'authorized admin access still includes inactive author content');
select is((select count(*)::integer from public.user_notifications where category='direct_requests'),1,
  'an admin personal inbox includes their own enabled activity');
select is_empty($$select * from public.user_notifications where user_id<>auth.uid()$$,
  'an admin personal inbox cannot include another account notifications');
select ok(exists(select 1 from public.notifications where user_id<>auth.uid()),
  'raw admin review still sees notifications for other accounts');
select public.update_notification_preferences('{"direct_requests":false}');
select is_empty($$select * from public.user_notifications where category='direct_requests'$$,
  'admin personal inbox honors category opt-out');
select is((select count(*)::integer from public.notifications where user_id=auth.uid() and category='direct_requests'),1,
  'admin review retains opted-out notification evidence');
select public.update_notification_preferences('{"direct_requests":true}');
insert into public.blocks(blocker_id,blocked_id) values ('40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','40222222-2222-2222-2222-222222222222');
select is_empty($$select * from public.user_notifications where category='direct_requests'$$,
  'admin personal inbox also hides a blocked actor');
select throws_ok($$update public.user_notifications set read_at=now()$$,'42501',null,
  'the personal notification view exposes reads only');
reset role;
delete from public.blocks where blocker_id='40aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.profiles set account_status='active' where id='40333333-3333-3333-3333-333333333333';
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select * from public.user_notifications$$,'42501',null,'guests cannot read personal notifications');
reset role;

-- Purging a root author must not cascade-delete another member's surviving reply or block deletion.
select set_config('request.jwt.claims','{"sub":"40222222-2222-2222-2222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::integer from public.user_notifications where category='comment_likes' and target_id=(select root_id from thread_state)),1,
  'a regular member can read their own visible activity through the same view');
select is_empty($$select * from public.user_notifications where user_id<>auth.uid()$$,
  'the personal view never includes another regular account notifications');
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'account deletion handles incoming reply foreign keys');
reset role;
select is((select count(*)::integer from public.notification_preferences where user_id='40222222-2222-2222-2222-222222222222'),0,
  'account data purge removes notification preferences before auth deletion');
select ok((select parent_id is null and reply_to_id is null from public.comments where id=(select reply_id from thread_state)),
  'other members replies survive purge with deleted parent identifiers removed');
select lives_ok($$delete from auth.users where id='40222222-2222-2222-2222-222222222222'$$,'new preferences and thread references do not prevent final auth deletion');
select * from finish();
rollback;
