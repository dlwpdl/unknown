# Gling admin redesign — 2026-10-09

The owner requested a redesign of every admin dashboard page, specifically AI safety, keyword alerts and users, using Apple Design and actual Mobbin screens.

## Scope and direction

Keep the existing Expo 57 / React Native Web dashboard and its 12 sections. Use an isolated, cool light admin palette with the current Gling iris identity, system typography, a fixed sidebar and utility header. Use one page heading, compact search, collapsed detailed filters, readable rows, Korean risk/status labels, quiet empty states and consistent detail panels. Preserve all current filtering, pagination, account actions, monitoring coverage, evidence retention, MFA and audited server calls. Prefer the existing ThemeOverrideProvider, table controls and feedback hook. No new dependency, database change or automation.

## Evidence

- Apple Design: immediate press feedback, familiar wayfinding, typography hierarchy, progressive disclosure, reduced motion and transparency, 44px controls.
- Google Workspace: https://mobbin.com/screens/bb4d7f66-148a-4b86-829c-0f43a2d0b21d — persistent navigation and compact member rows.
- incident.io: https://mobbin.com/screens/91cca104-910b-49b5-b280-2ed7738259f6 — separated alert source, priority, state and filter toolbar.
- Sentry: https://mobbin.com/screens/af1214cb-f31a-4a41-93c0-f3fef0635834 — issue list with distinct summary and metadata.
- BrandKit product tokens match the checked current Gling night palette; admin light is an intentional separate theme. Kroma did not return references because its configured search credential is unavailable.

## Implementation and verification

1. Render current source with isolated fixtures; save baseline screenshots and current working source backups.
2. Establish admin tokens and shell, then redesign safety/alert review rows and shared filters, then unify analytics, revenue, merchants, reports, users, posts, conversations and detail views.
3. Run `npx tsc --noEmit`, `npm test`, changed-file ESLint and `GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir output/design/gling-admin-redesign-2026-10-09/admin-export`.
4. Open actual React components in a standalone HTML preview. Check every section at 1440, 768 and 390px; test filtering, search, details, navigation, keyboard focus and reduced motion. Fixture numbers are explicitly examples and never evidence of measured operations or UX improvement.

Source: `src/components/admin/`, `src/constants/theme.ts`, `src/lib/admin.ts`. Preview and screenshots: `output/design/gling-admin-redesign-2026-10-09/`. The source backups preserve unrelated uncommitted owner work. Public website and store release are outside this task.

Completed: all 12 sections are implemented and applied to the existing private local server. TypeScript and changed-file ESLint pass; 475 tests have 474 passes, 1 skip and no failures. The standalone actual-component preview passes 36 viewport checks and navigation/search/filter/detail interactions. The local server's 42 final files match their recorded hashes. The final merchant CSS correction retains the verified Expo JavaScript and excludes concurrent, unrelated profile edits. Previous HTML and static assets are preserved.

Authenticated moderation actions were not executed. A React 419 SSR recovery warning reproduces with both the original and updated login page; login remains visible. See `output/design/gling-admin-redesign-2026-10-09/completion.md` and the JSON verification records for scope, evidence and limitations.
