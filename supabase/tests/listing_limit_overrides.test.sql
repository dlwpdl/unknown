begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('d4800000-0000-4000-8000-000000000001','limit-override@example.test','{}'),
 ('d4800000-0000-4000-8000-000000000002','limit-default@example.test','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'한도'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like 'd4800000-%';

select is(private.listing_limit('d4800000-0000-4000-8000-000000000001'),5,'a free member starts at the default limit');
insert into private.listing_limit_overrides(user_id,listing_limit,note) values('d4800000-0000-4000-8000-000000000001',1000,'Synthetic rollback-only test');
select is(private.listing_limit('d4800000-0000-4000-8000-000000000001'),1000,'an override replaces the membership limit');
select is(private.listing_limit('d4800000-0000-4000-8000-000000000002'),5,'members without an override keep their membership limit');
select throws_ok($$insert into private.listing_limit_overrides(user_id,listing_limit) values('d4800000-0000-4000-8000-000000000002',1001)$$,'23514',null,'the override stays within the admin ceiling');
select ok(not has_table_privilege('authenticated','private.listing_limit_overrides','select'),'signed-in members cannot read overrides');
select ok(not has_table_privilege('authenticated','private.listing_limit_overrides','insert'),'signed-in members cannot grant themselves an override');
delete from auth.users where id='d4800000-0000-4000-8000-000000000001';
select is((select count(*) from private.listing_limit_overrides where user_id='d4800000-0000-4000-8000-000000000001')::int,0,'deleting the account removes its override');
select * from finish();
rollback;
