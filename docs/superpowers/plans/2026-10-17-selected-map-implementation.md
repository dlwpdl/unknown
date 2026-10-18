# Selected map implementation

The owner requested implementation of the selected A layout and B loading capsule after confirming they existed only in the HTML preview.

Reference: `/Users/ash/Desktop/Git/unknown/output/design/gling-map-redesign-2026-10-17/report.json` and its approved `index.html`.

Keep the existing `/map` route, OpenFreeMap Positron, discovery eligibility, privacy filtering, GPS validation, translations, cards, directions and pagination. Reuse installed dependencies and the existing shared GUI queue. Native/store upload and minimum-version policy remain unchanged.

1. Add a component-level interaction check for the compact toolbar, category/date sheet, date validation, reset, list/map switch and fixed-dark loader. Observe failure before implementation.
2. Update `src/app/map.tsx`: one title row, search with filter control, one category row; move dates/help/login into a scrollable bottom sheet. Retain all category choices. Extend the shared `GlingLoader` with the selected capsule variant and keep existing callers unchanged. Reuse existing analytics targets and add the three required English labels. Adapt the affected category/date regression fixtures.
3. Run focused discovery checks, TypeScript, lint and the full Node suite. Render actual components at narrow/wide widths and inspect the result.
4. Commit the scoped change. Coordinate a frozen source handoff with the existing native owner; verify the exact source in a new local simulator artifact and inspect the map when user input permits. Preserve any separate store/publication holds.

The latest ad-cadence change `3bc57b7` is part of the starting source and must be retained.
