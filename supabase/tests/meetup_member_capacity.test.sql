begin;
set local search_path=public,extensions;
select no_plan();

select is((select proowner from pg_proc where oid='public.get_chilling_roster_v2(uuid)'::regprocedure),
  (select proowner from pg_proc where oid='public.get_chilling_roster(uuid)'::regprocedure),'V2 preserves the legacy function owner');
select is((select proconfig::text from pg_proc where oid='public.get_chilling_roster_v2(uuid)'::regprocedure),
  (select proconfig::text from pg_proc where oid='public.get_chilling_roster(uuid)'::regprocedure),'V2 preserves the fixed search path');
select is((select prosrc from pg_proc where oid='public.get_chilling_roster_v2(uuid)'::regprocedure),
  (select replace(prosrc,'order by is_host desc,id limit 50','order by is_host desc,id limit 5000') from pg_proc where oid='public.get_chilling_roster(uuid)'::regprocedure),
  'V2 changes only the row bound inside the real privacy projection');
select ok((select prosecdef from pg_proc where oid='public.get_chilling_roster_v2(uuid)'::regprocedure),'V2 retains security definer');
select ok(has_function_privilege('authenticated','public.get_chilling_roster_v2(uuid)','execute'),'Authenticated callers retain scoped roster access');
select ok(not has_function_privilege('anon','public.get_chilling_roster_v2(uuid)','execute'),'V2 denies anonymous access');
select ok(not has_function_privilege('service_role','public.get_chilling_roster_v2(uuid)','execute'),'V2 exposes no service-role RPC');
select is((select string_agg(grantor||':'||grantee||':'||privilege_type||':'||is_grantable,',' order by grantor,grantee,privilege_type,is_grantable)
  from pg_proc cross join lateral aclexplode(proacl) where oid='public.get_chilling_roster_v2(uuid)'::regprocedure),
  (select string_agg(grantor||':'||grantee||':'||privilege_type||':'||is_grantable,',' order by grantor,grantee,privilege_type,is_grantable)
  from pg_proc cross join lateral aclexplode(proacl) where oid='public.get_chilling_roster(uuid)'::regprocedure),'V2 preserves the exact legacy ACL');

insert into public.cities(id,name,province,timezone) values('capacity-test','Capacity test','BC','America/Vancouver') on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31995,'capacity-test','Capacity test','meetup') on conflict do nothing;
insert into auth.users(id,email)
select ('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'capacity-host-'||n||'@example.invalid' from generate_series(1,8)n;
insert into auth.users(id,email)
select ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'capacity-member-'||n||'@example.invalid' from generate_series(1,5000)n;
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
select id,'Cap'||case when id::text like 'ca500000%' then 'host' else 'member' end||right(id::text,6),
  'capacity-test',now(),now(),now(),'test' from auth.users where id::text like 'ca500000-%' or id::text like 'ca510000-%';
insert into private.chilling_profiles(id,profile)
select id,'{"intro":"Synthetic capacity fixture","interests":["walk"],"promptOne":"park","promptTwo":"weekend"}' from public.profiles where id::text like 'ca500000%';

-- Use the existing receipt authority, including a legacy annual personal subscription.
select public.apply_membership_snapshot('ca500000-0000-4000-8000-000000000002',jsonb_build_array(jsonb_build_object(
  'tier','plus','expires_at',now()+interval '1 day','product_id','com.dlwpdl.gling.plus.yearly','store','test_store','will_renew',true)),now());
select public.apply_membership_snapshot(('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,jsonb_build_array(jsonb_build_object(
  'kind',case n when 5 then 'business' else 'general' end,'plan_version',2,'tier',case n when 3 then 'pro' when 6 then 'plus' else 'premium' end,
  'expires_at',case n when 6 then now()-interval '1 day' else now()+interval '1 day' end,
  'product_id','com.dlwpdl.gling.'||case n when 5 then 'business' else 'general' end||'.'||case n when 3 then 'pro' when 6 then 'plus' else 'premium' end||'.monthly.v2',
  'store','test_store','will_renew',true)),now()) from generate_series(3,7)n;

select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000001'),10,'Free has ten host-inclusive seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000002'),30,'Legacy personal Plus includes thirty seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000003'),100,'Personal Pro includes one hundred seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000004'),500,'Personal Premium includes five hundred seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000005'),10,'Business-only promotion membership grants no personal seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000006'),10,'Expired personal membership falls back to ten');

insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('ca520000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'capacity-test',31995,'Capacity fixture '||n,'Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}'
from generate_series(1,7)n;

select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tier":"premium"}}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000001','group',p_cadence=>'weekly',p_capacity=>10)$$,'Free10 is accepted through the real configuration RPC');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000001','group',p_cadence=>'weekly',p_capacity=>11)$$,'P0001','INVALID_EVENT_CAPACITY','Direct RPC and client claims cannot grant Free11');
select lives_ok($$select public.create_chilling_event('capacity-test','New Free10','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":10}','Question?')$$,'The create RPC also accepts Free10');
select throws_ok($$select public.create_chilling_event('capacity-test','Rejected Free11','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":11}','Question?')$$,'P0001','INVALID_EVENT_CAPACITY','Direct create RPC cannot bypass the free boundary');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>100)$$,'P0001','MEETUP_NOT_FOUND','Another host cannot borrow a paid owner capacity');
reset role;

-- Each personal paid tier accepts exactly its limit and rejects limit+1 through the real RPCs.
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000002','group',p_cadence=>'weekly',p_capacity=>30)$$,'Plus can choose exactly30 through the RPC');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000002','group',p_cadence=>'weekly',p_capacity=>31)$$,'P0001','INVALID_EVENT_CAPACITY','Plus31 is rejected through the RPC');
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>100)$$,'Pro can choose exactly100 through the RPC');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>101)$$,'P0001','INVALID_EVENT_CAPACITY','Pro101 is rejected through the RPC');
select lives_ok($$select public.create_chilling_event('capacity-test','New pro100','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":100}','Question?')$$,'The create RPC accepts pro100');
select throws_ok($$select public.create_chilling_event('capacity-test','Rejected pro101','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":101}','Question?')$$,'P0001','INVALID_EVENT_CAPACITY','The create RPC rejects pro101');
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000004','group',p_cadence=>'weekly',p_capacity=>500)$$,'Premium can choose exactly500 through the RPC');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000004','group',p_cadence=>'weekly',p_capacity=>501)$$,'P0001','INVALID_EVENT_CAPACITY','Premium501 is rejected through the RPC');
reset role;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000005','group',p_cadence=>'weekly',p_capacity=>11)$$,'P0001','INVALID_EVENT_CAPACITY','Business-only plan cannot configure11');
reset role;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000006','group',p_cadence=>'weekly',p_capacity=>10)$$,'Expired paid account can still choose10');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000006','group',p_cadence=>'weekly',p_capacity=>11)$$,'P0001','INVALID_EVENT_CAPACITY','Expired paid account cannot choose11');
reset role;
update public.profiles set account_status='suspended' where id='ca500000-0000-4000-8000-000000000007';
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000007'),10,'Inactive paid account falls back to ten');
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000007','group',p_cadence=>'weekly',p_capacity=>10)$$,'P0001','ACCOUNT_LOCKED','Capacity policy retains account locks');
reset role;
select throws_ok($$update public.posts set room_preview=room_preview||'{"capacity":11}' where id='ca520000-0000-4000-8000-000000000001'$$,'P0001','INVALID_EVENT_CAPACITY','Even a direct privileged table write obeys the host plan');
select throws_ok($$update public.posts set room_preview=room_preview||'{"capacity":100.5}' where id='ca520000-0000-4000-8000-000000000003'$$,'P0001','INVALID_EVENT_CAPACITY','Fractional capacity cannot bypass validation');

-- Only the operator account may hold the 5000-seat validator maximum; promote the Pro fixture for the roster checks.
insert into private.admin_ids(user_id) values('ca500000-0000-4000-8000-000000000003');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000003'),5000,'The operator account holds five thousand seats');
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>5000)$$,'The operator can choose exactly5000 through the RPC');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>5001)$$,'P0001','INVALID_EVENT_CAPACITY','Operator5001 is rejected through the RPC');
reset role;

