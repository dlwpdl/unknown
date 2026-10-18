# Integrated Map Details Implementation Plan

> **For agentic workers:** Follow the approved spec with incremental implementation and test-driven checks. The supervisor owns integration and final acceptance; the designated existing native owner retains install/QA ownership.

**Goal:** Implement the approved entity cards, visible local event windows and public housing addresses without copying posts or adding providers.

**Architecture:** Reuse DiscoveryItem, PostMapBody and the existing map/list/detail routes. A small public-address reader is shared by the housing card/detail. Existing Ticketmaster daily requests and source guards remain authoritative.

**Tech Stack:** Expo57, React19, TypeScript6, installed React Native Web/MapLibre, Node tests.

**Spec:** docs/specs/integrated-map-details-2026-10-18.md

## Global Constraints
- Preserve existing foreign TOP25 edits and all current data/auth/privacy boundaries. No new dependencies, database fields, external provider calls, Store deployment or version floor change.
- Reuse existing isolated checkout. Each worker owns exact files. No second native installer or simulator.

## Tasks
- [x] Address worker: implement and test postPublicAddress(body): string|null in src/lib/post-maps.ts; show registered public address/fallback in housing listing PostDetail; do not commit supervisor files.
- [x] Supervisor: add rolling seven-day date behavior and event-day filtering tests before implementation in discovery.ts/map.tsx. Preserve explicit date selection and partial-success results.
- [x] Supervisor: implement price/entity/address/photo presentation using existing controls; add faithful English UI copy and responsive component checks.
- [x] Supervisor: integrate and review worker diff; typecheck/lint and 1,443 Node tests (1,441 passed, two environment/time skips), plus 24 actual-source layouts across 320/390/1120px. Independent review passed 43 targeted tests with no important findings.
- [ ] Supervisor: merge only owned hunks into canonical, preserving other edits.
- [ ] Existing native owner: normal local update and actual map/list/detail checks with data preserved; supervisor records source/installed proof separately from browser checks.

## Verification evidence
- Address worker commit: `4e0503ae24f4fc6145b578379b6cecb3cbc8c3a7`; 88 focused/existing post-map/detail checks.
- Red/green date, card, partial-day failure and same-place photo preservation checks; full typecheck/lint/Node validation recorded externally.
- Actual React Native Web source/style renders: 24 cases across 320/390/1120px, Korean/English and light/dark; inspected rendered images. Fixtures and static basemap are identified and do not count as native QA.
- Artifact directory: `/Users/ash/Desktop/Git/unknown/output/reviews/gling-integrated-map-details-2026-10-18/`.
