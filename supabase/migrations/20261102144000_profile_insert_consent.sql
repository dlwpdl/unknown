-- Security audit 2026-11-02 (db-profile-insert): the 0002 mock-data grant let a member create an active profile directly,
-- skipping the terms/privacy/AI-safety consent and the admin signup alert. Every shipped app signs up through
-- public.create_profile_with_consent (security definer), so the direct path is closed.
drop policy if exists "users create own profile" on public.profiles;
revoke insert on public.profiles from anon, authenticated;
