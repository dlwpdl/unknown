begin;
set local search_path=public,extensions;
select no_plan();

-- Hosts: 1 free, 2 plus, 3 pro, 4 premium, 5 operator, 6 premium then suspended. Members 1-7.
insert into public.cities(id,name,province,timezone) values('scale-test','Scale test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31994,'scale-test','Scale test','meetup') on conflict do nothing;
insert into auth.users(id,email)
select ('cc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'scale-host-'||n||'@example.invalid' from generate_series(1,6)n;
insert into auth.users(id,email)
select ('cc510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'scale-member-'||n||'@example.invalid' from generate_series(1,7)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Scale'||substr(id::text,3,2)||right(id::text,4),'scale-test',now(),now(),now(),'test' from auth.users where id::text like 'cc500000-%' or id::text like 'cc510000-%';
select public.apply_membership_snapshot(('cc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_array(jsonb_build_object(
  'kind','general','plan_version',2,'tier',case n when 2 then 'plus' when 3 then 'pro' else 'premium' end,'expires_at',now()+interval '1 day',
  'product_id','com.dlwpdl.gling.general.'||case n when 2 then 'plus' when 3 then 'pro' else 'premium' end||'.monthly.v2',
  'store','test_store','will_renew',true)),now()) from unnest(array[2,3,4,6])n;
insert into private.admin_ids(user_id) values('cc500000-0000-4000-8000-000000000005');
update public.profiles set account_status='suspended' where id='cc500000-0000-4000-8000-000000000006';

select is(private.meetup_capacity_limit('cc500000-0000-4000-8000-000000000001'),10,'Free hosts get ten seats');
select is(private.meetup_capacity_limit('cc500000-0000-4000-8000-000000000002'),30,'Plus hosts get thirty seats');
select is(private.meetup_capacity_limit('cc500000-0000-4000-8000-000000000003'),100,'Pro hosts get one hundred seats');
select is(private.meetup_capacity_limit('cc500000-0000-4000-8000-000000000004'),500,'Premium hosts get five hundred seats');
select is(private.meetup_capacity_limit('cc500000-0000-4000-8000-000000000005'),5000,'The operator keeps the validator maximum');
select is(private.meetup_capacity_limit('cc500000-0000-4000-8000-000000000006'),10,'An inactive paid account falls back to ten seats');
select is(private.meetup_cohost_limit('cc500000-0000-4000-8000-000000000001'),0,'Free hosts get no cohosts');
select is(private.meetup_cohost_limit('cc500000-0000-4000-8000-000000000002'),1,'Plus hosts get one cohost');
select is(private.meetup_cohost_limit('cc500000-0000-4000-8000-000000000003'),3,'Pro hosts get three cohosts');
select is(private.meetup_cohost_limit('cc500000-0000-4000-8000-000000000004'),5,'Premium hosts get five cohosts');
select is(private.meetup_cohost_limit('cc500000-0000-4000-8000-000000000005'),1000,'The operator gets effectively unlimited cohosts');
select is(private.meetup_cohost_limit('cc500000-0000-4000-8000-000000000006'),0,'An inactive paid account gets no cohosts');

select ok(not has_function_privilege(r,'private.meetup_cohost_limit(uuid)','execute'),'meetup_cohost_limit is not executable by '||r)
  from unnest(array['anon','authenticated','service_role'])r;
select ok(not has_table_privilege(r,'private.meetup_role_audit','select,insert,update,delete'),'meetup_role_audit is not accessible to '||r)
  from unnest(array['anon','authenticated','service_role'])r;

insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('cc520000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('cc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'scale-test',31994,'Scale fixture '||n,'Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8}'
from unnest(array[1,2,3,5])n;
-- Members 1-5 join the Pro meetup, 1-2 the free and Plus meetups; member 6 waits on the Pro meetup.
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select ('cc520000-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,('cc500000-0000-4000-8000-'||lpad(p::text,12,'0'))::uuid,
  ('cc510000-0000-4000-8000-'||lpad(m::text,12,'0'))::uuid,'approved'
from unnest(array[1,2,3])p cross join generate_series(1,5)m where p=3 or m<=2;
insert into private.meetup_waitlist(post_id,user_id) values('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000006');

-- Free and Plus hosts.
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000001','cc510000-0000-4000-8000-000000000001')$$,'P0001','PLUS_REQUIRED','Free hosts cannot invite cohosts');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000001')->'cohostLimit','0'::jsonb,'Free host tools report no cohost seats');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000001')->>'canInviteCohost','false','Free host tools hide cohost invitations');
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000002')->>'canInviteCohost','true','A Plus host with a free cohost seat may invite');
select lives_ok($$select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000002','cc510000-0000-4000-8000-000000000001')$$,'A Plus host invites one cohost');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000002')->>'canInviteCohost','false','A pending invitation fills the Plus seat');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000002')->'cohostLimit','1'::jsonb,'Plus host tools report one cohost seat');
select throws_ok($$select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000002','cc510000-0000-4000-8000-000000000002')$$,'P0001','MEETUP_COHOST_LIMIT','A second Plus invitation is rejected');

-- Pro host: fill three cohost seats. Each invite clears the per-user cooldown first.
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->'cohostLimit','3'::jsonb,'Pro host tools report three cohost seats');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->>'canInviteCohost','true','A Pro host with free seats may invite cohosts');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->>'canInvite','true','A Pro host may invite from the waitlist');
select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000001');
reset role; delete from private.action_rate_events where user_id='cc500000-0000-4000-8000-000000000003'; set local role authenticated;
select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000002');
reset role; delete from private.action_rate_events where user_id='cc500000-0000-4000-8000-000000000003'; set local role authenticated;
select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000003');
reset role; delete from private.action_rate_events where user_id='cc500000-0000-4000-8000-000000000003'; set local role authenticated;
select throws_ok($$select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000004')$$,'P0001','MEETUP_COHOST_LIMIT','A fourth Pro invitation is rejected');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.respond_meetup_cohost('cc520000-0000-4000-8000-000000000003',true)$$,'First cohost accepts');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select public.respond_meetup_cohost('cc520000-0000-4000-8000-000000000003',true)$$,'Second cohost accepts');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.respond_meetup_cohost('cc520000-0000-4000-8000-000000000003',true)$$,'Third cohost accepts');
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->>'canInviteCohost','false','Three accepted cohosts fill the Pro seats');

