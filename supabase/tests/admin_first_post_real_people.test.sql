begin;
select no_plan();
-- 1,2 active admins · 3 new real member · 4 real member 10 days in · 5 operated character · 6 official editor
-- 7 test account · 8 analytics-internal · 9 anonymous · 10 same-day real member · 11 real member with a removed post
-- 12 invited real member · 13,14 real members who joined 40 and 50 days ago
insert into auth.users(id,email,raw_app_meta_data,is_anonymous) select
 ('f1f50000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case n when 5 then 'first-post-5@seed.gling.invalid' when 6 then 'editor-check@official.gling.invalid' else 'first-post-'||n||'@example.test' end,
 case when n in (1,2) then '{"role":"admin"}'::jsonb when n=7 then '{"role":"test"}'::jsonb
  when n=8 then '{"analytics_internal":true}'::jsonb when n=5 then '{"gling_persona":{"kind":"gling_operated_character"}}'::jsonb else '{}'::jsonb end,
 n=9
from generate_series(1,14) n;
insert into public.profiles(id,nickname,city_id,account_status,created_at) select id,'첫글검사'||right(id::text,2),'vancouver','active',
 now()-case right(id::text,2) when '04' then interval '10 days' when '03' then interval '2 days' when '11' then interval '5 days'
  when '12' then interval '20 days' when '13' then interval '40 days' when '14' then interval '50 days' when '10' then interval '0' else interval '60 days' end
from auth.users where id::text like 'f1f50000-%';
update private.analytics_config set started_at=now()-interval '200 days';
insert into auth.sessions(id,user_id,not_after,aal) select
 ('f1f50001-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('f1f50000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()+interval '1 day','aal2'
from generate_series(1,2) n;
insert into public.notification_preferences(user_id,push_enabled) select
 ('f1f50000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,true from generate_series(1,2) n
on conflict(user_id) do update set push_enabled=true;
insert into private.push_devices(user_id,session_id,token) select
 ('f1f50000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('f1f50001-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'ExponentPushToken[first-post-'||n||']' from generate_series(1,2) n;

select ok(private.is_real_member('f1f50000-0000-0000-0000-000000000003') and private.is_real_member('f1f50000-0000-0000-0000-000000000004'),'ordinary members are real members');
select ok(not private.is_real_member(id),'not a real member: '||right(id::text,2)) from auth.users
 where id in ('f1f50000-0000-0000-0000-000000000001','f1f50000-0000-0000-0000-000000000005','f1f50000-0000-0000-0000-000000000006',
  'f1f50000-0000-0000-0000-000000000007','f1f50000-0000-0000-0000-000000000008','f1f50000-0000-0000-0000-000000000009');

-- A new real member's first post alerts both admins at once, with no title or text.
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at) values
 ('f1f50002-0000-0000-0000-000000000003','f1f50000-0000-0000-0000-000000000003','vancouver',1,'비밀제목','비밀본문 내용',now()-interval '26 hours');
select is((select count(*)::int from public.notifications where kind='admin_first_post' and target_id='f1f50002-0000-0000-0000-000000000003'
 and user_id in ('f1f50000-0000-0000-0000-000000000001','f1f50000-0000-0000-0000-000000000002')),2,'both admins get the first post');
select ok((select bool_and(body ~ '^첫글검사03님이 (가입한 날|가입하고 (하루|[0-9]+일) 만에) 밴쿠버에서 첫 글을 올렸어요\.$'
 and body not like '%비밀%' and body not like '%@%' and body not like '%f1f5%') from public.notifications where kind='admin_first_post'),'body: nickname, days since signup and city only');
select is((select min(route) from public.notifications where kind='admin_first_post'),'/post/f1f50002-0000-0000-0000-000000000003','tapping opens the post');
select is((select min(category) from public.notifications where kind='admin_first_post'),'system','system notification handling applies');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id
 where n.kind='admin_first_post' and q.next_attempt_at<=now()),2,'pushed at once, not held for the twice-daily digest');
select is((select count(*)::int from public.claim_push_notifications('send',100) c where c.kind='admin_first_post' and c.post_title is null and c.post_preview is null),2,
 'the push carries no post title or preview');

-- Later posts, old members, meetups and non-real accounts stay quiet.
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('f1f50002-0000-0000-0000-000000000033','f1f50000-0000-0000-0000-000000000003','vancouver',1,'두 번째','본문'),
 ('f1f50002-0000-0000-0000-000000000004','f1f50000-0000-0000-0000-000000000004','vancouver',1,'열흘째 첫 글','본문');
update public.posts set created_at=now()-interval '3 days' where id='f1f50002-0000-0000-0000-000000000004';
insert into public.posts(id,author_id,city_id,tag_id,title,body) select
 ('f1f50002-0000-0000-0000-0000000000'||lpad(n::text,2,'0'))::uuid,('f1f50000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'vancouver',1,'계정 글','본문'
from generate_series(5,9) n;
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview) values
 ('f1f50002-0000-0000-0000-000000000100','f1f50000-0000-0000-0000-000000000010','vancouver',5,'주말 모임','모임 설명',
  jsonb_build_object('eventKind','once','startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 2 hours','capacity',8,'closed',false,'timezone','America/Vancouver'));
insert into public.posts(id,author_id,city_id,tag_id,title,body,status,created_at) values
 ('f1f50002-0000-0000-0000-000000000110','f1f50000-0000-0000-0000-000000000011','vancouver',1,'지운 글','본문','removed',now()-interval '2 days');
insert into public.posts(id,author_id,city_id,tag_id,title,body,created_at) values
 ('f1f50002-0000-0000-0000-000000000111','f1f50000-0000-0000-0000-000000000011','vancouver',1,'다시 쓴 글','본문',now()-interval '30 hours');
select is((select count(*)::int from public.notifications where kind='admin_first_post'),2,'second posts, members past day 7, meetups, removed-then-new and non-real accounts do not alert');

-- The meetup does not use up the first post; the same-day post reads as "the day they joined".
insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('f1f50002-0000-0000-0000-000000000101','f1f50000-0000-0000-0000-000000000010','toronto',1,'오늘 가입','본문');
select is((select body from public.notifications where kind='admin_first_post' and target_id='f1f50002-0000-0000-0000-000000000101' and user_id='f1f50000-0000-0000-0000-000000000001'),
 '첫글검사10님이 가입한 날 토론토에서 첫 글을 올렸어요.','first non-meetup post on signup day');

-- Replies: the author's own and an operated character's do not count; an admin's and a member's do.
insert into public.comments(post_id,author_id,body,created_at) values
 ('f1f50002-0000-0000-0000-000000000003','f1f50000-0000-0000-0000-000000000005','캐릭터 댓글',now()-interval '26 hours'+interval '5 minutes'),
 ('f1f50002-0000-0000-0000-000000000003','f1f50000-0000-0000-0000-000000000003','본인 댓글',now()-interval '26 hours'+interval '10 minutes'),
 ('f1f50002-0000-0000-0000-000000000003','f1f50000-0000-0000-0000-000000000012','회원 답',now()-interval '26 hours'+interval '90 minutes'),
 ('f1f50002-0000-0000-0000-000000000004','f1f50000-0000-0000-0000-000000000001','운영팀 답',now()-interval '3 days'+interval '20 minutes');
insert into private.analytics_visits(user_id,platform,bucket,first_at,last_at,screen,app_version) values
 ('f1f50000-0000-0000-0000-000000000003','ios',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day','home','1'),
 ('f1f50000-0000-0000-0000-000000000003','ios',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days','home','1'),
 ('f1f50000-0000-0000-0000-000000000004','web',now()-interval '3 days',now()-interval '3 days',now()-interval '3 days','home','1'),
 ('f1f50000-0000-0000-0000-000000000005','ios',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day','home','1'),
 ('f1f50000-0000-0000-0000-000000000013','ios',now()-interval '17 days',now()-interval '17 days',now()-interval '17 days','home','1'),
 ('f1f50000-0000-0000-0000-000000000014','ios',now()-interval '40 days',now()-interval '40 days',now()-interval '40 days','home','1');
insert into private.analytics_visits(user_id,platform,bucket,first_at,last_at,screen,app_version) select
 'f1f50000-0000-0000-0000-000000000012','android',now()-n*interval '1 day',now()-n*interval '1 day',now()-n*interval '1 day','home','1'
from generate_series(1,5) n;
insert into private.invite_links(id,code,owner_id) values ('f1f50003-0000-0000-0000-000000000001','FPQRSTUV','f1f50000-0000-0000-0000-000000000004');
insert into private.invite_redemptions(invitee_id,link_id,inviter_id) values
 ('f1f50000-0000-0000-0000-000000000012','f1f50003-0000-0000-0000-000000000001','f1f50000-0000-0000-0000-000000000004');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f1f50000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.get_admin_real_people()$$,'P0001','ADMIN_REQUIRED','members cannot read the numbers');
select throws_ok($$select private.is_real_member('f1f50000-0000-0000-0000-000000000003')$$,'42501',null,'members cannot call the private check');
select throws_ok($$select private.notify_admin_first_post()$$,'42501',null,'members cannot call the private trigger');
select is((select count(*)::int from public.user_notifications where kind='admin_first_post'),0,'members cannot read admin first-post alerts');
select set_config('request.jwt.claims','{"sub":"f1f50000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.get_admin_real_people()$$,'P0001','ADMIN_REQUIRED','an admin without the second factor cannot read the numbers');
select is((select count(*)::int from public.user_notifications where kind='admin_first_post'),2,'admin inbox holds their own first-post alerts');
select set_config('request.jwt.claims','{"sub":"f1f50000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2","session_id":"f1f50001-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
select set_config('first_post_check.result',public.get_admin_real_people()::text,true);
reset role;

select is((select (r->>'members')::int from (select current_setting('first_post_check.result')::jsonb r) x),7,'real members: operated characters, editor, staff, test, internal and anonymous accounts left out');
select is((select r->'visitDays' from (select current_setting('first_post_check.result')::jsonb r) x),'{"none":3,"one":2,"twoToThree":1,"fourToSeven":1,"eightToFourteen":0,"fifteenPlus":0}'::jsonb,'Vancouver days visited in the last 30 days');
select is((select r->'weekFour' from (select current_setting('first_post_check.result')::jsonb r) x),'{"eligible":2,"returned":1}'::jsonb,'came back in days 22-28 among signups 4 to 12 weeks old');
select is((select r->'signups' from (select current_setting('first_post_check.result')::jsonb r) x),'{"total":5,"onTheirOwn":4}'::jsonb,'last-30-day signups without a reward invite');
select is((select jsonb_array_length(r->'replyWeeks') from (select current_setting('first_post_check.result')::jsonb r) x),8,'eight Vancouver weeks, empty ones included');
select is((select jsonb_build_object('posts',sum((w->>'posts')::int),'replied',sum((w->>'replied')::int),'due',sum((w->>'due')::int),'unanswered',sum((w->>'unanswered')::int))
 from (select current_setting('first_post_check.result')::jsonb r) x,jsonb_array_elements(r->'replyWeeks') w),'{"posts":5,"replied":2,"due":3,"unanswered":1}'::jsonb,
 'real members'' posts: first reply by someone else, a day-old post with no reply in 24 hours');
select ok((select bool_and((w->>'medianMinutes') in ('20','55','90')) from (select current_setting('first_post_check.result')::jsonb r) x,jsonb_array_elements(r->'replyWeeks') w where w->>'medianMinutes' is not null),
 'median minutes ignore the author''s own and operated-character comments');
select ok((select r::text !~ '(@|첫글검사|f1f5|비밀)' from (select current_setting('first_post_check.result')::jsonb r) x),'numbers only: no names, emails, ids or text');
select ok(exists(select 1 from public.admin_access_logs where actor_id='f1f50000-0000-0000-0000-000000000001' and scope='analytics'),'each read is logged');

-- A failed alert never blocks the member's post.
alter table public.notifications add constraint first_post_check_block check (kind<>'admin_first_post') not valid;
insert into auth.users(id,email) values ('f1f50000-0000-0000-0000-000000000015','first-post-15@example.test');
insert into public.profiles(id,nickname,city_id) values ('f1f50000-0000-0000-0000-000000000015','첫글검사15','vancouver');
select lives_ok($$insert into public.posts(id,author_id,city_id,tag_id,title,body) values
 ('f1f50002-0000-0000-0000-000000000150','f1f50000-0000-0000-0000-000000000015','vancouver',1,'막혀도','본문')$$,'a failed alert does not block the post');
select is((select count(*)::int from public.notifications where target_id='f1f50002-0000-0000-0000-000000000150'),0,'and leaves no half-made alert');
alter table public.notifications drop constraint first_post_check_block;

-- Leaving Gling also clears the admins' alert that carried the nickname (no new table to clean up).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f1f50000-0000-0000-0000-000000000010","role":"authenticated"}',true);
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'the member can leave');
reset role;
select is((select count(*)::int from public.notifications where kind='admin_first_post' and target_id='f1f50002-0000-0000-0000-000000000101'),0,'account deletion removes the first-post alert');
select * from finish();
rollback;
