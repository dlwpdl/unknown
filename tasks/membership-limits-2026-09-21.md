# Membership activity limits — 2026-09-21

Owner-approved limits (concurrent owned/joined meetups, active direct conversations, daily posts): free 2/2/1, plus 4/4/2, premium 7/7/3. Prices, listing allowances, moderation and cooldown rules are unchanged. Existing conversations and memberships remain; new activity is checked against the new limits.

Changed shared app limits and plan descriptions; migration 0076 updates the server policy function without changing permissions or stored entitlements. Native plan descriptions require a new app build; existing binaries retain their bundled comparison copy.

Validation: 13 membership JS tests, TypeScript and changed-file ESLint passed. Transactional DB membership (16) and relationship slots (68) checks passed. The broader membership_limits test has seven pre-existing failures reproduced on HEAD: four local create_post room_preview ambiguity failures, three outdated group cooldown assertions. These are not caused by the revised limits. Local migration tests roll back.

Production: migration 0076 applied separately from unrelated in-progress migrations. Prior function saved outside Git under the Gling backups directory.
