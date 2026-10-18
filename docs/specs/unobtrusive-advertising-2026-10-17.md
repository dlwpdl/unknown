# Unobtrusive advertising — 2026-10-17

The owner approved the [placement prototype](/Users/ash/Desktop/Git/unknown/output/design/gling-ad-placement-2026-10-17/index.html), its `references.json` and `verification.json`. Implementation lives in `dlwpdl/gling-ad-placement-20261017`, based on canonical commit `5b7d86d361cb865ca3c716441764fe4314332f4d`. The private admin checkout was not edited.

| Surface | Implemented behavior |
| --- | --- |
| Public HTML reader | A separate AdSense component after organic posts 4, 8, 12, with a following organic post required. Counts span appended pages; post order, identities and existing ad keys survive append failures and retries. |
| App web public feed | The same boundary, restricted to the guest public feed. Detail, compose, search and private screens do not receive slots. |
| Event index | Existing `FeedAd` after four completed event cards, repeating when another organic card follows. Calendar, filters, carousel and detail/actions retain their existing layout. |
| Map | One separate card after the fourth real list result when at least five exist. Canvas, pins, selected detail overlay and TOP25 filters stay clear. No synthetic discovery item is created. |
| Chat | Existing list-header navigation remains. The conversation header opens the existing public map in a separate full-screen modal with only an `onClose` callback; the current room stays mounted. |

The shared boundary produces 0, 1, 1 and 2 slots for 4, 5, 8 and 9 organic items. The current owner-approved native main-feed cadence remains after post 4 and every 4 thereafter, including its existing end-of-list behavior. The supervisor corrected the older 6/7 cadence in the original task packet.

Embedded chat discovery uses a clearly marked external public-information action. It validates HTTPS sources, Ticketmaster hosts and public post UUIDs, then uses the installed Expo WebBrowser. Standalone map cards keep their normal internal detail navigation. No chat, thread, message, private location or authentication parameters are forwarded.

While discovery covers a room, realtime and safety updates continue. UI read receipts and automatic scrolling pause; returning preserves the composer and scroll position and offers the existing jump-to-latest control for new messages. Initial unread positioning waits until discovery closes, including when the original 50 ms positioning timer was interrupted. Personal, group, business identity and participant/security behavior remain in the existing paths.

## Web readiness and configuration

The supervisor's actual AdSense readback reported that `pub-2361293253164911` was **not approved**. No real web display unit or installed web CMP was available. Web ads therefore remain off; no account was created, certified or resubmitted.

| Public build field | Required value when the supervisor enables an approved rollout |
| --- | --- |
| `EXPO_PUBLIC_ADSENSE_ENABLED` | Exactly `true`; the checked-in example defaults to `false`. |
| `EXPO_PUBLIC_ADSENSE_CLIENT` | An owned `ca-pub-` publisher ID with 16 digits. |
| `EXPO_PUBLIC_ADSENSE_SLOT` | The real display unit's 10-digit slot ID. |
| `EXPO_PUBLIC_ADSENSE_ORIGIN` | The exact approved HTTPS origin; no path, query, port or credentials. |
| `EXPO_PUBLIC_ADSENSE_CMP_ID` | The verified Google-certified web CMP's numeric ID. |

The CMP must be installed before the ad component subscribes, expose the TCF API, and meet current TCF v2.3 requirements. Runtime consent requires a loaded CMP with the matching ID, a completed consent event and TC string, Google vendor 755 consent, and explicit consent for purposes 1, 2, 7, 9 and 10. This conservative gate also stays off for legitimate-interest-only or absent/unknown signals. There is no build-time visitor-consent override, new CMP, polling service or backend.

Google Auto ads must remain off for this mixed public/private application. Only explicit eligible public slots request ads. The separate public-web route set has a reader and chat participant route; it has no standalone `/map` or `/events` route. The app web route set has those index screens. Web discovery embedded above `/chat` remains ineligible for AdSense.

