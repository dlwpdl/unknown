begin;

select plan(8);

select has_column('public', 'profiles', 'terms_accepted_at', 'terms acceptance is recorded');
select has_column('public', 'profiles', 'privacy_accepted_at', 'privacy acceptance is recorded');
select has_column('public', 'profiles', 'ai_safety_consent_at', 'third-party AI consent is recorded');
select has_function('public', 'accept_launch_terms', array['text'], 'users can explicitly accept the current notices');
select has_function('public', 'create_profile_with_consent', array['text', 'text', 'text', 'text'], 'profile creation and consent are atomic');
select has_function('public', 'configure_safety_monitor', array['text', 'text'], 'service role can configure the scheduled worker');

insert into auth.users (id, email, raw_app_meta_data)
values ('8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'consent-user@example.com', '{}');
insert into public.profiles (id, nickname, city_id)
values ('8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '동의테스트', 'vancouver');

select set_config('request.jwt.claims', '{"sub":"8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.accept_launch_terms('2026-09-02')$$,
  'authenticated user can record explicit consent'
);
reset role;

select results_eq(
  $$select consent_version from public.profiles where id = '8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and terms_accepted_at is not null and privacy_accepted_at is not null and ai_safety_consent_at is not null$$,
  array['2026-09-02'],
  'all required consent timestamps and version are stored together'
);

select * from finish();
rollback;
