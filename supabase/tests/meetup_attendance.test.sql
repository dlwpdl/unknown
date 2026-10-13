begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data)
select ('9f000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'attendance-'||n||'@example.invalid',
 case when n=5 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,5)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select id,'참석검증'||right(id::text,1),'vancouver',now(),now(),now() from auth.users where id::text like '9f000000%';
insert into auth.sessions(id,user_id,aal) values('9f900000-0000-0000-0000-000000000005','9f000000-0000-0000-0000-000000000005','aal2');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('9f100000-0000-0000-0000-000000000001','9f000000-0000-0000-0000-000000000001','vancouver',1,'매주 산책','산책하는 모임',current_date,'{"eventKind":"group","cadence":"매주","capacity":8}');
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select '9f100000-0000-0000-0000-000000000001','9f000000-0000-0000-0000-000000000001',id,'approved'
from public.profiles where id in('9f000000-0000-0000-0000-000000000002','9f000000-0000-0000-0000-000000000003');
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_meetup_session('9f100000-0000-0000-0000-000000000001',now()-interval '1 hour',now()+interval '1 hour') as session_id \gset
select is(jsonb_array_length(public.get_meetup_sessions('9f100000-0000-0000-0000-000000000001')->'sessions'),1,'host can see the created session');
select lives_ok(format('select public.check_in_meetup(%L)',:'session_id'),'host can check in');
select throws_ok(format('select public.confirm_meetup_attendance(%L,%L)',:'session_id','9f000000-0000-0000-0000-000000000001'),'P0001','INVALID_ATTENDEE','self confirmation is denied');
select throws_ok($$select * from private.meetup_attendance$$,'42501',null,'clients have no direct attendance access');
reset role;
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_meetup_session('9f100000-0000-0000-0000-000000000001',now(),now()+interval '3 hours')$$,'P0001','HOST_REQUIRED','participant cannot fabricate a recurring session');
select lives_ok(format('select public.check_in_meetup(%L)',:'session_id'),'approved participant checks in');
reset role;
select is((select confirmed_at from private.meetup_attendance where session_id=:'session_id' and user_id='9f000000-0000-0000-0000-000000000002'),null::timestamptz,'join and own check-in alone are not verified presence');
update private.meetup_sessions set ends_at=now()-interval '1 minute' where id=:'session_id';
set local role authenticated;
select lives_ok(format('select public.confirm_meetup_attendance(%L,%L)',:'session_id','9f000000-0000-0000-0000-000000000001'),'participant can confirm host after meeting');
reset role;
select is((select confirmed_at from private.meetup_attendance where session_id=:'session_id' and user_id='9f000000-0000-0000-0000-000000000001'),null::timestamptz,'one-sided confirmation is not enough');
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok(format('select public.confirm_meetup_attendance(%L,%L)',:'session_id','9f000000-0000-0000-0000-000000000002'),'reciprocal confirmation completes presence');
reset role;
select is((select count(*)::integer from private.meetup_attendance where session_id=:'session_id' and confirmed_at is not null),2,'both reciprocal participants are verified');
update public.meetup_requests set status='cancelled' where post_id='9f100000-0000-0000-0000-000000000001' and requester_id='9f000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_meetup_sessions('9f100000-0000-0000-0000-000000000001')->'sessions'),1,'leaving cannot erase verified participation');
reset role;
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.claim_meetup_attendance(:'session_id','현장에서 함께 산책했습니다. 참석 확인에 이의가 있어 검토를 요청해요.') as claim_id \gset
select is(public.get_meetup_sessions('9f100000-0000-0000-0000-000000000001')->'sessions'->0->>'claimStatus','pending','unverified attendee has an independent claim path');
reset role;
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.check_in_meetup(%L)',:'session_id'),'P0001','SESSION_NOT_FOUND','unrelated account cannot check in');
select throws_ok(format('select public.claim_meetup_attendance(%L,%L)',:'session_id','현장에 있었다고 거짓으로 주장해요'),'P0001','SESSION_NOT_FOUND','outsider cannot use the claim path');
select throws_ok(format('select public.confirm_meetup_attendance(%L,%L)',:'session_id','9f000000-0000-0000-0000-000000000001'),'P0001','SESSION_NOT_FOUND','outsider cannot act as witness');
reset role;
set local role anon;
select throws_ok($$select public.get_meetup_sessions('9f100000-0000-0000-0000-000000000001')$$,'42501',null,'private roster is not public');
reset role;
select set_config('request.jwt.claims','{"sub":"9f000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_meetup_session('9f100000-0000-0000-0000-000000000001',now()+interval '1 day','infinity')$$,'P0001','INVALID_SESSION_TIME','infinite sessions cannot manufacture attendance windows');
reset role;
-- Local fixture represents a current group that has been cancelled after registration.
update private.meetup_sessions set ends_at=now()+interval '1 hour' where id=:'session_id';
update public.posts set room_preview=room_preview||'{"closed":true}' where id='9f100000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok(format('select public.check_in_meetup(%L)',:'session_id'),'P0001','CHECK_IN_UNAVAILABLE','cancelled meetings cannot receive new check-ins');
reset role;

select * from finish();
rollback;
