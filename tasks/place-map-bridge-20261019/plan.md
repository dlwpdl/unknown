# Canonical place → shared map

Approved scope: Home/full-list cards open the existing map at the same catalog ID and city. Keep reviews/details and external directions reachable. Reuse the existing map, camera request, filters and feedback; preserve GPS/blue marker behavior and embedded-map callers. Do not mutate community-city preference, make a duplicate place registry, or change the catalog owner's files.

1. Test real route callbacks, canonical map identity, explicit-target camera lifecycle, result cap, and English curated copy with the real language/locale contract.
2. Add one shared internal route helper. Resolve route city/place against the existing catalog, select the correct filter and pin once per focused target, including async catalog readiness. Keep curated pins before the 500-item cap.
3. Update Home/full-list callers and add a detail-map entry using existing control styling and selection feedback. Fix `locale === 'en'` in the three curated-copy callers using `language`, retaining locale for Intl dates.
4. Run focused map/navigation/language checks, type/lint/full repository checks, and render/view the changed detail entry and KO/EN curated copy. Send one isolated source commit and changed-file hashes to the release owner; same sole native installer verifies installed Home/list → exact pin → detail/reviews/directions/back/GPS on iOS and Android.

Reference actually viewed: https://mobbin.com/screens/5b38f4ff-989f-4634-a8e6-1072bbd2d9ab (Google Maps selected pin with bottom place card, rating, photos and Directions). Retain Gling's approved map layout rather than changing its visual system. No image generation, provider call, new dependency, build/install/reset or GUI ownership change.

Catalog reselection is independently owned by run_3b9c2f0283ed. This UI packet is not evidence that all eleven cities contain fifty reviewed places, or that a native installation/store update has occurred.

Source verification: four new navigation/language checks failed before implementation and pass after it; 62 focused caller/map/analytics checks pass. Full suite: 1540 pass, zero fail, two existing skips. Typecheck, changed-runtime ESLint and diff checks pass. Existing caller harnesses were updated for the map's explicit city prop, focus hook and shared route export; data-owner test sections are untouched. Eight actual-source fragment renders pass in KO/EN, light/dark and 320/390px, with 44px controls and no overflow; final PNG was viewed. Evidence: `unknown/output/reviews/gling-place-reselection-2026-10-19/map-bridge/`. Native acceptance is pending the release owner's integration and sole installer's preserving update.
