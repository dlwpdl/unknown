# Dining and Gling Visited discovery

User scope: continue the other ten cities, restore useful cafe and restaurant discovery, and add Gling Visited to the map.

Assumption: Gling Visited means the team's attested firsthand visits, consistent with the approved existing VISITED editorial label. An optional clarification is pending; ordinary user reviews, external photographs and curated picks do not attest a team visit.

## Acceptance

- Keep the shipped Vancouver 50 and its photographs, ratings and canonical place identities.
- Source40 owns reviewed dining/visit records and existing city helpers, photos, ratings and request histories. F5 owns map/list UI and caller checks. Root3309 owns the next integration pin; the submitted 1.4.2 tag stays immutable.
- Cafe and restaurant tabs show their reviewed category records even when those places are outside TOP 50. All includes them without duplicates. Do not restore unreviewed franchise padding or relax post visibility/moderation rules.
- Gling Visited is a single map category alongside All, TOP 50, restaurants and cafes. Only exact city/place matches with explicit firsthand evidence qualify. A purple VISITED marker and the existing Gling wordmark identify these places on the selected card.
- Preserve canonical place details, Gling reviews and directions. Preserve category exclusivity, festival-only date controls, fresh explicit target navigation and ordinary Back behavior.
- Show an honest empty state for cities with no attested visits. Do not invent a visit date, rating, photo or public Reel.
- Every changed control keeps selection feedback and a 44px target. Review KO/EN, dark/light and 320/390px widths with the actual source.

## Sequence and checks

1. Current-source RCA and source-owned getter/record contract.
2. A failing behavior check for visited filtering and canonical record preservation.
3. Small UI/data wiring, then targeted Node tests.
4. HTML review using actual code and approved brand assets, headless rendering and visual inspection.
5. `npm test`, `npx tsc --noEmit`, `npm run lint`, `git diff --check`; freeze only scoped files and send their hashes to root.
6. Root integrates accepted city cohorts. Sole6ac handles any later normal preserving native refresh. F5 does not build, install, control the GUI or mutate Stores/accounts.

Existing dependencies and patterns suffice. No new service, dependency, job, worker, database, paid call or publication is needed for this UI change.
