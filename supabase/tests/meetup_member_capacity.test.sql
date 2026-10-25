begin;
set local search_path=public,extensions;
select no_plan();

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

select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000001'),50,'Free has fifty host-inclusive seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000002'),5000,'Legacy personal Plus includes five thousand seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000003'),5000,'Personal Pro includes five thousand seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000004'),5000,'Personal Premium includes five thousand seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000005'),50,'Business-only promotion membership grants no personal seats');
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000006'),50,'Expired personal membership falls back to fifty');

insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,room_preview)
select ('ca520000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'capacity-test',31995,'Capacity fixture '||n,'Synthetic local test',current_date,'{"eventKind":"group","cadence":"weekly","capacity":8,"memberCount":1}'
from generate_series(1,7)n;

select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"tier":"premium"}}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000001','group',p_cadence=>'weekly',p_capacity=>50)$$,'Free50 is accepted through the real configuration RPC');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000001','group',p_cadence=>'weekly',p_capacity=>51)$$,'P0001','INVALID_EVENT_CAPACITY','Direct RPC and client claims cannot grant Free51');
select lives_ok($$select public.create_chilling_event('capacity-test','New Free50','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":50}','Question?')$$,'The create RPC also accepts Free50');
select throws_ok($$select public.create_chilling_event('capacity-test','Rejected Free51','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":51}','Question?')$$,'P0001','INVALID_EVENT_CAPACITY','Direct create RPC cannot bypass the free boundary');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>5000)$$,'P0001','MEETUP_NOT_FOUND','Another host cannot borrow a paid owner capacity');
reset role;

