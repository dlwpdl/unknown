# Approved release follow-up — 2026-10-16

The owner approved all three audit corrections: the new public member profile, fixed analytics identifiers, and reactive map error copy. The owner then clarified that manually authored partner posts only need an AD label. This work changes local source; the existing deployment hold remains.

## Scope and acceptance

1. Reuse the approved [member profile proposal](/Users/ash/Desktop/Git/unknown/output/design/user-profile-2026-10-15/index.html) and its existing implementation owner. Preserve report, block, chat, transaction and late-response checks. Review the stable handoff and render the result before acceptance. Existing own-profile A is a different screen.
2. Register the actual fixed native/public-reader controls in `private.behavior_targets`. Use additive, idempotent migrations; preserve unknown-target rejection, content-free events, administrator exclusions and bounded retries. Coverage reads live components rather than only the old control snapshot. Verify the real RPC in a local rollback transaction.
3. Keep canonical owned map errors in state and translate at render. Permission failure and invalid-date copy must change in both directions on the same mounted view, without repeating a GPS request or changing the date input.
4. Reuse post hashtags for the manual AD disclosure. The existing writer adds/removes `AD`; the post card, detail, map result and map pin keep the label visible. This label identifies a disclosed advertisement; it does not award TOP25 membership or alter ranking. Retain city, dates, expiry, blocking and public-location constraints. No ad buying, credit sales or campaign system is needed.

## Implementation and checks

Use the installed Expo57, React Native, TypeScript and Node test runner; add no dependencies. Follow the existing `useLanguage` render binding and `useInteractionFeedback().play(...)` control feedback. Use the existing theme and accessible disclosure text. BrandKit product tokens and the actual [Yelp sponsored-results reference](https://mobbin.com/screens/fd9ef807-e28e-416c-8068-09b6e3577dd8) inform clear labeling adjacent to results.

First add failing regression checks, then apply each narrow change. Commands:

```sh
node --experimental-strip-types --test scripts/map-error-language.test.mjs scripts/behavior-analytics.test.mjs
GLING_MERCHANT_WEB_EXPORT_DIR=.merchant-dist GLING_WEB_BASE_URL=/merchant npm test
npx tsc --noEmit
npx expo lint
```

Run the local SQL fixture through the existing `supabase_db_gling` container inside a rollback transaction; never apply it to production during this task. Render the approved profile and AD states using the existing bounded GUI queue. Do not change membership, auth, moderation, automatic update policy, release version, dependencies or unrelated working trees. Never push, tag, publish or trigger release workflows here.
