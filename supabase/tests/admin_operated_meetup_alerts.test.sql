begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) select
 ('a1560000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n=4 then 'operated@seed.gling.invalid' else 'admin-meetup-'||n||'@example.test' end,
 case when n in (1,2,3) then '{"role":"admin"}'::jsonb else '{}'::jsonb end
from generate_series(1,8) n;
insert into public.profiles(id,nickname,city_id,account_status) select id,'모임알림검사-'||right(id::text,1),'vancouver',
 case when right(id::text,1)='3' then 'suspended' else 'active' end
from auth.users where id::text like 'a1560000-%';
update auth.users set raw_app_meta_data=jsonb_build_object('gling_persona',jsonb_build_object(
 'kind','gling_operated_character','version','4','profile_id',id::text,'city_id','vancouver',
 'living','fixture','background','fixture','values','fixture','personality','fixture',
 'interests','fixture','writing_purpose','fixture','voice','fixture','continuity','fixture'))
where id='a1560000-0000-0000-0000-000000000004';
insert into auth.sessions(id,user_id,not_after) select
 ('a1560001-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1560000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now()+interval '1 day' from generate_series(1,2) n;
insert into public.notification_preferences(user_id,push_enabled) select
 ('a1560000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,true from generate_series(1,2) n
on conflict(user_id) do update set push_enabled=true;
insert into private.push_devices(user_id,session_id,token) select
 ('a1560000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1560001-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'ExponentPushToken[admin-meetup-'||n||']' from generate_series(1,2) n;
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview) select
 ('a1560002-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1560000-0000-0000-0000-'||lpad(case n when 1 then '4' when 2 then '1' else '5' end,12,'0'))::uuid,
 'vancouver',5,'신청 알림 검사 '||n,'모임 설명',jsonb_build_object('eventKind','once','startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 2 hours','capacity',8,'closed',false,'timezone','America/Vancouver')
from generate_series(1,3) n;
insert into public.meetup_requests(id,post_id,host_id,requester_id) select
 ('a1560003-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1560002-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('a1560000-0000-0000-0000-'||lpad(case n when 1 then '4' when 2 then '1' else '5' end,12,'0'))::uuid,
 'a1560000-0000-0000-0000-000000000006' from generate_series(1,3) n;
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000001' and user_id in ('a1560000-0000-0000-0000-000000000001','a1560000-0000-0000-0000-000000000002')),2,'AI-operated host application reaches both active admins');
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000003'),0,'ordinary real-user hosts are excluded');
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and user_id='a1560000-0000-0000-0000-000000000003'),0,'suspended admin is excluded');
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000002' and user_id='a1560000-0000-0000-0000-000000000001'),0,'admin host keeps the original host alert without a duplicate admin copy');
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000002' and user_id='a1560000-0000-0000-0000-000000000002'),1,'another admin is informed about an owner-created meetup');
select ok((select bool_and(category='system' and route='/admin?section=posts' and body like '%신청 알림 검사%' and body not like '%a156000%' and body not like '%@%') from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000001'),'existing admin destination and minimal human-readable body');
select is((select count(*)::int from private.push_delivery_queue q join public.notifications n on n.id=q.notification_id where n.kind='admin_meetup_request' and n.target_id='a1560003-0000-0000-0000-000000000001' and n.user_id in ('a1560000-0000-0000-0000-000000000001','a1560000-0000-0000-0000-000000000002')),0,'operated meetup requests reach admins through the twice-daily digest push, not one push each');
update public.meetup_requests set message='수정한 신청' where id='a1560003-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000001' and user_id='a1560000-0000-0000-0000-000000000001'),1,'pending edits do not repeat an application alert');

-- Existing host alerts remain on the original RPC path; its request validation is not replaced.
select set_config('request.jwt.claims','{"sub":"a1560000-0000-0000-0000-000000000007","role":"authenticated"}',true);
select public.save_chilling_profile('{"intro":"안녕하세요","interests":["산책"],"promptOne":"바다","promptTwo":"주말"}');
select public.request_chilling_join('a1560002-0000-0000-0000-000000000002','참여하고 싶어요','chilling-v1');
select is((select count(*)::int from public.notifications where kind='meetup_request' and actor_id='a1560000-0000-0000-0000-000000000007' and user_id='a1560000-0000-0000-0000-000000000001'),1,'owner still receives the original host notification');
select set_config('request.jwt.claims','{}',true);

-- Revalidate queued content instead of leaking a withdrawn request or a demoted admin.
create temp view checked_alert as select n.id,n.user_id,n.target_id,n.created_at,d.id device from public.notifications n
 join private.push_devices d on d.user_id=n.user_id where n.kind='admin_meetup_request'
 and n.target_id='a1560003-0000-0000-0000-000000000001' and n.user_id='a1560000-0000-0000-0000-000000000001';
select ok((select private.push_notification_eligible(device,id) from checked_alert),'current active admin can receive queued application');
select set_config('request.jwt.claims','{"sub":"a1560000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000001'),1,'admin app inbox reads the intended application alert');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.users set raw_app_meta_data='{}' where id='a1560000-0000-0000-0000-000000000001';
select ok(not (select private.push_notification_eligible(device,id) from checked_alert),'demotion suppresses queued push');
select set_config('request.jwt.claims','{"sub":"a1560000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.user_notifications where kind='admin_meetup_request'),0,'demoted admin cannot read old admin application alerts');
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and user_id=auth.uid()),0,'raw notification RLS also hides revoked admin alerts');
reset role;
select set_config('request.jwt.claims','{}',true);
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='a1560000-0000-0000-0000-000000000001';
update public.meetup_requests set status='cancelled' where id='a1560003-0000-0000-0000-000000000001';
select ok(not (select private.push_notification_eligible(device,id) from checked_alert),'withdrawn application is not delivered');
update public.meetup_requests set status='pending',created_at=clock_timestamp() where id='a1560003-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notifications where kind='admin_meetup_request' and target_id='a1560003-0000-0000-0000-000000000001' and user_id='a1560000-0000-0000-0000-000000000001'),2,'a genuine reapplication has a new alert');
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert where created_at<(select max(created_at) from checked_alert)),'previous application revision remains suppressed');