do $$
declare n integer; id uuid;
begin
  for n in 2..4 loop
    id:=('ca500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true);
    perform public.configure_chilling_event(('ca520000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'group',p_cadence=>'weekly',p_capacity=>5000);
  end loop;
end;
$$;
select is((select count(*)::integer from public.posts where id::text like 'ca520000%' and room_preview->>'capacity'='5000'),3,'All personal paid tiers can choose exactly5000 through the RPC');
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000003','group',p_cadence=>'weekly',p_capacity=>5001)$$,'P0001','INVALID_EVENT_CAPACITY','Paid5001 is rejected through the RPC');
select lives_ok($$select public.create_chilling_event('capacity-test','New paid5000','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":5000}','Question?')$$,'The create RPC accepts paid5000');
select throws_ok($$select public.create_chilling_event('capacity-test','Rejected paid5001','Synthetic local test','{"eventKind":"group","cadence":"weekly","capacity":5001}','Question?')$$,'P0001','INVALID_EVENT_CAPACITY','The create RPC rejects paid5001');
reset role;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000005','group',p_cadence=>'weekly',p_capacity=>51)$$,'P0001','INVALID_EVENT_CAPACITY','Business-only plan cannot configure51');
reset role;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000006','group',p_cadence=>'weekly',p_capacity=>50)$$,'Expired paid account can still choose50');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000006','group',p_cadence=>'weekly',p_capacity=>51)$$,'P0001','INVALID_EVENT_CAPACITY','Expired paid account cannot choose51');
reset role;
update public.profiles set account_status='suspended' where id='ca500000-0000-4000-8000-000000000007';
select is(private.meetup_capacity_limit('ca500000-0000-4000-8000-000000000007'),50,'Inactive paid account falls back to fifty');
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000007','group',p_cadence=>'weekly',p_capacity=>50)$$,'P0001','ACCOUNT_LOCKED','Capacity policy retains account locks');
reset role;
select throws_ok($$update public.posts set room_preview=room_preview||'{"capacity":51}' where id='ca520000-0000-4000-8000-000000000001'$$,'P0001','INVALID_EVENT_CAPACITY','Even a direct privileged table write obeys the host plan');
select throws_ok($$update public.posts set room_preview=room_preview||'{"capacity":5000.5}' where id='ca520000-0000-4000-8000-000000000003'$$,'P0001','INVALID_EVENT_CAPACITY','Fractional capacity cannot bypass validation');

-- Synthetic approved rows exercise real member/slot triggers; no participant or room is copied.
insert into public.meetup_requests(id,post_id,host_id,requester_id,status)
select ('ca530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ca520000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000003',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(1,4998)n;
insert into public.meetup_requests(id,post_id,host_id,requester_id,status)
select ('ca530000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ca520000-0000-4000-8000-000000000003','ca500000-0000-4000-8000-000000000003',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'pending' from generate_series(4999,5000)n;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request('ca530000-0000-4000-8000-000000004999','approved')$$,'The real approval RPC fills paid seat5000');
select throws_ok($$select public.respond_meetup_request('ca530000-0000-4000-8000-000000005000','approved')$$,'P0001','MEETUP_FULL','The next approval cannot overfill5000');
select is(jsonb_array_length(public.get_chilling_roster('ca520000-0000-4000-8000-000000000003')),5000,'Scoped roster includes every one of the5000 participants');
select is((select count(*)::integer from public.get_conversation_members((select id from public.conversations where group_post_id='ca520000-0000-4000-8000-000000000003'))),5000,'Group-chat roster is not truncated to fifty');
reset role;

-- The existing Free50 room survives at its full host-inclusive capacity.
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select 'ca520000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(1,49)n;
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000001','group',p_cadence=>'updated weekly',p_capacity=>50)$$,'Existing fifty-member room remains editable');
reset role;
select is((select count(*)::integer+1 from public.meetup_requests where post_id='ca520000-0000-4000-8000-000000000001' and status='approved'),50,'No existing participant was removed');
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('ca520000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','ca510000-0000-4000-8000-000000000050','approved')$$,'P0001','MEETUP_FULL','Free approval cannot allocate seat51');

-- Choose5000 while paid, then expire with51 members and one earlier pending request.
insert into public.meetup_requests(post_id,host_id,requester_id,status)
select 'ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004',
  ('ca510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'approved' from generate_series(1,50)n;
insert into public.meetup_requests(id,post_id,host_id,requester_id,status) values
 ('ca540000-0000-4000-8000-000000000051','ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004','ca510000-0000-4000-8000-000000000051','pending');
update private.membership_accounts set entitlements=jsonb_set(entitlements,'{0,expires_at}',to_jsonb((now()-interval '1 day')::text)) where user_id='ca500000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000004','group',p_cadence=>'still weekly',p_capacity=>5000)$$,'Expiry permits ordinary edits without silently shrinking the room');
select throws_ok($$select public.configure_chilling_event('ca520000-0000-4000-8000-000000000004','group',p_cadence=>'still weekly',p_capacity=>50)$$,'P0001','EVENT_CAPACITY_BELOW_MEMBERS','Downgrade cannot shrink below existing members');
select throws_ok($$select public.respond_meetup_request('ca540000-0000-4000-8000-000000000051','approved')$$,'P0001','MEETUP_HOST_CAPACITY_LIMIT','Expiry blocks approval above fifty despite the recorded5000');
reset role;
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004','ca510000-0000-4000-8000-000000000052','approved')$$,'P0001','MEETUP_HOST_CAPACITY_LIMIT','A direct instant approval cannot bypass the expired host policy');
select throws_ok($$insert into public.meetup_requests(post_id,host_id,requester_id,status) values('ca520000-0000-4000-8000-000000000004','ca500000-0000-4000-8000-000000000004','ca510000-0000-4000-8000-000000000052','pending')$$,'P0001','MEETUP_HOST_CAPACITY_LIMIT','A new pending join observes the same current host limit');
select is((select count(*)::integer+1 from public.meetup_requests where post_id='ca520000-0000-4000-8000-000000000004' and status='approved'),51,'Downgrade retains all existing members');
select lives_ok($$update public.posts set room_preview=room_preview||'{"capacity":4000}' where id='ca520000-0000-4000-8000-000000000004'$$,'A downgrade may reduce the recorded capacity without evicting anyone');
select throws_ok($$update public.posts set room_preview=room_preview||'{"capacity":4001}' where id='ca520000-0000-4000-8000-000000000004'$$,'P0001','INVALID_EVENT_CAPACITY','Grandfathering does not authorize a new increase');
select set_config('request.jwt.claims','{"sub":"ca510000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('ca520000-0000-4000-8000-000000000004')$$,'Existing member can leave a downgraded large room');
reset role;
update private.membership_accounts set entitlements=jsonb_set(entitlements,'{0,expires_at}',to_jsonb((now()+interval '1 day')::text)) where user_id='ca500000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.respond_meetup_request('ca540000-0000-4000-8000-000000000051','approved')$$,'Reactivated personal membership permits another member');
reset role;
update private.membership_accounts set entitlements='[]' where user_id='ca500000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"ca500000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.leave_meetup('ca520000-0000-4000-8000-000000000004')$$,'A downgraded host can still close the room');
reset role;

select ok(not has_function_privilege('anon','private.meetup_capacity_limit(uuid)','execute'),'Capacity policy exposes no anonymous membership oracle');
select ok(not has_function_privilege('authenticated','private.meetup_capacity_limit(uuid)','execute'),'Clients cannot inspect another host private billing helper');
select ok(not has_function_privilege('service_role','private.guard_meetup_capacity_admission()','execute'),'Trigger entry point is not granted as a service RPC');
select * from finish();
rollback;
