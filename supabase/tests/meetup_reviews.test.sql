begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data)
select ('9d000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'trust-'||n||'@example.invalid',
 case when n=9 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,9)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at)
select id,'후기검증'||right(id::text,1),'vancouver',now(),now(),now() from auth.users where id::text like '9d000000%';
update auth.users set created_at=now()-interval '14 days' where id::text like '9d000000%';
insert into auth.sessions(id,user_id,aal) values('9d900000-0000-0000-0000-000000000009','9d000000-0000-0000-0000-000000000009','aal2');
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
values('9d100000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','vancouver',1,'정기 산책','함께 산책',current_date,'{"eventKind":"group","cadence":"매주","capacity":10}'),
 ('9d100000-0000-0000-0000-000000000002','9d000000-0000-0000-0000-000000000001','vancouver',1,'한번 산책','함께 산책',current_date,jsonb_build_object('eventKind','once','capacity',10,'startsAt',now()+interval '1 hour','endsAt',now()+interval '2 hours','timezone','America/Vancouver'));
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at)
select ('9d200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('9d100000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '9d000000-0000-0000-0000-000000000001',now()-interval '2 hours',now()-interval '1 hour' from generate_series(1,2)n;
insert into private.meetup_attendance(session_id,user_id,checked_in_at,confirmed_at,confirmation_source)
select '9d200000-0000-0000-0000-000000000001',id,now()-interval '90 minutes',
 case when right(id::text,1)<>'3' then now()-interval '30 minutes' end,
 case when right(id::text,1)<>'3' then 'peer' end from public.profiles where id::text like '9d000000%' and right(id::text,1)<>'9';
insert into private.meetup_attendance(session_id,user_id,checked_in_at,confirmed_at,confirmation_source)
select '9d200000-0000-0000-0000-000000000002',id,now()-interval '90 minutes',now()-interval '30 minutes','peer'
 from public.profiles where id in('9d000000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.write_meetup_review('9d200000-0000-0000-0000-000000000001',9,'설명과 같았고 분위기도 편했어요.') as review_id \gset
select is(public.write_meetup_review('9d200000-0000-0000-0000-000000000001',9,'설명과 같았고 분위기도 편했어요.'),:'review_id'::uuid,'identical uncertain resubmission returns the existing review');
select throws_ok($$select public.write_meetup_review('9d200000-0000-0000-0000-000000000001',1,'이미 제출한 내용을 다른 평가로 바꿉니다.')$$,'P0001','REVIEW_ALREADY_SUBMITTED','cannot replace a submitted review');
select throws_ok($$select public.write_meetup_review('9d200000-0000-0000-0000-000000000002',9,'일회성')$$,'P0001','REGULAR_MEETUP_REQUIRED','one-off meetups never acquire group reviews');
select throws_ok($$select public.write_manner_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000002','{"punctual":true,"respectful":true,"boundaries":true}',null)$$,'P0001','INVALID_SUBJECT','self rating is denied');
select public.write_manner_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000001','{"punctual":true,"respectful":false,"boundaries":null}','합의한 대화 경계를 여러 번 무시했습니다.') as manner_id \gset
select throws_ok($$select * from private.trust_reviews$$,'42501',null,'no direct private review read');
select is(jsonb_array_length(public.get_my_manner_feedback()),0,'reviewer has no incoming feedback');
reset role;
select is((select status from private.trust_reviews where id=:'manner_id'),'needs_review','negative feedback always requires human review');
select is((select count(*)::integer from public.safety_review_queue where target_id in(:'review_id',:'manner_id')),2,'both public and private reviews enter the existing safety queue');
update public.safety_review_queue set status='processing' where target_id in(:'review_id',:'manner_id');
update public.safety_review_queue set status='reviewed',risk_level='low',risk_score=0.01,risk_reasons='[]' where target_id in(:'review_id',:'manner_id');
select is((select status from private.trust_reviews where id=:'manner_id'),'needs_review','low-risk AI result alone cannot penalize a person');
select is((select status from private.trust_reviews where id=:'review_id'),'published','low-risk positive group feedback can be released');
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.write_meetup_review('9d200000-0000-0000-0000-000000000001',9,null)$$,'P0001','CANNOT_REVIEW_OWN_MEETUP','host cannot rate own group');
select is(jsonb_array_length(public.get_my_manner_feedback()),0,'subject cannot see the rating during the blind window');
select throws_ok(format('select public.get_admin_trust_content(%L,%L)','manner_review',:'manner_id'),'P0001','ADMIN_REQUIRED','ordinary user cannot read personal review text');
reset role;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.write_meetup_review('9d200000-0000-0000-0000-000000000001',9,null)$$,'P0001','ATTENDANCE_REQUIRED','joining/check-in alone cannot grant reviews');
select throws_ok($$select public.write_manner_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000001','{"punctual":null,"respectful":true,"boundaries":true}',null)$$,'P0001','ATTENDANCE_REQUIRED','unverified physical presence cannot influence meeting reputation');
select public.claim_meetup_attendance('9d200000-0000-0000-0000-000000000001','함께 걸은 회차입니다. 참석을 독립적으로 검토해 주세요.') as claim_id \gset
reset role;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal1","session_id":"9d900000-0000-0000-0000-000000000009","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok(format('select public.get_admin_trust_content(%L,%L)','manner_review',:'manner_id'),'P0001','ADMIN_REQUIRED','admin needs a live elevated MFA session');
reset role;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000009","role":"authenticated","aal":"aal2","session_id":"9d900000-0000-0000-0000-000000000009","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.get_admin_trust_content('manner_review',:'manner_id')->>'updatedAt' as manner_version \gset
select public.get_admin_trust_content('meetup_attendance',:'claim_id')->>'updatedAt' as claim_version \gset
select lives_ok(format('select public.review_admin_trust_target(%L,%L,%L,%L,%L)','manner_review',:'manner_id','published','행동과 맥락을 확인했습니다.',:'manner_version'),'audited human review can accept legitimate negative feedback');
select throws_ok(format('select public.review_admin_trust_target(%L,%L,%L,%L,%L)','manner_review',:'manner_id','removed','이전 상태로 중복 조치합니다.',:'manner_version'),'P0001','STALE_REVIEW','stale moderation cannot overwrite a later decision');
select lives_ok(format('select public.review_admin_trust_target(%L,%L,%L,%L,%L)','meetup_attendance',:'claim_id','published','참석 증빙과 두 참가자의 진술을 확인했습니다.',:'claim_version'),'admin can independently resolve a suppressed attendance claim');
reset role;
select is((select confirmation_source from private.meetup_attendance where id=:'claim_id'),'admin','independent attendance is marked as human verified');
update auth.users set created_at=now() where id='9d000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.write_manner_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000001','{"punctual":true,"respectful":true,"boundaries":true}',null) as fresh_review \gset
reset role;
select is((select status from private.trust_reviews where id=:'fresh_review'),'needs_review','fresh unverified accounts cannot auto-boost reputation even with positive feedback');

-- The following timestamp change is only a local simulation of the blind-window expiry.
update private.trust_reviews set release_at=now()-interval '1 minute' where id=:'manner_id';
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_manner_feedback()),1,'subject can see structured feedback after release');
select ok(not (public.get_my_manner_feedback()->0 ? 'body') and not (public.get_my_manner_feedback()->0 ? 'authorId'),'incoming feedback never exposes accusation text or reviewer identity');
select lives_ok(format('select public.appeal_manner_review(%L,%L)',:'manner_id','사실관계와 맥락에 이의가 있어 재검토를 요청합니다.'),'subject has an appeal path');
reset role;
select is((select status from private.trust_reviews where id=:'manner_id'),'held','appealed feedback is excluded while awaiting review');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->>'score',null::text,'insufficient samples never become a low public score');
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(format('select public.create_report(%L,%L,%L,%L)','manner_review',:'manner_id','other','평가 원문·작성자 정보 누출 방지 검사'),'P0001','TARGET_NOT_FOUND','personal appeal cannot leak reviewer identity through reporter-readable evidence');
reset role;
insert into public.conversations(id,user_low_id,user_high_id,requester_id,status,accepted_at)
values('9d400000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000002','9d000000-0000-0000-0000-000000000002','active',now());
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_manner_review_state('9d000000-0000-0000-0000-000000000001',null,'9d400000-0000-0000-0000-000000000001')->>'eligible','false','starting a chat is not enough for reputation');
reset role;
insert into public.messages(conversation_id,sender_id,body,created_at)
select '9d400000-0000-0000-0000-000000000001',case when n%2=0 then '9d000000-0000-0000-0000-000000000001'::uuid else '9d000000-0000-0000-0000-000000000002'::uuid end,'검증용 서로 주고받은 대화 '||n,now()-(5-n)*interval '1 minute' from generate_series(1,4)n;
set local role authenticated;
select is(public.get_manner_review_state('9d000000-0000-0000-0000-000000000001',null,'9d400000-0000-0000-0000-000000000001')->>'eligible','true','two-way conversation grants only chat feedback');
select throws_ok($$select public.write_manner_review(null,'9d400000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','{"punctual":true,"respectful":true,"boundaries":true}',null)$$,'P0001','INVALID_REVIEW','chat cannot claim in-person punctuality');
select throws_ok($$select public.write_manner_review(null,'9d400000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','{"punctual":null,"respectful":true,"boundaries":true,"forged":true}',null)$$,'P0001','INVALID_REVIEW','forged signal fields are rejected');
reset role;
-- Advance the rate-limit fixture without relaxing production throttling.
delete from private.action_rate_events where user_id='9d000000-0000-0000-0000-000000000002' and action='manner_review';
set local role authenticated;
select lives_ok($$select public.write_manner_review(null,'9d400000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','{"punctual":null,"respectful":true,"boundaries":true}',null)$$,'real conversation can submit blind chat feedback');
reset role;
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.write_manner_review(null,'9d400000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001','{"punctual":null,"respectful":true,"boundaries":true}',null)$$,'P0001','ATTENDANCE_REQUIRED','unrelated account cannot fabricate chat reputation');
reset role;

