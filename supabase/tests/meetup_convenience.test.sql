begin;
set local search_path=public,extensions;
select no_plan();

-- 1 host, 2 free member, 3 plus member, 4 same-city newcomer, 5 free waitlist, 6 plus waitlist, 7 no-show, 8 other city.
insert into public.cities(id,name,province,timezone) values('conv-test','Convenience test','BC','America/Vancouver'),('conv-other','Other test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31996,'conv-test','Convenience test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select ('c0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'conv-'||n||'@example.invalid','{}' from generate_series(1,8)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'Conv'||right(id::text,2),case when right(id::text,1)='8' then 'conv-other' else 'conv-test' end,now(),now(),now(),'test',
  case when right(id::text,1) in ('4') then now()-interval '2 days' else now()-interval '200 days' end
from auth.users where id::text like 'c0000000-%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"함께 걸어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}' from public.profiles where id::text like 'c0000000-%';
create temporary table ids as select
  'c0000000-0000-4000-8000-000000000001'::uuid h, 'c0000000-0000-4000-8000-000000000002'::uuid m2, 'c0000000-0000-4000-8000-000000000003'::uuid m3,
  'c0000000-0000-4000-8000-000000000004'::uuid m4, 'c0000000-0000-4000-8000-000000000005'::uuid m5, 'c0000000-0000-4000-8000-000000000006'::uuid m6,
  'c0000000-0000-4000-8000-000000000007'::uuid m7, 'c0000000-0000-4000-8000-000000000008'::uuid m8,
  'c0100000-0000-4000-8000-000000000001'::uuid a, 'c0100000-0000-4000-8000-000000000002'::uuid b, 'c0100000-0000-4000-8000-000000000003'::uuid c,
  'c0100000-0000-4000-8000-000000000004'::uuid d, 'c0100000-0000-4000-8000-000000000005'::uuid e;
grant select on ids to authenticated;
create function pg_temp.member_tier(p uuid, t text) returns void language sql as $$
  insert into private.membership_accounts(user_id,entitlements,observed_at) values(p,
    case when t='free' then '[]'::jsonb else jsonb_build_array(jsonb_build_object('tier',t,'kind','general','plan_version','2','expires_at',now()+interval '30 days')) end,now())
  on conflict(user_id) do update set entitlements=excluded.entitlements,observed_at=now();
$$;
select pg_temp.member_tier(m3,'plus') from ids; select pg_temp.member_tier(m6,'plus') from ids;
-- The host hosts six fixtures, past free slots; tiers are switched per check below.
select pg_temp.member_tier(h,'premium') from ids;
create function pg_temp.as_user(p uuid) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true) $$;

-- Fixtures bypass the hosting-frequency guard (rolled back with the test).
alter table public.posts disable trigger posts_meetup_abuse;
-- A: one-time meetup in 3 days (capacity 6). B: regular group (capacity 3). C: same host, later one-time.
-- D: starts in 24h, created 10h ago, nobody asked. E: started an hour ago, nobody asked.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview,created_at)
select a,h,'conv-test',31996,'Stanley walk','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '3 days','endsAt',now()+interval '3 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1,'recommendedAgeMin',20,'recommendedAgeMax',39),now()-interval '2 days' from ids
union all select b,h,'conv-test',31996,'Board games','Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":3,"memberCount":1}',now()-interval '2 days' from ids
union all select c,h,'conv-test',31996,'Later walk','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '9 days','endsAt',now()+interval '9 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1),now()-interval '2 days' from ids
union all select d,h,'conv-test',31996,'Quiet coffee','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '24 hours','endsAt',now()+interval '26 hours','timezone','America/Vancouver','capacity',6,'memberCount',1),now()-interval '10 hours' from ids
union all select e,h,'conv-test',31996,'Empty brunch','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','timezone','America/Vancouver','capacity',6,'memberCount',1),now()-interval '3 days' from ids;
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at)
select a,h,m2,'approved',now()-interval '1 day' from ids union all select a,h,m7,'approved',now()-interval '1 day' from ids
union all select b,h,m2,'approved',now()-interval '1 day' from ids union all select b,h,m3,'approved',now()-interval '1 day' from ids;
alter table public.posts enable trigger posts_meetup_abuse;
select ok(exists(select 1 from public.conversations where group_post_id=(select a from ids) and status='active'),'Fixture: meetup chat exists');

