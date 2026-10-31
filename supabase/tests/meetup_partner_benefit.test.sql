begin;
set local search_path=public,extensions;
select no_plan();

-- 1 admin (MFA) · 2 real host · 3 member M1 · 4 member M2 · 5 persona · 6 first-time host · 7 member M3 · 8 plain member
create function pg_temp.u(n int) returns uuid language sql as $$ select ('a9e00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.p(n int) returns uuid language sql as $$ select ('a9e20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql as $$ select ('a9e30000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.b(n int) returns uuid language sql as $$ select ('a9e10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated')::text,true) $$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims','{"sub":"a9e00000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a9e40000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true) $$;
grant execute on function pg_temp.u(int),pg_temp.p(int),pg_temp.s(int),pg_temp.b(int),pg_temp.as_user(int),pg_temp.as_admin() to anon,authenticated;

insert into public.cities(id,name,province,timezone,is_open) values('partner-test','제휴검사','BC','America/Vancouver',true) on conflict do nothing;
insert into public.tags(id,slug,label,kind) values(31997,'partner-test','제휴검사','meetup') on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select pg_temp.u(n),'partner-'||n||'@example.test',
  case n when 1 then '{"role":"admin"}'::jsonb when 5 then '{"gling_persona":{"kind":"gling_operated_character"}}'::jsonb else '{}'::jsonb end
  from generate_series(1,8) n;
insert into auth.sessions(id,user_id,aal) values('a9e40000-0000-4000-8000-000000000001',pg_temp.u(1),'aal2');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
  select pg_temp.u(n),'제휴'||n,'partner-test',now(),now(),now(),'test' from generate_series(1,8) n;
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,record_kind,deleted_at) values
 (pg_temp.b(1),'지모코','partner-test','604-555-0100','lead','granted','Synthetic rollback-only test','business',null),
 (pg_temp.b(2),'삭제된 가게','partner-test','604-555-0101','lead','granted','Synthetic rollback-only test','business',now());
-- The public profile needs linked live posts; only that inner lookup is stubbed, the outer visibility rules stay real.
create or replace function private.business_base_get_merchant_profile(p_merchant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',id,'name',name) from private.merchants where id=p_merchant_id $$;

-- Fixture rows skip the hosting-frequency and slot triggers only here.
set local session_replication_role=replica;
insert into public.posts(id,author_id,city_id,tag_id,title,body,posted_on,created_at,room_preview) values
 (pg_temp.p(1),pg_temp.u(2),'partner-test',31997,'공식 밋업','합성 테스트',current_date,now()-interval '20 days','{"eventKind":"group","cadence":"매주 목요일","capacity":10,"memberCount":3}'),
 (pg_temp.p(2),pg_temp.u(6),'partner-test',31997,'첫 호스트 모임','합성 테스트',current_date,now()-interval '2 days','{"eventKind":"group","cadence":"매주 토요일","capacity":10,"memberCount":2}'),
 (pg_temp.p(3),pg_temp.u(2),'partner-test',1,'일반 글','합성 테스트',current_date,now(),null);
insert into public.meetup_requests(post_id,host_id,requester_id,status,responded_at) values
 (pg_temp.p(1),pg_temp.u(2),pg_temp.u(3),'approved',now()),(pg_temp.p(1),pg_temp.u(2),pg_temp.u(4),'approved',now()),
 (pg_temp.p(1),pg_temp.u(2),pg_temp.u(7),'rejected',now()),(pg_temp.p(1),pg_temp.u(2),pg_temp.u(1),'pending',null),
 (pg_temp.p(1),pg_temp.u(2),pg_temp.u(5),'pending',null),(pg_temp.p(2),pg_temp.u(6),pg_temp.u(7),'approved',now());
set local session_replication_role=origin;

-- 1. Nobody but the admin RPC writes room_preview.partner.
select pg_temp.as_user(2);
update public.posts set room_preview=room_preview||'{"partner":{"businessId":"a9e10000-0000-4000-8000-000000000001","name":"가짜","benefit":"무료"}}' where id=pg_temp.p(1);
select is((select room_preview ? 'partner' from public.posts where id=pg_temp.p(1)),false,'a host edit cannot add a partner benefit');
select is((select room_preview->>'cadence' from public.posts where id=pg_temp.p(1)),'매주 목요일','the rest of the host edit is kept');

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료 1잔')$$,'42501',null,'anonymous callers cannot set a partner');
select throws_ok($$select public.admin_meetup_experiment_metrics()$$,'42501',null,'anonymous callers cannot read metrics');
reset role;
select pg_temp.as_user(8);
set local role authenticated;
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료 1잔')$$,'P0001','ADMIN_REQUIRED','a member cannot set a partner');
select throws_ok($$select public.admin_meetup_experiment_metrics()$$,'P0001','ADMIN_REQUIRED','a member cannot read metrics');
reset role;
-- Admin claims without a live AAL2 admin session are still refused.
select set_config('request.jwt.claims','{"sub":"a9e00000-0000-4000-8000-000000000008","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료 1잔')$$,'P0001','ADMIN_REQUIRED','forged admin claims are refused');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),' 음료   1잔 '),
  jsonb_build_object('businessId',pg_temp.b(1),'name','지모코','benefit','음료 1잔'),'the admin attaches the partner without a percent');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료',0)$$,'P0001','INVALID_PARTNER_PERCENT','0% is refused');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료',101)$$,'P0001','INVALID_PARTNER_PERCENT','over 100% is refused');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료',12.5)$$,'P0001','INVALID_PARTNER_PERCENT','fractional percents are refused');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'  ')$$,'P0001','INVALID_PARTNER_BENEFIT','an empty benefit without a percent is refused');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),repeat('가',61))$$,'P0001','INVALID_PARTNER_BENEFIT','an overlong benefit is refused');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(2),'음료')$$,'P0001','PARTNER_BUSINESS_NOT_FOUND','a deleted business is refused');
