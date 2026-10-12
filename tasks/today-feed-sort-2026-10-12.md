# Today feed: latest and popular

The owner reviewed the clickable 2026-10-12 prototype and approved implementing it. Add the two-option control immediately above the Today post list. Latest is the default; popular shows the selected city's/category's posts from the last seven days. Category changes retain the selected order. Reuse the night palette, existing Pressable, selection feedback and native FlatList. Keep the current fixed app header, event carousel and separate weekly ranking.

## Structure and scope
- `src/components/feed-screen.tsx`: sort selection, request identity, pinned sort row, refresh/error handling and pagination. Every post in the sorted Today list retains the server order; do not lift meetup posts ahead of it. The separate meetups screen retains its existing discovery behavior.
- `src/lib/feed-data.ts` and `src/lib/types.ts`: optional popularity cursor/row fields and a popular feed call. Default/latest calls retain the existing feed RPC, listing bumps, signed-image scope and search behavior.
- `supabase/migrations/`: add the bounded popular feed RPC, reusing the current post-reader authorization and eligibility conditions. No new table, scheduler, dependency or service.
- `scripts/` and `supabase/tests/`: meaningful client/UI and SQL checks. Evidence and rendered screens go under this task's `output/qa` and `output/design` folders.

## Server behavior
Use the existing post reaction counters: likes + 2 × comments + 3 × saves, matching the approved prototype's example. Filter to published, visible, active-author posts created within seven days; honor city, tag, block, report, closed/expired listing and viewer visibility rules. Guest discovery retains the existing title/safe-first-image preview while bodies, private attachments and room details stay redacted. Read stored counters in one query rather than launching a recalculation job. Use the existing city/time indexes and verify the query plan.

Popular pages use a score/creation-time/ID cursor and a fixed eligibility timestamp. New posts do not enter an already-started seven-day window. Reaction changes can alter a live ranking; the client removes overlaps and refresh starts a new ranking window. Do not claim an immutable score snapshot. Scores are not exposed as a product metric.

## Acceptance
- Latest and popular each fetch the whole eligible server feed in their order, not just a re-sorted first page.
- Popular includes unseen high-scoring posts and excludes posts outside the seven-day window. Equal scores use newest creation time, then ID.
- A new selection invalidates stale requests and refreshes from the first page; changing category preserves the selected sort. Refresh and next-page loading keep the current mode.
- Errors never silently show a different order; account/city/filter transitions preserve existing data visibility boundaries.
- Sort remains visible while scrolling, has native accessibility state, 44px targets and the existing `play('selection')` feedback; enlarged text wraps safely.
- Previously shipped clients keep working through the unchanged latest RPC. No existing production posts or reactions are edited for tests.

## Implementation and verification
1. Write failing API/cursor and SQL tests, implement the popular RPC/client contract and verify eligibility/security/pagination.
2. Write failing rendered UI tests, add the approved control to the existing FlatList and verify stale-response handling.
3. Run `npm test`, `npm run typecheck`, `npm run lint -- --no-cache`, the local SQL fixture and the actual web export/browser checks. Reuse installed dependencies and rollback SQL fixtures.
4. Review the connected code, integrate the scoped change, apply the additive migration and verify readback. Preserve any release already in progress and distinguish source/backend delivery from availability in installed native builds.

Boundary: no moderation, account, notification, automated publishing or ranking scheduler change. No live fixture mutations, secrets in artifacts or broad writes over the dirty shared checkout. The existing current administrator/safety policy and login-only post content remain intact.

## Verified implementation
- Latest remains the default. Popular uses the server's seven-day score order. Category changes retain the order; the sort row stays below the fixed brand header while scrolling. Loading, empty and error states occupy the results area below that row.
- Publishing in popular mode reloads the first server page; latest retains its immediate new-post preview. An earlier account's publish completion cannot refresh the current feed. Refresh cancels a previous page's loading indicator, and overlapping live-score pages advance using the last raw server row.
- Local checks: `npm test` 740 tests / 739 passed / 1 existing skip / 0 failed; TypeScript and lint passed; SQL fixture 25/25 passed and rolled back. The native component browser export passed at 320/390/768/1440px, 44px targets, sort/category/error/keyboard/rapid transitions, sticky positioning and hit testing, reduced motion, and enlarged sort text at 200%/320px.
- Browser QA temporarily uses the native layout and Today entry, then restores both public web entries with SHA256 readback. All external HTTP and WebSockets use isolated fixtures. Native physical-device haptics, VoiceOver/TalkBack and installed-app availability were not tested.
- Connected-code review resolved the publish, refresh and account-rotation races and found no remaining Critical/Important issues. No new native release is part of this source/backend integration; the previously submitted 1.1.9 is preserved.
