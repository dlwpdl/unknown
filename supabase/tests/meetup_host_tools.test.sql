begin;
select no_plan();

insert into public.cities(id,name,province,timezone) values('host-tools-test','Host tools','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label) values(31999,'host-tools-test','Host tools') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data)
select ('a1610000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'host-tools-'||n||'@example.invalid','{}'
from generate_series(1,8)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select id,'hosttools'||right(id::text,2),'host-tools-test',now(),now(),now() from auth.users where id::text like 'a1610000%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"함께 걸어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}' from public.profiles where id::text like 'a1610000%';
insert into private.membership_accounts(user_id,entitlements,observed_at)
select ('a1610000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  jsonb_build_array(jsonb_build_object('tier',case n when 1 then 'pro' when 2 then 'plus' else 'premium' end,
    'kind','general','plan_version','2','expires_at',now()+interval '30 days')),now()
from generate_series(1,3)n;
select is((private.membership_details('a1610000-0000-0000-0000-000000000006')->>'meetupLimit')::int,3,'Free retains three hosted-or-approved-joined slots');
select is((private.membership_details('a1610000-0000-0000-0000-000000000002')->>'meetupLimit')::int,5,'Plus retains five hosted-or-approved-joined slots');
select is((private.membership_details('a1610000-0000-0000-0000-000000000001')->>'meetupLimit')::int,10,'Pro retains ten hosted-or-approved-joined slots');
select is((private.membership_details('a1610000-0000-0000-0000-000000000003')->>'meetupLimit')::int,20,'Premium retains twenty hosted-or-approved-joined slots');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000001','host-tools-test',31999,'함께 산책','합성 로컬 테스트 모임',current_date,
  '{"eventKind":"group","capacity":3,"cadence":"매주"}');
insert into public.meetup_requests(post_id,host_id,requester_id,status)
values('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000002','approved');

