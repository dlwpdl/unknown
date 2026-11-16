begin;
set local search_path=public,extensions;
select no_plan();

-- Every meetup host tool is free for every tier; only numeric caps stay tiered.
-- 1 free host, 2 free member, 3 plus member.
insert into public.cities(id,name,province,timezone) values('free-tools','Free tools test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'free-tools','Free tools test','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select ('f0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'free-tools-'||n||'@example.invalid','{}' from generate_series(1,3)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version,created_at)
select id,'Free'||right(id::text,2),'free-tools',now(),now(),now(),'test',now()-interval '200 days' from auth.users where id::text like 'f0000000-%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"함께 걸어요","interests":["산책"],"promptOne":"공원","promptTwo":"주말"}' from public.profiles where id::text like 'f0000000-%';
insert into private.membership_accounts(user_id,entitlements,observed_at)
values('f0000000-0000-4000-8000-000000000003',jsonb_build_array(jsonb_build_object('tier','plus','kind','general','plan_version','2','expires_at',now()+interval '30 days')),now());
create function pg_temp.as_user(p uuid) returns void language sql as $$ select set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated')::text,true) $$;

alter table public.posts disable trigger posts_meetup_abuse;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview,created_at)
values('f0100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','free-tools',31997,'Free walk','Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '3 days','endsAt',now()+interval '3 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1),now()-interval '2 days');
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at)
values('f0100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','approved',now()-interval '1 day');
alter table public.posts enable trigger posts_meetup_abuse;

select is(private.meetup_tool_tier('f0000000-0000-4000-8000-000000000001'),'free','The host is on the free tier');
select lives_ok($$select private.require_meetup_tool_tier('f0000000-0000-4000-8000-000000000001','premium')$$,'A free host passes the highest tool gate');

select pg_temp.as_user('f0000000-0000-4000-8000-000000000001'); set local role authenticated;
select lives_ok($$select public.set_meetup_auto_approval('f0100000-0000-4000-8000-000000000001',true,true,false)$$,'Free host turns on auto-approve');
select lives_ok($$select public.set_meetup_waitlist_promotion('f0100000-0000-4000-8000-000000000001',true,3)$$,'Free host turns on waitlist auto-pass');
select lives_ok($$select public.set_meetup_no_show_rule(2)$$,'Free host turns on the no-show rule');
select is((public.get_meetup_automation('f0100000-0000-4000-8000-000000000001')->>'canPromote'),'true','Automation screen reports waitlist auto-pass as available');
select is(public.get_meetup_rsvp('f0100000-0000-4000-8000-000000000001')->>'canSeeCounts','true','Free host sees RSVP counts');
select is(public.get_meetup_rsvp('f0100000-0000-4000-8000-000000000001')->'counts','{"going":0,"notGoing":0,"noAnswer":1}'::jsonb,'The counts are real');
select lives_ok($$select public.save_meetup_template('무료 초안','{"title":"산책"}')$$,'Free host saves a template');
select is(public.get_meetup_templates()->>'canUse','true','Templates are available');
select is(public.get_meetup_host_tools('f0100000-0000-4000-8000-000000000001')->'cohostLimit','1'::jsonb,'Free host gets one co-host seat');
select lives_ok($$select public.invite_meetup_cohost('f0100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002')$$,'Free host invites one co-host');
select lives_ok($$select public.get_meetup_host_aggregates('f0100000-0000-4000-8000-000000000001')$$,'Free host reads the stats');
reset role;

-- The participant join cap (switched off in production) still exempts only real paid tiers.
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview,created_at)
select ('f0100000-0000-4000-8000-00000000000'||n)::uuid,'f0000000-0000-4000-8000-000000000001','free-tools',31997,'Walk '||n,'Synthetic local test',current_date,
  jsonb_build_object('eventKind','once','startsAt',now()+interval '4 days','endsAt',now()+interval '4 days 2 hours','timezone','America/Vancouver','capacity',6,'memberCount',1),now()-interval '2 days'
from generate_series(2,3)n;
update private.meetup_join_cap set enabled=true;
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at)
select 'f0100000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','approved',now();
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('f0100000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','pending')$$,'P0001','MEETUP_LIMIT_REACHED','A free member is still capped when the join cap is on');
select lives_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('f0100000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','pending')$$,'A plus member is exempt from the join cap');

select * from finish();
rollback;