-- Synthetic approved rows exercise real member/slot triggers; no participant or room is copied.
insert into public.meetup_requests(id,post_id,host_id,requester_id,status)
select ('ca530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ca520000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000003',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(1,4998)n;
insert into public.meetup_requests(id,post_id,host_id,requester_id,status)
select ('ca530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ca520000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000003',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pending' from generate_series(4999,5000)n;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request('ca530000-0000-4000-8000-000000004999','approved')$$,'The real approval RPC fills operator seat5000');
select throws_ok($$select public.respond_meetup_request('ca530000-0000-4000-8000-000000005000','approved')$$,'P0001','MEETUP_FULL','The next approval cannot overfill5000');
select is(jsonb_array_length(public.get_chilling_roster('ca520000-0000-4000-8000-000000000003')),50,'Legacy clients still receive at most fifty members after the capacity migration');
select is(jsonb_array_length(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003')),5000,'New clients receive metadata for every participant');
select is((select count(*)::integer from public.get_conversation_members((select id from public.conversations where group_post_id='ca520000-0000-4000-8000-000000000003'))),50,'The legacy conversation-member RPC keeps its fifty-member contract');
reset role;

-- A member beyond the old page boundary still uses the unchanged per-photo Storage policy.
insert into private.chilling_applications(id,author_id,profile,answer,question,consent_version) values
 ('ca530000-0000-4000-8000-000000004999','ca510000-0000-4000-8000-000000004999',
  '{"version":2,"displayName":"Late alias","intro":"Private intro","shareWithMembers":false,"photoPaths":["ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp"]}',
  'Synthetic answer','Synthetic question','chilling-v2');
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('meetup-profiles','ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp','ca510000-0000-4000-8000-000000004999','{"size":1024,"mimetype":"image/webp"}');
select set_config('storage.operation','storage.object.get_authenticated',true);
select set_config('request.jwt.claims','{"sub":"ca510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_chilling_member_profile('ca520000-0000-4000-8000-000000000003','ca510000-0000-4000-8000-000000004999')->'photoPaths','[]'::jsonb,'A later member private photo remains hidden without member-sharing consent');
select is((select count(*)::integer from storage.objects where bucket_id='meetup-profiles' and name='ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp'),0,'Storage denies a later member photo before consent');
reset role;
update private.chilling_applications set profile=profile||'{"shareWithMembers":true}' where id='ca530000-0000-4000-8000-000000004999';
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.get_chilling_roster('ca520000-0000-4000-8000-000000000003')) item where item->>'userId'='ca510000-0000-4000-8000-000000004999'),'The photo subject is beyond the legacy fifty-member page');
select is((select item->'photoPaths'->>0 from jsonb_array_elements(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003')) item where item->>'userId'='ca510000-0000-4000-8000-000000004999'),
  'ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp','V2 includes only the consented meetup photo, not general identity');
select is((select count(*)::integer from storage.objects where bucket_id='meetup-profiles' and name='ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp'),1,'An approved viewer can read the consented photo beyond the legacy page');
reset role;
insert into public.blocks(blocker_id,blocked_id) values('ca510000-0000-4000-8000-000000000001','ca510000-0000-4000-8000-000000004999');
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003')) item where item->>'userId'='ca510000-0000-4000-8000-000000004999'),'A current block removes the later member from V2');
select is((select count(*)::integer from storage.objects where bucket_id='meetup-profiles' and name='ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp'),0,'A block revokes the later photo independently of roster limits');
reset role;
delete from public.blocks where blocker_id='ca510000-0000-4000-8000-000000000001' and blocked_id='ca510000-0000-4000-8000-000000004999';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003'),'[]'::jsonb,'A nonmember cannot read the expanded roster');
reset role;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003')$$,'P0001','ACCOUNT_LOCKED','V2 retains active-account enforcement');
reset role;

-- The existing Free10 room survives at its full host-inclusive capacity.
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select 'ca520000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(1,9)n;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000001','group',p_cadence=>'updated weekly',p_capacity=>10)$$,'Existing ten-member room remains editable');
reset role;
select is((select count(*)::integer+1 from public.meetup_requests where post_id='ca520000-0000-4000-8000-000000000001' and status='approved'),10,'No existing participant was removed');
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('ca520000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','ca510000-0000-4000-8000-000000000010','approved')$$,'P0001','MEETUP_FULL','Free approval cannot allocate seat11');

-- Choose500 while Premium, then expire with11 members and one earlier pending request.
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select 'ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(1,10)n;
insert into public.meetup_requests(id,post_id,host_id,requester_id,status) values
 ('ca540000-0000-4000-8000-000000000011','ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004','ca510000-0000-4000-8000-000000000011','pending');
update private.membership_accounts set entitlements=jsonb_set(entitlements,'{0,expires_at}',to_jsonb((now()-interval '1 day')::text)) where user_id='ca500000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000004','group',p_cadence=>'still weekly',p_capacity=>500)$$,'Expiry permits ordinary edits without silently shrinking the room');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000004','group',p_cadence=>'still weekly',p_capacity=>10)$$,'P0001','EVENT_CAPACITY_BELOW_MEMBERS','Downgrade cannot shrink below existing members');
select throws_ok($$select public.respond_meetup_request('ca540000-0000-4000-8000-000000000011','approved')$$,'P0001','MEETUP_HOST_CAPACITY_LIMIT','Expiry blocks approval above ten despite the recorded500');
reset role;
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004','ca510000-0000-4000-8000-000000000012','approved')$$,'P0001','MEETUP_HOST_CAPACITY_LIMIT','A direct instant approval cannot bypass the expired host policy');
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004','ca510000-0000-4000-8000-000000000012','pending')$$,'P0001','MEETUP_HOST_CAPACITY_LIMIT','A new pending join observes the same current host limit');
select is((select count(*)::integer+1 from public.meetup_requests where post_id='ca520000-0000-4000-8000-000000000004' and status='approved'),11,'Downgrade retains all existing members');
select lives_ok($$update public.posts set room_preview=room_preview||'{"capacity":400}' where id='ca520000-0000-4000-8000-000000000004'$$,'A downgrade may reduce the recorded capacity without evicting anyone');
select throws_ok($$update public.posts set room_preview=room_preview||'{"capacity":401}' where id='ca520000-0000-4000-8000-000000000004'$$,'P0001','INVALID_EVENT_CAPACITY','Grandfathering does not authorize a new increase');
select set_config('request.jwt.claims','{"sub":"ca510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('ca520000-0000-4000-8000-000000000004')$$,'Existing member can leave a downgraded large room');
reset role;
update private.membership_accounts set entitlements=jsonb_set(entitlements,'{0,expires_at}',to_jsonb((now()+interval '1 day')::text)) where user_id='ca500000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request('ca540000-0000-4000-8000-000000000011','approved')$$,'Reactivated personal membership permits another member');
reset role;
update private.membership_accounts set entitlements='[]' where user_id='ca500000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('ca520000-0000-4000-8000-000000000004')$$,'A downgraded host can still close the room');
reset role;

select ok(not has_function_privilege('anon','private.meetup_capacity_limit(uuid)','execute'),'Capacity policy exposes no anonymous membership oracle');
select ok(not has_function_privilege('authenticated','private.meetup_capacity_limit(uuid)','execute'),'Clients cannot inspect another host private billing helper');
select ok(not has_function_privilege('service_role','private.guard_meetup_capacity_admission()','execute'),'Trigger entry point is not granted as a service RPC');
select set_config('request.jwt.claims','{"sub":"ca510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.create_report('post','ca520000-0000-4000-8000-000000000003','other','Synthetic local privacy check');
select is(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003'),'[]'::jsonb,'Reporting the post immediately revokes V2 for that viewer');
select is((select count(*)::integer from storage.objects where bucket_id='meetup-profiles' and name='ca510000-0000-4000-8000-000000004999/1792380000000-aabbccdd.webp'),0,'A current report also revokes the later photo');
reset role;
-- Context closure still revokes both contracts immediately.
update public.posts set room_preview=room_preview||'{"closed":true}' where id='ca520000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_chilling_roster('ca520000-0000-4000-8000-000000000003'),'[]'::jsonb,'Closed context revokes the legacy roster');
select is(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000003'),'[]'::jsonb,'Closed context revokes V2 without a refresh job');
reset role;
-- Advance a fixture to an elapsed event; do not disable the new capacity or privacy guards.
alter table public.posts disable trigger posts_chilling_event_details;
alter table public.posts disable trigger posts_membership_limit;
update public.posts set room_preview=room_preview||jsonb_build_object('eventKind','once','startsAt',now()-interval '2 days','endsAt',now()-interval '1 day')
  where id='ca520000-0000-4000-8000-000000000001';
alter table public.posts enable trigger posts_chilling_event_details;
alter table public.posts enable trigger posts_membership_limit;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_chilling_roster_v2('ca520000-0000-4000-8000-000000000001'),'[]'::jsonb,'V2 checks actual expiry without a refresh job');
reset role;
select * from finish();
rollback;