select throws_ok($$select public.admin_set_meetup_partner(pg_temp.p(3),pg_temp.b(1),'음료')$$,'P0001','MEETUP_NOT_FOUND','only meetups take a partner');
reset role;
select is((select count(*) from public.admin_access_logs where actor_id=pg_temp.u(1) and scope='posts' and resource_id=pg_temp.p(1)),1::bigint,'the change is in the admin access log');

-- A later host edit keeps the admin's partner, even when it drops the key.
select pg_temp.as_user(2);
update public.posts set room_preview=(room_preview-'partner')||'{"memberCount":4}' where id=pg_temp.p(1);
select is((select room_preview->'partner'->>'name' from public.posts where id=pg_temp.p(1)),'지모코','a host edit keeps the partner');
select is((select (room_preview->>'memberCount')::int from public.posts where id=pg_temp.p(1)),4,'and still applies its own change');

-- The percent can be added, changed and dropped any time.
select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료 1잔',10)->>'percent','10','the percent can be set');
select is(public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),null,15),jsonb_build_object('businessId',pg_temp.b(1),'name','지모코','percent',15),'a percent alone is allowed');
select is(public.admin_set_meetup_partner(pg_temp.p(1),null),null::jsonb,'null business clears it');
reset role;
select is((select room_preview ? 'partner' from public.posts where id=pg_temp.p(1)),false,'the cleared partner is gone');
select pg_temp.as_admin();
set local role authenticated;
select ok(public.admin_set_meetup_partner(pg_temp.p(1),pg_temp.b(1),'음료 1잔') is not null,'set again for the reads below');
reset role;

-- Anonymous readers get it through the existing public meetup read.
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is((select room_preview->'partner' from public.get_public_post(pg_temp.p(1))),
  jsonb_build_object('businessId',pg_temp.b(1),'name','지모코','benefit','음료 1잔'),'anonymous detail read carries the partner');
reset role;

-- 2. Check-in source: self, host, staff; it never changes after the first check-in.
insert into private.meetup_sessions(id,post_id,host_id,starts_at,ends_at) values
 (pg_temp.s(1),pg_temp.p(1),pg_temp.u(2),now()-interval '8 days',now()-interval '8 days'+interval '2 hours'),
 (pg_temp.s(2),pg_temp.p(1),pg_temp.u(2),now()-interval '1 day',now()-interval '1 day'+interval '2 hours'),
 (pg_temp.s(3),pg_temp.p(2),pg_temp.u(6),now()-interval '1 day',now()-interval '1 day'+interval '2 hours');
