# Image optimization and five photos per post — 2026-09-22

Owner asked to start the media optimization plan (items 1-4) and to raise the story photo limit from one to five. Video stays out until media moves off the free-tier egress budget.

## What changed

1. Upload budget: photos are always re-encoded to webp (keeps alpha, removes the 2-4MB PNG screenshot problem), long side 1280px, quality 0.72, with fallback attempts at 1024/0.62 and 800/0.55 until the file fits the 700KB target. Anything still above 2MB is rejected instead of uploaded.
2. Feed thumbnails: each photo also uploads a 480px webp beside it (`<name>.thumb.webp`). Feed cards and the web reader list use the thumbnail, the post detail gallery uses the original, and posts without a thumbnail fall back to the original. The signed-URL cache signs both in one batch.
3. Single media module: `src/lib/image-upload.ts` now owns kinds, sizes, formats, path and thumbnail rules plus the `PostMedia` shape, so video or external storage (R2) becomes a one-file change later.
4. Usage watch: `npm run storage:usage` (or `python3 scripts/storage-usage.py`) prints per-bucket size, object counts, the largest objects, and the remaining free-tier view estimate, warning at 300MB and failing at 600MB of the 1GB storage.
5. Five photos: the composer multi-selects up to five, shows a tile grid with per-photo delete and a `사진 n/5` line, uploads all of them (with thumbnails) before creating the post, and cleans up every uploaded object if creation fails. Migration 0095 raises the story cap to five (listings keep eight; the table check now allows eight so listings actually can).

Post detail gained a horizontal gallery with a counter, and cards show a `1/n` badge when a post has several photos.

## Regression caught on device

Adding the feedback hook to `LoginPanel` crashed the login prompt, because `AuthProvider` renders that panel and sat outside `InteractionFeedbackProvider`. The provider now wraps `AuthProvider` in the app layout, the admin layout includes it too, and `scripts/interaction-feedback.test.mjs` asserts the order so it cannot come back.

## Production

Migrations were renumbered twice while other sessions took 0089/0090; they are `0095_post_media_five_images.sql` and `0096_post_gallery_analytics.sql` and both are applied to the live project. Verified live: the posts check allows eight, `create_post` caps non-listings at five, and the gallery analytics id is registered.

## Checks

`npm test` 228/228, `npm run typecheck`, eslint on the changed files, `npm run storage:usage` against the live project, and a simulator pass that confirmed the login prompt renders again. The composer's five-photo grid still needs a signed-in look on the device; the pipeline behind it (plan, fallback attempts, thumbnail, upload, cleanup, feed selection, gallery) is covered by tests.
