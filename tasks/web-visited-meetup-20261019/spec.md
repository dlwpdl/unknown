# Gling Visited on web and destination-to-meetup flow · 2026-10-19

## Objective and accepted direction
The owner wants real places, cafes, restaurants and festivals to lead to meeting people: find an existing eligible meetup for that exact destination, inspect it and request participation; otherwise create a meetup with that destination already selected. Public web must show Gling Visited and use the same canonical Gling map location as the app. Existing city filling continues independently, with more than50 restaurants allowed separately.

## Assumptions already surfaced
Visited means Gling team firsthand visits, never ratings/curation. The current web public reader remains anonymous for discovery; use existing shared detail/join and app handoff for creation until API/privacy owner changes that policy. Place and event identities remain stable and city-scoped. Exact source identity, not title or proximity, joins a meetup to a venue. The current registry is empty because the attested HANDSON visit still needs an accepted canonical place identity; no fake production visit or coordinates will be inserted for a demo.

## Stack, existing reuse and smallest slices
Expo57/React/TypeScript, existing public reader and read-only Supabase transport. No new dependency, provider, service, job or worker.
1. Public /visited?city=vancouver&placeId=... page with home navigation, city selection, actual attested-only cards and selected canonical place panel. Reuse getCityPlaces/subscribeCityPlaces, CityPlacePhoto and DiscoveryMap (its existing iframe on web); never import native MapScreen or authenticated discovery loader. Desktop list/map; narrow screen list/map switch. The selected card and map pin keep one exact placeId. Optional app map deep link carries same cityId/placeId.
2. Destination module in native place detail and event detail: existing eligible meetup list; existing post detail/join/request; create action. Festival currently already supports find/create by Ticketmaster eventId. Add place prefill through the audited existing composer boundary, preserving unknown drafts and explicit consent.
3. Web venue panel uses the same safe linkage and public eligible list; create action hands off exact destination to app. No public event/location/member fields beyond already-approved readers. Data owner integrates actual visited record and rights-compatible photo after identity verification.

## Proposed files and ownership
F5 proposal: new src/components/public-web/visited.tsx, visited.css; new src/web/visited.tsx; small navigation insertion src/components/public-web/reader.tsx; new focused scripts/public-visited.test.mjs and spec. Shared composer/meetup/RPC/public transport source remains read-only until Root3309 and source owner handoff exact files/contracts. DiscoveryMap source and city data helpers remain read-only reuse. Root owns any DB/RPC visibility decision; Source40 owns collection/catalog/photos/ratings/visited canonical data. Native6ac remains sole controller and frozen current e4 remains untouched.

## Design research and rationale
Apple Design: immediate pressed/focus feedback,44px controls, one primary action, reduced motion and reversible panels. Actual Mobbin Meetup web screen https://mobbin.com/screens/7e48b26b-a709-413a-be4b-eac987f5de1d viewed: venue map with address, date/meeting info and persistent attendance action. Transfer the location-to-action continuity, not its donations or online-meeting fields. First Luma results were a report dialog and organizer check-in screen, so they are not evidence for the intended join flow. Preserve current Gling wordmark plus restrained purple VISITED, WebNightColors and honest empty/error states. The updated creative-library README was read; no creative/video example is being reclassified or generated here.

## Code style
Use direct existing functions and component-local state, keyed by city and place. Follow neighboring DOM TSX/CSS. Every changed or new control calls useInteractionFeedback().play(selection); minimum44px, focus-visible and keyboard semantics.

## Commands
Focused: node --experimental-strip-types --test scripts/public-visited.test.mjs scripts/public-festivals.test.mjs scripts/web-trust-boundary.test.mjs
Types: npx tsc --noEmit
Lint: npx eslint src/components/public-web/visited.tsx src/web/visited.tsx src/components/public-web/reader.tsx
Full: npm test
Web artifact: npm run export:web and npm run check:public-web (only in the authorized isolated source checkout, no deploy).

## Acceptance checks
- Only exact attested city/place registry entries appear; actual no-entry city has an honest empty state.
- Card/map selected identity is consistent across city changes, deep links, back and retry; no auto GPS request or other-user location.
- Failed meetup lookup is distinct from a successful empty result. Closed, cancelled, past, blocked or nonpublic meetups are never offered as joinable.
- Existing detail/join profile, capacity, consent, rate limits and permissions remain enforced at server boundaries.
- Creating a destination meetup preserves manual edits/drafts and does not post until explicit submit. No production creation/join/AI call during QA.
- Actual source UI renders at320/390/1440, no clipped numbers or overflow,44px controls, keyboard/reduced-motion; light/dark for native changed surfaces. Public web follows its current night theme.
- Exact source paths/hashes, tests, export, actual native install and public deployment are reported separately.

## Current state
Web slice1 accepted and implemented under exact Root3309 ownership grant; native flow contract remains with Root. No public deployment or native/hosted actions.