-- Controlled, human-approved fixtures verify the aggregation independently of the UI.
insert into private.trust_reviews(kind,author_id,subject_id,session_id,signals,status,release_at)
select 'manner',id,'9d000000-0000-0000-0000-000000000001','9d200000-0000-0000-0000-000000000001',
 '{"punctual":true,"respectful":true,"boundaries":true}','published',now()-interval '1 minute'
 from public.profiles where id::text like '9d000000%' and right(id::text,1) in('4','5','6','7','8');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->>'score','100','five distinct cleared counterparts unlock a public score');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'chat'->>'score',null::text,'meeting feedback never fabricates a chat score');
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at) values('9d200000-0000-0000-0000-000000000003','9d100000-0000-0000-0000-000000000001','9d000000-0000-0000-0000-000000000001',now()-interval '2 days',now()-interval '47 hours');
insert into private.trust_reviews(kind,author_id,subject_id,session_id,signals,status,release_at,created_at)
values('manner','9d000000-0000-0000-0000-000000000004','9d000000-0000-0000-0000-000000000001','9d200000-0000-0000-0000-000000000003',
 '{"punctual":false,"respectful":false,"boundaries":false}','published',now()-interval '1 minute',now()+interval '1 second');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->>'participants','5','same counterpart in another session cannot inflate sample size');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->>'score','80','only the most recent counterpart feedback influences the score');
