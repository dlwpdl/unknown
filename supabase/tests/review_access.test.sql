begin;
select plan(14);

select is(public.gling_before_user_created('{"user":{"app_metadata":{"provider":"kakao"}}}'), '{}'::jsonb, 'Kakao signup remains open');
select is(public.gling_before_user_created('{"user":{"app_metadata":{"provider":"apple"}}}'), '{}'::jsonb, 'Apple signup remains open');
select is(public.gling_before_user_created('{"user":{"app_metadata":{"provider":"email"},"user_metadata":{"review_access":true,"role":"admin"}}}') #>> '{error,http_code}', '403', 'public email signup cannot spoof trusted metadata');

insert into auth.users (id, email, raw_app_meta_data) values
('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'review-access-test@example.com', '{"provider":"email","review_access":true}'),
('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'review-access-member@example.com', '{"provider":"email"}'),
('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'review-access-social@example.com', '{"provider":"kakao"}'),
('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'review-access-admin@example.com', '{"provider":"email","role":"admin"}');

select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","authentication_method":"password","claims":{"role":"authenticated"}}'), '{"claims":{"role":"authenticated"}}'::jsonb, 'review password keeps ordinary claims');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","authentication_method":"token_refresh","claims":{}}'), '{"claims":{}}'::jsonb, 'review sessions refresh');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2","authentication_method":"password","claims":{"app_metadata":{"review_access":true}}}') #>> '{error,http_code}', '403', 'unapproved email and forged claims are denied');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","authentication_method":"oauth","claims":{}}'), '{"claims":{}}'::jsonb, 'social login is allowed');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","authentication_method":"password","claims":{}}') #>> '{error,http_code}', '403', 'adding a password to Kakao does not bypass the restriction');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","authentication_method":"token_refresh","claims":{"amr":[{"method":"oauth"}]}}') -> 'claims', '{"amr":[{"method":"oauth"}]}'::jsonb, 'social sessions refresh');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","authentication_method":"token_refresh","claims":{"amr":[{"method":"password"}]}}') #>> '{error,http_code}', '403', 'old non-social sessions cannot refresh');
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4","authentication_method":"password","claims":{}}'), '{"claims":{}}'::jsonb, 'existing admin authentication remains available');

update auth.users set raw_app_meta_data = '{"provider":"email"}' where id = '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
select is(public.gling_access_token_hook('{"user_id":"9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","authentication_method":"token_refresh","claims":{"app_metadata":{"review_access":true}}}') #>> '{error,http_code}', '403', 'revoking the marker denies refresh despite old claims');
select ok(not has_function_privilege('anon', 'public.gling_before_user_created(jsonb)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.gling_access_token_hook(jsonb)', 'EXECUTE'), 'public clients cannot invoke auth hooks');

select ok(has_function_privilege('supabase_auth_admin', 'public.gling_access_token_hook(jsonb)', 'EXECUTE') and has_table_privilege('supabase_auth_admin', 'auth.users', 'SELECT'), 'Auth service has only the required hook and metadata permissions');
select * from finish();
rollback;
