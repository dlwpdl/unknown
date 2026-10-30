begin;
set local search_path=public,extensions;
select no_plan();

-- 01 admin · 02 member · 03 business owner · 04 plain member (non-admin caller) · 05 unverified owner · 06 invitee placeholder
create function pg_temp.u(n int) returns uuid language sql as $$ select ('d9700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.m(n int) returns uuid language sql as $$ select ('d9710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into public.cities(id,name,province,timezone,is_open) values('admin-grant-test','지급검사','BC','America/Vancouver',true) on conflict do nothing;
insert into auth.users(id,email,raw_app_meta_data) select pg_temp.u(n),'admin-grant-'||n||'@example.test',
  case when n=1 then '{"role":"admin"}'::jsonb else '{}'::jsonb end from generate_series(1,6) n;
insert into auth.sessions(id,user_id,aal) values('d9800000-0000-4000-8000-000000000001',pg_temp.u(1),'aal2');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
  select pg_temp.u(n),'지급'||n,'admin-grant-test',now(),now(),now(),'test' from generate_series(1,6) n;
insert into private.admin_ids(user_id) values(pg_temp.u(1));
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 (pg_temp.m(1),'지급검사 가게','admin-grant-test','604-555-0100','lead','granted','Synthetic rollback-only test',pg_temp.u(3),now(),'business'),
 (pg_temp.m(2),'지급검사 미확인','admin-grant-test','604-555-0101','lead','granted','Synthetic rollback-only test',pg_temp.u(5),null,'business'),
 (pg_temp.m(3),'지급검사 둘째','admin-grant-test','604-555-0102','lead','granted','Synthetic rollback-only test',pg_temp.u(3),now(),'business');

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims','{"sub":"d9700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"d9800000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true) $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Vancouver')::date $$;
grant execute on function pg_temp.as_admin(),pg_temp.today(),pg_temp.u(int),pg_temp.m(int) to anon,authenticated;

-- Callers other than an MFA admin are refused.
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.get_admin_membership(pg_temp.u(2))$$,'42501',null,'anonymous callers cannot read memberships');
reset role;
select set_config('request.jwt.claims','{"sub":"d9700000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_membership(pg_temp.u(4),null,'premium',pg_temp.today()+30)$$,'P0001','ADMIN_REQUIRED','a member with a forged admin claim cannot grant themselves a membership');
select throws_ok($$select public.get_admin_membership(pg_temp.u(2))$$,'P0001','ADMIN_REQUIRED','a member cannot read another member''s membership');
select throws_ok($$select public.clear_admin_membership(pg_temp.u(2),null)$$,'P0001','ADMIN_REQUIRED','a member cannot clear a membership');
reset role;
select set_config('request.jwt.claims','{"sub":"d9700000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"d9800000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select throws_ok($$select public.set_admin_membership(pg_temp.u(2),null,'plus',pg_temp.today()+30)$$,'P0001','ADMIN_REQUIRED','granting requires a two-step verified admin session');
reset role;

-- Personal membership.
select pg_temp.as_admin();
set local role authenticated;
select is(public.get_admin_membership(pg_temp.u(2))->'personal'->>'source','free','a member starts on free');
select throws_ok($$select public.set_admin_membership(pg_temp.u(2),null,'free',pg_temp.today()+30)$$,'P0001','INVALID_MEMBERSHIP_TIER','free is not a grant');
select throws_ok($$select public.set_admin_membership(pg_temp.u(2),null,'plus',pg_temp.today()-1)$$,'P0001','INVALID_MEMBERSHIP_EXPIRY','a past end date is refused');
select is(public.set_admin_membership(pg_temp.u(2),null,'plus',pg_temp.today()+30,'오픈 이벤트')->'personal'->>'tier','plus','the admin grants plus');
select is(public.get_admin_membership(pg_temp.u(2))->'personal'->>'source','admin','the grant is shown as an admin grant');
select is(public.get_admin_membership(pg_temp.u(2))->'personal'->'grant'->>'created_by','지급1','the grant records who gave it');
reset role;
select is(private.membership_details(pg_temp.u(2))->>'store','admin','the member''s own membership reads store admin');
select is(private.membership_details(pg_temp.u(2))->'willRenew','false'::jsonb,'an admin grant never renews');
select is((private.membership_details(pg_temp.u(2))->>'meetupLimit')::int,5,'plus limits apply');
select is((private.membership_details(pg_temp.u(2))->>'expiresAt')::timestamptz,
  ((pg_temp.today()+31)::timestamp at time zone 'America/Vancouver')-interval '1 second','the grant lasts to the end of the chosen local day');

-- Invite reward overlap: the higher tier wins either way.
insert into private.invite_rewards(user_id,kind,tier,days,starts_at,ends_at,invitee_id,reason)
  values(pg_temp.u(2),'general','pro',14,now()-interval '1 hour',now()+interval '13 days',pg_temp.u(6),'attended');
select is(private.membership_details(pg_temp.u(2))->>'store','reward','a higher invite reward wins over a lower admin grant');
select pg_temp.as_admin();
set local role authenticated;
select is(public.set_admin_membership(pg_temp.u(2),null,'premium',pg_temp.today()+30)->'personal'->>'source','admin','a higher admin grant wins over the invite reward');
reset role;

-- A higher paid plan wins; an equal paid plan wins the tie.
insert into private.membership_accounts(user_id,entitlements,observed_at) values
 (pg_temp.u(2),jsonb_build_array(jsonb_build_object('tier','premium','kind','general','plan_version','2','store','app_store','product_id','com.dlwpdl.gling.general.premium.monthly.v2','will_renew',true,'expires_at',now()+interval '20 days')),now());
select is(private.membership_details(pg_temp.u(2))->>'store','app_store','an equal paid plan wins over the admin grant');
update private.membership_accounts set entitlements=jsonb_build_array(jsonb_build_object('tier','plus','kind','general','plan_version','2','store','app_store','product_id','com.dlwpdl.gling.general.plus.monthly.v2','will_renew',true,'expires_at',now()+interval '20 days')) where user_id=pg_temp.u(2);
select is(private.membership_details(pg_temp.u(2))->>'tier','premium','a higher admin grant shows over a lower paid plan');

-- Expiry falls back to the next best source.
update private.admin_membership_grants set expires_at=now()-interval '1 minute' where user_id=pg_temp.u(2);
select is(private.membership_details(pg_temp.u(2))->>'store','reward','after the grant ends the member falls back to the invite reward');
delete from private.invite_rewards where user_id=pg_temp.u(2);
select is(private.membership_details(pg_temp.u(2))->>'store','app_store','and then to the paid plan');
select pg_temp.as_admin();
set local role authenticated;
select is(public.get_admin_membership(pg_temp.u(2))->'personal'->'grant'->>'active','false','an ended grant stays visible as ended');

-- Clearing.
select is(public.set_admin_membership(pg_temp.u(2),null,'pro',pg_temp.today())->'personal'->>'tier','pro','a grant can end today');
select is(public.clear_admin_membership(pg_temp.u(2),null,'테스트 해제')->'personal'->'grant','null'::jsonb,'clearing removes the grant');
select is(public.get_admin_membership(pg_temp.u(2))->'personal'->>'source','store','clearing returns the member to the paid plan');
select is(jsonb_array_length(public.clear_admin_membership(pg_temp.u(2),null)->'history'),4,'a repeated clear adds no history row');
reset role;

-- Business membership.
select pg_temp.as_admin();
set local role authenticated;
select throws_ok($$select public.set_admin_membership(pg_temp.u(5),pg_temp.m(2),'pro',pg_temp.today()+30)$$,'P0001','MERCHANT_OWNER_VERIFICATION_REQUIRED','an unverified owner''s business cannot get a grant');
select throws_ok($$select public.set_admin_membership(pg_temp.u(2),pg_temp.m(1),'pro',pg_temp.today()+30)$$,'P0001','MERCHANT_NOT_FOUND','a business is granted only through its owner');
select is(public.get_admin_membership(pg_temp.u(3))->'businesses'->0->>'tier','free','the business starts free');
select is((select b->>'source' from jsonb_array_elements(public.set_admin_membership(pg_temp.u(3),pg_temp.m(1),'pro',pg_temp.today()+30)->'businesses') b where b->>'merchant_id'=pg_temp.m(1)::text),'admin','the admin grants the business pro');
select throws_ok($$select public.set_admin_membership(pg_temp.u(3),pg_temp.m(3),'plus',pg_temp.today()+30)$$,'P0001','BUSINESS_SUBSCRIPTION_BOUND','an owner''s second business cannot share the one business membership');
reset role;
select is(private.business_membership_details(pg_temp.m(1))->>'tier','pro','business limits follow the grant');
select is((private.business_membership_details(pg_temp.m(1))->>'postLimit')::int,5,'pro post limit applies');
select is(private.merchant_workspace_plan(pg_temp.m(1)),'pro','a granted business gets the paid workspace tools');
select is(private.membership_entitlement(pg_temp.u(3),'business')->>'store','admin','the owner''s app sees the business grant');
select is(private.membership_details(pg_temp.u(3))->>'tier','free','a business grant does not change the owner''s personal membership');
update private.admin_membership_grants set expires_at=now()-interval '1 minute' where merchant_id=pg_temp.m(1);
select is(private.business_membership_details(pg_temp.m(1))->>'tier','free','the business returns to free after the grant ends');

-- Audit.
select ok((select count(*) from public.admin_access_logs where actor_id=pg_temp.u(1) and scope='user_detail' and subject_user_id=pg_temp.u(2))>=5,'every admin read and change is logged');
select is((select count(*) from private.admin_membership_grants where created_by=pg_temp.u(1)),5::bigint,'each grant and clear keeps a history row with its author');
select * from finish();
rollback;
