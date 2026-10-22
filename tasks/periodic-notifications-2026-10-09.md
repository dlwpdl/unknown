# Gling periodic notifications

Owner request: periodic app notifications appear never to arrive. The initial audit is in `output/qa/periodic-notifications-2026-10-09/`.

## Scope and findings

- The existing minute push worker and 15-minute trending job are active. Weekly ranking runs Monday 13:00 UTC. The recent periodic queue has three provider-accepted jobs and no current failures; this does not prove device receipt.
- Eleven active non-seed/non-review accounts: four opted into push, three have a current registered device. The current trending candidates in their cities do not reach the popularity floor. Existing notifications without queue entries predate their current device registrations.
- The permission invite saves push opt-in without notifying the running notification observer. A failed registration or setting save also dismisses the invite silently.
- Provisional regular recommendation: once daily at 18:00 in the user's selected city timezone, when a fresh readable post exists. This provisional cadence is superseded by the owner-approved expansion below. Reuse the existing trending schedule, private topic ledger and push queue; no new worker, dependency, table or public RPC.

## Acceptance and implementation

1. Reproduce the invite's missing foreground update and silent failure; preserve permission denial and opt-out. Save first, emit the existing settings event, and retain the existing invite for retry on connection failure.
2. Daily recommendations use fresh non-review/non-seed content, opt-in and registered active-session recipients, existing visibility/block checks, a once-per-city/day claim and no old-slot replay. Keep current popularity and weekly notifications.
3. Verify real SQL in the existing local database with rollback, existing push regressions, TypeScript and lint. Preserve the live cron job identity, schedule and active state if deployed; do not manually send to users.

Commands: `node --experimental-strip-types --test scripts/push-*.test.mjs scripts/notification-preferences.test.mjs`; `npx tsc --noEmit`; `npx eslint src/components/push-invite.tsx`; local SQL via `docker exec -i supabase_db_gling psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1`.

Use existing React Native controls and `DeviceEventEmitter`; private SQL uses `security definer set search_path=''`, qualified names and explicit permission revocation. No user settings, auth sessions, content or unrelated schedules are changed for testing. Actual device receipt and store release are separate from server/provider acceptance.

## Historical verified outcome — 0136

Server migration 0136 is applied and recorded. Existing job 16 keeps its identity, 15-minute schedule, postgres owner and active state; every other job identity/schedule is unchanged. Live function body matches the tested source exactly. The first normal post-deploy run at 2026-10-09T08:00:00Z succeeded, before the local evening recommendation slot. No manual notification was sent. Full current Node suite: 449 tests, 448 pass, 0 fail, 1 existing skip; SQL 28 assertions, TypeScript and changed-file lint pass. Permission invite source fix is ready for the next app build; physical-device receipt and store release remain unverified. HTML is a flow simulation. Cadence was an explicitly stated provisional assumption; the later owner-approved expansion supersedes it. Evidence: `output/qa/periodic-notifications-2026-10-09/verification.json`.

## Owner-approved expansion — 2026-10-09

The owner superseded the provisional daily-only cadence and approved the proposed frequent recommendations, adding Ticketmaster discovery, real-click festival popularity and existing-person subscriptions only if already implemented. Live schema and source contain no follow/person-subscription feature, so do not build one. Interest-tag/hashtag discovery and activity notifications already exist; verify their actual push boundary rather than adding duplicate jobs.

Acceptance: local 11:00/16:00/20:00 recommendation slots, plus fresh place/festival posts, genuinely rising posts, newly discovered Ticketmaster events and festivals ranked by distinct real member detail opens. General recommendations allow at most six pushes per member/local day, at least 30 minutes apart, and respect existing local quiet hours, global/category opt-outs, session validity, blocks, visibility and content freshness. Interest-tag/hashtag new-post opt-ins and likes/comments/thread replies remain immediate and separate. Never infer a newly opened venue from a newly published post, or Ticketmaster's listing creation date from first discovery. Never use adjusted display counts, seed/review/admin activity as member popularity. Same recommendation target is not repeated within seven days.