select pg_temp.member_tier(h,'free') from ids;
-- 0. Tier rank.
select is(private.meetup_tier_rank((select m3 from ids)),1,'Plus ranks 1');
select is(private.meetup_tier_rank((select m2 from ids)),0,'Free ranks 0');

-- 1. RSVP buttons are free; counts need a plus host.
select pg_temp.as_user(m8) from ids; set local role authenticated;
select throws_ok($$select public.set_meetup_rsvp((select a from ids),true)$$,'P0001','APPROVED_MEMBER_REQUIRED','Only approved members answer');
reset role; select pg_temp.as_user(m2) from ids; set local role authenticated;
select is(public.set_meetup_rsvp((select a from ids),true)->>'mine','going','Free member says 갈게요');
select throws_ok($$select public.set_meetup_rsvp((select a from ids),true,true)$$,'P0001','INVALID_RESPONSE','Going cannot release a seat');
reset role; select pg_temp.as_user(h) from ids; set local role authenticated;
select is(public.get_meetup_rsvp((select a from ids))->>'canSeeCounts','false','Free host does not see counts');
select ok(public.get_meetup_rsvp((select a from ids))->'counts'='null'::jsonb,'Free host gets no counts');
select throws_ok($$select public.set_meetup_auto_approval((select a from ids),true,false,false)$$,'P0001','PLUS_REQUIRED','Auto-approval needs plus');
reset role; select pg_temp.member_tier(h,'plus') from ids; select pg_temp.as_user(h) from ids; set local role authenticated;
select is(public.get_meetup_rsvp((select a from ids))->'counts','{"going":1,"notGoing":0,"noAnswer":1}'::jsonb,'Plus host sees 갈게요 1 · 아직 1');

-- 2. Auto-approval by same city, checked at commit (deferred constraint trigger).
select lives_ok($$select public.set_meetup_auto_approval((select a from ids),true,false,false)$$,'Plus host turns on same-city auto-approval');
select throws_ok($$select public.set_meetup_auto_approval((select c from ids),false,false,true)$$,'P0001','AGE_RANGE_REQUIRED','Age rule needs a recommended age range');
reset role;
insert into public.meetup_requests(post_id,host_id,requester_id,status) select a,h,m4,'pending' from ids union all select a,h,m8,'pending' from ids;
set constraints meetup_requests_auto_approve immediate;
select is((select status from public.meetup_requests where post_id=(select a from ids) and requester_id=(select m4 from ids)),'approved','Same-city request approved automatically');
select is((select status from public.meetup_requests where post_id=(select a from ids) and requester_id=(select m8 from ids)),'pending','Other-city request waits for the host');
select is(current_setting('request.jwt.claims',true)::jsonb->>'sub',(select h::text from ids),'Caller claims restored after auto-approval');
select ok(exists(select 1 from public.notifications n,ids where n.user_id=m4 and n.kind='meetup_approved'),'Auto-approved member gets the usual approval notice');