update private.meetup_sessions set starts_at=now()-interval '14 hours',ends_at=now()-interval '12 hours' where id='9d200000-0000-0000-0000-000000000001';
select is(private.send_meetup_review_requests(now()),8,'normal reminder producer sends one review request per checked-in attendee');
select is(private.send_meetup_review_requests(now()),0,'same reminder run cannot send a second copy');
select is((select count(*)::integer from public.notifications where kind='meetup_review_request' and target_id='9d200000-0000-0000-0000-000000000001'),8,'review requests use the existing recipient-bound notification path');
select ok(not private.notification_target_visible('9d000000-0000-0000-0000-000000000009','meetup_session','9d200000-0000-0000-0000-000000000001'),'review request does not make an unrelated account a participant');
set local role anon;
select throws_ok($$select public.get_my_manner_feedback()$$,'42501',null,'incoming personal feedback is not an anonymous API');
select throws_ok(format('select public.get_trust_safety_content(%L,%L)','manner_review',:'manner_id'),'42501',null,'AI content RPC is service-only');
reset role;
-- Ten-point ratings never manufacture scores from older behavior-only feedback.
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->'rating'->>'participants','0','legacy signals are not numeric reviews');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->'rating'->>'score',null::text,'legacy signal ratios are never relabeled as review ratings');
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.write_user_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000002','{"punctual":true,"respectful":true,"boundaries":true}',7.3,null)$$,'P0001','INVALID_REVIEW','ratings use half-point steps');
select throws_ok($$select public.write_user_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000002','{"punctual":true,"respectful":true,"boundaries":true}',5,null)$$,'P0001','REVIEW_REASON_REQUIRED','low rating needs a reason even with positive signals');
select public.write_user_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000002','{"punctual":true,"respectful":true,"boundaries":true}',4.5,'실제 만남에서 아쉬웠던 점을 구체적으로 남깁니다.') as numeric_review \gset
select is(public.write_user_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000002','{"punctual":true,"respectful":true,"boundaries":true}',4.5,'실제 만남에서 아쉬웠던 점을 구체적으로 남깁니다.'),:'numeric_review'::uuid,'same rating retry returns the saved review');
select throws_ok($$select public.write_user_review('9d200000-0000-0000-0000-000000000001',null,'9d000000-0000-0000-0000-000000000002','{"punctual":true,"respectful":true,"boundaries":true}',9,'실제 만남에서 아쉬웠던 점을 구체적으로 남깁니다.')$$,'P0001','REVIEW_ALREADY_SUBMITTED','rating cannot be changed on a retry');
reset role;
select is((select score from private.trust_reviews where id=:'numeric_review'),4.5::numeric,'explicit rating is saved');
select is((select status from private.trust_reviews where id=:'numeric_review'),'needs_review','low rating requires human moderation');
select is((select content_hash from public.safety_review_queue where target_id=:'numeric_review'),encode(extensions.digest(convert_to(private.trust_safety_content('manner_review',:'numeric_review')->>'text','UTF8'),'sha256'),'hex'),'safety queue includes the actual numeric rating');
update private.trust_reviews set status='published',release_at=now()-interval '1 minute' where id=:'numeric_review';
select set_config('request.jwt.claims','{"sub":"9d000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_my_manner_feedback()->0->>'score','4.5','subject sees the released numeric rating');
select ok(not (public.get_my_manner_feedback()->0 ? 'body') and not (public.get_my_manner_feedback()->0 ? 'authorId'),'numeric feedback keeps personal text and identity private');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
update private.trust_reviews set score=8.5 where kind='manner' and subject_id='9d000000-0000-0000-0000-000000000001' and status='published';
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->'rating'->>'score','8.5','five reviewed counterparts produce a ten-point average');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->'rating'->>'participants','5','repeated counterpart remains one numeric review');
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'chat'->'rating'->>'score',null::text,'meeting ratings remain separate from chat');
update private.trust_reviews set score=10 where kind='manner' and author_id='9d000000-0000-0000-0000-000000000004' and session_id='9d200000-0000-0000-0000-000000000003';
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->'rating'->>'score','8.8','numeric average uses only latest review per counterpart');
update private.trust_reviews set status='held' where kind='manner' and author_id='9d000000-0000-0000-0000-000000000005';
select is(public.get_manner_summary('9d000000-0000-0000-0000-000000000001')->'meeting'->'rating'->>'score',null::text,'holding a review hides an insufficient sample');
set local role anon;
select throws_ok($$select public.write_user_review(null,null,null,null,8,null)$$,'42501',null,'anonymous clients cannot submit ratings');
reset role;
select * from finish();
rollback;
