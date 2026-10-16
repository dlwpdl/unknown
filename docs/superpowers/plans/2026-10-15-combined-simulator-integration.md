# Combined simulator integration

> **For agentic workers:** Use incremental implementation and the existing Orca Run. Primary owns the final merge and simulator verification; independent workers own isolated source branches or read-only evidence.

**Goal:** Restore every approved missing feature to one testable simulator build without deploying.

**Architecture:** Start from the current flat-control/back-navigation source at `771a270`. Merge existing validated feature changes, retaining newer shared behavior. Merge the existing ML Kit owner's committed source only after its writer releases that boundary. The existing private admin remains a separate build target with MFA and full-content safety monitoring.

**Tech stack:** Expo 57, React 19, React Native 0.86, TypeScript 6, existing Supabase/Postgres and WebView/MapLibre; Google ML Kit supplied by the existing native owner.

**Spec:** `/Users/ash/Desktop/Git/unknown/output/reviews/all-features-simulator-integration-2026-10-15/approved-integration-spec.txt`; existing per-feature specs remain authoritative.

## Constraints

- Preserve current 2D controls, back handling, 20-photo uploads/albums, sharing, chat, auth, update policy and notification behavior.
- Preserve original user content, drafts, access checks, admin MFA/audit and full post/comment/conversation safety coverage.
- Reuse existing helpers and tests; no new service, dependency or recurring automation.
- No production DB/Edge/web/store deployment, release tag, remote push that triggers a release, paid model request or external publication.
- Source integration and local simulator/native verification are authorized. Later explicit owner deployment instruction activates the existing release pipeline.
- Keep the active ML Kit checkout and original dirty source untouched until a stable handoff. Only primary selects the final simulator/Metro source under the shared GUI queue.
- Do not invent Top25 selections, partner relationships, performance data or backend success. Keep fixture verification separate from live results.

## Tasks

1. **Baseline and request coverage.** Verify `npm test` at `771a270`; independently compare earlier approved specs/tasks/receipts against files and callers, including uncommitted work. Record source/runtime binding and exclude deferred or superseded proposals.
2. **Profile A.** Reuse `a3f57ce` and its profile tests. Preserve current flat controls and account/merchant behavior. Run `node --experimental-strip-types --test scripts/profile-actions.test.mjs scripts/merchant-account-entry.test.mjs` before committing.
3. **Full app language.** Reuse only the language worktree's actual UI-localization changes and fixtures. Preserve current routing, content and existing controls. Verify language lifecycle, unchanged drafts, reactive dictionaries and affected UI tests.
4. **Map and Top25.** Reuse the map/Top25 source manifest and original route/entry hunks; adapt the display-only translation hook to the native translation contract. Verify `scripts/discovery*.test.mjs`, Ticketmaster tests, visibility, dates, navigation URLs and camera insets. Keep real editorial selections empty until sourced.
5. **Merchant drafts.** Merge the existing generation/review/channel-selection hunks without replacing newer image/account/review handling. Reuse the existing factual draft validation and channel confirmation tests; never submit a paid request or publish during checks.
6. **Admin, analytics and install reproducibility.** Independent worker integrates pinned `31270f1` in an isolated branch, including private admin/creator/directory, client product instrumentation and URI override/lock/compatibility test. Preserve source/app boundaries and migrate only under local rollback tests. Primary reviews and merges its checked commit.
7. **Operated-meetup SQL.** Reuse `2ab721f`'s migration/test without copying its older profile source. Test only locally in rollback scope and retain the production hold.
8. **ML Kit and combined checks.** Merge the current owner's stable native/client commit, resolve language/map overlap once, and run `npm test`, `npm run typecheck`, `npx eslint` on changed TypeScript plus native JavaScript exports. Independently review connected behavior, not just file existence.
9. **Simulator and release readiness.** Use the existing simulator tools and bounded shared GUI queue. Bind the exact combined source/native binary, verify visible routes and real controls, then leave the simulator usable for the owner. Backend-dependent fixture checks remain labelled. Prepare the existing pipeline and exact migration/commit order without starting deployment.

## Validation record

Commands run from this isolated checkout; logs and source manifests go to `/Users/ash/Desktop/Git/unknown/output/reviews/all-features-simulator-integration-2026-10-15/`. Add focused regressions when merge resolution changes behavior. Do not rerun unchanged successful checks without a new concern. Final delivery must distinguish code integration, simulator rendering, actual native inference, local backend checks and pending production activation.
