# Gling launch motion preview · 2026-09-12

Approved browser concepts. The selected revision is now implemented in the local native app; see `tasks/launch-motion-2026-09-12.md` for Release simulator verification. No upload.

- Left: previous Link concept, 950 ms. Open-ring mark fades into the wordmark/home.
- Right: selected Link revision, 950 ms. The actual wordmark's last g supplies the initial ring. An elliptical mask reveals its descender, the same glyph and orbiting dot move into their wordmark position, and `glin` appears to their left. No glyph replacement or opacity gap during this transition.
- Reduced motion: 120 ms opacity only. Replay cancels the previous animation. No sound or haptics in this browser preview.
- `wordmark.png` / `mark.png` are unchanged copies of `assets/brand/gling-wordmark.png` / `gling-mark-light.png`. CSS masks and transforms isolate the last g and moving dots; no new logo assets or vector path interpolation.
- `home.png` is an unchanged copy of `output/design/gling-redesign/implemented/ios-home.png`. It is an earlier QA reference, not evidence of the latest app UI or native launch performance.

Run from this directory: `python3 -m http.server 8177 --bind 127.0.0.1`.
Check the open Orca page: `python3 check.py <browser-page-id>`.

Research: [Apple HIG launching](https://developer.apple.com/design/human-interface-guidelines/launching), [Expo 57 SplashScreen](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/), [Mobbin Klarna](https://mobbin.com/screens/c4259511-2fdd-4492-8bf9-5ac3b4deeeda), [Mobbin Glovo](https://mobbin.com/screens/78e3a230-a46c-4121-8a9a-f9dfc84def0c). Mobbin references were static screens, not observed motion. BrandKit had no Gling record; repo brand assets, theme, and brand story supplied the direction. Pinterest returned logo-motion references; Kroma returned an authentication error.

The native version uses the same wordmark crops and 950 ms sequence, with matching light/dark launch backgrounds and a 120 ms reduced-motion fade. Native recordings are in `output/qa/launch-motion-2026-09-12/`; this browser page remains a concept reference, not native performance evidence.