select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'tier','pro','host tools use general Pro entitlement');
select throws_ok($$select * from private.meetup_templates$$,'42501',null,'private templates have no client table access');
select throws_ok($$select * from private.meetup_cohosts$$,'42501',null,'cohost grants have no client table access');
select throws_ok($$select * from private.meetup_waitlist$$,'42501',null,'queue identities have no client table access');
select throws_ok($$select private.purge_meetup_tool_account_data('a1610000-0000-0000-0000-000000000002')$$,'42501',null,'clients cannot purge another account through the private helper');
select public.save_meetup_template('산책 초안','{"title":"산책","body":"함께 걸어요","applicationQuestion":"좋아하는 길은요?"}') as template_id \gset
select is(jsonb_array_length(public.get_meetup_templates()->'templates'),1,'owner can save and read a Plus template');
select throws_ok($$select public.save_meetup_template('위조 장소','{"title":"산책","venue":"예약됨"}')$$,'P0001','INVALID_TEMPLATE','templates cannot store venue or booking facts');
select throws_ok($$select public.save_meetup_template('날짜','{"startsAt":"2030-01-01"}')$$,'P0001','INVALID_TEMPLATE','templates cannot store dates');
select throws_ok($$select public.save_meetup_template('잘못된 값','[]')$$,'P0001','INVALID_TEMPLATE','templates reject non-object values');
select throws_ok($$select public.save_meetup_template('빈 값','{}')$$,'P0001','INVALID_TEMPLATE','empty templates are rejected');
select throws_ok($$select public.save_meetup_template('잘못된 질문','{"applicationQuestion":42}')$$,'P0001','INVALID_TEMPLATE','template questions must be text');
select lives_ok($$select public.save_meetup_template('운동 초안',jsonb_build_object('title',repeat('가',60),'body',repeat('나',5000),'category','sports'))$$,'sports template accepts the actual form bounds');
select lives_ok($$select public.save_meetup_template('축제 초안','{"title":"축제 모임","category":"festival"}')$$,'festival templates use the same categories as the form');
select lives_ok($$select public.save_meetup_template('파티 초안','{"title":"파티 모임","category":"party"}')$$,'party templates use the same categories as the form');
select throws_ok($$select public.save_meetup_template('긴 제목',jsonb_build_object('title',repeat('가',61)))$$,'P0001','INVALID_TEMPLATE','template titles cannot overfill the form');
select throws_ok($$select public.save_meetup_template('긴 본문',jsonb_build_object('body',repeat('가',5001)))$$,'P0001','INVALID_TEMPLATE','template bodies reject over 5000 characters');
select throws_ok($$select public.save_meetup_template('알 수 없는 분류','{"title":"모임","category":"unknown"}')$$,'P0001','INVALID_TEMPLATE','unknown categories are rejected');
reset role;
delete from private.meetup_templates where owner_id='a1610000-0000-0000-0000-000000000001' and id<>:'template_id';
set local role authenticated;
select public.propose_meetup_dates('a1620000-0000-0000-0000-000000000001','2030-10-27T18:00:00Z','2030-10-27T19:00:00Z','weekly',3,'America/Vancouver') as proposals \gset
select is(jsonb_array_length(:'proposals'::jsonb),3,'weekly dates are proposed explicitly');
select is(((:'proposals'::jsonb->1->>'startsAt')::timestamptz at time zone 'America/Vancouver')::time,'11:00'::time,'weekly proposals preserve local wall-clock time across DST');
select is(extract(epoch from ((:'proposals'::jsonb->1->>'startsAt')::timestamptz-(:'proposals'::jsonb->0->>'startsAt')::timestamptz))::int,608400,'DST fallback is 169 actual hours, not a fabricated UTC week');
select throws_ok($$select public.propose_meetup_dates('a1620000-0000-0000-0000-000000000001',now()+interval '1 day',now()+interval '2 days','daily',4)$$,'P0001','INVALID_RECURRENCE','daily scheduling was not authorized');
select throws_ok($$select public.propose_meetup_dates('a1620000-0000-0000-0000-000000000001',now()+interval '1 day','infinity','weekly',4)$$,'P0001','INVALID_SESSION_TIME','non-finite windows are rejected');
reset role;
select is((select count(*)::int from private.meetup_sessions where post_id='a1620000-0000-0000-0000-000000000001'),0,'proposing dates creates no session or parent');
set local role authenticated;
select public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '2 days',now()+interval '2 days 1 hour') as session_id \gset
select is(public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '2 days',now()+interval '2 days 1 hour'),:'session_id'::uuid,'an ambiguous successful creation can be retried idempotently');
select throws_ok($$select public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '2 days',now()+interval '2 days 2 hours')$$,'P0001','SESSION_OVERLAP','idempotent retry cannot silently change its end');
select throws_ok($$select public.invite_meetup_cohost('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000003')$$,'P0001','APPROVED_MEMBER_REQUIRED','strangers cannot be nominated as cohosts');
select lives_ok($$select public.invite_meetup_cohost('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000002')$$,'host can invite an approved member');

