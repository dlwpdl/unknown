begin;
set local search_path=public,extensions;
select no_plan();

-- 1 host; 2..7 applicants (2 fresh, 3 two days, 4 eight days, 5 on a removed meetup, 6 approved, 7 re-applies).
insert into public.cities(id,name,province,timezone) values('exp-test','Expiry test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31995,'exp-test','Expiry test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select ('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'exp-'||n||'@example.invalid','{}' from generate_series(1,7)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'Exp'||right(id::text,2),'exp-test',now(),now(),now(),'test',now()-interval '200 days' from auth.users where id::text like 'e0000000-%';
create temporary table ids as select
  'e0000000-0000-4000-8000-000000000001'::uuid h, 'e0000000-0000-4000-8000-000000000002'::uuid fresh, 'e0000000-0000-4000-8000-000000000003'::uuid two,
  'e0000000-0000-4000-8000-000000000004'::uuid eight, 'e0000000-0000-4000-8000-000000000005'::uuid gone, 'e0000000-0000-4000-8000-000000000006'::uuid member,
  'e0000000-0000-4000-8000-000000000007'::uuid again,
  'e0100000-0000-4000-8000-000000000001'::uuid open_post, 'e0100000-0000-4000-8000-000000000002'::uuid dead_post;
alter table public.posts disable trigger posts_meetup_abuse;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select open_post,h,'exp-test',31995,'Seawall walk','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '5 days','endsAt',now()+interval '5 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1) from ids
union all select dead_post,h,'exp-test',31995,'Old walk','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '6 days','endsAt',now()+interval '6 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1) from ids;
alter table public.posts enable trigger posts_meetup_abuse;
insert into public.meetup_requests(post_id,host_id,requester_id,status,created_at)
select open_post,h,fresh,'pending',now()-interval '1 day' from ids
union all select open_post,h,two,'pending',now()-interval '3 days' from ids
union all select open_post,h,eight,'pending',now()-interval '8 days' from ids
union all select dead_post,h,gone,'pending',now()-interval '1 day' from ids
union all select open_post,h,again,'pending',now()-interval '9 days' from ids;
insert into public.meetup_requests(post_id,host_id,requester_id,status,created_at,responded_at) select open_post,h,member,'approved',now()-interval '20 days',now()-interval '19 days' from ids;
-- Waitlist entries that invited the 8-day and the removed-meetup requester.
insert into private.meetup_waitlist(post_id,user_id,invited_at,offer_expires_at) select open_post,eight,now()-interval '8 days',now()-interval '7 days' from ids
union all select dead_post,gone,now()-interval '1 day',now()+interval '1 day' from ids;
update public.posts set status='removed' where id=(select dead_post from ids);

select is(private.expire_meetup_requests(),4,'One sweep: one silent close, two no-answer closes, one host reminder');

-- Removed meetup: closed quietly, nobody told, waitlist entry freed.
select is((select status||'/'||expired_reason from public.meetup_requests where requester_id=(select gone from ids)),'cancelled/meetup_closed','Request on a removed meetup closes as meetup_closed');
select is((select count(*)::int from public.notifications where user_id in((select gone from ids),(select h from ids)) and target_id=(select id from public.meetup_requests where requester_id=(select gone from ids))),0,'The silent close sends nothing');
select isnt((select cancelled_at from private.meetup_waitlist where user_id=(select gone from ids)),null,'Its waitlist entry is freed');

-- Seven days: closed with its own reason, the applicant is told, the host is not (and it is not a rejection).
select is((select status||'/'||expired_reason from public.meetup_requests where requester_id=(select eight from ids)),'cancelled/no_answer','Eight days pending closes as no_answer');
select is((select count(*)::int from public.notifications where user_id=(select eight from ids) and kind='meetup_changed' and body like '%호스트 답이 없어 신청이 닫혔어요%' and route='/post/'||(select open_post from ids)),1,'The applicant hears it closed without an answer, and the notice opens that meetup');
select is((select count(*)::int from public.notifications where user_id=(select eight from ids) and kind='meetup_rejected'),0,'It never reads as a rejection');
select is((select count(*)::int from public.meetup_requests where expired_reason is not null and responded_at is not null),0,'Closed requests keep responded_at empty (no re-apply wait, no cancelled-notice access)');
select is((select count(*)::int from public.notifications where user_id=(select h from ids) and target_id in(select id from public.meetup_requests where expired_reason is not null)),0,'The host is not told about the close');
select isnt((select cancelled_at from private.meetup_waitlist where user_id=(select eight from ids)),null,'Its waitlist entry is freed');

-- Two days: one reminder to the host, once.
select isnt((select reminded_at from public.meetup_requests where requester_id=(select two from ids)),null,'Two days pending marks the reminder');
select is((select count(*)::int from public.notifications where user_id=(select h from ids) and kind='meetup_request' and target_id=(select id from public.meetup_requests where requester_id=(select two from ids))),1,'The host is reminded once');
select is((select status from public.meetup_requests where requester_id=(select two from ids)),'pending','The reminded request stays pending');
select is((select reminded_at from public.meetup_requests where requester_id=(select fresh from ids)),null,'A one-day-old request is left alone');
select is((select count(*)::int from public.notifications where user_id=(select h from ids) and kind='meetup_request' and target_id in(select id from public.meetup_requests where requester_id in((select eight from ids),(select again from ids)))),0,'Requests that close are not reminded first');
select is(private.expire_meetup_requests(),0,'A second sweep changes nothing');
select is((select count(*)::int from public.notifications where user_id=(select h from ids) and kind='meetup_request'),1,'No second reminder');
select is((select status from public.meetup_requests where requester_id=(select member from ids)),'approved','Approved members are untouched');

-- Applying again after an expiry starts clean and can be reminded on its own clock.
update public.meetup_requests set status='pending',created_at=now()-interval '3 days' where requester_id=(select again from ids);
select ok((select reminded_at is null and expired_reason is null from public.meetup_requests where requester_id=(select again from ids)),'A re-applied request is reset');
select is(private.expire_meetup_requests(),1,'The re-applied request is reminded after two days');

-- Someone whose request closed unanswered still sees the meetup; a requester who cancelled themselves does not.
update public.meetup_requests set status='cancelled' where requester_id=(select fresh from ids);
select set_config('request.jwt.claims',jsonb_build_object('sub',eight,'role','authenticated')::text,true) from ids;
select is(private.chilling_context_visible((select open_post from ids),(select eight from ids)),true,'An unanswered-closed requester still sees the meetup');
select set_config('request.jwt.claims',jsonb_build_object('sub',fresh,'role','authenticated')::text,true) from ids;
select is(private.chilling_context_visible((select open_post from ids),(select fresh from ids)),false,'A requester who cancelled does not');

select ok((select command from cron.job where jobname='gling-meetup-tidy') like '%private.expire_meetup_requests()%' and (select command from cron.job where jobname='gling-meetup-tidy') like '%tidy_empty_meetups%','The existing tidy job runs it and keeps its old work');
select * from finish();
rollback;
