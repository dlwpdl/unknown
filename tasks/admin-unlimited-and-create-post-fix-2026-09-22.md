# Admin unlimited accounts and story posting fix — 2026-09-22

Owner decided the admin account is not limited anywhere in the app, and that the earlier objection about abuse pacing was out of scope for the owner's own account.

## Admin exemption

- `supabase/migrations/0083_admin_meetup_bypass.sql`: meetup request pacing (60s, 5/day), the 12-hour leave block, the 24-hour early-close host block and the 3-per-day one-off hosting cap skip admins.
- `supabase/migrations/0084_admin_unlimited.sql`: every rate limit (`private.enforce_rate_limit`), the meetup slot cap, the daily story quota, the live listing allowance, bump and reopen cooldowns, 1:1 request cooldown and pending ceiling, 1:1 slot capacity on either side of an acceptance, and the AI draft allowance skip admins.
- Admin identity is the JWT `app_metadata.role = admin`. A session cannot read another member's claim, so the first admin action records the account in `private.admin_ids` and participant-side checks (a host approving an admin applicant, another member accepting an admin's 1:1 request) skip it too. `private.is_admin_id(uuid)` is the single entry point.
- Still enforced for admins: content moderation and watch terms, account status, blocking, reporting, and the membership tier shown in the app. Client-side pre-checks (story quota in the composer, meetup slot line in the create screen) are skipped for admins, and the membership screen labels the account as unlimited.

## Story posting was broken for everyone

`0066_chilling_host_limits_and_expiry.sql` appended an unqualified `room_preview is null` to the story quota query inside `create_post`, which collides with that function's local variable of the same name. Every story post raised `column reference "room_preview" is ambiguous` instead of being created, and four long-standing local test failures were the visible symptom. `supabase/migrations/0085_create_post_story_scope.sql` qualifies the column as `public.posts.room_preview`. Confirm whether production carries the 0066 function body; if it does, story writing is broken there too.

## Stale tests repaired

- `membership_limits.test.sql`: the three assertions that expected a 24-hour slot lock after leaving a meetup describe the behaviour 0065 retired. They now assert the seat returns at once and that the 12-hour participation block is the anti-abuse rule. 22/22 pass, all seven previously known failures gone.
- `relationship_slots.test.sql`: the batch-insert check ran as an admin account and asserted the free seat cap. It now asserts the cap for a normal member and that an admin may exceed it. 69/69 pass.
- `meetup_abuse_limits.test.sql`: the setup gave a free account three approved meetups, which the 2/4/7 limits reject, so the file never ran. The requester now holds a premium snapshot. 42/42 pass.
- `user_flow.test.sql`: the create_post signature assertion still listed the pre-0046 seven-argument shape.

## Checks

`python3 scripts/check-membership-slots.py` (23 checks: tier capacity, seat release, every cooldown, admin exemption, non-admin limits intact). SQL suites for membership, relationship slots, meetup abuse, user flow, chilling, meetup notifications, listing, feed, AI draft and behaviour analytics: 333 tests pass. `npm test` 218 pass, `npm run typecheck` and eslint clean.

## Production

The migrations were numbered 0084 and 0085 when written, but a parallel session had already taken those versions for `admin_trust_level` and `admin_trust_level_scope` and applied them to the live project. Supabase keys migration history on the version number, so the files were renamed to `0087_admin_unlimited.sql` and `0088_create_post_story_scope.sql`; the folder now holds one file per version.

`npx supabase db push --linked --yes --skip-vault --include-all` applied 0082_meetup_discovery_analytics, 0083_admin_meetup_bypass, 0087_admin_unlimited and 0088_create_post_story_scope. The remote history table lists all four.

Verified against the live project afterwards: `private.admin_ids` exists, story posting no longer references the ambiguous `room_preview` while the qualified `public.posts.room_preview is null` is present, eight functions carry the `is_admin_id` guard, both meetup abuse guards carry `is_admin()`, and all nine new behaviour targets are registered. The same migration set was exercised locally with `scripts/check-membership-slots.py` (23 checks).

Live probes after the push (each wrapped so it rolls back, verified zero leftovers):

- `public.create_post(...)` for a story returned a new post id, so story writing works again on the live project. The same call raised the ambiguous-column error before 0088.
- `private.is_admin_id(uuid)` returned true for a session carrying `app_metadata.role = admin`, and `private.admin_ids` stayed empty afterwards.

## Device pass

The simulator's installed dev client was older than the JS (missing `RNGoogleSignin`), so `npx expo run:ios` rebuilt and installed the current client. On iPhone 16 Pro Max: the meetups tab renders the new search field and 검색 button, the 일정 전체 / 오늘 / 7일 이내 chips (only for 칠링), the 자리 남음 toggle, and the 다가오는 칠링 empty state; the 모임 (정기모임) segment lists the four live Vancouver meetups with the new seat line (`4 / 10명 · 6자리 남음`) and host line; searching "라멘" filtered to the single matching meetup and the clear control restored the list. The 칠링 list is empty because the only live one-off event has already ended.

Not verified on device: the admin-unlimited labels and the 모임 자리 line, which need the app signed in as the admin account.
