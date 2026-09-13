# Approved Gling launch motion · 2026-09-12

The user selected the revised Link concept: the ring becomes the last g, `glin` joins it, and the complete wordmark enters the home header.

- Reuse the unchanged wordmark PNG with native clipping, tint, and transforms. The g and dot remain the same mounted elements throughout. Existing Reanimated/Worklets handle the 950 ms timeline; no dependency added.
- Native launch background matches light/dark app paper. Reduced motion uses only a 120 ms fade. Tapping, backgrounding, or navigating dismisses the introduction. Local image errors and a 3-second watchdog cannot strand startup.
- Home target follows FeedScreen's 64 × 36 logo, safe area, maximum content width, and text-size-dependent header row. Deep links fade in place. No login, location, notification, or account preference changes.
- Preserve the notification observer and other changes from `562faba`. The public web keeps its existing no-overlay component.

## Verification

- 112/112 Node tests; TypeScript, ESLint, web export, iOS Simulator Release build passed. The added test verifies continuous glyph visibility, target geometry and deep-link geometry, plus the generated iOS launch storyboard.
- Installed on the existing 583E7BFD-5CB4-42EC-B15C-1D4D5986FA39 (iOS 26.5, iPhone 16 Pro Max); preserved the Orca 3100 stream and account data.
- Directly inspected recordings in light and dark: ring/dot → last g → complete wordmark → feed header. Reduced Motion was enabled in iOS Settings: launch used a fade with no moving logo. Restored Reduced Motion off and light appearance afterward.
- Cold `gling://profile/notifications` opened the intended settings with a centered fade; no flight to the home header. The final screen is the user's original notification settings, with the same visible switch states.
- Expo 57 skips applying the storyboard color when the splash image is omitted. `plugins/with-launch-background.js`, registered before the SDK plugin, binds the generated light/dark color and removes dangling image constraints. A regression check first reproduced the white background, then passed. Both final native recordings show the correct background before the logo appears.
- `output/qa/launch-motion-2026-09-12/provenance.json` records build/asset/recording hashes. `light.mp4` is the original cold-launch recording, and PNGs are unretouched extracted frames. Other full recordings are retained locally with hashes in provenance.

The 950 ms figure is the animation timeline after React/assets are ready, not total cold-launch time. Simulator recordings include several seconds of native startup and are not real-device performance measurements. Android and physical-device motion were not verified in this task. Background/tap/error dismissal paths were reviewed in source, not fault-injected on a device. This is a local build, not a TestFlight upload or App Store submission.

Sources: [Expo 57 SplashScreen](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/), [React Native 0.86 view styles](https://reactnative.dev/docs/0.86/view-style-props), [Worklets scheduleOnRN](https://docs.swmansion.com/react-native-worklets/docs/threading/scheduleOnRN/). Existing brand/Mobbin research and the approved browser concept are recorded in `output/design/gling-launch-motion/README.md`.