-- Waitlist invitations: an acting cohost may invite; a regular member may not.
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->>'canInvite','true','An acting cohost sees the waitlist invitation');
select ok(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->'waitlistCount' is distinct from 'null'::jsonb,'An acting cohost sees the waitlist count');
select is(public.invite_next_meetup_waitlist('cc520000-0000-4000-8000-000000000003'),true,'An acting cohost invites from a Pro host waitlist');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.invite_next_meetup_waitlist('cc520000-0000-4000-8000-000000000003')$$,'P0001','HOST_REQUIRED','A regular member cannot invite from the waitlist');
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.remove_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000003')$$,'Host removes the third cohost');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.invite_next_meetup_waitlist('cc520000-0000-4000-8000-000000000003')$$,'P0001','HOST_REQUIRED','A removed cohost cannot invite from the waitlist');
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
reset role; delete from private.action_rate_events where user_id='cc500000-0000-4000-8000-000000000003'; set local role authenticated;
select lives_ok($$select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000004')$$,'A freed Pro seat can be offered again');
reset role;

-- Downgrade Pro -> Plus with two accepted cohosts and one pending.
select public.apply_membership_snapshot('cc500000-0000-4000-8000-000000000003',jsonb_build_array(jsonb_build_object(
  'kind','general','plan_version',2,'tier','plus','expires_at',now()+interval '1 day',
  'product_id','com.dlwpdl.gling.general.plus.monthly.v2','store','test_store','will_renew',true)),clock_timestamp());
select ok(private.meetup_tool_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000001'),'After downgrade the earliest accepted cohost still acts');
select ok(not private.meetup_tool_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000002'),'After downgrade a later accepted cohost no longer acts');
set local role authenticated;
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->'cohostLimit','1'::jsonb,'Downgraded host tools report one cohost seat');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->>'canInviteCohost','false','Downgraded host cannot invite more cohosts');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.respond_meetup_cohost('cc520000-0000-4000-8000-000000000003',true)$$,'P0001','MEETUP_COHOST_LIMIT','A pending cohost cannot accept above the downgraded limit');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000003')->>'isCohost','false','The non-acting cohost is not shown as a cohost');
select throws_ok($$select public.invite_next_meetup_waitlist('cc520000-0000-4000-8000-000000000003')$$,'P0001','HOST_REQUIRED','A non-acting cohost cannot invite from the waitlist');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.invite_next_meetup_waitlist('cc520000-0000-4000-8000-000000000003')$$,'P0001','PRO_REQUIRED','The acting cohost still needs the host to hold Pro');
reset role;

-- Downgrade to free: no cohost acts, accepting and inviting need Plus.
select public.apply_membership_snapshot('cc500000-0000-4000-8000-000000000003','[]',clock_timestamp());
select ok(not private.meetup_tool_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000001'),'A free host has no acting cohost');
select set_config('request.jwt.claims','{"sub":"cc510000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.respond_meetup_cohost('cc520000-0000-4000-8000-000000000003',true)$$,'P0001','PLUS_REQUIRED','A cohost cannot accept from a free host');
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.invite_meetup_cohost('cc520000-0000-4000-8000-000000000003','cc510000-0000-4000-8000-000000000005')$$,'P0001','PLUS_REQUIRED','A downgraded free host cannot invite cohosts');
select throws_ok($$select * from private.meetup_role_audit$$,'42501',null,'Clients cannot read the role audit');
reset role;

select is((select string_agg(action||':'||n,',' order by action) from(select action,count(*) n from private.meetup_role_audit
  where post_id='cc520000-0000-4000-8000-000000000003' group by action)s),
  'cohost_accept:3,cohost_invite:4,cohost_remove:1,waitlist_invite:1','Every successful role action on the Pro meetup is audited once');
select is((select actor_id::text||'>'||target_id::text from private.meetup_role_audit where post_id='cc520000-0000-4000-8000-000000000003' and action='waitlist_invite'),
  'cc510000-0000-4000-8000-000000000001>cc510000-0000-4000-8000-000000000006','The waitlist audit names the acting cohost and the invited waiter');
select is((select actor_id::text||'>'||target_id::text from private.meetup_role_audit where post_id='cc520000-0000-4000-8000-000000000003' and action='cohost_remove'),
  'cc500000-0000-4000-8000-000000000003>cc510000-0000-4000-8000-000000000003','The removal audit names the host and the removed cohost');

-- The operator host counts as Pro for host tools.
select set_config('request.jwt.claims','{"sub":"cc500000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000005')->'cohostLimit','1000'::jsonb,'Operator host tools report the operator cohost limit');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000005')->>'canInvite','true','Operator hosts have Pro waitlist tools');
select is(public.get_meetup_host_tools('cc520000-0000-4000-8000-000000000005')->>'canManageSessions','true','Operator hosts have Pro session tools');
reset role;
select * from finish();
rollback;
