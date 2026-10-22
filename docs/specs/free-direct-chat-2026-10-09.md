# Free direct conversations

Owner direction, 2026-10-09: all 1:1 conversations are free and unlimited; a person can send a message immediately without sending a request and waiting for acceptance. Later correction: omit the obvious free-DM badge and repeated plan benefits from the interface.

Use the existing `start_conversation(uuid, uuid)` RPC, conversation rows, message RPCs, RLS, notifications, and safety-monitoring pipeline. Do not introduce another messaging service or alter subscription products, meetup limits, merchant MCP, or moderation ownership.

Acceptance:

- Profile and post author actions say `대화하기` and open the direct conversation with its message composer.
- The server creates an active room immediately, independently of either participant's membership or number of other rooms. Retrying the same pair returns one room; a listing origin remains verified against its real author.
- Current pending requests can become ordinary conversations; already expired requests remain cancelled. The compatibility acceptance RPC continues to work for old clients without a slot check.
- Ending a conversation preserves messages and creates no 24-hour slot lock. Existing slot-lock records are retained for audit but never restrict direct conversations.
- Anonymous, self, inactive-recipient, unrelated-room, and blocked-pair access remain prohibited. Existing request/message pacing remains a common anti-spam rule. Existing all-message safety analysis, retention, audited admin review, and meetup approval are unchanged.
- Creating an empty room does not send a request/acceptance notification. The first real message uses the existing message notification trigger.
- Chat says `1:1 대화` without a free badge. Membership plans show their meetup/listing differences without presenting common direct messaging as a paid-tier benefit; terms retain its free unlimited policy. Four-tier commercial prices and bump policy remain proposals in the separate membership research.

Implementation order: transaction-scoped SQL regression → existing RPC/membership migration → native controls and copy → focused/full Node, TypeScript, lint, SQL regressions → native/public deployment handoff.

Commands (existing dependencies and disposable local database only):

```
node --experimental-strip-types --test scripts/free-direct-chat.test.mjs scripts/membership.test.mjs scripts/membership-screen.test.mjs scripts/relationship-ui.test.mjs
npm test
npm run typecheck
npm run lint
docker exec -i supabase_db_gling psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

SQL tests run in a transaction and roll back; stage the new migration after `begin;` in that same transaction. Do not reset the shared database or start a server. Use current file hashes and preserve other owners' edits. No secrets or private messages enter evidence. Remote schema execution, app release, and actual two-device delivery are distinct from local verification.

Official references checked 2026-10-09: https://docs.expo.dev/versions/v57.0.0/ and https://supabase.com/docs/guides/database/functions . Follow `docs/decisions/0001-safety-monitoring-and-admin-access.md` and existing night/iris theme. Mobbin MCP is not exposed in this session; Kroma's Mobbin search failed because its Serper key is not configured; no new key/service is acquired.
