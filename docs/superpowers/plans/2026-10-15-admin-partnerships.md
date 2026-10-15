# Admin Partnerships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Coordinator retains integration and release ownership.

**Goal:** Provide private admin management of businesses, creators, collaboration campaigns, visit benefits and individual coupons.

**Architecture:** Reuse merchants, profiles, admin MFA, auditing and the existing private static admin deployment. Add bounded private Postgres records and four protected RPCs, a small TypeScript contract/client and explicit list/detail forms. No public recruitment, automatic payments or new automation jobs.

**Tech Stack:** Expo57, React19, TypeScript6, existing Supabase Postgres/pgTAP, Node tests and existing browser harness. No dependencies.

**Spec:** `docs/specs/admin-partnerships-2026-10-15.md` (approved structure, latest user instruction to implement).

## Global Constraints

- Preserve branch baseline64ba35c, URI remediation, admin response headers, monitoring ADR and PR39 notification ownership.
- Only current AAL2 active administrators use new protected RPCs. No service key in clients, test auth bypass, new roles, external sends or real coupon/payment test operations.
- Owner transferred the existing clean isolated checkout; no extra worktree/server/recurring job is needed.
- Root owns contract, integration, UI and release. One orchestrated worker owns only new partnership SQL, its pgTAP fixture and runnable local checker. Both share this checkout with disjoint file boundaries.

## Task 1: Protected persistence and state rules

Files: new `supabase/migrations/20261015190000_admin_partnerships.sql`, `supabase/tests/admin_partnerships.test.sql`, `scripts/check-admin-partnerships.py`.

- [x] Write failing pgTAP tests against the specified RPCs; run before implementation.
- [x] Implement private records, constraints/indexes/RLS, protected reads and writes, audit, revision/term locks, capacity, expiry and one-use rules.
- [x] Run rollback tests on existing Docker Postgres. Use isolated temporary schema-only DB for committed concurrency probes if needed; never reset shared local DB.
- [x] Cover AAL1/non-admin/inactive/expired boundaries, legitimate saves, wrong recipients/merchant/campaign, duplicates, quotas, stale edits, cancellation, audit and concurrency. Report actual evidence.

## Task 2: Typed client and operator interface

Files: new `src/lib/admin-partnerships.ts`, `scripts/admin-partnerships.test.mjs`, `src/components/admin/admin-partnerships.tsx`, `.css`, `.native.tsx`, optional focused editor child; root owns existing admin navigation/screen/data and relevant regression tests.

- [x] Test failure paths, strict money-to-cents handling, RPC argument/revision preservation, malformed readbacks and safe links before implementation.
- [x] Implement exact typed contract; no automatic mutation retry. Build bounded lists, explicit editor dialogs, existing member/merchant search, participation and coupon actions/history.
- [x] Wire three new sections and rename vendor UI to 업체 관리 without breaking existing URL section=merchants. Avoid background operations dashboard loads for new self-contained sections.
- [x] Test actual components with existing fixture renderer/Playwright; include dirty-form protection, async scope changes, rejection messages, keyboard and mobile layout.

## Task 3: Integration and private delivery

- [x] Review worker SQL and run tests: `python3 scripts/check-admin-partnerships.py`, focused Node, `npm test`, `npx tsc --noEmit`, changed-file `npx eslint`.
- [x] Build private admin with `GLING_LOCAL_ADMIN=1 GLING_PUBLIC_WEB=0 GLING_MERCHANT_WEB=0 npx expo export --platform web --output-dir output/qa/admin-partnerships-20261015/admin-export --max-workers 2`; validate actual screens and create clickable HTML preview, normal protected access and public bundle separation.
- [x] Re-evaluate current `npm audit --json` and immutable export scope against existing dated security review. Preserve source and private export rollback/hash evidence before normal existing publication.
- [x] Apply only reviewed new migration via existing authorized project path, read back protected functions, publish only the existing private admin artifact if normal verification is available, and verify served hashes/headers and actual normal-MFA UI. Never native/store/public deployment.
- [x] Add pilot merchant internal drafts only through normal authorized admin RPC/UI, retain unresolved terms/inactive status, read back exact record. No real coupon issuance, fake creators or payout.
- [x] Record completed/remaining checks and risks; release the orchestrated worker after settlement.

## Completion — 2026-10-15

- Released source: `649ef4a46286ff644df6a480d99e1ed312c20e25`. This later plan update changes documentation only.
- Verification: 1,049 Node tests passed, zero failed; one conditional export check was covered by actual merchant export verification. Type checking, lint, all three web exports and public/private bundle separation passed. The database checker passed 181 rollback assertions and 10 isolated committed concurrency probes; the shared database was not reset.
- Reviewed migration `20261015190000` was applied once and its protected metadata read back. The existing private admin artifact was published with rollback files and served hash/header evidence. Normal AAL2 admin UI saved and read back two pilot drafts. Account roles, native/store releases and public deployments were outside this change.
- Vendor list/detail account links were activated in the live UI; a separate native browser window opened while the original admin page remained. Desktop and 390px layouts were inspected. Design references and actual component previews were retained in private local artifacts.
- No real coupons, public recruitment, payments or recurring jobs were created. Unconfirmed pilot terms remain drafts. Existing build-tool audit findings remain under the dated private-static-admin review, which expires on 2026-10-16 and requires reassessment before any scope change.
- Worker reports and failed-dispatch/recovery history were preserved; workers were settled and released. Protected operations receipts retain source boundaries, backups, review results and delivery evidence separately from tracked documentation.
