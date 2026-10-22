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
# Native destination increment · 2026-10-19

Owner intent: places, cafés, restaurants and festivals lead to a same-destination meetup; reuse existing detail/request/join and composer. Root scope/contract is Orca `msg_7e496465baf3`; no new SQL, RPC, dependency, automatic post/join/AI or global city change. Map badge state is separately completed in `8b51a1d`.

Use current canonical city/place identity and exact OSM URL. Save a readable immutable source tail in the existing body; keep Ticketmaster body references compatible. Preserve it through editing and AI; hide valid tails from prose and expose meaningful source navigation. Reject stale, conflicting or invented destination routes. Escape literal ILIKE query characters, then exact-match visible results against the canonical reference. Keep the raw feed cursor before filtering: an empty filtered page with a cursor remains incomplete, never “no meetups”. Source route city is local to the screen. A late event prefill preserves manual/AI edits, host consent, visibility, quotas, existing revalidation and draft guards.

Order/checkpoints: failing pure identity/tail/matching tests → helper → raw-page search and local-city routing → guarded prefill/source-tail preservation → existing join/detail reuse → source controls using the documented shared design foundation → actual KO/EN dark/light renders → full tests/types/lint and frozen source packet. Existing native installer and release coordinator perform integration/install; this task makes no native deployment claim.

Commands: `node --test scripts/meetup-destination.test.mjs`; affected existing meetup/discovery/AI tests; `npm test`; `npx tsc --noEmit`; ESLint on changed runtime paths. Tests use current code with local fixtures, never production posting or joining. Existing protected source paths outside the granted native slice remain read-only.


## Native destination implementation — 2026-10-19

Place detail hands off its exact canonical place/city to meetup discovery. Discovery keeps the public server visibility contract, uses the raw page cursor before exact destination/hidden/kind/date/seat filtering, and distinguishes an incomplete empty page from an exhausted filtered list. The existing create action carries the same source into a city-scoped draft without changing the preferred city. Ticketmaster callers now pass an explicit source city and preserve their existing event body contract.

A verified OSM place uses an immutable human-readable body suffix; AI edits and post editing change only the invitation. Creating a meetup still requires explicit publication and consent to the current host-profile revision. Existing join/request/quota flows remain in PostDetail. Unknown/conflicting source parameters block creation rather than silently choosing the preferred city.

New controls reuse the shared design-system module, existing feedback and registered analytics targets. The legacy find target is distinguished by place-detail/event-detail screen, with no place/event identifiers or draft text in analytics. Existing guest no-parser and on-device translation checks remain intact; a test-only real-source loader resolves their new bundled-catalog dependency without changing Metro imports. All existing English dictionary pairs remain unchanged.

The minimal valid-place caption in the legacy public ReaderContent post branch preserves source meaning; live /post and /share routes continue through SharedPostRoute and its existing guest gate. Authenticated shared post details use the same PostDetail map action. This feature grants no anonymous joining, new public RPC, SQL/schema change, deployment or native installation. It remains a separate complete source increment after the frozen 9938a8a installer.
