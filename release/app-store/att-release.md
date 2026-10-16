# ATT privacy fix — 1.3.1 (68)

Apple rejected 1.4.0 (68) under Guideline 5.1.2(i): the Google consent form disclosed tracking, but the app never requested Apple's App Tracking Transparency permission. Google UMP consent and non-personalized ad requests do not replace ATT.

The iOS advertising entry points now check native ATT permission before importing the Google advertising SDK. An undetermined permission triggers the system prompt; denied, restricted, unavailable or failed permission checks prevent SDK initialization and ad requests. Returning to the foreground checks permission again. Android retains UMP, and web/Expo Go do not load native advertising or tracking modules. Core app features and manually labeled sponsored posts remain available after denial.

`expo-tracking-transparency` supplies the native Apple permission API missing from the installed advertising SDK's JavaScript interface. English and Korean purpose messages are bundled, app measurement remains delayed, and the privacy manifest discloses advertising tracking. App Store Connect tracking disclosures for Device ID, Product Interaction and Advertising Data were also updated and read back on October 16, 2026.

The rejected submission was canceled. Its terminal API state is `COMPLETE`; the editable version is now `1.3.1`, `PREPARE_FOR_SUBMISSION`, with manual release and the old 1.4.0 build unlinked. No new review submission has been started.

## Review Notes addendum

This build fixes Guideline 5.1.2(i). On iOS, Apple's App Tracking Transparency permission is requested before loading the Google advertising SDK, showing any Google UMP consent form, initializing advertising, or requesting an ad. If tracking is denied or restricted, the app does not initialize AdMob or request AdMob ads. Other app features remain available.

On a fresh install, the ATT prompt appears when the first Home feed ad slot loads; its placement is after the sixth post. It can also be triggered from Profile > Settings > Ad privacy settings. Apple remembers an existing permission decision. If the device prevents tracking requests, AdMob remains disabled.

ATT is checked in all regions. Google's additional consent form appears only where required by Google UMP. The app continues to request non-personalized ads. App Privacy disclosures now identify advertising tracking.

## Build and verification

The signed iOS archive and IPA were built locally as 1.3.1 (68). Verification checked the bundle version, ATT framework linkage, both localized purpose strings, the delayed measurement flag, the tracking manifest and the code signature. Regression tests cover permission ordering, denial, native failures, concurrent feed slots, system permission changes, privacy settings, Android consent and web/Expo Go boundaries.

For the requested iOS build number, reuse the reviewed 1.3.1 (68) artifact or the existing `release.py build --platform ios --build-number 68 --local` command. Do not run the shared build-number allocator for this correction: Android already uses code 68 and the shared allocator would advance to 69. Do not re-upload a changed Android artifact as code 68.

Evidence: `/Users/ash/Desktop/Git/unknown/output/reviews/gling-att-fix-20261016/`.

Sources: [Expo SDK 57 ATT](https://docs.expo.dev/versions/v57.0.0/sdk/tracking-transparency/), [Apple ATT](https://developer.apple.com/documentation/apptrackingtransparency), [Google privacy strategies](https://developers.google.com/admob/ios/privacy/strategies), [Google UMP and ATT](https://developers.google.com/admob/ios/privacy/idfa).
