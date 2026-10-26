begin;
select no_plan();
-- 1,2 active admins · 3 suspended admin · 4,5 operated personas · 6,7 real users · 8 seed account · 9 test account
insert into auth.users(id,email,raw_app_meta_data) select
 ('a1570000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n in (4,5,8) then 'contact-'||n||'@seed.gling.invalid' else 'admin-contact-'||n||'@example.test' end,
 case when n in (1,2,3) then '{"role":"admin"}'::jsonb when n=9 then '{"role":"test"}'::jsonb else '{}'::jsonb end
from generate_series(1,9) n;
insert into public.profiles(id,nickname,city_id,account_status) select id,'연락검사'||right(id::text,1),'vancouver',
 case when right(id::text,1)='3' then 'suspended' else 'active' end
from auth.users where id::text like 'a1570000-%';
update auth.users set raw_app_meta_data=jsonb_build_object('gling_persona',jsonb_build_object(
 'kind','gling_operated_character','version','4','profile_id',id::text,'city_id','vancouver',
 'living','fixture','background','fixture','values','fixture','personality','fixture',
 'interests','fixture','writing_purpose','fixture','voice','fixture','continuity','fixture'))
where id in ('a1570000-0000-0000-0000-000000000004','a1570000-0000-0000-0000-000000000005');
insert into auth.sessions(id,user_id,not_after) select
 ('a1570001-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1570000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()+interval '1 day' from generate_series(1,2) n;
insert into public.notification_preferences(user_id,push_enabled) select
 ('a1570000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,true from generate_series(1,2) n
on conflict(user_id) do update set push_enabled=true;
insert into private.push_devices(user_id,session_id,token) select
 ('a1570000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1570001-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'ExponentPushToken[admin-contact-'||n||']' from generate_series(1,2) n;
-- Posts: 1 by persona 4, 2 by real user 7, 3 a meetup by real user 6.
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview) values
 ('a1570002-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000004','vancouver',5,'캐릭터 글','본문',null),
 ('a1570002-0000-0000-0000-000000000002','a1570000-0000-0000-0000-000000000007','vancouver',5,'회원 글','본문',null),
 ('a1570002-0000-0000-0000-000000000003','a1570000-0000-0000-0000-000000000006','vancouver',5,'주말 산책 모임','모임 설명',
  jsonb_build_object('eventKind','once','startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 2 hours','capacity',8,'closed',false,'timezone','America/Vancouver'));
-- Direct rooms: real↔persona, persona↔persona, real↔real, seed↔persona, test↔persona, admin↔persona.
insert into public.conversations(id,user_low_id,user_high_id,requester_id,status,accepted_at) select
 ('a1570003-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1570000-0000-0000-0000-'||lpad(least(a,b)::text,12,'0'))::uuid,('a1570000-0000-0000-0000-'||lpad(greatest(a,b)::text,12,'0'))::uuid,
 ('a1570000-0000-0000-0000-'||lpad(a::text,12,'0'))::uuid,'active',now()
from (values(1,6,4),(2,5,4),(3,6,7),(4,8,4),(5,9,4),(6,1,4)) v(n,a,b);
insert into public.messages(id,conversation_id,sender_id,body) select
 ('a1570004-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('a1570003-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1570000-0000-0000-0000-'||lpad(a::text,12,'0'))::uuid,'안녕하세요 비밀번호는 알려주지 마세요'
from (values(1,6),(2,5),(3,6),(4,8),(5,9),(6,1)) v(n,a);

create temp view contact_alert as select * from public.notifications where kind='admin_persona_contact'
 and user_id in ('a1570000-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000002','a1570000-0000-0000-0000-000000000003');
select is((select count(*)::int from contact_alert where target_id='a1570004-0000-0000-0000-000000000001' and user_id<>'a1570000-0000-0000-0000-000000000003'),2,'real user DM to a persona reaches both active admins');
select is((select count(*)::int from contact_alert where user_id='a1570000-0000-0000-0000-000000000003'),0,'suspended admin is excluded');
select ok((select bool_and(category='system' and target_type='message' and actor_id is null and route='/admin?section=conversations'
 and body='연락검사6님이 운영 캐릭터 연락검사4님에게 1:1 메시지를 보냈어요.') from contact_alert where target_id='a1570004-0000-0000-0000-000000000001'),'DM alert names only the two nicknames and opens admin conversations');
select is((select count(*)::int from contact_alert where target_id in ('a1570004-0000-0000-0000-000000000002','a1570004-0000-0000-0000-000000000003',
 'a1570004-0000-0000-0000-000000000004','a1570004-0000-0000-0000-000000000005','a1570004-0000-0000-0000-000000000006')),0,'persona, real-to-real, seed, test and admin senders never alert');
select is((select count(*)::int from private.push_delivery_queue q join contact_alert n on n.id=q.notification_id where n.target_id='a1570004-0000-0000-0000-000000000001'),2,'both opted-in admin devices use the existing push queue');
select is((select count(*)::int from public.notifications where kind='message' and user_id='a1570000-0000-0000-0000-000000000004' and target_id='a1570004-0000-0000-0000-000000000001'),1,'the persona keeps its own message notification');

insert into public.messages(id,conversation_id,sender_id,body) values
 ('a1570004-0000-0000-0000-000000000011','a1570003-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000006','하나 더요'),
 ('a1570004-0000-0000-0000-000000000012','a1570003-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000004','캐릭터 답장');
select is((select count(*)::int from contact_alert where target_id in ('a1570004-0000-0000-0000-000000000011','a1570004-0000-0000-0000-000000000012')),0,'a busy room alerts once per 30 minutes and persona replies never alert');

-- Comments: on a persona post, a dedupe on the same post, a reply to a persona comment elsewhere, and non-persona threads.
insert into public.comments(id,post_id,author_id,body) values
 ('a1570005-0000-0000-0000-000000000001','a1570002-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000006','좋은 글이네요'),
 ('a1570005-0000-0000-0000-000000000002','a1570002-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000007','저도 궁금해요'),
 ('a1570005-0000-0000-0000-000000000003','a1570002-0000-0000-0000-000000000002','a1570000-0000-0000-0000-000000000005','캐릭터 댓글'),
 ('a1570005-0000-0000-0000-000000000005','a1570002-0000-0000-0000-000000000001','a1570000-0000-0000-0000-000000000004','캐릭터 본인 댓글'),
 ('a1570005-0000-0000-0000-000000000006','a1570002-0000-0000-0000-000000000002','a1570000-0000-0000-0000-000000000006','회원끼리 댓글');
insert into public.comments(id,post_id,author_id,body,parent_id,reply_to_id) values
 ('a1570005-0000-0000-0000-000000000004','a1570002-0000-0000-0000-000000000002','a1570000-0000-0000-0000-000000000006','답글이에요',
  'a1570005-0000-0000-0000-000000000003','a1570005-0000-0000-0000-000000000003');
select ok((select count(*)=2 and bool_and(body='연락검사6님이 운영 캐릭터 연락검사4님의 글에 댓글을 남겼어요.'
 and route='/post/a1570002-0000-0000-0000-000000000001?commentId=a1570005-0000-0000-0000-000000000001')
 from contact_alert where target_id='a1570005-0000-0000-0000-000000000001'),'comment on a persona post alerts and opens the comment');
select is((select count(*)::int from contact_alert where target_id='a1570005-0000-0000-0000-000000000002'),0,'another comment on the same post within 30 minutes is folded');
select ok((select count(*)=2 and bool_and(body='연락검사6님이 운영 캐릭터 연락검사5님의 댓글에 답글을 남겼어요.')
 from contact_alert where target_id='a1570005-0000-0000-0000-000000000004'),'reply to a persona comment on a member post alerts');
select is((select count(*)::int from contact_alert where target_id in ('a1570005-0000-0000-0000-000000000003','a1570005-0000-0000-0000-000000000005','a1570005-0000-0000-0000-000000000006')),0,'persona comments and member-only threads never alert');

-- Invitations from a real host to a persona.
insert into private.meetup_cohosts(post_id,user_id,status) values('a1570002-0000-0000-0000-000000000003','a1570000-0000-0000-0000-000000000004','pending');
insert into private.meetup_waitlist(post_id,user_id) values('a1570002-0000-0000-0000-000000000003','a1570000-0000-0000-0000-000000000005');
select is((select count(*)::int from contact_alert where target_id='a1570000-0000-0000-0000-000000000005'),0,'joining a waitlist is not an invitation');
update private.meetup_waitlist set invited_at=clock_timestamp() where user_id='a1570000-0000-0000-0000-000000000005';
select ok((select count(*)=2 and bool_and(target_type='user' and route='/post/a1570002-0000-0000-0000-000000000003'
 and body='연락검사6님이 운영 캐릭터 연락검사4님을 모임 「주말 산책 모임」 공동 호스트로 초대했어요.')
 from contact_alert where target_id='a1570000-0000-0000-0000-000000000004'),'co-host invitation alerts');
select ok((select count(*)=2 and bool_and(body='연락검사6님이 운영 캐릭터 연락검사5님에게 모임 「주말 산책 모임」 참여를 제안했어요.')
 from contact_alert where target_id='a1570000-0000-0000-0000-000000000005'),'waitlist offer alerts');

-- Read and push revalidate the source and the admin role.
create temp view checked_contact as select n.id,n.target_id,d.id device from contact_alert n
 join private.push_devices d on d.user_id=n.user_id where n.user_id='a1570000-0000-0000-0000-000000000001';
select ok((select bool_and(private.push_notification_eligible(device,id)) from checked_contact),'current admin can receive every queued alert');
select set_config('request.jwt.claims','{"sub":"a1570000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='admin_persona_contact'),5,'admin inbox reads DM, comment, reply and both invitation alerts');
select throws_ok($$select private.admin_persona_contact_visible('a1570000-0000-0000-0000-000000000001','message','a1570004-0000-0000-0000-000000000001',now())$$,'42501',null,'members cannot probe private source eligibility');
reset role;
select set_config('request.jwt.claims','{}',true);

savepoint revoke_checks;
update auth.users set raw_app_meta_data='{}' where id='a1570000-0000-0000-0000-000000000001';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_contact),'demotion suppresses queued alerts');
select set_config('request.jwt.claims','{"sub":"a1570000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.notifications where kind='admin_persona_contact' and user_id=auth.uid()),0,'raw notification RLS hides alerts from a demoted admin');
reset role;
select set_config('request.jwt.claims','{}',true);
rollback to revoke_checks;
update public.messages set hidden_at=now() where id='a1570004-0000-0000-0000-000000000001';
select ok((select not private.push_notification_eligible(device,id) from checked_contact where target_id='a1570004-0000-0000-0000-000000000001'),'hidden message is not delivered');
rollback to revoke_checks;
insert into public.blocks(blocker_id,blocked_id) values('a1570000-0000-0000-0000-000000000004','a1570000-0000-0000-0000-000000000006');
select ok((select not private.push_notification_eligible(device,id) from checked_contact where target_id='a1570004-0000-0000-0000-000000000001'),'a block suppresses the queued alert');
rollback to revoke_checks;
update public.comments set deleted_at=now() where id='a1570005-0000-0000-0000-000000000001';
select ok((select not private.push_notification_eligible(device,id) from checked_contact where target_id='a1570005-0000-0000-0000-000000000001'),'deleted comment is not delivered');
rollback to revoke_checks;
update auth.users set raw_app_meta_data='{}' where id='a1570000-0000-0000-0000-000000000004';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_contact where target_id<>'a1570000-0000-0000-0000-000000000005' and target_id<>'a1570005-0000-0000-0000-000000000004'),'removing operated status suppresses that persona''s alerts');
rollback to revoke_checks;
update private.meetup_cohosts set status='revoked' where user_id='a1570000-0000-0000-0000-000000000004';
select ok((select not private.push_notification_eligible(device,id) from checked_contact where target_id='a1570000-0000-0000-0000-000000000004'),'revoked invitation is not delivered');
rollback to revoke_checks;
update public.notification_preferences set push_enabled=false where user_id='a1570000-0000-0000-0000-000000000001';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_contact),'admin push opt-out remains effective');
rollback to revoke_checks;
select ok(not has_function_privilege('authenticated','private.notify_admin_persona_contact()','execute'),'members cannot call the sender');
select * from finish();
rollback;
