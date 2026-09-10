begin;
select plan(10);

select has_function('public', 'get_membership', array[]::text[], 'membership is read through an authenticated RPC');
select has_function('public', 'apply_membership_snapshot', array['uuid', 'jsonb', 'timestamp with time zone'], 'verified snapshots have a server-only write path');

insert into auth.users (id, email) values ('71111111-1111-1111-1111-111111111111', 'membership-test@example.com');
insert into public.profiles (id, nickname, city_id) values ('71111111-1111-1111-1111-111111111111', '구독검증사용자', 'vancouver');
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_membership()->>'tier', 'free', 'new members stay free');
select is((select max_count::integer from public.get_post_quota()), 1, 'free members get one daily post');
select throws_ok($$select public.apply_membership_snapshot('71111111-1111-1111-1111-111111111111', '[]', now())$$, '42501', null, 'clients cannot grant themselves paid membership');
reset role;

select public.apply_membership_snapshot('71111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('tier','plus','expires_at',now()+interval '30 days','product_id','plus_monthly','store','app_store','will_renew',true)), now()-interval '10 seconds');
set local role authenticated;
select is((select max_count::integer from public.get_post_quota()), 2, 'verified plus changes the existing post quota');
reset role;

select public.apply_membership_snapshot('71111111-1111-1111-1111-111111111111', '[]', now()-interval '20 seconds');
set local role authenticated;
select is(public.get_membership()->>'tier', 'plus', 'older responses cannot overwrite a newer purchase');
reset role;

select public.apply_membership_snapshot('71111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()+interval '30 days','product_id','premium_monthly','store','app_store','will_renew',false)), now()-interval '5 seconds');
set local role authenticated;
select is((select max_count::integer from public.get_post_quota()), 5, 'cancelled renewal retains premium for the paid period');
reset role;

select public.apply_membership_snapshot('71111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('tier','premium','expires_at',now()-interval '1 second','product_id','premium_monthly','store','app_store','will_renew',false)), now()-interval '3 seconds');
set local role authenticated;
select is((select max_count::integer from public.get_post_quota()), 1, 'expired membership drops to free without relying on a webhook');
reset role;

select public.apply_membership_snapshot('71111111-1111-1111-1111-111111111111', '[]', now());
set local role authenticated;
select is(public.get_membership()->>'tier', 'free', 'empty verified state revokes refunded membership');
reset role;
select * from finish();
rollback;
