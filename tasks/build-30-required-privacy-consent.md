# Build 30 — required signup consent (2026-09-19)

User requested policy URLs and explicit checkboxes before signup, then an iOS upload. Before authentication, Terms/community rules and personal-data collection/use are separate required, initially unchecked checkboxes. Each has a working full-policy URL. Both must be selected for Apple, Google, Kakao, review, development and admin login. Optional name/birthdate consent and the separate onboarding AI safety consent remain separate. All safety monitoring in ADR-0001 remains in place.

The existing account-bound receipt now records version `2026-09-19`, identifying acceptance of both displayed agreements. Migration 0071 preserves prior-client compatibility and prevents an older client from overwriting a newer receipt. Existing receipts are not backfilled. Account cleanup and private-ledger RLS remain in place.

Validation: 180 Node tests, TypeScript and lint pass; 40 selected pgTAP checks pass (login terms, AI consent/scheduler, account lifecycle). Regression test failed before implementation and passes after: missing/either-only agreement blocks providers, both enable them, unchecking privacy blocks again, and both links open the intended URLs. Orca browser independently checked the real rendered review-login form, both links, and a 320px content width. Both public policy URLs return HTTP 200. Public web export excludes admin code. Native physical-device signup and photo-picker QA are not claimed.

Design: reused existing controls and BrandKit product tokens. Mobbin search through Kroma was unavailable (missing Serper key). Consulted Expo 57 documentation and Apple's current App Review Guidelines; this work does not establish that consent was the only rejection reason.

Production migration 0071 applied and verified in remote migration history. Backups: `~/Library/Application Support/gling/backups/pre-build30-2026-09-19/` (public/private schema and private data, mode 0600).

Release: 1.0.1 (30), includes the unuploaded build 29's meetup cover photos and chat details. Archive and App Store export succeeded; verified the IPA bundle ID and version before upload. Apple build `33f5e568-6040-4563-92d3-52cb9ca095e8` is `VALID`, linked to existing `Gling Internal`, and re-read as `IN_BETA_TESTING`. No new invitations or App Review submission. Artifacts, upload log and final API receipt: `~/Library/Application Support/gling/releases/1.0.1-30/`. Keep build 28 available; the additive migration supports the previous client contract for rollback.

Audit: 16 existing moderate findings, zero high/critical; no dependency changes. Additional focused checks confirm privacy-only acceptance is blocked and loading prevents duplicate authentication. Source commit `8be4200` pushed to `origin/mobile-app`.
