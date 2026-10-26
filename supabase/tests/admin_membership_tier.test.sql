begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('d4700000-0000-4000-8000-000000000001','tier-admin@example.test','{"role":"admin","merchant_enabled":true}'),
 ('d4700000-0000-4000-8000-000000000002','tier-member@example.test','{"merchant_enabled":true}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'관리등급'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like 'd4700000-%';
insert into private.admin_ids(user_id) values('d4700000-0000-4000-8000-000000000001');
insert into private.merchants(id,name,city_id,contact,status,consent,consent_note,owner_id,owner_verified_at,record_kind) values
 ('d4710000-0000-4000-8000-000000000001','Admin business','vancouver','c','lead','granted','Synthetic rollback-only test','d4700000-0000-4000-8000-000000000001',now(),'business'),
 ('d4710000-0000-4000-8000-000000000002','Member business','vancouver','c','lead','granted','Synthetic rollback-only test','d4700000-0000-4000-8000-000000000002',now(),'business');

select is(private.membership_details('d4700000-0000-4000-8000-000000000001')->>'tier','admin','the operator account has the personal admin tier');
select is(private.membership_details('d4700000-0000-4000-8000-000000000002')->>'tier','free','other accounts keep their own tier');
select is(private.meetup_tool_tier('d4700000-0000-4000-8000-000000000001'),'admin','admin never expires for meetup tools');
select lives_ok($$select private.require_meetup_tool_tier('d4700000-0000-4000-8000-000000000001','premium')$$,'admin passes every meetup tool gate');
select throws_ok($$select private.require_meetup_tool_tier('d4700000-0000-4000-8000-000000000002','plus')$$,'P0001','PLUS_REQUIRED','free members are still gated');
select is(private.business_membership_details('d4710000-0000-4000-8000-000000000001')->>'tier','admin','the operator business has the business admin tier');
select ok(private.business_membership_details('d4710000-0000-4000-8000-000000000001')->'postLimit'='null'::jsonb,'admin business posts are unlimited');
select ok(private.business_membership_details('d4710000-0000-4000-8000-000000000001')->'bumpLimit'='null'::jsonb,'admin business bumps are unlimited');
select is(private.business_membership_details('d4710000-0000-4000-8000-000000000002')->>'tier','free','other businesses keep their tier');
select is(private.merchant_workspace_plan('d4710000-0000-4000-8000-000000000001'),'pro','admin business has every paid feature');
select is(private.business_operator_limit('d4710000-0000-4000-8000-000000000001'),1000,'admin business co-managers are effectively unlimited');
select is(private.meetup_capacity_limit('d4700000-0000-4000-8000-000000000001'),5000,'admin meetups get the maximum seats');
select lives_ok($$select private.consume_business_usage('d4710000-0000-4000-8000-000000000001','post',gen_random_uuid(),'admin-'||n) from generate_series(1,5)n$$,'admin business publishes past the free monthly cap');
select throws_ok($$select private.consume_business_usage('d4710000-0000-4000-8000-000000000002','post',('d4720000-0000-4000-8000-00000000000'||n)::uuid,'member-'||n) from generate_series(1,2)n$$,'P0001','BUSINESS_MONTHLY_LIMIT_REACHED','a free business is still capped at one post');
select * from finish();
rollback;
