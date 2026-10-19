# Gling place ratings

The owner wants Gling reviews to be primary, external reviews secondary, and numeric ratings visible on the main card. After discussing how a review-count weighted blend would bury Gling ratings, the owner acknowledged the recommendation to show Gling prominently and external scores separately. With no Gling rating, the external score becomes primary. The existing text-review flow remains the content and moderation boundary.

## Contract

- Gling scores use the existing merchant convention: 1–10, in 0.5 steps. A short text review remains required, as in the existing place-review form.
- One scored post per member, city and exact OSM place identity. Repeated submission edits that post; it never increases the rating count. Removed posts cannot be restored by this RPC.
- Add nullable place identity/score columns to `posts`. Ordinary and legacy text posts remain compatible. Keep normal create quotas, safety triggers, reports, blocks, account checks and audited admin access.
- New writes use `write_place_rating`; two read RPCs return batched public aggregates and authenticated per-review state. Read visibility delegates to the existing `get_public_post` boundary. Guests receive no review bodies from new endpoints.
- Rating count includes scored, visible Gling posts only. An empty average is `null`, never zero. External provider scores/counts never enter stored Gling aggregates.
- The approved ✦ palettes stay intact. Main cards use a 10-point presentation; external 5-point scores are explicitly marked as an external conversion. Expanded provider cards keep the original scores and denominators. Never label external or combined values as a Gling-only average.
- Keep the current source coordinator, sole Simulator installer, unknown draft and all native/release holds. This task does not submit a store build or change a minimum supported version.

## Increments and checks

1. Add schema/RPCs and typed client helpers; test validation, duplicate updates, account isolation, visibility, removal and actual SQL in an isolated local database.
2. Add score selection to the existing review editor, genuine averages/counts, empty/error states and account-safe batched reads. Preserve drafts and existing review pagination.
3. Apply the owner's final main/fallback presentation, put Gling reviews first, and collapse external sources. Render and inspect dark/light at 320/390px.
4. Run `node --experimental-strip-types --test scripts/place-reviews*.test.mjs scripts/place-external-ratings.test.mjs`, `npm test`, `npx tsc --noEmit`, changed-file ESLint and `git diff --check`. Send only tested commits and exact file hashes to the current source coordinator.

No new dependency, paid provider call or external review-body import is required. Use the installed PostgreSQL image only for a disposable local SQL test; do not alter the existing shared development database.

## Deployment order

Apply `20261019013000_place_ratings.sql` through the existing authorized database release path before enabling real ratings in the installed client. The migration is additive and does not change old-client post reads, store availability, authentication or minimum versions. If the RPCs are unavailable, main cards retain disclosed external fallbacks and the review editor stays disabled with a retry message; missing data never becomes a fabricated zero. The SQL has only been exercised in an owned disposable local database, not deployed to the production backend.

For a client rollback, retain the nullable columns and existing member reviews. Do not drop rating data or weaken the visibility/safety policies. External review bodies have not been imported; expanded external cards show provider scores, dates and deliberate source links.
