begin;
select no_plan();
insert into auth.users(id,email) values
 ('72000000-0000-0000-0000-000000000001','age-host@example.test'),
 ('72000000-0000-0000-0000-000000000002','age-guest@example.test'),
 ('72000000-0000-0000-0000-000000000003','age-no-dob@example.test');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'연령검사'||right(id::text,1),'vancouver',now(),now(),now(),'test' from auth.users where id::text like '72000000-%';
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.save_chilling_profile('{"intro":"함께 산책해요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}');
select throws_ok($$select public.create_chilling_event('vancouver','연령 검사','함께 걸어요','{"eventKind":"group","cadence":"weekly","capacity":8,"recommendedAgeMin":40,"recommendedAgeMax":20}','질문')$$,'P0001','INVALID_RECOMMENDED_AGE','reversed range rejected atomically');
select is((select count(*)::int from public.posts where author_id=auth.uid()),0,'invalid recommendation leaves no partial event');
select set_config('test.age_post',public.create_chilling_event('vancouver','산책 모임','함께 걸어요','{"eventKind":"group","cadence":"weekly","capacity":8,"recommendedAgeMin":20,"recommendedAgeMax":39}','질문',array[]::text[])::text,true);
select is((select room_preview->>'recommendedAgeMin' from public.posts where id=current_setting('test.age_post')::uuid),'20','six-argument creation preserves minimum');
select is((select room_preview->>'recommendedAgeMax' from public.posts where id=current_setting('test.age_post')::uuid),'39','creation preserves maximum');
select public.configure_chilling_event(current_setting('test.age_post')::uuid,'group',p_cadence=>'monthly');
select is((select room_preview->>'recommendedAgeMin' from public.posts where id=current_setting('test.age_post')::uuid),'20','legacy configure retains recommendation');
select throws_ok($$select public.configure_chilling_event(current_setting('test.age_post')::uuid,'group',null,null,null,'changed',8,40,20)$$,'P0001','INVALID_RECOMMENDED_AGE','new configure rejects invalid range');
select is((select room_preview->>'cadence' from public.posts where id=current_setting('test.age_post')::uuid),'monthly','invalid configure also rolls back schedule');
select lives_ok($$select public.configure_chilling_event(current_setting('test.age_post')::uuid,'group',null,null,null,'monthly',8,null,null)$$,'owner can clear recommendation');
select is((select room_preview->'recommendedAgeMin' from public.posts where id=current_setting('test.age_post')::uuid),'null'::jsonb,'cleared recommendation is null');
select public.configure_chilling_event(current_setting('test.age_post')::uuid,'group',null,null,null,'monthly',8,20,39);
reset role;
select throws_ok(format('update public.posts set room_preview=room_preview||%L::jsonb where id=%L::uuid',invalid,current_setting('test.age_post')),'P0001','INVALID_RECOMMENDED_AGE','direct writes reject malformed age range: '||invalid)
from unnest(array['{"recommendedAgeMin":null}','{"recommendedAgeMin":"20"}','{"recommendedAgeMin":20.5}','{"recommendedAgeMin":-1}','{"recommendedAgeMax":121}','{"recommendedAgeMax":false}']) invalid;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select public.save_chilling_profile('{"intro":"걷고 싶어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}');
select public.save_my_personal_info('비공개 검사 이름','1970-01-01','2026-09-12',auth.uid());
select is(public.get_my_personal_info()->>'consent_version','2026-09-12','old client consent is not silently upgraded');
select public.save_my_personal_info('비공개 검사 이름','1970-01-01','2026-09-19',auth.uid());
select is(public.get_my_personal_info()->>'consent_version','2026-09-19','owner can explicitly consent to new purpose');
select is((select verification_level::int from public.profiles where id=auth.uid()),1,'self-reported date never upgrades trust');
select throws_ok($$select public.configure_chilling_event(current_setting('test.age_post')::uuid,'group',null,null,null,'weekly',8,1,120)$$,'P0001','MEETUP_NOT_FOUND','non-host cannot change recommendations');
select set_config('test.age_request',public.request_chilling_join(current_setting('test.age_post')::uuid,'신청합니다','chilling-v1')::text,true);
select ok(current_setting('test.age_request')::uuid is not null,'out-of-range applicant can apply');
select ok(public.get_chilling_application(current_setting('test.age_request')::uuid)::text not like '%1970-01-01%' and public.get_chilling_application(current_setting('test.age_request')::uuid)::text not like '%비공개 검사 이름%','application snapshot excludes private birthday and name');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select public.save_chilling_profile('{"intro":"반가워요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}');
select is(public.get_my_personal_info()->'date_of_birth','null'::jsonb,'other member cannot read applicant birthday');
select lives_ok($$select public.request_chilling_join(current_setting('test.age_post')::uuid,'신청합니다','chilling-v1')$$,'applicant without birth date can apply');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request(current_setting('test.age_request')::uuid,'approved')$$,'out-of-range applicant can be approved');
select ok((select room_preview::text not like '%1970-01-01%' and room_preview::text not like '%비공개 검사 이름%' from public.posts where id=current_setting('test.age_post')::uuid),'public event contains no private personal information');
reset role;
select ok(not has_function_privilege('anon','public.configure_chilling_event(uuid,text,timestamptz,timestamptz,text,text,integer,integer,integer)','execute'),'anonymous recommendation update forbidden');
select * from finish();
rollback;
