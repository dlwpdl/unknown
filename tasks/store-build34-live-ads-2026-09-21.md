# Build 34: live ads and store resubmission

Owner requested AdMob re-verification and submission to both stores with the prepared screenshots, then reported continuing test ads.

- Build 33 iOS binary omitted the production ad-unit ID. The existing code deliberately uses test units unless EXPO_PUBLIC_ADS_MODE=live. Added a non-secret .env.production with that setting; __DEV__ still forces test ads. Existing UMP clearance and PG rating remain unchanged.
- Bumped iOS/Android build to 34 (version 1.0.2). Built locally from clean committed source, excluding unrelated admin, marketing and mock-data edits. Membership limits/copy from 957dc74 are included. Source configuration commit: bcadd0d.
- Ads/membership tests: 10 passed. TypeScript passed. Verified each final Hermes bundle contains its platform-specific production ad-unit ID.
- Apple screenshot set: six COMPLETE files, MD5 matches the approved ios-6.9-build33 directory. Google: three phone screenshots match the approved phone-build33 files; intended order is home, cities, login.
- AdMob Check for updates executed; Google AppAdsTxtService requests returned HTTP 200, but iOS still reports details mismatch / Not verified. Android remains unlinked / Requires review while Play is closed Alpha. Do not claim live serving is approved.
- Private artifacts and receipts: ~/Library/Application Support/gling/releases/1.0.2-34-live/.

## Submission receipts

- Google Play: build 34 and phone screenshot order submitted together through the authenticated Console. Publishing overview confirms 검토 중인 변경사항, pending automatic checks before review. Alpha only; not public production. API readback confirms versionCode 34 and the three screenshot SHA256 hashes in home/cities/login order. Service-account validate/commit returned 403, so submission used the owner’s existing Console session without changing account permissions.
- Apple: 1.0.2 (34), build c725d17c-6d2d-4ee7-9adf-4adb81833d80 is VALID and attached to version 2b88fa4f-a384-4408-aba9-75b67f46886a. Submission 85319b05-e631-4d08-b922-bd58f3b1591d is WAITING_FOR_REVIEW, submitted 2026-09-21T22:37:10.522Z. Post-submission check confirms all six screenshots remain COMPLETE with matching local MD5 hashes.

