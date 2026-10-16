# App language selection

Owner-approved scope: use the device language by default, allow app-only Korean or English, retain the choice after restart, and let users return to device settings. Other device languages fall back to English. Refresh device language on foreground, preserve navigation and drafts, and never translate user posts/messages automatically.

Use existing React Native settings/Intl and AsyncStorage; no new dependency, service, schema, paid translation, push notification change, native binary or publication. Reuse current theme, controls, accessibility, and interaction feedback. Add a compact three-option language card to profile settings and a guest-accessible selector so signed-out users can override the default. Translate shared dictionary and app-controlled UI copy, retaining safety/consent meaning, IDs, notification/content bodies and submitted user data.

Implementation: pure language resolution and typed Korean/English dictionaries; reactive preference provider following the existing theme pattern; update actual UI consumers without remounting the app; locale-aware date labels. Keep private admin collaboration files outside this task.

Design reference: N26 https://mobbin.com/screens/80d6cc95-50c6-47a4-a556-d900b9d15c47 (separate options, clear selection). Existing BrandKit product tokens: dark #0B0B12, card #171722, accent #CBB9FF; use theme variables including light theme. Render an interactive HTML preview under output/design and inspect it.

Verification: node --experimental-strip-types --test scripts/app-language.test.mjs, npm test, npm run lint -- --no-cache, npm run typecheck, web and iOS/Android JavaScript exports. Browser checks cover Korean/English system defaults, manual override, persistence/reload, return to device default, unsupported locale, unchanged draft/user content, save failure, narrow layout and controls. Keep the feature changes uncommitted for the owner’s next combined release; do not create a signed build, deploy, or submit. Verification exports are JavaScript/static checks only.

## Verification result

2026-10-15: full Node suite 970 passed, 0 failed, 1 conditional merchant-export check skipped before the export existed. TypeScript and ESLint passed. iOS/Android JavaScript-only exports and public/merchant static exports passed. The actual provider/control browser harness passed all 12 lifecycle, persistence, failure, keyboard, content-preservation and narrow-layout checks with zero browser errors or backend requests. Screenshots were inspected in Korean and English at 320px. Native device-locale fields were tested with platform mocks; no physical-device language/settings/foreground test or signed native binary was run.

The app-language preview uses the actual provider, theme and selector with sample surrounding content; it is not a full-app or simulator run. User-generated content and server push bodies retain their original language. No package, native configuration, Supabase migration, admin implementation or production release file was changed.
