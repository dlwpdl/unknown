# Webshop performance redesign — 2026-10-23

The private admin now separates performance, connections/prices, and order reports. Four summary values distinguish comparison views, webshop visits, confirmed orders, and confirmed net sales. Missing order reports remain unknown instead of appearing as zero revenue.

Only explicitly configured Uber webshops appear in the default list. At rollout, the registry contained Jimoco Cafe & Pasta alone; the other businesses were unconnected query placeholders, so no business records were deleted. Business Management remains the entry point for choosing additional profiles. A new connection requires the operator to confirm food-restaurant and Uber-ordering eligibility, followed by the existing validated webshop configuration flow. The UI and report selection support multiple restaurants without hardcoded business identities.

Migration `20261023213000_webshops_connected_scope.sql` preserves the RPC signature, administrator/MFA checks, aggregation, and explicit profile lookup. Its default query excludes businesses without a valid registered webshop URL. Existing report validation, optimistic revisions, unsaved-edit guards, and idempotency remain in place.

## Deployment and authentication correction

Deploy private admin exports from the canonical `gling-admin-current-20261017` checkout. Preserve its login, MFA, provider, creator, campaign, benefit, and business-management code. The server remains on its existing private origin and port.

The first redesigned export contained a stale test public-client key and caused authentication requests to fail with 401, including Google sign-in. The previous working export was restored, then the canonical source was exported with the existing public environment and a cleared Metro cache. The `admin` command now includes `expo export --clear`. No account, MFA policy, credential rotation, or server restart was required.

Before replacing the served export, verify its compiled public-client configuration, a successful auth settings response, and a Google authorization redirect to `accounts.google.com`. Retain the previous good export for rollback and old good hashed assets for open tabs. Do not overwrite an active admin editing tab during verification.

The corrected served entry is `entry-bbdd43a2cc871b46b4050a2eec2e5310.js` (SHA-256 `d849f976476bfe5662808c31c9d3cb4b5118c9828888fe740a22ba11e90c43c4`). Actual authenticated readback verified all three tabs, only Jimoco in the connected list, and no error alerts.

## Validation evidence

Local evidence is stored in `/Users/ash/Desktop/Git/unknown/output/reviews/gling-admin-webshops-redesign-2026-10-23/`. It includes before/after source and SQL receipts, responsive previews, authenticated readback, auth preflight and deployment hashes, UI tests, database/concurrency checks, lint, and type checking. The multi-restaurant regression verifies that a second enrolled restaurant can be selected and its own report editor receives the correct merchant ID.