-- 3. No-show records: host checked in; 7 never showed; 2 said 못 가요 before the start.
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at)
select 'c0200000-0000-4000-8000-000000000001',a,h,now()-interval '5 hours',now()-interval '3 hours' from ids;
insert into private.meetup_attendance(session_id,user_id,checked_in_at) select 'c0200000-0000-4000-8000-000000000001',h,now()-interval '4 hours' from ids;
insert into private.meetup_rsvps(post_id,user_id,starts_at,response,responded_at) select a,m2,now()-interval '5 hours','not_going',now()-interval '1 day' from ids;
select ok(private.record_meetup_absences()>=2,'Absences recorded');
select is((select kind from private.meetup_absences a,ids where a.user_id=m7 and a.session_id='c0200000-0000-4000-8000-000000000001'),'no_show','Silent absence is a no-show');
select is((select kind from private.meetup_absences a,ids where a.user_id=m2 and a.session_id='c0200000-0000-4000-8000-000000000001'),'excused','Told-in-advance absence is excused');
select is(private.record_meetup_absences(),0,'A session is recorded once');
select pg_temp.as_user(h) from ids; set local role authenticated;
select lives_ok($$select public.set_meetup_no_show_rule(1)$$,'Plus host turns on the no-show rule');
reset role;
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) select c,h,m7,'pending' from ids$$,'P0001','MEETUP_WAITLIST_ONLY','Past the threshold: waitlist only');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) select c,h,m2,'pending' from ids$$,'Excused absence does not count');

-- 4. Waitlist: signup order for every tier; pro promotion offers a freed seat with a deadline and auto-approves the reply.
select pg_temp.member_tier(h,'pro') from ids;
insert into private.meetup_waitlist(post_id,user_id,joined_at) select b,m5,now()-interval '2 hours' from ids union all select b,m6,now()-interval '1 hour' from ids;
select pg_temp.as_user(h) from ids; set local role authenticated;
select lives_ok($$select public.set_meetup_waitlist_promotion((select b from ids),true,3)$$,'Pro host turns on promotion');
reset role;
update public.meetup_requests set status='cancelled',responded_at=now() where post_id=(select b from ids) and requester_id=(select m3 from ids);
select ok((select invited_at is not null and offer_expires_at between now()+interval '2 hours 59 minutes' and now()+interval '3 hours 1 minute'
  from private.meetup_waitlist w,ids where w.post_id=b and w.user_id=m5),'Freed seat goes to whoever joined first (free member), with 3 hours to reply');
select ok((select invited_at is null from private.meetup_waitlist w,ids where w.post_id=b and w.user_id=m6),'Plus member waits in signup order, no priority');
select ok(exists(select 1 from public.notifications n,ids where n.user_id=m5 and n.target_id=b and n.body like '%3시간 안에 신청하면%'),'Offer notice names the deadline');
insert into public.meetup_requests(post_id,host_id,requester_id,status) select b,h,m5,'pending' from ids;
set constraints meetup_requests_auto_approve immediate;
select is((select status from public.meetup_requests r,ids where r.post_id=b and r.requester_id=m5),'approved','Reply within the deadline is approved automatically');
update public.meetup_requests set status='cancelled',responded_at=now() where post_id=(select b from ids) and requester_id=(select m5 from ids);
select ok((select invited_at is not null from private.meetup_waitlist w,ids where w.post_id=b and w.user_id=m6),'Next seat goes to the next person');
update private.meetup_waitlist set offer_expires_at=now()-interval '1 minute' where post_id=(select b from ids) and user_id=(select m6 from ids);
select is(private.expire_meetup_waitlist_offers(),1,'Unanswered offer lapses');
select ok((select cancelled_at is not null from private.meetup_waitlist w,ids where w.post_id=b and w.user_id=m6),'Lapsed entry leaves the waitlist');

-- 5. "못 가요" with release leaves through leave_meetup.
select pg_temp.as_user(m4) from ids; set local role authenticated;
select is(public.set_meetup_rsvp((select a from ids),false,true)->>'member','false','Releasing the seat leaves the meetup');
reset role;
select is((select response from private.meetup_rsvps v,ids where v.post_id=a and v.user_id=m4),'not_going','The 못 가요 answer is kept');

