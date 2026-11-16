begin;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values('e1000000-0000-4000-8000-000000000001','signup-source@example.invalid');

select ok(not has_function_privilege('anon','public.record_signup_source(text)','execute'),'anon cannot execute');
select ok(has_function_privilege('authenticated','public.record_signup_source(text)','execute'),'authenticated can execute');
select ok(not has_table_privilege('authenticated','private.signup_source_answers','select'),'table is closed to members');

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.record_signup_source('instagram')$$,'AUTH_REQUIRED','signed-out call fails');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.record_signup_source('tv')$$,'INVALID_SIGNUP_SOURCE','unknown answer fails');
select lives_ok($$select public.record_signup_source('naver')$$,'first answer is saved');
select lives_ok($$select public.record_signup_source('kakao')$$,'second answer is ignored without error');
reset role;
select is((select count(*) from private.signup_source_answers where user_id='e1000000-0000-4000-8000-000000000001'),1::bigint,'one row');
select is((select answer from private.signup_source_answers where user_id='e1000000-0000-4000-8000-000000000001'),'naver','first answer kept');
delete from auth.users where id='e1000000-0000-4000-8000-000000000001';
select is((select count(*) from private.signup_source_answers),0::bigint,'deleting the account removes the answer');
select * from finish();
rollback;
