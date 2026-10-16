# On-device Korean/English translation

Owner approved Google ML Kit on both iOS and Android after confirming the separate language-pack download. Replace paid GPT content translation, reuse the existing language preference and post/comment translation controls, and preserve original content, edits, sharing, location attachments, account boundaries, 2D controls and navigation fixes.

Use a local Expo57 module (`modules/gling-translation`) with pinned GoogleMLKit/Translate8.0.0 and com.google.mlkit:translate17.0.3. No npm translation wrapper, new backend, paid request, database migration or automatic cloud fallback. Only Korean/English models may be requested, initially over Wi-Fi. Existing app builds without the module and web must retain originals and explain availability.

The JS boundary validates source and language, protects URLs/numbers/mentions/hashtags by translating only text segments, limits native batches, deduplicates pending work, bounds in-memory caching, and cancels stale screen/account work. Translation results remain display-only. Existing server safety monitoring and access checks stay in place. First-use consent describes local processing and language-pack storage, not OpenAI. Display required Google attribution beside translated content.

Implementation order: (1) regression tests and native bridge, (2) reuse stable language/translation code and integrate feed/detail/comments/settings without copying unrelated pending changes, (3) render download/error/original states, run tests/types/lint/exports and local native builds, (4) capture measured size and validation limits. Native builds are local verification; no signed store upload or production release.

Checks: `node --experimental-strip-types --test scripts/device-translation.test.mjs`; `npm test`; `npm run typecheck`; changed-file ESLint; Expo autolinking resolve for apple/android; CocoaPods/Xcode simulator build and local Android Gradle build when the existing toolchain is available. No real user content is sent to a remote translation provider. Native download/inference, app install size and JavaScript mocks must be reported separately.

Official sources read before implementation:
- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/modules/get-started/
- https://docs.expo.dev/modules/module-api/
- https://docs.expo.dev/modules/autolinking/
- https://developers.google.com/ml-kit/language/translation/ios
- https://developers.google.com/ml-kit/language/translation/android
- https://developers.google.com/ml-kit/language/translation/translation-terms

Design: reuse the current compact text action and settings card. Google language selector reference https://mobbin.com/screens/0cebf73d-e923-4e12-95eb-af68aac46237 shows download arrows beside language rows. Keep touch feedback, visible download preparation/failure and original text; no new decorative button treatment.

Google branding: https://docs.cloud.google.com/translate/attribution requires the official powered-by badge beside translated results, “Translate with Google” action wording and the translation warranty disclaimer available in settings. The six PNGs under `assets/images/google-translate*` are unmodified regular/white 1x/2x/3x badges from https://docs.cloud.google.com/static/translate/images/google-translate-attribution.zip, displayed at their official176×16 size. They are Google brand assets used under these attribution rules, not original Gling artwork. Store descriptions/help should mention Google Translate and link https://cloud.google.com/translate when this native feature ships.

Native verification limit: Google’s current iOS pod excludes arm64 simulator builds. The existing iOS26.5 simulator runtime is arm64-only; local verification therefore targets the existing x86_64-capable iOS18.4 simulator. Do not remove the vendor exclusion to force the newer simulator, and do not compare its raw x86_64 app size with the previous arm64 debug app as an install-size increase. Physical iOS/Android release-size and translation-quality checks remain separate from compile/export/fixture tests. No language models are bundled in the app.

Integration boundary: language foundation and its settings card are reused here; complete UI localization, the unified map route, profile-A layout, merchant/admin/analytics changes and unrelated dependency-lock repair stay with their existing owners. This branch is not the combined pending-feature release.
