# Gling share preview gateway

`share-preview-worker.ts` is a dependency-free Cloudflare Workers-compatible `fetch` handler for the existing app origin's `/share/:UUID` route. **It has not been deployed.** GitHub Pages serves static app files and cannot generate per-link metadata. Supabase Edge Functions currently serve HTML as `text/plain`, so pointing a share URL at that function is not a working OG deployment.

Route only `https://gling.ej-entertainment.com/share/*` to this handler on an already authorized edge hosting account; keep the other paths on the existing website. The share URL must remain on the same app origin. No worker account, DNS, schedule, paid service, deployment, or production credential was created by this change.

The worker bindings are:

| Binding | Value |
| --- | --- |
| `APP_URL` | `https://gling.ej-entertainment.com` — an HTTPS origin, without a path/query/fragment |
| `SUPABASE_URL` | The existing project's HTTPS origin |
| `SUPABASE_PUBLISHABLE_KEY` | The existing `sb_publishable_…` key or legacy `anon` JWT; never a secret or service-role key |

The only data read is `POST /rest/v1/rpc/get_shared_link_preview` with `{ "p_post_id": "UUID" }`. Its result is `null` for unavailable links, or `{ id, title, kind, city, label, schedule, imagePath, closed }`, where `kind` is `post`, `festival`, or `meetup` and `schedule` is `null` or `{ eventKind, startsAt, endsAt, timezone, cadence }`. Recurring `group` cards show cadence; one-off cards show their date in the supplied timezone. The RPC must enforce the source post and account's visibility/moderation rules and exclude hidden/deleted content. It must never return body text, comments, review authors, or precise meeting places. The worker only renders these preview fields and discards any extra fields; it does not bypass source filtering or mint invitation authority.

If `imagePath` is present, the worker attempts to sign that exact path in the fixed `post-images` bucket with the same publishable key, a one-day expiry, and no redirects. A denied or invalid image falls back to the source-owned files `public/share-covers/post.png`, `festival.png`, and `meetup.png`; the web export must retain those files at `/share-covers/<kind>.png`. They are approved existing Gling assets, not generated illustrations. Titles and covers are intentionally visible to link recipients and platform preview caches; body text stays absent from the HTML.

The original HTML contains escaped Open Graph and Twitter large-image tags before any JavaScript. Crawlers and people receive the same preview. `public/share-redirect.js`, served unchanged at the app origin's `/share-redirect.js`, immediately continues to the fixed primary CTA destination using `location.replace`. It accepts only the same HTTPS origin's `/post?id=UUID&shared=1`, with optional `&invite=1`, and requires the UUID to match the current `/share/:UUID`. A visible CTA remains usable with JavaScript disabled. There is no user-agent discrimination or inline script; CSP permits scripts only from the fixed app origin. The app must open authentication before returning the body and retain that destination through Google/social login. Possessing a link alone never grants membership or permits an outsider to bypass application or host approval.

Responses use `no-store`, a restrictive CSP, and generic 404/405/503 errors. Fetches are bounded to five seconds each and only use the configured Supabase origin. Query parameters, incoming Host, caller cookies, and caller authorization cannot change a backend URL, destination, kind, or account. Signed images can expire in a third party's cached preview; refreshing that platform's preview is separate from a new worker response.

Local verification:

```sh
node --experimental-strip-types --test scripts/share-preview-worker.test.mjs
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --target es2022 --module esnext --lib es2022,dom --skipLibCheck infra/share-preview-worker.ts
```

Before claiming external sharing works, verify the authorized deployed `/share/:UUID` response is `text/html` with the actual link's OG tags, source/account filtering, actual covers, the login return flow, and an external platform's rendered card. Local tests do not establish deployment or Google/social provider configuration.

Design references: Apple's legible hierarchy, keyboard focus, touch target, and reduced-motion guidance; [Once invitation](https://mobbin.com/screens/0612120c-8ad7-4581-828c-fb8face6ac9c) for cover/title/one CTA and [Givingli event card](https://mobbin.com/screens/c023134b-53f7-4404-b13c-d700a9ff11e1) for title/date/city hierarchy. The current night palette is `#0B0B12`, `#171722`, `#CBB9FF`, `#F6F3F0`, and `#B7B4C3`.