select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is(jsonb_array_length(public.get_meetup_templates()->'templates'),0,'other paid accounts cannot read owner templates');
select lives_ok(format('select public.delete_meetup_template(%L)',:'template_id'),'other accounts cannot delete an owner template');
select throws_ok($$select public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '9 days',now()+interval '9 days 1 hour')$$,'P0001','HOST_REQUIRED','pending cohost invitation grants no operations');
select lives_ok($$select public.respond_meetup_cohost('a1620000-0000-0000-0000-000000000001',true)$$,'approved member explicitly accepts role');
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'isCohost','true','accepted role is visible only in scoped context');
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'canManageSessions','true','host Pro entitlement enables approved accepted cohost operations');
select public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '9 days',now()+interval '9 days 1 hour') as cohost_session_id \gset
select is(public.invite_next_meetup_waitlist('a1620000-0000-0000-0000-000000000001'),false,'an acting cohost may invite from the waitlist (nobody is queued yet)');
select throws_ok($$select public.invite_meetup_cohost('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000003')$$,'P0001','HOST_REQUIRED','cohosts cannot expand account privileges');
select throws_ok($$select public.get_meetup_host_aggregates('a1620000-0000-0000-0000-000000000001')$$,'P0001','HOST_REQUIRED','paid cohosts cannot read owner aggregates');
reset role;
select is((select host_id from private.meetup_sessions where id=:'cohost_session_id'),'a1610000-0000-0000-0000-000000000001'::uuid,'cohost session retains the same parent and original host');
insert into public.meetup_requests(id,post_id,host_id,requester_id,status) values('a1630000-0000-0000-0000-000000000004','a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000004','pending');
insert into private.chilling_applications(id,author_id,profile,answer,question,consent_version)
values('a1630000-0000-0000-0000-000000000004','a1610000-0000-0000-0000-000000000004','{}','비공개 답변','질문','chilling-v1');
set local role authenticated;
select is(public.get_chilling_application('a1630000-0000-0000-0000-000000000004'),null::jsonb,'accepted cohost never receives private application answers');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select lives_ok($$select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',true)$$,'applicant explicitly opts into waiting');
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->'waitlist'->>'position','1','applicant sees own position');
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->'waitlistCount','null'::jsonb,'applicant cannot read total queue or identity lists');
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->'cohosts','[]'::jsonb,'outsiders cannot enumerate cohosts');
select lives_ok($$select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',true)$$,'repeated opt-in preserves queue place');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000005","role":"authenticated"}',true);
select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',true);
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->'waitlist'->>'position','2','waitlist is ordered by join time');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',false);
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->'waitlist','null'::jsonb,'cancellation removes own queue entry');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is(public.invite_next_meetup_waitlist('a1620000-0000-0000-0000-000000000001'),true,'host explicitly invites next eligible waiter');
reset role;
select is((select count(*)::int from public.meetup_requests where post_id='a1620000-0000-0000-0000-000000000001' and status='approved'),1,'waitlist invite never auto-approves or reserves a seat');
select is((select count(*)::int from public.notifications where user_id='a1610000-0000-0000-0000-000000000005' and route='/post/a1620000-0000-0000-0000-000000000001'),1,'invitation uses existing post deep link');
select ok((select invited_at is not null from private.meetup_waitlist where post_id='a1620000-0000-0000-0000-000000000001' and user_id='a1610000-0000-0000-0000-000000000005'),'cancellation skips original first waiter');
select is((select invited_at from private.meetup_waitlist where post_id='a1620000-0000-0000-0000-000000000001' and user_id='a1610000-0000-0000-0000-000000000004'),null::timestamptz,'cancelled waiter receives no invitation');
set local role authenticated;
select is(public.invite_next_meetup_waitlist('a1620000-0000-0000-0000-000000000001'),false,'repeated invitation cannot resend or invent a waiter');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000006","role":"authenticated"}',true);
select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',true);
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->'waitlist'->>'position','1','already invited waiters do not inflate remaining queue position');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.get_meetup_host_aggregates('a1620000-0000-0000-0000-000000000001')$$,'P0001','PREMIUM_REQUIRED','Pro cannot read new Premium metrics');
reset role;