After valid configuration, consent, public-route eligibility, foreground visibility and near-viewport intersection, the official async script loads once per document with `crossOrigin="anonymous"`. Dormant units reserve their geometry without the `adsbygoogle` class; only the unit ready to request exposes that class immediately before its one empty SDK push. A first-match SDK test verifies that jumping to a later unit cannot fill an earlier offscreen one. Delayed loads recheck consent, mounting, viewport and visibility; natural return can complete the original request without refresh loops. Observer/CMP listeners clean up on unmount. No private context is added to request fields.

Unconfigured or denied components render nothing. Pending inventory reserves space without a fake creative; no-fill hides the ad and its label while retaining blank space to avoid moving already-read content. Google attribution and AdChoices remain under SDK control. `public/ads.txt` repeats the verified owned seller line from `app-ads.txt`; approval and consent remain separate readiness dependencies.

## Verification and handoff

The installed dependency tree was reused through a private-worktree symlink after exact package/lock compatibility checks. No dependency, service, automation, ad-task SQL, release/version floor, upload, review, deployment, PR, merge or push was added. Native ATT, UMP, non-personalized requests, PG rating and development test IDs retain executable coverage.

Final commands and bundle hashes are recorded in `.expo/advertising-verification/verification.json` with their logs. The deterministic source harnesses are `scripts/adsense.test.mjs`, `scripts/content-ad-surfaces.test.mjs` and the added cases in `scripts/chat-lifecycle.test.mjs`. Tests use fake SDK/DOM/transport boundaries and perform zero live ad requests or ad clicks.

| Final check | Result |
| --- | --- |
| `npm test` | 1,422 tests: 1,421 passed, zero failed, one artifact-dependent test skipped. |
| Merchant artifact test with `GLING_MERCHANT_WEB_EXPORT_DIR=.merchant-dist GLING_WEB_BASE_URL=/merchant` | The skipped test was separately run against the actual export and passed. |
| `npm run typecheck`, `npm run lint` | Passed. |
| `npm run export:web`, `check:public-web`, `check:merchant-web` | Public and merchant exports/checks passed. |
| iOS export with `--no-bytecode` | Passed; web SDK excluded, native SDK retained. |
| Platform bundle inspection | Passed for all nine generated JavaScript bundles. |

The inherited business-DM analytics allowlist failures on `ee08db1` were resolved by the supervisor-provided canonical backend commit `5b7d86d`. The ad task added no database patch and did not apply that migration.

Local review artifacts: `dist/index.html`, `.merchant-dist`, and `.expo/advertising-verification/native-export`. All exports force native ads to `test`, AdSense to `false`, and use dummy public Supabase build values. Public/merchant exports are checked for native SDK exclusion; the iOS export is checked for web SDK exclusion. These generated artifacts are untracked.

The supervisor owns final browser/native visual acceptance, native modal/browser presentation checks, account readiness and any authorized rollout. Worker GUI/simulator/account operations were excluded. Image generation/model research is not applicable to this implementation.

Sources checked before implementation: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [platform extensions](https://docs.expo.dev/router/advanced/platform-specific-modules/), [WebBrowser 57](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/), [React effect cleanup](https://react.dev/reference/react/useEffect), Google's [responsive tag contract](https://support.google.com/adsense/answer/9183460?hl=en), [no-fill status](https://support.google.com/adsense/answer/10762946?hl=en), [display units/site readiness](https://support.google.com/adsense/answer/9274025?hl=en), [certified CMP requirements](https://support.google.com/adsense/answer/13554116?hl=en) and [TCF integration](https://support.google.com/adsense/answer/9804260?hl=en). The approved reference pack, current BrandKit tokens and the actual [Reddit promoted-card reference](https://mobbin.com/screens/62f0b383-94ab-452a-ba41-a68197287485) informed reuse of existing styles; worker Kroma access lacked its existing key and Pinterest returned no result, so no replacement direction or service was introduced.
