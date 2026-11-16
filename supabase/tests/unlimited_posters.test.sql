begin;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data) values
 ('d4800000-0000-4000-8000-000000000001','unlimited-poster@example.test','{}'),
 ('d4800000-0000-4000-8000-000000000002','limited-poster@example.test','{}');
insert into public.profiles(id,nickname,city_id,terms_accepted_at,privacy_accepted_at,ai_safety_consent_at,consent_version)
 select id,'한도'||right(id::text,4),'vancouver',now(),now(),now(),'test' from auth.users where id::text like 'd4800000-%';

select is(private.listing_limit('d4800000-0000-4000-8000-000000000001'),5,'a free member starts at the default listing limit');
insert into private.unlimited_posters(user_id,note) values('d4800000-0000-4000-8000-000000000001','Synthetic rollback-only test');
select is(private.listing_limit('d4800000-0000-4000-8000-000000000001'),1000,'an unlimited poster gets the admin listing ceiling');
select is(private.listing_limit('d4800000-0000-4000-8000-000000000002'),5,'other members keep their membership listing limit');

select set_config('request.jwt.claims','{"sub":"d4800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select private.enforce_rate_limit('story_post',10,interval '10 minutes') from generate_series(1,15)$$,'an unlimited poster is not stopped after 10 posts in 10 minutes');
select lives_ok($$select private.enforce_rate_limit('send_message',2,interval '10 minutes') from generate_series(1,2)$$,'other actions still count for an unlimited poster');
select throws_ok($$select private.enforce_rate_limit('send_message',2,interval '10 minutes')$$,'P0001','RATE_LIMITED','other rate limits still apply to an unlimited poster');
select set_config('request.jwt.claims','{"sub":"d4800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select private.enforce_rate_limit('story_post',10,interval '10 minutes') from generate_series(1,11)$$,'P0001','RATE_LIMITED','other members still hit the posting rate limit');

select ok(not has_table_privilege('authenticated','private.unlimited_posters','select'),'signed-in members cannot read the list');
select ok(not has_table_privilege('authenticated','private.unlimited_posters','insert'),'signed-in members cannot add themselves');
delete from private.action_rate_events where user_id='d4800000-0000-4000-8000-000000000001';
delete from auth.users where id='d4800000-0000-4000-8000-000000000001';
select is((select count(*) from private.unlimited_posters where user_id='d4800000-0000-4000-8000-000000000001')::int,0,'deleting the account removes it from the list');
select * from finish();
rollback;
