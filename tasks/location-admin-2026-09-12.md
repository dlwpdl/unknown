# Location and admin refinement — 2026-09-12

Implemented optional foreground location consent, one-shot sign-in/writer measurements, nearby Vancouver/Toronto recommendations, manual posting-city selection, private login/post/meetup records and settings withdrawal/deletion. Exact coordinates never enter public posts. Migration 0037 is applied to production and the local migration ledger; signed-in session/user ownership, freshness, coordinate bounds, post ownership, idempotency, retention and audited admin reads are enforced server-side.

Apple Design and Frontend UI Engineering applied to the local admin: sidebar icons/selection, system typography and heading hierarchy, aligned member rows, account/location/identity groups, timeline spacing, 44px controls and scoped keyboard focus styles. Security, search, pagination, filters and raw activity access remain intact.

## Verification
- PostgreSQL: 348 checks passed (21 location-specific).
- Node: 81 checks passed; typecheck and ESLint passed.
- Web and iOS JavaScript exports passed. Public web export excludes admin routes/code.
- Expo native configuration includes When In Use / fine/coarse location only; no Always/motion/background location or location service permission.
- Orca: production-backed admin loaded, owner email/role and new location-empty state verified; desktop dashboard and 375px member-detail screenshots inspected, horizontal scroll width 375px. Evidence is private under `~/Library/Application Support/gling/operations/`.
- Browser composer displays optional consent and separate city controls. No test posts or synthetic coordinates were written to production.

## Remaining native release validation
This is not in the existing TestFlight build 11. A new native binary and App Store/Play location disclosure updates are needed before distribution. On-device permission denial, Allow Once/approximate permission, GPS timeout, cancellation/manual override and sign-out mid-request still need device acceptance checks. See `release/app-store/location-release.md`.
The local Expo preview unexpectedly bundled the production Supabase URL despite shell overrides; its backend-origin guard caught this before any test publication/location storage. Do not count that preview as a local end-to-end location test. Use an isolated build with verified backend origin for subsequent device tests.

## Inspected design references
- [Outseta navigation and metrics](https://mobbin.com/screens/b97fc96c-eda9-4241-bfd6-757e55814cd0)
- [Zoho CRM sidebar and tables](https://mobbin.com/screens/050cf6d0-08c9-41e3-b677-f6801ee33bbb)
- [Shopify customer detail](https://mobbin.com/screens/0923dee6-44f2-4b31-8fa2-ef202f0548ae)

BrandKit is an unconfigured template, so existing Gling tokens were retained. Pinterest metadata was checked; Kroma could not run without a Serper key. No new paid services were used.