-- 6. Title drafts: one per draft on free, more on plus.
select pg_temp.as_user(m2) from ids; set local role authenticated;
select is(public.reserve_meetup_title_draft('c0300000-0000-4000-8000-000000000001')->>'canRegenerate','false','Free: first title draft');
select throws_ok($$select public.reserve_meetup_title_draft('c0300000-0000-4000-8000-000000000001')$$,'P0001','MEETUP_TITLE_DRAFT_PLUS_REQUIRED','Free: no second draft for the same meetup');
reset role; select pg_temp.as_user(m3) from ids; set local role authenticated;
select lives_ok($$select public.reserve_meetup_title_draft('c0300000-0000-4000-8000-000000000002'); select public.reserve_meetup_title_draft('c0300000-0000-4000-8000-000000000002')$$,'Plus: regenerate');
reset role;

-- 8. Empty meetups.
select ok(private.tidy_empty_meetups()>=2,'Tidy ran');
select ok(exists(select 1 from public.notifications n,ids where n.user_id=h and n.kind='meetup_host_tip' and n.target_id=d and n.body like 'Quiet coffee 모임에 아직 신청이 없어요.%'),'Host gets one suggestion 48h before');
select is((select count(*)::int from public.notifications n,ids where n.user_id=h and n.kind='meetup_host_tip'),1,'Only the empty meetup gets a suggestion');
select private.tidy_empty_meetups();
select is((select count(*)::int from public.notifications n,ids where n.user_id=h and n.kind='meetup_host_tip'),1,'Suggestion is sent once');
select is((select room_preview->>'closed' from public.posts,ids where id=e),'true','Started with nobody: off the list');
select is((select room_preview->>'closed' from public.posts,ids where id=d),null,'Upcoming empty meetup stays listed');
select is((select count(*)::int from public.meetup_requests r,ids where r.post_id in (d,e)),0,'No seats filled by the tidy job');
select is(private.notification_category('meetup_host_tip','post'),'meetups','Host tip files under meetups');

-- 9. Owner 2026-10-30: a late offer gets 1 hour; free members join one meetup at a time once switched on.
alter table public.posts disable trigger posts_meetup_abuse;
update public.posts set room_preview=room_preview||jsonb_build_object('startsAt',now()+interval '4 hours','endsAt',now()+interval '6 hours') where id=(select d from ids);
alter table public.posts enable trigger posts_meetup_abuse;
insert into private.meetup_waitlist(post_id,user_id,joined_at) select d,m5,now()-interval '1 hour' from ids;
select ok(private.offer_meetup_waitlist((select d from ids),3),'Late seat offered');
select ok((select offer_expires_at between now()+interval '59 minutes' and now()+interval '61 minutes' from private.meetup_waitlist w,ids where w.post_id=d and w.user_id=m5),'Within 6 hours of the start the reply window is 1 hour');
select ok(exists(select 1 from public.notifications n,ids where n.user_id=m5 and n.target_id=d and n.body like '%1시간 안에 신청하면%'),'Late offer notice says 1 hour');
select is((select enabled from private.meetup_join_cap),false,'Free join cap ships switched off');
update public.meetup_requests set status='cancelled',responded_at=now() where post_id=(select c from ids) and requester_id=(select m2 from ids);
select lives_ok($$update public.meetup_requests set status='pending' where post_id=(select c from ids) and requester_id=(select m2 from ids)$$,'Switched off: a free member in two meetups can still ask');
update public.meetup_requests set status='cancelled',responded_at=now() where post_id=(select c from ids) and requester_id=(select m2 from ids);
update private.meetup_join_cap set enabled=true;
select throws_ok($$update public.meetup_requests set status='pending' where post_id=(select c from ids) and requester_id=(select m2 from ids)$$,'P0001','MEETUP_LIMIT_REACHED','Switched on: a free member already in a meetup cannot ask for another');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) select c,h,m3,'pending' from ids$$,'Plus members are not capped');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) select c,h,m4,'pending' from ids$$,'A free member in no meetup can ask');
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at) select d,h,m4,'approved',now() from ids;
select throws_ok($$update public.meetup_requests set status='approved',responded_at=now() where post_id=(select c from ids) and requester_id=(select m4 from ids)$$,'P0001','REQUESTER_MEETUP_LIMIT_REACHED','Approval rechecks: joined another meetup meanwhile');

select * from finish();
rollback;
