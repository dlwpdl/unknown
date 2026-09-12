# Preferred region and GPS display — 2026-09-12

## Result

- Explicit city selection saves the signed-in member's `profiles.city_id`. Clear the previous city's neighborhood only when the city changes. Save failures retain the previous selection; duplicate taps are ignored while saving. Guests can browse without a database write.
- Saved profile city takes priority over the GPS recommendation. Navigation to a just-published post's city remains temporary browsing.
- Profile summary and quota reload after a saved region change. Existing quota/membership rules remain server enforced.
- Existing admin analytics count current preferred regions; moving a member subtracts from the previous region and adds to the new one on refresh. All selectable cities can be filtered, including cities awaiting launch. This is current population, not a historical migration ledger.
- Admin member detail displays the named preferred city and GPS-derived nearby community separately, with existing coordinates and measurement/receipt times. Missing GPS stays missing; no preferred-city fallback fabricates a GPS record. Historical snapshots use their measurement time for geographic labeling and are not presented as live location.
- The existing GPS matcher covers the Vancouver and Toronto community catchments. Outside supported catchments or with unusable accuracy, the admin shows that no supported city is available.
- User guidance explains that GPS finds a nearby city community for neighborhood news, while a directly saved preference has priority. Existing consent, retention, and withdrawal disclosures remain.
- No new schema, migration, API, dependency, or location collection was needed. Existing admin authorization, audit logging, and 30-day GPS retention are reused.

## Verification

- Reproduced the saved-city/GPS precedence bug with `scripts/community-city.test.mjs` before the fix; the regression passes after the fix.
- `npm run typecheck` and `npm run lint`: pass.
- `npm test`: 85/85 pass.
- `npx --no-install supabase test db`: 25 files, 386/386 pass. Includes own-profile permission checks, region count transfer, invalid city rejection, and a Toronto preference alongside the recorded Vancouver GPS snapshot.
- Private admin web export: pass, `.admin-dist` rebuilt.
- iOS and Android Expo exports: pass, `/tmp/gling-region-native` (JavaScript bundles, not signed/installable app builds).
- `git diff --check`: pass.
- Browser visual check not completed: Orca's tab list reports the existing Gling folder, but its workspace selector returns `selector_not_found`. No unrelated browser tabs were changed or created.

## Delivery

Code and local private admin export are updated. No signed mobile build was installed or distributed, and no production database data was changed for testing. The installed app requires a new build for this behavior.

UI reference inspected through connected Mobbin before the display change: [GoDaddy address fields](https://mobbin.com/screens/9ef61d30-06a4-43bf-8b90-aef5a43bf64a). Existing Gling admin components and styling were retained.