Reuse the existing private topic ledger, push queue, protected Ticketmaster cache and one matching server cron. Extend its check to five minutes and refresh one city/query at a time (ten city/query combinations in 50 minutes) within the existing upstream budget; preserve unrelated job IDs, schedules and owners. Native local automation catalog/459 run records and GUI ownership were read before setup. No GUI, new automation/daemon, dependencies, paid calls, store upload or unrelated shared edits are required. Server data preparation stays outside the GUI guard.

Implementation order: (1) runnable failing SQL/route checks, (2) private cache-derived event identities and rate-limited authenticated member-open recording, (3) local slot/event recommendation selection and existing cron reuse, (4) safe app notification route + nonvisual detail-open instrumentation, (5) rollback SQL/native checks, deploy and saved configuration/function readback. Shared source owners were notified; read current files again before edits. New migration reservation: 0138. Test fixtures run only in the existing local Docker Postgres, inside rollback transactions; no production test members, clicks or manual push.

Commands: `node --experimental-strip-types --test scripts/notification-preferences.test.mjs scripts/push-*.test.mjs`; `npx tsc --noEmit`; changed-file `npx eslint`; `docker exec -i supabase_db_gling psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1` with the saved rollback SQL. Follow surrounding `security definer set search_path=''`, qualified SQL, private RLS/revocations and real-output assertions. Evidence: `output/qa/periodic-notifications-2026-10-09/expanded/`. Existing 0136 function remains as a rollback reference; only the new approved engine owns scheduled recommendations after deployment.

## Verified expansion outcome

Migration 0138 was applied and recorded at 2026-10-09T09:29:01Z. Existing recommendation job 16 now runs every five minutes with the tested refresh/generator commands; existing retention job 23 only appends 90-day member-click cleanup. All fourteen job IDs/owners/active states and all twelve unrelated schedules/commands are preserved. Member settings, users, profiles, posts and devices match preflight counts. All 22 live readback checks pass, including exact tested function bodies, preserved worker/function ACLs and all prior target/moderation cases. The existing push function retains its identity, JWT setting and secret-based authentication and is ACTIVE at version 9; its downloaded deployed bundle contains the event-route guard.

The ordinary 09:30Z recommendation run succeeded. Its Ticketmaster refresh returned HTTP 200 and updated Montreal's festival cache; ordinary push-worker responses returned HTTP 200 with no errors. This was a quiet-hour run: no new recommendation push or production test click was generated, and no manual broadcast was invoked. This proves scheduling/cache/worker execution, not midday recipient or physical-device delivery.

The final rollback SQL has 59 passing assertions. It covers the owner-approved cadence, real member popularity, opt-outs/sessions/visibility, seven-day target deduplication, legacy meetup recommendations, readable per-member slot fallback, actual send-time quiet/spacing/six-per-day guards, two devices sharing a notification, retry and receipt handling, stale backlog suppression, interest posts and real like/comment/thread-reply triggers. Review exposed three SQL boundary failures and the worker's event-link rewrite; the saved red regressions reproduce them and the final checks pass. Full shared Node suite: 477 tests, 476 pass, zero fail, one existing skip; TypeScript and changed-file lint pass. Independent reviewer verdict: ready, no remaining must-fix findings.

Native event navigation/click recording and the prior foreground permission-observer fix require the next app build. Older installed clients safely open the notification inbox for event recommendations; exact event navigation needs the updated client. There is no existing person-follow feature, so none was added. No store build/upload, public web deployment, new job/dependency/paid service, GUI action or fake popularity was introduced. The old 0136 functions remain available; `expanded/restore-command.sql` is a guarded schedule-only rollback preserving new data and send guards, and has not been executed.

Evidence: `output/qa/periodic-notifications-2026-10-09/expanded/verification.json`, `readback-verification.json`, `health.json`, `review.json`, `source-reviewed.json`, `review-regressions-red.txt`, `worker-routes-red.txt` and runnable rollback SQL. Daily recommendations need enough fresh readable content; actual delivery/open/return rates and notification opt-outs are still unmeasured.
