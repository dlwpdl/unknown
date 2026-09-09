# Restricted store review access

Owner request: provide a pre-created review account without opening email signup to ordinary members. Keep Kakao, existing iOS Apple sign-in, and authorized admin access.

- Use Supabase Auth password sign-in and trusted `app_metadata.review_access`, never a client password or user-editable flag.
- Reject public non-social signup before account creation. Reject ordinary password/token issuance server-side, including passwords added to social accounts. Preserve existing admin authentication.
- Offer a labeled `심사용 계정 로그인 / Review access` route from the existing login panel. Only validated review sessions reach persistent app storage. No public signup form.
- Reviewers use ordinary member permissions and the same content, consent, moderation, reporting, and deletion flows. No admin role or simulated Kakao verification.
- Store credentials outside Git with owner-only permissions; provide English store review instructions. No credentials in application code, output bundles, or task documents.

Changes: shared auth/login panel, `/auth/review`, one SQL migration and matching tests. Reuse current theme and installed Supabase SDK; no dependencies.

Validation: `npm test`, `npm run typecheck`, `npm run lint`, existing SQL test runner or transaction-scoped pgTAP, web export and real positive/negative Auth API checks. Validate normal social authorization routing and the review UI before building/uploading the next store build. Do not claim an actual personal OAuth login without completing it.

## 2026-09-08 implementation status

- Added the labeled review route and nonpersistent validation client. Node tests: 41/41; typecheck, lint, and web export passed after the final keyboard layout adjustment.
- Web UI rejects a wrong password without persisting a session. The initial redirect problem was resolved on September 9 by keeping the root Stack stable and grouping only the tab routes. `scripts/check-review-navigation.mjs` now passes correct login → profile → notifications → back to profile and persisted-session reload.
- Migration 0023 is applied, and both hosted Auth hooks are enabled. A first immediate probe ran before hosted configuration had propagated; configuration was restored and the probe was repeated after propagation.
- Fourteen transaction-scoped database checks passed. Live Auth verified reviewer password sign-in and refresh, ordinary profile/consent, rejection of unapproved email credentials, rejection of user-metadata spoofing and public email signup, wrong-password rejection, revocation, and restored access. Synthetic negative-test accounts were deleted.
- Reviewer is an ordinary L1 member, not an admin; existing admin authentication and Kakao/Apple policy are preserved. Actual personal Kakao/Apple OAuth login was not repeated during these checks.
- Credentials: owner-only `~/Library/Application Support/gling/credentials/store-review.json`; never copy them into this repository. Verification evidence: `/tmp/gling-review-access-2026-09-08/auth-verification.json`.
- Review access is included in native builds 5 and later. App Store and Google Play have the current restricted credentials and instructions, saved and rechecked on September 9. The entry is the person icon at the top-right, beside Search, then Review access. See the September 9 release record for the currently selected store build; never submit build 4 claiming this route is available.
