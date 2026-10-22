# Public web cinematic color correction — 2026-10-01

- Owner reported incorrect colors at https://gling.ej-entertainment.com/.
- Live web still used the earlier #CBB9FF bright iris palette and saturated purple showcase. Applied the approved cinematic proposal: #0D0C10 background, #19161E surface, #9283AC accent, #746486 button fill, #F1EDF5 button text. Native app palette and submitted binaries are unchanged.
- Shared WebNightColors covers reader/list/detail/landing/legal. Removed old hardcoded bright hover fills and purple gradients; showcase image uses CSS display grading. Existing layout, logo, fonts and motion remain.
- References: connected BrandKit current night identity, Mobbin DICE/Eventbrite dark event pages, local cinematic palette proposal. Pinterest research available; Kroma unavailable without its provider key. Apple Design, frontend engineering, systematic debugging, Impeccable used. Impeccable detector: zero findings.
- Validation: main workspace typecheck and all 273 tests passed; isolated public-web tests 2/2; production export and public-route/security export checks passed. Desktop 1440 and mobile 390/320 checked without horizontal overflow. Minimum palette text contrast 4.65:1. Live deployed CSS hashes and computed colors matched the build.
- Color-only commit: f55752da5114158036781c2736d07f5799b7871f, pushed to mobile-app from isolated /Users/ash/Desktop/Git/unknown/gling-web-cinematic-fix. Preserved the main workspace's existing changes.
- Successful deployment: https://github.com/dlwpdl/gling/actions/runs/36883165549
- Review: output/design/gling-web-colors-2026-10-01/review.html; screenshots and verification.json alongside it.
- Rollback: revert f55752d on mobile-app and deploy through the same Pages workflow.

## Follow-up: background stopped below the first viewport

- Owner clarified that the lower page was white. Reproduced: reader height 972px vs document 8190px, transparent HTML/body and default light navigation backing. A dark browser showed black in the same uncovered area. The initial above-fold inspection missed this geometry error.
- Reader no longer flex-shrinks; public HTML/body and navigation backing use the shared background and dark color-scheme, including initial load/overscroll.
- check-web-scroll now rejects insufficient background coverage or a canvas color different from the surface. Confirmed RED on old live version; GREEN on local/live desktop/mobile, post detail and account-deletion page. Added a native Orca condition wait for legal pages' existing smooth scrolling so the check waits for visible movement.
- Typecheck, export/public security check and Impeccable detection passed. Live background covers all 7534px desktop / 8381px mobile content, including footer.
- Application commit e2044e70a9d4f86e8152bc5259bc58b0a92f394d; successful deployment https://github.com/dlwpdl/gling/actions/runs/36891138707. A subsequent manual-check-only commit skips redundant Pages rebuild; shipped UI is unchanged.
- Screenshots and scroll-background-verification.json are alongside review.html. Rollback is a revert of e2044e7 through Pages, restoring the old bug; use only for a material regression.
