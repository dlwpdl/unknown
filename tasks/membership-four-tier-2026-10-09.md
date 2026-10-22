# Four-tier membership implementation

Owner request: apply the reviewed general/business tiers, check security, and repair the existing billing platform connection. Source: `marketing/reports/2026-10-09/membership-market-ai/revision-03.json`. This is an extension of existing RevenueCat → App Store/Google Play billing, not a new payment provider.

## Contract and assumptions

| Family | Basic | Plus | Pro | Premium |
|---|---|---|---|---|
| General CAD/month target | 0 | 4.99 | 9.99 | 14.99 |
| Concurrent meetups | 3 | 5 | 10 | 20 |
| Bump cooldown | 48h | 36h | 30h | 24h |
| Business CAD/month target | 0 | 19 | 49 | 199 |
| Distinct new promotions/month | 4 | 12 | 30 | 30 |
| Business bumps/month | 0 | 8 | 16 | 24 |

Business Premium managed work (4 new, 8 bumps, 1 report/month) is included in 30/24, not added to it. Human fulfillment uses existing approval/report workflows; no new unattended generation or external publishing. The owner's latest correction orders both general and business Basic → Plus → Pro → Premium; general benefits and cooldowns stay unchanged. Business same-post waits are Plus72h/Pro60h/Premium48h; whole-business wait stays24h and monthly bumps stay8/16/24. These durations are a conservative implementation choice stated to the owner after optional clarification, not a market benchmark or an explicit numeric owner quote. Monthly usage resets at UTC month boundaries, never on purchase, restoration, staff/client changes, or deletion. Bumps preserve the original post ID, history and created timestamp. General bumps also consume one shared account turn; unused turns do not accumulate. Current active-listing limits carry forward as 5/10/20/20; Pro does not introduce an unresearched extra listing ceiling. Existing legacy subscriptions retain prices, faster per-post bump rights and annual products. New products are monthly only.

Direct chat remains immediate/unlimited with no paid slots and no redundant free-chat badge. Blocks, moderation, rate limits, verification and existing content remain intact. Not-yet-built AI planning/cohost features are not sold as shipped benefits.

## Design and scope

- Extend existing membership types/parser/provider and current membership screen with general/business tabs and four tiers; retain house components and interaction feedback.
- New versioned entitlement/SKU names prevent an old priced product being sold as a new offer. Display native store prices only; unavailable/unmapped products cannot be purchased.
- Authoritative RevenueCat receipts → server-only snapshot → private PostgreSQL entitlement/usage policy. App-provided tier, expiry, product status or user ID never grants benefits.
- One business subscription belongs to one verified canonical business owner binding. Operators can share its usage but cannot bind purchases; personal Premium cannot unlock business tools. Bindings remain attached to the selected canonical business, including while a purchase is pending or expired; moving a subscription requires a separately audited support action. This avoids a second device changing the company during checkout. Verification revocation removes the grant without erasing stored work.
- New migration `0149_membership_four_tiers.sql` only; preserve original 0146 chat, 0147 notifications and 0148 MCP owner files. Enforce business quotas at the shared merchant-post link and bump entry point, including existing web/MCP paths. Do not edit other workers' MCP/auth files.
- Retain webhook retry/idempotency, authenticated SDK identity queue, expiration/refund/grace handling and cross-store purchase safeguards. Android replacement is within the same subscription family only.
- Normalize repeated promotion content in a durable private ledger. This deterministic duplicate check is not a claim of semantic AI accuracy; existing safety review remains responsible for uncertain/paraphrased promotion cases. Record remaining semantic limitations explicitly.

## Verification and boundaries

First run meaningful red tests for family isolation and tier caps. Then run `node --test scripts/membership*.test.mjs scripts/purchases-identity.test.mjs`, `npx tsc --noEmit`, `npm run lint`, dependency audit, and transaction-scoped pgTAP checks inside existing `supabase_db_gling` using staged 0146/0149 and ROLLBACK. Exercise unauthorized tier grants, stale snapshots, expiry/refund, cross-family products, restored-account changes, owner/operator boundaries, shared quota replay and preserved chat history.

Inspect real configured RevenueCat/Apple/Google catalogs read-only and save sanitized receipts. Draft new catalog configuration separately from current offerings; no new product sale activation, actual charged purchase, whole-checkout deployment, new dependency/server/worker, or remote DB push. Real device purchase/restore, store review and deployment are reported separately from mocked/transaction tests. Prepare reviewable catalog actions before any final permission request.

Structure: existing `src/lib`, `src/app/profile`, `supabase/functions/_shared`, and `supabase/migrations`; tests in `scripts`/`supabase/tests`; dated QA artifacts in `output/qa/membership-four-tier-2026-10-09`. Small patches, explicit validation, qualified database objects/search paths, no secrets or customer identities in artifacts.

Example policy lookup: `MEMBERSHIP_LIMITS[tier].meetups`; use store `priceString`, never a client-supplied billing amount. No public client may write entitlement/usage tables.

## Verified result

Local app/server source and transaction-scoped policy checks are implemented; this is not a production rollout. RevenueCat now has two non-current draft offerings with six entitlements, twelve native product mappings and six packages; all associations were read back and the legacy default offering is unchanged. The app rejects those draft offers until `launch_status=ready` and authoritative `billingPolicyVersion=2` are both present. Existing Apple four subscriptions and Google two products/four active base plans were read without mutation. All six CAD targets exist in Apple's price-point catalog; SKU-specific prices, native store product creation/metadata/approval and general-family crossgrade ordering remain in the concrete `output/qa/membership-four-tier-2026-10-09/store-catalog-plan.json`.

Latest follow-up checks: 608 Node passes/zero failures/one existing skip; TypeScript and lint exit0; 275 SQL assertions plus the existing four-tier group/operator assertion script pass with ROLLBACK. Business same-post tests reject one hour before each tier's boundary, accept exactly at72/60/48h, return the correct next wait and remove shortened rights on expiry. Both general and business ordering are checked as Basic → Plus → Pro → Premium, including returning from one family to the other. The shell-quote1.10.0 command-injection reproducer fails before the single1.11.0 dependency patch and passes afterward; the previous local npm audit has critical0 but high25/moderate11 transitive alerts remain. Native device purchase/restore/refund/deferred approval, current production RevenueCat transfer-policy readback and pre-publication semantic AI duplicate detection are not claimed verified or implemented. HTML prototype responsive checks are distinct from native-app/device checks. The previous accepted report and patch are retained under `output/qa/membership-four-tier-2026-10-09/business-tier-followup/previous-*`.

## Business quota audit follow-up

The owner asked whether12/30 monthly new-post ceilings really hold. Added35 pgTAP assertions to the existing owned business-usage test (now75pass/0fail/exit0/ROLLBACK). Earlier canonical posts are seeded; the final allowed and first denied posts use the actual authenticated workspace/admin publishing RPCs. Plus12/13, Pro30/31 and Premium26self+4managed/total31 boundaries pass, including full-quota retry, no orphan posts or spent quota after rejection, unpublished draft retention, UTC month boundary and cross-month duplicate history. Application/policy bytes were unchanged, so prior other8SQLfiles235assertions,Node608pass/typecheck/lint/UI evidence are retained rather than described as rerun. Local database remains history0111 with no new ledger or test users. Production quota, real IAP and independent two-connection races remain unverified. Evidence: `output/qa/membership-four-tier-2026-10-09/quota-audit/verification.json`.
