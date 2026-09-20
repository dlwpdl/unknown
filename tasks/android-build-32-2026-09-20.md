# Android build 32 — 2026-09-20

Owner requested Google Play submission alongside the already-submitted Apple build 32. Android source `bdc9756`, version 1.0.1 (32), package `com.dlwpdl.gling`. Includes the signup consent, meetup cover photos and recommended-age changes in iOS 32. Only the Android version code changed for this build.

## Build and verification

- Expo prebuild and signed Gradle `bundleRelease` / `assembleRelease` succeeded (JDK 17, SDK 36, min SDK 24). No new dependencies or signing keys.
- AAB and APK signatures match existing upload certificate SHA-256 `413e75957cf604fd225a37527cce90b7379f3226b572f2b589c77396dcbfefbd`. APK version/package and 16 KB ZIP alignment checks passed.
- Both packaged Hermes bundles contain the production Supabase URL, new-purpose consent version `2026-09-19`, recommended-age and unverified wording; no local backend URL.
- Existing feature validation: 183 Node tests, TypeScript, lint and 113 scoped pgTAP assertions passed before the iOS release. No feature code changed for Android. Existing dependency audit has 16 moderate findings and zero high/critical findings.
- Signed APK installed over the existing QA installation on `Gling_Release_API_36`, emulator 5560. Cold launch succeeded and the production home feed rendered; no AndroidRuntime/ReactNativeJS error was captured. A transient Android **System UI** not-responding dialog was dismissed with Wait; the subsequent home UI was readable. This is an emulator smoke check, not physical-device signup, photo-selection or Play Billing verification.
- AAB SHA-256: `46ef9cc24b4e19ef3e90b083386a4da5fa805e0ef4182905227cc6b38d6ebafc`.
- APK SHA-256: `ec54f4c38805febef5556578ced73b7b9190835ddcecd7ed607ffd48db8c81ec`.
- Private artifacts, logs and screenshots: `~/Library/Application Support/gling/releases/android-1.0.1-32/`.

## Google Play preparation

Fresh readback before changes: internal testing has completed build 15; production, beta and alpha have no releases. Production access is locked: Console requires at least 12 opted-in closed-test users for 14 days and currently reports zero opted-in users.

Prepared existing closed-test Alpha track `4699661949237724749`: Canada, South Korea and United States; only the existing Gling internal tester list (one member), with the unrelated Rottery list unselected. Feedback contact is the existing `gling@ej-entertainment.com`. Korean release notes describe signup consent, recommended ages and optional information disclosures. No invitations or messages were sent.

Uploaded AAB 32 through the authenticated owner Console and saved release 1 to Publishing overview. Play recognizes version 32 / 1.0.1, API 24+, target 36, four ABIs and attached native debug symbols. Release validation has no blocking artifact errors; its sole warning is the absent R8 mapping file (release minification remains disabled). Fresh API bundle readback returns the exact local SHA-256 above. Alpha reports `completed` / `[32]` in the track API, but **this is not review submission or tester availability**: Publishing overview explicitly says the 14 pending changes have not been submitted and its Submit button is disabled. Internal testing remains completed build 15; production and beta remain empty.

Child Safety Standards is the remaining mandatory App Content declaration. Console requires a public CSAE policy URL, a prepared child-safety contact and an assertion of compliance/reporting to relevant authorities. Existing in-app reports and prohibited-content terms do not establish an operational authority-reporting process. Asked the owner for the actual contact and procedure; did not certify unknown facts. Review submission remains pending that information. Apple review submission was left unchanged.

Publishing overview's issue dialog specifically confirms one blocker: **Incomplete Child Safety Standards declaration**. Automated pre-review checks were still running at this snapshot, so no claim that every automatic check has finished. Only this task's Android emulator 5560 was stopped after QA. Existing unrelated marketing changes were preserved.
