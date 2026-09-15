# Gling store monetization status

Checked: 2026-09-12T21:03:43.756350-07:00

Read-only recheck; no upload, submission, financial transaction or account changes.

- Apple public API: app 6809273242 / version 1.0.0 is REJECTED; submission 86deeeed-7156-484d-aa26-e3ee81a1b1a5 is UNRESOLVED_ISSUES. This is the same submission documented in release/app-review/2026-09-11/README.md (2.1, physical-device video and explanatory material). Browser session expired, so message contents were not freshly retrieved.
- Apple subscriptions: all four remain READY_TO_SUBMIT. Latest uploaded build remains 11, uploaded 2026-09-11 14:45:37 PDT, VALID; today's local ads, memberships, city and splash work is not in that upload.
- Apple agreement/bank/tax activation: reuse the direct earlier September 12 verification in tasks/ads-membership-fix-2026-09-12.md; not reauthenticated here.
- Google Play payment profile: bank account present; no deposit-verification warning. Plus and Premium each have 2 active base plans (4 total), rechecked in the subscription list.
- Google Play dashboard: now 10/11 setup items complete, remaining Data safety. Target audience is now shown complete (supersedes earlier 9/11 note). Production inactive. Closed test: 0 opted-in testers; console requires 12 or more for at least 14 days.
- AdMob Gling iOS and Android: both Requires review / Limited ad serving / Add store to lift limit, no linked store. Do not confuse with Rottery iOS, which now has an App Store link.
- Code/device evidence remains tasks/membership-native-qa-2026-09-12.md: iOS ad validator passed and Android test-ad rendering was observed by the other agent. Apple native prices/login entry were verified, but Sandbox purchase completion, restore and server entitlement propagation remain unverified. Default local ad mode is test.

Sources: authenticated App Store Connect API, existing Gling Orca Play Console and AdMob pages, and the explicitly dated records above. No new store approval or production purchase success is claimed.
