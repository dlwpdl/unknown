# Combined simulator handoff — 2026-10-15

Deployment is held by the owner. The combined source is on `dlwpdl/gling-combined-simulator-20261015` in `/Users/ash/Desktop/Git/Orca/workspace/mobile/gling-combined-simulator-20261015`. The original dirty mobile checkout is preserved. Metro port8083 belongs to this combined checkout; local development previews are not deployments.

The combined source retains profile A, the complete reactive Korean/English UI, unified discovery and TOP25 A, the factual merchant AI draft/review/channel flow, private admin/creator/directory changes, app analytics, operated-meetup alerts, and the reproducible router URI decoder repair. General catalog-place community reviews and their visibility-aware native translation are also connected. Existing chat/photo/auth/2D/back/notification behavior is preserved.

The existing OSM catalog now participates in the unified map. Catalog IDs and coordinates stay unchanged. Ordinary catalog cards open the existing place detail and review path; exact matching TOP25 IDs merge into one record. A catalog record is not an editorial selection, popularity result or verified visit. Real TOP25 selections remain empty. Credit sales remain held. The owner later approved manually authored partner posts with an AD label; the existing hashtags carry this disclosure through cards, details, map results and pin labels without changing ranking or TOP25 selection.

Map categories now combine with OR: TOP25 + Cafés includes both collections, with exact-ID overlaps once. Removing a category preserves the others; All resets the selection. The content order is TOP25, Restaurants, Cafés, Festivals, Nightlife, Places to Visit, Housing and Buy & Sell, followed by the retained All Events utility. Places to Visit covers attractions rather than the separate food/nightlife categories. City, search, visibility, listing expiry and event dates still constrain the shared map/list results. An active date remains visible and resettable after switching categories.

The fixed-label follow-up translates owned Chilling/Meetup terms, contextual counts and chat dates while retaining member content, nicknames and edited drafts. Meetup creation now translates its catalog city label. Both meetup slot summaries show the existing administrator exemption rather than a finite allowance; this does not alter membership or admission checks.

Native English review also caught a truncated meetup city and the concatenated wording `Vancouverin`. Phone headers now wrap before the city is squeezed, and the city uses one translated template (`in Vancouver` / `밴쿠버에서`).

## Local evidence

Evidence is outside this checkout at `/Users/ash/Desktop/Git/unknown/output/reviews/all-features-simulator-integration-2026-10-15/`. The original72-request audit is preserved; the final resolution report adds current integration/runtime status without rewriting historical observations.

- `combined-final-union-tests.txt`:1208 passed, zero failed, one existing real-clock skip. `verification.json` records the accepted source and check exit receipts.
- `combined-final-union-types.txt`, `combined-final-union-lint.txt`: successful full type and lint checks.
- `combined-final-union-exports.txt`: iOS/Android Hermes and web exports. `combined-final-union-public-merchant-exports.txt` and both `combined-final-union-*-web-check.txt` logs verify the separate public and merchant bundles. These are JavaScript exports, not signed native releases.
- `uri-clean-install-verified.json` and `uri-clean-installed-behavior.txt`: isolated offline `npm ci`, actual patched decoder/router behavior and cleanup. Shared dependencies were not changed.
- Local SQL checks ran in rollback scope. The map test includes the unchanged preceding performance-target baseline required by the ordered migration. Admin integration evidence includes374 SQL assertions and10 concurrency probes.
- Actual iPhone screenshots/AX records include75 catalog pins in Toronto and Vancouver, map/list views, profile A, place detail and an empty review composer. Live list counts vary with city and event expiry. `ios-header-map-route-verification.json` verifies that Meetups and Chat open the shared map and return to their original list. Screenshots and test receipts remain distinct from native inference.
- `ui-labels-review/coordinator-acceptance.json` verifies the independent35-file source review. `map-union-source-acceptance.json` and `map-union-review-resolution.json` bind the single map implementation and its two resolved review findings. The original72-row audit remains unchanged; `request-resolution-final.json` supplies current paths, evidence and external-validation limits.

The installed React Compiler exposed a real language-state bug: components called the language hook but discarded its returned dictionary, allowing first-language copy to remain cached. Render owners now bind the context dictionary/locale. Canonical owned feedback stays untranslated in state and is translated at display, preserving original member text and action results. Regression checks include actual installed-compiler output and mounted language switches without repeating requests, copying links or sending messages.

The existing Today-fix owner supplied `9cc9d26` as an exact four-file handoff. The client now waits abortably for the existing bounded translation queue instead of rejecting the next visible card after rapid scrolling during model download. The popular-feed SQL source adds existing views to the ranking score and retains its eligibility/cursor/access rules. Its rollback regressions passed; production ranking is not changed until the reviewed migration is activated.

