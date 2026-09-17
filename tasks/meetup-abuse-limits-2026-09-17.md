# Approved meetup limits

User approved 2026-09-17. Replace group-slot cooldowns, not direct-chat cooldowns.

- Third distinct approved voluntary departure in rolling 24h: new participation blocked 12h from that departure. Pending cancellation, natural expiry, removal by someone else do not count. One departure per event; reporting/blocking never resets history. Existing participation and safety actions remain available.
- One-off creation: 3 per rolling 24h and 10 per rolling 7d, all tiers. Cancellation never refunds a creation.
- Second early host closure with approved participants in rolling 7d: new hosting blocked 24h. Empty closures exempt. Shortening an accepted event's end counts as early closure; changing kind cannot evade this.
- Natural expiry returns slots immediately and automatically closes rooms without deleting evidence. Recurring groups have no automatic expiry.
- Show warnings before the threshold and exact local release timestamps. Server is authoritative, including concurrent/legacy requests and approval of already-pending applications.

Implementation: private indexed event ledger + existing relationship lock/triggers/RPCs; additive self-scoped status RPC; reuse existing confirmation/error text and membership UI. No dependencies, paid services or new moderation access.

Checks: `npx supabase test db supabase/tests/meetup_abuse_limits.test.sql`; related SQL suites; `npm test`; `npm run typecheck`; `npm run lint`.

Source: SQL in supabase/migrations and supabase/tests, UI in src/components and src/app; follow existing camelCase TS and snake_case SQL (`perform private.lock_relationships();`). Always preserve authorization, record integrity and direct-chat behavior. Do not retroactively penalize old departures. Deployment/build status must be reported separately from local implementation.

Tasks: server tests → server limits/expiry → client notices/errors → regression verification.

## Verification

- 205 related pgTAP assertions passed (new limits, Chilling metadata/free flow, relationship slots).
- Another 32 inbox/account lifecycle assertions passed, total 237.
- 170 Node tests, TypeScript and lint passed. Web export succeeded.
- `python3 scripts/check-meetup-race.py`: two simultaneous requests for the final creation allowance commit once; loser creates no post.
- npm production audit: 16 moderate, no high/critical. Existing Expo build-tool advisories; no dependency changes or forced remediation. Recheck during next SDK maintenance, by 2026-10-01.
- Existing general story quota and 6-hour meetup cooldown conflicted with the approved creation allowance. Meetup creation is now separate from story quota; 1:1 behavior is unchanged.
- Existing group cooldown rows are retained but ignored, not deleted. No retrospective departure/closure penalties. Existing recent one-off creations count toward their rolling window.
- Expiry uses existing Postgres cron each minute; slot calculation and send/inbox checks recognize expiry immediately. No post/message evidence is deleted.

## Deployment / rollback

Before production: schema and data backed up outside git under `/Users/ash/Library/Application Support/gling/backups/pre-meetup-limits-2026-09-17/`. Data-only restore has the existing circular comments-FK caveat; do not blindly restore the entire DB.

Rollback: unschedule `gling-chilling-expiry`, remove only `posts_meetup_abuse` and `meetup_requests_abuse_limit` triggers, restore modified function definitions from the pre-change schema backup (including create_post, creation, membership, group leave/sync, previews, send_message and account purge). Retain the new ledger and existing evidence. Do not reopen naturally expired events or restore entire production data. Revert UI commit if needed. Monitor cron.job_run_details and existing client error reporting after rollout.

References checked: [Expo 57](https://docs.expo.dev/versions/v57.0.0/), [Postgres locking](https://www.postgresql.org/docs/current/explicit-locking.html). BrandKit had no notice component; Mobbin/Kroma search unavailable without Serper credentials, so existing themed inline notices are reused.

Independent review found stale pending applications after expiry and the actual inbox RPC was different from the legacy one. Forward migration 0067 cancels expired pending applications, hides natural expiry from current inbox pages, and retains read-only deep-link access for reporting. Approved memberships/messages are retained. Release timestamps include seconds.

0065–0067 applied to production; expiry cron verified `succeeded`; existing client error monitor showed 0 recent error types after deployment. Independent follow-up review cleared the expiry fixes.

## Delivery

- Source commit `697673e`, build-number commit `8c31bc8`; pushed to `origin/mobile-app`.
- GitHub Pages run `35277268031` succeeded; live `/terms` returned HTTP 200.
- Local Xcode archive/export succeeded. Bundle `com.dlwpdl.gling`, version 1.0.1, build 28.
- ASC build `ca12163d-3450-4af4-adf0-f3125c8782a3`: processing `VALID`.
- Existing `Gling Internal` group `03fefab3-98b9-4f9c-a6a0-450fdd703efb`: explicit membership verified; `IN_BETA_TESTING`.
- Artifacts/logs: `/Users/ash/Library/Application Support/gling/releases/1.0.1-28/`.
- No App Review or external beta submission; no physical-device QA claimed. This build contains the meetup-policy/expiry work, not the separately discussed cover-photo/chat-member feature work.