select ok((select bool_or(private.push_notification_eligible(device,id)) from checked_alert),'reapplied source is eligible before further revocation checks');
savepoint source_identity;
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{gling_persona,profile_id}','"other-account"') where id='a1560000-0000-0000-0000-000000000004';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'spoofed persona profile binding is excluded');
rollback to source_identity;
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{gling_persona,voice}','{}') where id='a1560000-0000-0000-0000-000000000004';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'incomplete operated persona is excluded');
rollback to source_identity;
update auth.users set raw_app_meta_data='{}' where id='a1560000-0000-0000-0000-000000000004';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'removing operated status suppresses already queued content');
rollback to source_identity;
update auth.users set email='noisy@seed.gling.invalid' where id='a1560000-0000-0000-0000-000000000006';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'seed requester is excluded');
rollback to source_identity;
update auth.users set raw_app_meta_data='{"role":"test"}' where id='a1560000-0000-0000-0000-000000000006';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'test requester is excluded');
rollback to source_identity;
update auth.users set raw_app_meta_data='{"role":"admin"}' where id='a1560000-0000-0000-0000-000000000006';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'admin requester is excluded');
rollback to source_identity;
update auth.users set raw_app_meta_data='{"gling_persona":{"kind":"gling_operated_character"}}' where id='a1560000-0000-0000-0000-000000000006';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'operated requester is excluded');
rollback to source_identity;
insert into public.blocks(blocker_id,blocked_id) values('a1560000-0000-0000-0000-000000000006','a1560000-0000-0000-0000-000000000004');
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'new block suppresses a queued application');
rollback to source_identity;
update public.posts set deleted_at=now() where id='a1560002-0000-0000-0000-000000000001';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'soft-deleted source is excluded');
rollback to source_identity;
select set_config('request.jwt.claims','{"sub":"a1560000-0000-0000-0000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select private.admin_meetup_alert_visible('a1560000-0000-0000-0000-000000000001','a1560003-0000-0000-0000-000000000001',now())$$,'42501',null,'member cannot probe private source eligibility');
select is(private.can_read_admin_meetup_alert('a1560000-0000-0000-0000-000000000001','a1560003-0000-0000-0000-000000000001',now()),false,'RLS predicate is bound to the caller');
reset role;
select set_config('request.jwt.claims','{}',true);

savepoint source_closed;
update public.posts set room_preview=room_preview||'{"closed":true}' where id='a1560002-0000-0000-0000-000000000001';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'closed meetup suppresses queued notifications');
rollback to source_closed;
update public.notification_preferences set push_enabled=false where user_id='a1560000-0000-0000-0000-000000000001';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'admin push opt-out remains effective');
update public.notification_preferences set push_enabled=true where user_id='a1560000-0000-0000-0000-000000000001';
update auth.sessions set not_after=now()-interval '1 minute' where user_id='a1560000-0000-0000-0000-000000000001';
select ok((select bool_and(not private.push_notification_eligible(device,id)) from checked_alert),'expired admin session does not receive push');
select ok(not has_function_privilege('authenticated','private.notify_admin_meetup_request()','execute'),'members cannot call the sender');
select * from finish();
rollback;
