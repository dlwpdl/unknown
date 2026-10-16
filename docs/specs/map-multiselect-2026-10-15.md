# Map category multi-select

Approved by the owner on2026-10-15. Source application is authorized; deployment remains held.

- Selected filters combine with OR. TOP25+Cafés shows every verified Top25 place and ordinary cafes. Existing exact-ID merge runs once before filtering, so the overlap appears once and distinct branches stay separate.
- Categories appear in this order: TOP25, Restaurants, Cafés, Festivals, Nightlife, Places to Visit, Housing and Buy & Sell, followed by the retained All Events utility. All/reset remains before the category chips. No selection shows all results; tapping a selected chip removes only that selection.
- Places to Visit covers attractions/nature/activities/libraries/shopping/trips/exhibitions, separate from the explicit cafe, dining, nightlife, festival and trading filters. The existing events deep link and nonfestival event access remain available through All Events.
- Query, current city, visibility/block/report rules, listing status/expiry, event dates and500-result limits apply outside the union. Map and list share the same results.
- An active event date remains visible and can be reset after switching to a place category.
- Event requests are skipped when no selected source includes events. Mixed selections load an unrestricted public post page; one Housing or Buy & Sell selection retains the existing tag-limited request. No RPC/schema or permission change is needed.
- Real editorial Top25 selections remain empty. Top25-only shows the existing honest empty state; adding Cafés still shows ordinary cafes. No OSM record receives a fabricated Top25 badge.
- Filter chips retain44px targets and existing flat styles, give selection feedback, and expose explicit checkbox names and checked state. The existing account/city remount and stale-request cancellation remain.

Evidence: scripts/discovery-multiselect.test.mjs and existing discovery screen/catalog/Top25 suites. Actual existing-simulator verification belongs to the combined source/runtime owner after guarded application. No native build, dependency install, paid call, commit, push or deployment is part of this patch.
