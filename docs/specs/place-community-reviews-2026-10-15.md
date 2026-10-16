# General place community reviews — 2026-10-15

Approved implementation contract: extend the existing dated OSM catalog detail route in every supported city. A review is an ordinary community story, not a verified visit or a merchant/private-evidence review. Show that it also appears in the city community before publishing.

Use the selected catalog city + canonical osm:type:id/sourceUrl, never a display name or coordinates alone. Add one reserved exact source-reference line and the existing withPostMap attachment built from catalog coordinates. Reject user text that attempts to supply the reserved metadata. Keep text nonempty and at most 1000 characters. Reuse createCommunityPost for authentication, quotas, validation, safety monitoring, reports and deletion; no new schema, RPC, provider, service, star rating or uploads.

Only authenticated active-profile users request full review bodies. Query loadPublicFeed with the exact sourceUrl, then require an exact parsed reference, matching city and story kind. Pagination follows the last unfiltered server row, including pages with no matching reviews. Preserve previous rows on errors, hide reported/blocked/deleted content immediately, and open the existing post route for full actions. Account/place/city changes discard prior scope and late results; failed publication keeps the local scoped draft. Recheck session and trusted catalog before writes, and guard double taps.

Reuse PostCard, StateCard, the flat 2D RaisedActionButton, current tokens, Korean/English subscriptions and 44px targets. Every control has existing interaction feedback. Mobbin Angi/Preply text-review forms inform the simple editor and explicit public-review label; no new visual direction. Current BrandKit matches night #0B0B12/iris #CBB9FF; light mode remains token-driven. Kroma search lacked a configured key; Pinterest returned metadata only. No generated image.

Files: src/lib/place-reviews.ts, src/components/place-reviews.tsx, src/app/places/[id].tsx, additive src/i18n/ui-en.ts entries and scripts/place-reviews*.test.mjs. Run focused tests, existing city-place/review tests, npm run typecheck and changed-file ESLint. Tests use real catalog/maps and controlled transports/hooks for identity, guest privacy, pagination, async invalidation and draft preservation.

No dependency installation, DB/native/Metro/browser/GUI/model calls, production data writes, deployment or remote push. Root owns actual simulator rendering and final integration/security acceptance. Analytics target IDs are listed in the handoff report for root; no DB instrumentation change here.

Verification commands:

```sh
node --experimental-strip-types --test scripts/place-reviews*.test.mjs scripts/city-places.test.mjs scripts/merchant-review-editor.test.mjs scripts/merchant-reviews.test.mjs scripts/feed-data.test.mjs scripts/post-maps.test.mjs
npm run typecheck
./node_modules/.bin/eslint src/lib/place-reviews.ts src/components/place-reviews.tsx 'src/app/places/[id].tsx' src/i18n/ui-en.ts scripts/place-reviews*.test.mjs
```

The generated source line is `장소 후기: https://www.openstreetmap.org/<node|way|relation>/<id>`; it is matched as a complete line before the map attachment. It identifies the referenced place, not proof of a visit or proof that every matching community post originated in this editor. Editing/removing that reference in a normal post can remove it from the place list. The existing createCommunityPost RPC has no client idempotency key: double taps are blocked here, automatic retries are absent, and an uncertain transport error keeps the draft and tells the member to check their community posts before retrying. The normal server city availability, account/merchant restrictions, quotas and safety policy remain authoritative.