create function pg_temp.check_in(session uuid,actor int,attendee int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(actor);
  insert into private.meetup_attendance(session_id,user_id,checked_in_at) values(session,pg_temp.u(attendee),now())
    on conflict(session_id,user_id) do update set checked_in_at=coalesce(meetup_attendance.checked_in_at,excluded.checked_in_at);
end $$;
select pg_temp.check_in(pg_temp.s(1),2,2),pg_temp.check_in(pg_temp.s(1),3,3),pg_temp.check_in(pg_temp.s(1),3,4),pg_temp.check_in(pg_temp.s(1),5,5);
select pg_temp.check_in(pg_temp.s(2),2,3),pg_temp.check_in(pg_temp.s(2),4,4),pg_temp.check_in(pg_temp.s(3),7,7),pg_temp.check_in(pg_temp.s(3),6,6);
insert into private.meetup_attendance(session_id,user_id) values(pg_temp.s(2),pg_temp.u(2));
insert into private.meetup_attendance_confirmations(session_id,witness_id,attendee_id) values(pg_temp.s(2),pg_temp.u(2),pg_temp.u(4));
select is(array(select check_in_source from private.meetup_attendance where session_id=pg_temp.s(1) and user_id in(pg_temp.u(3),pg_temp.u(4)) order by user_id),
  array['self','staff'],'self and staff check-ins are told apart');
select is((select check_in_source from private.meetup_attendance where session_id=pg_temp.s(2) and user_id=pg_temp.u(3)),'host','a host check-in is recorded');
select pg_temp.check_in(pg_temp.s(1),2,3);
update private.meetup_attendance set claim_status='none' where session_id=pg_temp.s(1) and user_id=pg_temp.u(3);
select is((select check_in_source from private.meetup_attendance where session_id=pg_temp.s(1) and user_id=pg_temp.u(3)),'self','a repeat check-in or later update keeps the first source');
select is((select check_in_source from private.meetup_attendance where session_id=pg_temp.s(2) and user_id=pg_temp.u(2)),null,'no check-in, no source');

-- M3 and the first-time host share a device: a multi-account signal.
insert into private.account_security_devices(user_id,device_hash) values(pg_temp.u(7),repeat('ab',32)),(pg_temp.u(6),repeat('ab',32));

-- 3. Metrics exclude the persona, the admin requester and the host.
select pg_temp.as_admin();
set local role authenticated;
select throws_ok($$select public.admin_meetup_experiment_metrics(now(),now()-interval '1 day')$$,'P0001','INVALID_WINDOW','an empty window is refused');
select set_config('test.metrics',public.admin_meetup_experiment_metrics(now()-interval '10 days',null,'partner-test')::text,true);
reset role;
create function pg_temp.m() returns jsonb language sql as $$ select current_setting('test.metrics')::jsonb $$;
select is(jsonb_array_length(pg_temp.m()->'official'),1,'one official meetup');
select is(pg_temp.m()->'official'->0->'joinRequests',jsonb_build_object('total',3,'approved',2,'pending',0,'other',1),'join requests exclude the admin and persona');
select is(jsonb_array_length(pg_temp.m()->'official'->0->'sessions'),2,'both sessions in the window');
select is(pg_temp.m()->'official'->0->'sessions'->0->'attendees','2'::jsonb,'first session counts two real attendees, not the persona or host');
select is(pg_temp.m()->'official'->0->'sessions'->0->'checkInSource',jsonb_build_object('self',1,'host',0,'staff',1,'unknown',0),'first session check-in sources');
select is(pg_temp.m()->'official'->0->'sessions'->1->'repeatAttendees','2'::jsonb,'both second-session attendees came back');
select is(pg_temp.m()->'official'->0->'sessions'->0->'people'->0->'rewardEligible','false'::jsonb,'reward flag is false, not null, for a self check-in');
select is(pg_temp.m()->'official'->0->'sessions'->1->'rewardEligible','2'::jsonb,'host check-in and host witness are reward-eligible');
select is(pg_temp.m()->'official'->0->'sessions'->0->'rewardEligible','1'::jsonb,'a self check-in alone is not');
select is(pg_temp.m()->'totals'->'distinctAttendees','2'::jsonb,'distinct attendees');
select is(pg_temp.m()->'totals'->'repeatAttendees','2'::jsonb,'repeat attendees');
select is(pg_temp.m()->'totals'->'joinRequests','3'::jsonb,'window join requests');
select ok(pg_temp.m()::text !~ pg_temp.u(5)::text and pg_temp.m()::text !~ '제휴5','the persona appears nowhere');
select is(jsonb_array_length(pg_temp.m()->'newHosts'),1,'one first-time host');
select is(pg_temp.m()->'newHosts'->0->'attendees','1'::jsonb,'the first-time host had one real attendee');
select is(pg_temp.m()->'newHosts'->0->'hostMultiAccountWith',jsonb_build_array(pg_temp.u(7)),'the host shares a device with the attendee');
select is(pg_temp.m()->'totals'->'multiAccountFlagged','1'::jsonb,'one flagged attendee');
select is((select count(*) from public.admin_access_logs where actor_id=pg_temp.u(1) and scope='analytics'),1::bigint,'the metrics read is logged');

-- Explicit post ids and extra exclusions.
select pg_temp.as_admin();
set local role authenticated;
select is((public.admin_meetup_experiment_metrics(now()-interval '10 days',null,null,array[pg_temp.p(1)],array[pg_temp.u(3)])->'totals'->>'distinctAttendees'),'1','p_exclude drops an unmarked operator account');
reset role;

select * from finish();
rollback;
