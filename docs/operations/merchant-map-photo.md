# Self-service map photo

Verified business owners and connected operators can select, replace, or remove a map photo in the existing business profile editor. Logo and channel banner remain separate. The editor reuses its picker, WebP preparation, immutable uploads, account check, revision conflict handling, retry, and cleanup. Contact saves retain all three image roles.

`20261024030000_merchant_map_photo.sql` adds one nullable `private.merchants.map_photo_path` column. `save_my_merchant_profile_photos` saves the three roles atomically using the existing `lock_merchant_profile_owner` and image validator. The old `save_my_merchant_profile` signature and its behavior remain available; older calls preserve the map photo. Authorization follows current `can_edit`, including existing audited administrator access with verified MFA. The client adds no admin review identity or privileged credentials.

`get_city_business_map_photos` reads one city batch from the existing `webshop_place_links` registry. City and merchant must both match. Only businesses visible through `get_merchant_profile`, with a saved storage object, produce a photo. The response contains an opaque business media reference; the existing service-only media resolver rechecks public visibility before serving bytes. Raw uploader paths never reach the map. Public profile fields and the old city-link RPC are unchanged.

The map keeps photos in its existing city registry, scoped to city and viewer. Focus, retry, and account changes recheck the batch; aborted reads cannot overwrite the next scope. Binding preserves place IDs, branch deduplication, navigation, and original photo attribution. A missing, removed, rejected, or failed representative image falls back to the existing place image. A new image version can load after a prior version failed. Representative image bytes bypass the image cache so the media endpoint can recheck public visibility; existing place images retain their offline cache.

Storage read/delete guards, account cleanup, and owner erasure cover map, logo, and banner. An operator's account cleanup preserves images still bound to the business. The migration checks each existing function patch anchor and fails on unexpected drift.

The coordinator's account-sheet follow-up adds optional `avatar_path` metadata to each `get_my_business_chat_profiles()` business row. It is an opaque `business-profile/{business UUID}/avatar/{version}` reference, or null when no logo exists. Existing fields, grants, and `business_chat_can_use` filtering stay unchanged. Actual owner/operator membership still controls the list; unrelated businesses and admin review access alone yield no identity or logo. Account-sheet frontend changes are owned by the coordinator.

## Verification, 2026-10-24

- The first four new behavior tests failed against the base implementation, then passed after implementation. All 183 focused Node tests pass, covering upload/save/remove/retry, legacy reads, contact saves, opaque media, fallback, exact business/place identity, city/viewer isolation, and focus refresh.
- Typecheck and focused ESLint checks pass. No dependency installation or full build was run.
- The existing disposable SQL checker supports `--map-photo` and an existing schema-only `--schema` snapshot. It uses `--pull never`, `--network none`, synthetic fixtures, transaction rollback, and `finally` container removal. The shared `supabase_db_gling` container stays stopped.
- 32 real pgTAP assertions cover owner/operator saves, rejected foreign business writes, stale revisions, unchanged legacy RPC, all three bound-image deletion guards, public visibility revocation, unverified admin denial, operator cleanup, owner erasure, and opaque account-sheet logos with unchanged fields/grants. The three new logo assertions failed before the additive payload patch.
- The existing business directory's 42 SQL assertions also pass through the offline checker.
- Offline snapshot: `/Users/ash/Desktop/Git/unknown/output/reviews/persona-response-live-2026-10-14/db/fixture-schema.sql`, SHA256 `ecda3b7613a340f2445c6e5d280fb42e5fdeed225c868deeaeb22da718a4015d`. The checker loads current repository prerequisites. This snapshot omitted owners and extensions; offline restore supplies installed extensions and restores Gling public/private ownership to `postgres` before the current migrations.
- Headless source-control renders use the current theme palette at 390px in light/dark and at 320px with enlarged text and reduced motion. Map controls remain visible without horizontal overflow. They use a native boundary adapter; native runtime rendering, actual image picking, and screen-reader behavior remain unverified.
- Local logs and source-render artifacts are in `assets/internal/merchant-map-photo-20261024/` (ignored QA artifacts, retained in this checkout).

Run the focused SQL check when a local schema source is available:

```sh
python3 scripts/check-business-directory.py --map-photo
```

For the offline snapshot, add `--schema` with the existing schema-only SQL file path. Run frontend checks with the installed release checkout's dependencies; do not install packages for this change.

Design research used the connected Mobbin photo-selection screen ([WHOOP](https://mobbin.com/screens/614c5819-58b6-43b6-9ea8-c8b369c9edbb)): keep the photo role explicit and selection/save actions distinct. The existing editor row and feedback remain the UI contract. BrandKit returned no token specimens, Pinterest results did not provide a relevant editor, and Kroma had no configured key; these were not treated as design evidence. No new design system or generated photo was added.

The live migration and media-function deployment are **unexecuted**, pending the supervisor's schema/permission review and existing release authority. No native builds, GUI/account changes, publication, tags, push, merge, or deployment were performed. The profile-switch redesign remains outside this change.
