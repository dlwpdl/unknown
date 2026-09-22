# Build 35 — signup input fixes

Owner authorized a new build and review submission after reporting birth-date formatting and optional-consent signup failures.

- Version 1.0.2, iOS/Android build 35. Fix commit `8123ca3`; build configuration `e67a1cd`.
- Numeric birth dates format as YYYY-MM-DD. Declined optional personal-information consent submits null name/date/consent version, even if a partial draft remains. Mandatory agreements and validation of consented dates remain enforced.
- Isolated source reused `/tmp/gling-release34-live` and was checked against committed source; unrelated working-tree edits excluded. No database migrations or screenshot changes.
- All 195 tests and TypeScript passed. Native iOS archive/export and Android AAB/APK builds succeeded. Both bundles contain the date formatter and prior production ad units. Android AAB/APK upload certificate matches the existing upload key.
- Private artifacts, logs and receipts: `~/Library/Application Support/gling/releases/1.0.2-35-signup/`.

## Apple

Canceled build 34 review submission `85319b05-e631-4d08-b922-bd58f3b1591d` after build 35 became VALID. Attached build `116be760-b65e-4d78-9961-ed64e56f1300` to version `2b88fa4f-a384-4408-aba9-75b67f46886a`. Added signup fixes to Korean release notes. Validation: zero errors/blockers; existing optional subscription-promotion image and keyword warnings only, privacy publication not verified by that API check.

Submitted `b64e646b-c08c-4cfa-8106-3fc79c28f2ef` at `2026-09-22T00:18:47.457Z` (September 21 PDT). API confirms WAITING_FOR_REVIEW and build 35. Six approved screenshots retained.

## Google Play

Build 34 was already published to Alpha. An API-only upload remained isolated from the Console; discarded that uncommitted edit, then uploaded the signed build 35 via the authenticated owner Console. Saved release `1.0.2 (35) 가입 입력 개선` to the same closed Alpha track, with the signup-fix release notes, and confirmed Send for review.

Publishing overview shows build 35 under 검토 중인 변경사항. Google automatic pre-review checks are still running; the Console states the changes will move into review when those checks succeed. This is a closed test update, not public production. No reviewer approval or public release claimed.

If review finds a regression, withdraw the pending submission; the previously published versions remain available until the update is approved/released.
