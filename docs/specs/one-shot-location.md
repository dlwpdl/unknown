# Optional one-shot location — 2026-09-11

## Outcome
Recommend an open community city at sign-in and while composing a post or meetup. Keep manual city selection available; never track movement or collect background location.

## Behavior
- Separate optional consent explains city recommendations and private safety records. Use foreground OS permission only. Settings can withdraw consent and delete location records.
- After consent, a fresh sign-in takes one measurement. Opening a writer takes one measurement for its city recommendation. Successful publication records that measurement only if it is at most five minutes old. Cancelled drafts do not create server location events.
- Recommendation is a nearby community, not a verified home city. Use an approximate 75 km radius around open Vancouver/Toronto community centers; uncertain/out-of-range measurements leave the city unchanged. An explicit manual choice wins over a pending measurement.
- Public posts show only the chosen city. Private records contain device coordinates, accuracy, measurement/server times and login or post context. No advertising, external geocoding, address lookup, continuous updates or motion collection.

## Data and access
Private preference and event tables; authenticated RPCs bind the user and auth session. Validate consent, freshness, coordinates, ownership and event uniqueness. Known simulated locations are not saved. GPS is device-reported, not proof of identity or presence.
Reuse audited admin user overview/timeline. Login IP remains separately labeled as an authentication-session IP. Location records expire from reads after 30 days and are physically purged hourly; withdrawing consent deletes them immediately. Auth account deletion cascades.

## Interface
One reusable nearby-city card alongside manual city buttons in onboarding and composition, and a recommendation card in the feed. Permission denial, unavailable/slow fixes and network errors preserve normal reading/writing. No prechecked consent.
References inspected: Mobbin Wolt 26742773-2c58-4848-85c2-9946961147a5, Uber Eats 0acc307e-d01e-499b-9936-d1fcf6988991, corner 3e34e9e8-ee0f-4ab8-8870-24e22829469a. BrandKit is unconfigured; retain Gling tokens. Pinterest metadata inspected; Kroma unavailable without a key.

## Checks
Node checks for geographic/freshness boundaries and manual override. pgTAP checks for opt-in, identity binding, timestamp/coordinate rejection, idempotency, admin-only audited reads and deletion/retention. Typecheck/lint, web/admin exports, Orca responsive behavior and native permission configuration.

## Delivery
Free Expo foreground location module; no paid services. Native functionality requires a new binary. Update privacy copy/manifests and release notes; store privacy answers must include precise location before distributing that binary. Preserve ongoing build 11/release work.
