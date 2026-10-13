begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data)
select ('a0130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'trust-delete-'||n||'@example.invalid',
 case when n in(5,7) then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,9)n;
insert into public.profiles(id,nickname,city_id,ai_safety_consent_at)
select id,'삭제확인'||right(id::text,1),'vancouver',now() from auth.users where id::text like 'a0130000-%';
insert into public.posts(id,author_id,city_id,tag_id,title,body,room_preview)
values('a0131000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000001','vancouver',1,'삭제 대상 모임','모임 본문','{"eventKind":"group","cadence":"매주","capacity":10}'),
 ('a0131000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000008','vancouver',1,'유지할 모임','타인의 모임 본문','{"eventKind":"group","cadence":"매주","capacity":10}');
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at)
values('a0132000-0000-4000-8000-000000000001','a0131000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000001',now()-interval '2 hours',now()-interval '1 hour'),
 ('a0132000-0000-4000-8000-000000000002','a0131000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000008',now()-interval '2 hours',now()-interval '1 hour');
insert into private.meetup_attendance(id,session_id,user_id)
select ('a0133000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a0132000-0000-4000-8000-000000000001',
 ('a0130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from unnest(array[1,2,3,4,6,9])n;
insert into private.meetup_attendance(session_id,user_id)
values('a0132000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000008'),
 ('a0132000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000006');
insert into private.meetup_attendance_confirmations(session_id,witness_id,attendee_id)
values('a0132000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000006'),
 ('a0132000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000006','a0130000-0000-4000-8000-000000000002');
update private.meetup_attendance set claim_body='참석자의 비공개 확인 설명입니다.',claim_status='pending' where id='a0133000-0000-4000-8000-000000000002';
insert into private.meetup_review_deliveries(session_id,user_id)
values('a0132000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000002');
insert into private.trust_reviews(id,kind,author_id,session_id,score,body,status,release_at)
values('a0134000-0000-4000-8000-000000000001','meetup','a0130000-0000-4000-8000-000000000003','a0132000-0000-4000-8000-000000000001',8,'삭제될 작성자의 후기 본문','published',now()),
 ('a0134000-0000-4000-8000-000000000003','meetup','a0130000-0000-4000-8000-000000000006','a0132000-0000-4000-8000-000000000001',9,'관리자가 탈퇴해도 참가자의 후기는 남습니다.','published',now()),
 ('a0134000-0000-4000-8000-000000000005','meetup','a0130000-0000-4000-8000-000000000009','a0132000-0000-4000-8000-000000000001',8,'이전 탈퇴 시 남은 후기','published',now()),
 ('a0134000-0000-4000-8000-000000000004','meetup','a0130000-0000-4000-8000-000000000006','a0132000-0000-4000-8000-000000000002',7,'관련 없는 모임의 후기를 유지합니다.','published',now());
insert into private.trust_reviews(id,kind,author_id,subject_id,session_id,signals,body,status,release_at)
values('a0134000-0000-4000-8000-000000000002','manner','a0130000-0000-4000-8000-000000000006','a0130000-0000-4000-8000-000000000004',
 'a0132000-0000-4000-8000-000000000001','{"punctual":true,"respectful":true,"boundaries":true}','삭제될 대상자의 비공개 평가','published',now());
insert into private.trust_review_decisions(target_type,target_id,admin_id,decision,note,previous)
select case when r.kind='manner' then 'manner_review' else 'meetup_review' end,r.id,
 case when right(r.id::text,1)='3' then 'a0130000-0000-4000-8000-000000000005'::uuid else 'a0130000-0000-4000-8000-000000000007'::uuid end,
 'published','사람이 원문과 맥락을 검토했습니다.',private.trust_safety_content(case when r.kind='manner' then 'manner_review' else 'meetup_review' end,r.id)
from private.trust_reviews r where id::text like 'a0134000-%';
insert into private.trust_review_decisions(target_type,target_id,admin_id,decision,note,previous)
values('meetup_attendance','a0133000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000007','published','참석 확인 설명을 검토했습니다.',
 private.trust_safety_content('meetup_attendance','a0133000-0000-4000-8000-000000000002'));
insert into public.reports(id,reporter_id,reported_user_id,target_type,target_id,reason_code)
values('a0135000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000005','a0130000-0000-4000-8000-000000000006',
 'manner_review','a0134000-0000-4000-8000-000000000002','other');
insert into public.moderation_actions(report_id,actor_id,action)
values('a0135000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000007','warned');
insert into public.safety_alerts(target_type,target_id,author_id,category,severity,matched_terms,excerpt)
values('manner_review','a0134000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000006','harassment','medium',array['test'],'삭제될 대상자의 비공개 증거');
insert into public.admin_access_logs(actor_id,scope,subject_user_id,resource_id)
values('a0130000-0000-4000-8000-000000000007','safety','a0130000-0000-4000-8000-000000000006','a0134000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,aal) values('a0139000-0000-4000-8000-000000000007','a0130000-0000-4000-8000-000000000007','aal2');
select set_config('request.jwt.claims','{"sub":"a0130000-0000-4000-8000-000000000007","role":"authenticated","aal":"aal2","session_id":"a0139000-0000-4000-8000-000000000007","app_metadata":{"role":"admin"}}',true);
select private.is_admin_id('a0130000-0000-4000-8000-000000000007');
insert into public.notifications(user_id,kind,target_type,target_id,body,route)
values('a0130000-0000-4000-8000-000000000007','safety_alert','manner_review','a0134000-0000-4000-8000-000000000002','대상 평가의 검토 알림','/admin?section=safety');
select is((select count(*)::integer from public.notifications where target_id='a0134000-0000-4000-8000-000000000002' and user_id='a0130000-0000-4000-8000-000000000007' and body='대상 평가의 검토 알림'),1,'trust target notification exists before erasure');
create function pg_temp.finish_trust_delete(p_user uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
 perform public.delete_my_account('탈퇴합니다');
 delete from auth.users where id=p_user;
end;
$$;
-- The old flow could freeze a profile, then fail its final auth deletion on these FKs.
update public.profiles set account_status='deleted' where id='a0130000-0000-4000-8000-000000000009';
select lives_ok($$select pg_temp.finish_trust_delete('a0130000-0000-4000-8000-000000000009')$$,'already-deleted account can retry and finish final auth deletion');
select is((select count(*)::integer from public.profiles where id='a0130000-0000-4000-8000-000000000009'),0,'retry clears the frozen profile');
select is((select count(*)::integer from private.trust_reviews where author_id='a0130000-0000-4000-8000-000000000009'),0,'retry clears the old review FK');
select is((select count(*)::integer from public.safety_review_queue where target_id='a0134000-0000-4000-8000-000000000005'),0,'retry clears old review safety payloads');
select lives_ok($$select pg_temp.finish_trust_delete('a0130000-0000-4000-8000-000000000002')$$,'non-host attendee completes purge and final auth deletion');
select is((select count(*)::integer from private.meetup_attendance where user_id='a0130000-0000-4000-8000-000000000002'),0,'departing attendee rows are removed');
select is((select count(*)::integer from private.meetup_attendance_confirmations),0,'both witness and attendee confirmations cascade');
select is((select count(*)::integer from private.meetup_review_deliveries where user_id='a0130000-0000-4000-8000-000000000002'),0,'feedback reminder ledger is cleared');
select is((select count(*)::integer from public.safety_review_queue where target_id='a0133000-0000-4000-8000-000000000002'),0,'attendance safety evidence is removed');
select is((select count(*)::integer from private.trust_review_decisions where target_id='a0133000-0000-4000-8000-000000000002'),0,'attendance decision snapshot follows deletion policy');
select lives_ok($$select pg_temp.finish_trust_delete('a0130000-0000-4000-8000-000000000003')$$,'review author completes purge and final auth deletion');
select is((select count(*)::integer from private.trust_reviews where author_id='a0130000-0000-4000-8000-000000000003'),0,'departing author review is removed');
select is((select count(*)::integer from private.trust_review_decisions where target_id='a0134000-0000-4000-8000-000000000001'),0,'author review snapshot is removed');
select lives_ok($$select pg_temp.finish_trust_delete('a0130000-0000-4000-8000-000000000004')$$,'personal-review subject completes purge and final auth deletion');
select is((select count(*)::integer from private.trust_reviews where subject_id='a0130000-0000-4000-8000-000000000004'),0,'departing subject feedback is removed');
select is((select count(*)::integer from public.reports where id='a0135000-0000-4000-8000-000000000001'),0,'report by unrelated author is still removed when its trust target is erased');
select is((select count(*)::integer from public.moderation_actions where report_id='a0135000-0000-4000-8000-000000000001'),0,'trust target moderation evidence is removed');
select is((select count(*)::integer from public.safety_alerts where target_id='a0134000-0000-4000-8000-000000000002'),0,'trust target alert excerpt is removed');
select is((select count(*)::integer from public.admin_access_logs where resource_id='a0134000-0000-4000-8000-000000000002'),0,'trust target access evidence is removed');
select is((select count(*)::integer from public.notifications where target_id='a0134000-0000-4000-8000-000000000002'),0,'trust target notifications are removed from other administrators inboxes');
select lives_ok($$select pg_temp.finish_trust_delete('a0130000-0000-4000-8000-000000000005')$$,'trust-review administrator completes purge and final auth deletion');
select is((select count(*)::integer from private.trust_review_decisions where admin_id='a0130000-0000-4000-8000-000000000005'),0,'departing admin decisions follow existing actor-record deletion policy');
select is((select body from private.trust_reviews where id='a0134000-0000-4000-8000-000000000003'),'관리자가 탈퇴해도 참가자의 후기는 남습니다.','admin account deletion preserves the reviewed participant content');
select lives_ok($$select pg_temp.finish_trust_delete('a0130000-0000-4000-8000-000000000001')$$,'meetup host completes purge and final auth deletion');
select is((select count(*)::integer from private.meetup_sessions where host_id='a0130000-0000-4000-8000-000000000001'),0,'departing host sessions are removed');
select is((select count(*)::integer from private.trust_reviews where session_id='a0132000-0000-4000-8000-000000000001'),0,'host-session reviews follow owned-post deletion');
select is((select count(*)::integer from public.safety_review_queue where target_id in('a0134000-0000-4000-8000-000000000001','a0134000-0000-4000-8000-000000000002','a0134000-0000-4000-8000-000000000003')),0,'removed trust targets leave no safety queue payloads');
select is((select body from private.trust_reviews where id='a0134000-0000-4000-8000-000000000004'),'관련 없는 모임의 후기를 유지합니다.','unrelated participant review remains unchanged');
select is((select count(*)::integer from private.trust_review_decisions where target_id='a0134000-0000-4000-8000-000000000004'),1,'unrelated audit decision remains attributable');
select is((select count(*)::integer from public.profiles where id in('a0130000-0000-4000-8000-000000000001','a0130000-0000-4000-8000-000000000002','a0130000-0000-4000-8000-000000000003','a0130000-0000-4000-8000-000000000004','a0130000-0000-4000-8000-000000000005')),0,'all five deleted auth accounts leave no profile FK blockers');
select set_config('request.jwt.claims','{"sub":"a0130000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.delete_my_account('다른 확인')$$,'P0001','CONFIRMATION_REQUIRED','erasure retains the explicit confirmation boundary');
select throws_ok($$select private.purge_trust_account_data('a0130000-0000-4000-8000-000000000008')$$,'42501',null,'client cannot invoke another account trust erasure');
reset role;
set local role anon;
select throws_ok($$select private.purge_trust_account_data('a0130000-0000-4000-8000-000000000008')$$,'42501',null,'anonymous cannot invoke trust erasure');
reset role;
set local role service_role;
select throws_ok($$select private.purge_trust_account_data('a0130000-0000-4000-8000-000000000008')$$,'42501',null,'service API cannot invoke the new private erasure helper directly');
reset role;
select * from finish();
rollback;
