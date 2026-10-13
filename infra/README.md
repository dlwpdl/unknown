# Gling share preview gateway

`share-preview-worker.ts` is a dependency-free `fetch` handler for a configured Gling gateway's `/share/:UUID` route; it also supports the original app origin when no separate gateway is configured. **It has not been deployed.** GitHub Pages serves static app files and cannot generate per-link metadata. Supabase Edge Functions currently serve HTML as `text/plain`, so pointing a share URL at that function is not a working OG deployment.

Keep `https://gling.ej-entertainment.com` as the website and authentication origin. A separate fixed Gling-owned Vercel project origin may serve `/share/:UUID` previews without moving the website or changing its DNS. The release owner must confirm the actual stable gateway alias before activating generated gateway links. Local preparation creates no account, DNS change, schedule, paid service, deployment, or production credential.

The worker bindings are:

| Binding | Value |
| --- | --- |
| `APP_URL` | `https://gling.ej-entertainment.com` — the fixed website/login origin, without a path/query/fragment |
| `SHARE_ORIGIN` | Optional configured HTTPS gateway origin for canonical and OG URL metadata only; defaults to `APP_URL` |
| `SUPABASE_URL` | The existing project's HTTPS origin |
| `SUPABASE_PUBLISHABLE_KEY` | The existing `sb_publishable_…` key or legacy `anon` JWT; never a secret or service-role key |

The only data read is `POST /rest/v1/rpc/get_shared_link_preview` with `{ "p_post_id": "UUID" }`. Its result is `null` for unavailable links, or `{ id, title, kind, city, label, schedule, imagePath, closed }`, where `kind` is `post`, `festival`, or `meetup` and `schedule` is `null` or `{ eventKind, startsAt, endsAt, timezone, cadence }`. Recurring `group` cards show cadence; one-off cards show their date in the supplied timezone. The RPC must enforce the source post and account's visibility/moderation rules and exclude hidden/deleted content. It must never return body text, comments, review authors, or precise meeting places. The worker only renders these preview fields and discards any extra fields; it does not bypass source filtering or mint invitation authority.

If `imagePath` is present, the worker attempts to sign that exact path in the fixed `post-images` bucket with the same publishable key, a one-day expiry, and no redirects. A denied or invalid image falls back to the source-owned files `public/share-covers/post.png`, `festival.png`, and `meetup.png`; the web export must retain those files at `/share-covers/<kind>.png`. They are approved existing Gling assets, not generated illustrations. Titles and covers are intentionally visible to link recipients and platform preview caches; body text stays absent from the HTML.

The original HTML contains escaped Open Graph and Twitter large-image tags before any JavaScript. Crawlers and people receive the same preview. `public/share-redirect.js`, served at the fixed app origin's `/share-redirect.js`, immediately continues to the fixed primary CTA destination using `location.replace`. It allows only `https://gling.ej-entertainment.com/post?id=UUID&shared=1`, with optional `&invite=1`, and requires the UUID to match the current `/share/:UUID`, including when that page is hosted on the configured gateway. It rejects gateway-hosted login destinations, lookalike origins, credentials, extra query keys and ambiguous UUID parameters. A visible CTA remains usable with JavaScript disabled. There is no user-agent discrimination or inline script; CSP permits scripts only from the fixed app origin. The app must open authentication before returning the body and retain that destination through Google/social login. Possessing a link alone never grants membership or permits an outsider to bypass application or host approval.

`SHARE_ORIGIN` is validated with the same HTTPS-origin rules as `APP_URL` and affects only canonical/OG URL metadata. CTA/login destinations, fallback covers, redirect-script source and CSP remain fixed to `APP_URL`; neither an incoming Host nor caller query parameters can supply either configured origin.

Responses use `no-store`, a restrictive CSP, and generic 404/405/503 errors. Fetches are bounded to five seconds each and only use the configured Supabase origin. Query parameters, incoming Host, caller cookies, and caller authorization cannot change a backend URL, destination, kind, or account. Signed images can expire in a third party's cached preview; refreshing that platform's preview is separate from a new worker response.

Local verification:

```sh
node --experimental-strip-types --test scripts/share-preview-worker.test.mjs
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --target es2022 --module esnext --lib es2022,dom --skipLibCheck infra/share-preview-worker.ts
```

Before claiming external sharing works, verify the authorized deployed `/share/:UUID` response is `text/html` with the actual link's OG tags, source/account filtering, actual covers, the login return flow, and an external platform's rendered card. Local tests do not establish deployment or Google/social provider configuration.

Design references: Apple's legible hierarchy, keyboard focus, touch target, and reduced-motion guidance; [Once invitation](https://mobbin.com/screens/0612120c-8ad7-4581-828c-fb8face6ac9c) for cover/title/one CTA and [Givingli event card](https://mobbin.com/screens/c023134b-53f7-4404-b13c-d700a9ff11e1) for title/date/city hierarchy. The current night palette is `#0B0B12`, `#171722`, `#CBB9FF`, `#F6F3F0`, and `#B7B4C3`.


## Vercel prebuilt bundle

Run `node infra/build-vercel-output.mjs` after the existing public and merchant export. It copies `dist` unchanged to `.vercel/output/static` and compiles the share handler plus a small Edge adapter with the installed TypeScript compiler. The generated `.vercel/output` stays ignored. Preparation does not deploy anything.

The adapter uses the bindings above as Vercel runtime environment variables. Keep `APP_URL=https://gling.ej-entertainment.com` and set `SHARE_ORIGIN` only to the stable Gling gateway alias confirmed by the release owner. The origin used in local tests, `https://gling-share-preview.vercel.app`, is a fixture, not proof that this alias exists or is owned. Deployment uses the existing authorized Vercel CLI with `deploy --prebuilt`; no CNAME or primary-site migration is required. Gateway `/auth/*` and `/merchant/auth/*` routes return 404. Copied static callback files do not establish a supported login flow there; authentication continues on the primary website.

The share route captures the UUID into `__gling_share_id`. Caller query collisions and direct access to the internal function route return 404. The adapter preserves an original `/share/:UUID` request; if Vercel supplies the rewritten internal URL, it reconstructs only the validated captured UUID before calling the preview handler. Static files are checked first after the share route, followed by existing HTML/index routes and the exported 404.

Run `node --experimental-strip-types --test scripts/vercel-share-preview.test.mjs scripts/share-preview-worker.test.mjs` to check the compiled adapter, default and configured gateway metadata, fixed app destinations, caller-query isolation, static routes and public response boundary. The routing check models the documented configuration; deployment routing still needs an actual HTTP readback.

Contracts checked on 2026-10-12: [Vercel Build Output configuration](https://vercel.com/docs/build-output-api/v3/configuration), [Edge function output](https://vercel.com/docs/build-output-api/v3/primitives), [Edge runtime environment variables](https://vercel.com/docs/functions/runtimes/edge), [official Edge entrypoint example](https://github.com/vercel/examples/blob/main/build-output-api/edge-functions/.vercel/output/functions/index.func/index.js), and [TypeScript import-extension rewriting](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html).

Before gateway links activate, deploy the updated primary-site `share-redirect.js`, configure the confirmed gateway alias in the app sharing allowlist, and verify an actual gateway preview continues to the primary website through Google/social login. Static build preparation does not verify alias ownership, provider configuration or external OG card rendering.
