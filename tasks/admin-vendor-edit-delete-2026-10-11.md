# Admin vendor editing and selected deletion

## Objective and agreed scope
The owner requested deletion, multiple selection and editing in the existing vendor dashboard. Add an explicit edit and delete action on each row, plus selection of the current page and one confirmed bulk delete action. Editing reuses the existing information form and save RPC. This is a bounded change to the private web admin; no native release, bulk field editing, new dependency or automation is needed.

Deletion removes the vendor from active lists, company profiles and vendor tools. Preserve the associated member account, published posts, reviews, saved reports, connection history and operating records. Record the deleting administrator and time. The confirmation names the selected vendors and explains this behavior. Do not delete any existing production vendor to test the feature.

## Implementation and structure
1. Extend `src/components/admin/admin-merchants.tsx` and its existing CSS with row actions, accessible checkboxes, selection count and confirmation. Preserve unsaved edits on cancellation or failure and clear selection on navigation/search.
2. Add the deletion call to `src/lib/admin-merchants.ts`. Send only selected IDs and the timestamps actually reviewed.
3. Add a migration with a private archival marker, current AAL2-admin validation, row locks, all-or-nothing timestamp checks and audit attribution. Reuse current visibility and workspace guards; retain historical data and protect unresolved external submissions.
4. Verify the real component, SQL permissions and lifecycle, and the exported admin UI. Integrate and refresh the existing private admin export.

## Style and boundaries
Use the existing light admin tokens, feedback hook, table, native browser confirmation and information form. Keep the existing `saveMerchant(supabase, value)` contract. No secrets, broader account deletion, public admin route, new service or unrelated dirty sources. The private administrator authorization and audit policy in ADR-0001 apply to every mutation.

## Verification commands
- `node --experimental-strip-types --test scripts/admin-merchants.test.mjs scripts/admin-merchants-view.test.mjs`
- `npm run typecheck` and `npm run lint -- --no-cache`
- `npm test`
- `GLING_LOCAL_ADMIN=1 npx --no-install expo export --platform web --output-dir .admin-dist`
- SQL fixtures through the existing local `supabase_db_gling` container; production checks are read-only except the scoped migration.

## Acceptance criteria
- Clicking a row's edit action opens its existing information form directly; saving reaches the existing protected RPC.
- Selecting one or several rows shows the exact count and never opens the detail dialog accidentally. Select-all covers the current visible page only.
- Cancelling sends no deletion request. A server failure retains the selection and draft; a successful mutation refreshes the list.
- Empty, duplicate, stale, oversized, malformed and unauthorized requests cannot delete a subset or bypass admin MFA.
- Archived vendors cannot be resurrected by a stale edit, retain their history, and stop appearing in active/vendor/public-company paths. A new active vendor may reuse an archived name.
- HTML preview, actual exported UI and verification evidence live in this task's `output/design` and `output/qa` folders.

## Design evidence
Apple Design: immediate response, clear consequences and accessible targets. Mobbin Stripe selection toolbar: https://mobbin.com/screens/d412df8a-c1d6-4d9c-af5d-04fd317f627f. Gorgias row-selection reference: https://mobbin.com/screens/fe3adbec-623a-4e3b-ad92-c8d101d53ecd. BrandKit confirms the admin light palette is separate from the public night identity. Pinterest search was available; Kroma was unavailable because its search credential was not configured. Expo SDK 57 versioned reference was read at https://docs.expo.dev/versions/v57.0.0/.