-- Existing attendance and groups survive expiry; only new paid actions stop.
update private.membership_accounts set entitlements='[]' where user_id='a1610000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.get_meetup_templates()->>'canUse','false','expiry disables new template application');
select is(jsonb_array_length(public.get_meetup_templates()->'templates'),1,'expiry preserves saved template history');
select throws_ok($$select public.save_meetup_template('새 초안','{"title":"산책"}')$$,'P0001','PLUS_REQUIRED','expiry stops new paid saves');
select throws_ok($$select public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '16 days',now()+interval '16 days 1 hour')$$,'P0001','PRO_REQUIRED','expiry stops new recurrence creation');
select is(jsonb_array_length(public.get_meetup_sessions('a1620000-0000-0000-0000-000000000001')->'sessions'),2,'expiry preserves existing sessions and attendance access');
select is(public.confirm_meetup_occurrence('a1620000-0000-0000-0000-000000000001',now()+interval '2 days',now()+interval '2 days 1 hour'),:'session_id'::uuid,'expiry still allows readback of a previously successful session');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'isCohost','false','owner expiry pauses cohost powers (the accepted record stays until renewal)');
reset role;
select is((select status from private.meetup_cohosts where post_id='a1620000-0000-0000-0000-000000000001' and user_id='a1610000-0000-0000-0000-000000000002'),'accepted','expiry keeps the accepted cohost record');
set local role authenticated;
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'canManageSessions','false','expiry prevents new paid cohost sessions');
select lives_ok($$select public.remove_meetup_cohost('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000002')$$,'cohost may relinquish access after owner expiry');
reset role;
update private.membership_accounts set entitlements=jsonb_build_array(jsonb_build_object('tier','premium','kind','business','plan_version','2','expires_at',now()+interval '30 days'))
where user_id='a1610000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'tier','free','business Premium is not a general host entitlement');
select throws_ok($$select public.save_meetup_template('사업 권한','{"title":"산책"}')$$,'P0001','PLUS_REQUIRED','business subscription cannot save general host templates');
reset role;
update private.membership_accounts set entitlements=jsonb_build_array(jsonb_build_object('tier','premium','kind','general','plan_version','2','expires_at',now()+interval '30 days'))
where user_id='a1610000-0000-0000-0000-000000000001';
update private.meetup_attendance set confirmed_at=now(),confirmation_source='peer' where session_id in(:'session_id',:'cohost_session_id') and user_id='a1610000-0000-0000-0000-000000000002';
set local role authenticated;
select is(public.get_meetup_host_aggregates('a1620000-0000-0000-0000-000000000001'),'{"applications":2,"approvals":1,"confirmedAttendance":2,"repeatParticipants":1}'::jsonb,'Premium reports only actual scoped request and verified attendance counts');
reset role;
update private.meetup_cohosts set status='accepted',accepted_at=now() where post_id='a1620000-0000-0000-0000-000000000001' and user_id='a1610000-0000-0000-0000-000000000002';
update public.meetup_requests set status='cancelled' where post_id='a1620000-0000-0000-0000-000000000001' and requester_id='a1610000-0000-0000-0000-000000000002';
update public.meetup_requests set status='approved',responded_at=now() where post_id='a1620000-0000-0000-0000-000000000001' and requester_id='a1610000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')->>'isCohost','false','rejoining does not restore an old cohost grant');
reset role;

-- Revocation guards preserve data but deny new reads/actions in unsafe contexts.
insert into public.blocks(blocker_id,blocked_id) values('a1610000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000004');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')$$,'P0001','MEETUP_NOT_FOUND','blocked account cannot inspect host context');
select lives_ok($$select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',false)$$,'blocked user can still cancel waitlist consent');
reset role;
delete from public.blocks where blocker_id='a1610000-0000-0000-0000-000000000001' and blocked_id='a1610000-0000-0000-0000-000000000004';
insert into public.reports(reporter_id,reported_user_id,target_type,target_id,reason_code,details)
values('a1610000-0000-0000-0000-000000000004','a1610000-0000-0000-0000-000000000001','post','a1620000-0000-0000-0000-000000000001','other','로컬 합성 신고 테스트');
set local role authenticated;
select throws_ok($$select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',true)$$,'P0001','MEETUP_NOT_FOUND','reported post cannot gain a new queue opt-in');
reset role;
update public.posts set room_preview=room_preview||'{"closed":true}' where id='a1620000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',true)$$,'P0001','MEETUP_CLOSED','closed meetup rejects new opt-ins');
select lives_ok($$select public.set_meetup_waitlist('a1620000-0000-0000-0000-000000000001',false)$$,'closed meetup still allows consent cancellation');
reset role;
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_aggregates('a1620000-0000-0000-0000-000000000001')->>'repeatParticipants','1','closing a group retains its real historical aggregate');
select throws_ok($$select public.invite_next_meetup_waitlist('a1620000-0000-0000-0000-000000000001')$$,'P0001','MEETUP_CLOSED','closed meetup cannot send new invitations');
reset role;

insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('a1620000-0000-0000-0000-000000000003','a1610000-0000-0000-0000-000000000002','host-tools-test',31999,'Plus 합성 모임','로컬 단계 검사',current_date,'{"eventKind":"group","capacity":3,"cadence":"매주"}');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_meetup_template('무료 초안','{"title":"산책"}')$$,'P0001','PLUS_REQUIRED','Free cannot save new paid templates');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.save_meetup_template('신청 질문','{"applicationQuestion":"처음 오시나요?"}')$$,'Plus can save a reusable question without inventing content or logistics');
select throws_ok($$select public.propose_meetup_dates('a1620000-0000-0000-0000-000000000003',now()+interval '1 day',now()+interval '1 day 1 hour','weekly',4)$$,'P0001','PRO_REQUIRED','Plus host cannot propose paid recurring dates');
reset role;
update private.membership_accounts set entitlements=jsonb_build_array(jsonb_build_object('tier','pro','kind','general','plan_version','2','expires_at',clock_timestamp()-interval '1 millisecond'))
where user_id='a1610000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_templates()->>'canUse','false','an actual expired Pro receipt grants no paid action');
select is(jsonb_array_length(public.get_meetup_templates()->'templates'),1,'receipt expiry keeps owner question history');
reset role;

update public.profiles set account_status='suspended' where id='a1610000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_meetup_templates()$$,'P0001',null,'inactive accounts cannot read templates');
reset role;
set local role anon;
select throws_ok($$select public.get_meetup_templates()$$,'42501',null,'anonymous template RPC access is denied');
select throws_ok($$select public.get_meetup_host_tools('a1620000-0000-0000-0000-000000000001')$$,'42501',null,'anonymous context access is denied');
reset role;
insert into private.meetup_templates(owner_id,name,draft)
values('a1610000-0000-0000-0000-000000000008','삭제할 비공개 초안','{"body":"탈퇴할 계정의 비공개 내용"}'),
 ('a1610000-0000-0000-0000-000000000007','유지할 초안','{"body":"별도 계정의 보존할 내용"}');
insert into private.meetup_waitlist(post_id,user_id)
values('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000008'),
 ('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000007');
insert into private.meetup_cohosts(post_id,user_id,status)
values('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000008','revoked'),
 ('a1620000-0000-0000-0000-000000000001','a1610000-0000-0000-0000-000000000007','revoked');
select set_config('request.jwt.claims','{"sub":"a1610000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'existing account erasure purges host metadata before Auth hard deletion');
reset role;
select is((select count(*)::int from private.meetup_templates where owner_id='a1610000-0000-0000-0000-000000000008'),0,'soft erasure deletes owner templates');
select is((select count(*)::int from private.meetup_waitlist where user_id='a1610000-0000-0000-0000-000000000008'),0,'soft erasure deletes own queue metadata');
select is((select count(*)::int from private.meetup_cohosts where user_id='a1610000-0000-0000-0000-000000000008'),0,'soft erasure deletes own cohost metadata');
select ok(exists(select 1 from auth.users where id='a1610000-0000-0000-0000-000000000008'),'metadata cleanup does not rely on the later Auth FK cascade');
select is((select count(*)::int from private.meetup_templates where owner_id='a1610000-0000-0000-0000-000000000007'),1,'other owners retain their templates');
-- Simulate retained metadata from an interrupted/older purge, then exercise the existing retry.
insert into private.meetup_templates(owner_id,name,draft) values('a1610000-0000-0000-0000-000000000008','재시도 잔여 초안','{"body":"남은 비공개 내용"}');
insert into private.meetup_waitlist(post_id,user_id) values('a1620000-0000-0000-0000-000000000003','a1610000-0000-0000-0000-000000000008');
set local role authenticated;
select lives_ok($$select public.delete_my_account('탈퇴합니다')$$,'existing deleted-account retry is idempotent');
reset role;
select is((select count(*)::int from private.meetup_templates where owner_id='a1610000-0000-0000-0000-000000000008'),0,'retry erases retained templates');
select is((select count(*)::int from private.meetup_waitlist where user_id='a1610000-0000-0000-0000-000000000008'),0,'retry erases retained queue metadata');
select * from finish();
rollback;