The existing Android translation QA binary supplied real Korean↔English model results with protected URLs, mentions, amounts and line breaks. Its native source is `171f9fb`. The installed iPhone26.5 simulator binary predates this native module. The vendor pod excludes arm64 simulators; the compatible x86_64 iOS18.4 simulator failed at launch with `NSMachErrorDomain -308`. Do not claim iPhone inference or signed release install size from JavaScript exports or Android fixture results.

The installed iPhone's compact native date controls still show device-language Korean inside the English meetup form. The shared component already passes the reactive `appLocale` through the installed `@expo/ui` locale contract; its implementation forwards that value to SwiftUI's locale environment. Surrounding labels, city, initial question and action are English. This native-control locale discrepancy remains a runtime validation item; its cause and behavior in an updated binary are not established. No date, time or submitted content was changed to test it.

## Start deployment only after the owner says to deploy

That future instruction authorizes starting the existing release pipeline without a second generic confirmation. Do not create a new scheduler or background release job. Before starting, read current remote history, active workflow/store submissions and backend migration definitions; preserve unfinished submissions and original holds. No release push, tag, workflow dispatch, native submission or production migration was performed for this handoff.

Apply only missing, reviewed migrations in dependency order:

1. `20261014210000_admin_performance.sql`
2. `20261015003000_admin_client_error_audit.sql`
3. `20261015190000_admin_partnerships.sql`
4. `20261015192052_public_web_analytics_targets.sql`
5. `20261015203000_popular_feed_views.sql`
6. `20261015210000_admin_merchant_directory.sql`
7. `20261015212000_unified_discovery_map.sql`
8. `20261015223000_admin_operated_meetup_alerts.sql`
9. `20261015234000_place_review_behavior_targets.sql`
10. `20261016043500_creator_profile_details.sql`
11. `20261016073000_live_behavior_targets.sql`

The normal migration role is required. Compare existing applied definitions before applying: parts of private admin were delivered earlier. Preserve fail-closed function anchors and MFA/audit checks. Run the relevant deployed read checks after schema application.

The separate private-admin owner reported that creator details were already applied under version `20261016043500` and served from source `435e2d0`, with25 records and their existing-field fingerprint preserved. That filename replaces the colliding `20261015230000` version without changing the SQL body. Reuse the actual remote definition/history; do not apply it again under the old filename. This task did not perform that private-admin release and does not treat it as app/public-web/store release approval.

After schema readiness, deploy the reviewed `ticketmaster-events` venue-coordinate/cache change and `draft-post` factual merchant input change before releasing their new clients. Refresh only the existing legacy venue cache as designed. Do not deploy the superseded server translation function/cache or blindly apply files from the original dirty checkout.

The existing `.github/workflows/deploy-pages.yml` publishes Pages on `mobile-app` pushes. The existing `.github/workflows/mobile-release.yml` builds/submits from version tags and supports its current manual build operation. `scripts/release.py` validates matching versions, unfinished App Store submissions and unused native build numbers. Keep its actual published-store checks before changing forced-update policy. Do not bump versions, push `mobile-app`, create `v*` tags or dispatch either workflow while the hold is in force.

Physical-device purchase/refund/restore, push reception, provider permissions and real external publishing retain their separate verification status. They are not proven by this simulator/source integration.


## Owner-approved source corrections — 2026-10-16

The new public member profile proposal now uses a left-aligned identity, two compact review columns, expandable rating criteria and trading detail, an explicit close action, public activity history and a persistent chat action. This is separate from the previously integrated own-profile A. Existing account/target request keys, blocking/reporting, guest login, conversation context and stale-response guards remain. Scores still require five distinct reviewers; no score is invented for a new neighbour. The full activity route retains its visibility filters, cursors and translated metadata.

Map GPS and invalid-date feedback now retain canonical owned strings and translate at render. Same-view English/Korean regressions pass without repeating GPS or changing the entered date.

Analytics migrations add the two public-reader targets and150 current fixed app targets, including static scroll identifiers and the new profile/AD actions. The live-component coverage check reads the current AST rather than relying only on the historical snapshot. Both migrations applied twice and the actual RPC acceptance/retry/unknown-target checks passed inside a rollback transaction in the existing local database. No production database was changed.

For manual advertisements, the owner can enable AD in the existing writer; the existing `AD`/`광고` hashtags persist the disclosure. Other hashtags are preserved; a full five-tag selection is not silently truncated. AI rewriting retains an existing manual AD choice. Native cards/details, discovery results/pin labels and the public reader display the disclosure. A voluntary AD label is not a verified campaign, paid ranking or editorial TOP25 award. No buying, billing, automatic promotion or new backend service was added.

Evidence: `/Users/ash/Desktop/Git/unknown/output/reviews/three-fixes-20261016/`. The actual-component render preview is `/Users/ash/Desktop/Git/unknown/output/design/three-fixes-2026-10-16/index.html`; identity, counts and ratings there are controlled QA fixtures. The existing iPhone is on a meetup-creation form, so its navigation/input was preserved. Source tests and JavaScript/Hermes exports are separate from signed native installation, physical-device verification and production activation. Deployment remains held.
