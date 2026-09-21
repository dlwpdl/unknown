# Read-only web, app participation — 2026-09-21

Owner approved: public posts and meetups can be browsed/shared on web; writing, meetup creation/application and every conversation stay in the app. No web login, personal-profile directory, private messages, name, birth date or contact details in the public UI. User-authored public text remains public; this does not promise automatic removal of contact information users write into public posts.

Reuse existing public feed/post RPCs and signed images with an isolated nonpersistent anonymous client. Separate public web route root from native and local admin routes, so privileged screens are not shipped. Preserve native behavior and all server auth, quotas, moderation and audited admin access. Browser exclusion is not app attestation and does not prevent direct API automation.

Web: city/category/meetup filters, bounded pagination, public post details with meetup dates and recommended ages, app handoff and install guidance. Preserve public policies, account deletion and mobile OAuth callback bridge. Existing native shared-post URLs remain valid. No new database permissions, dependency or infrastructure.

Verify unit tests for route/app-link validation and anonymous-only transport, typecheck/lint, public export exclusion, actual browser at 320 and desktop widths, public feed/detail and private-route fallback. Check real public backend reads without writing production data. App-store availability remains unconfirmed until stores approve; show honest launch guidance. No new mobile build required.

## Implemented and verified

- Dedicated `src/web` route root, `npm run web` / `npm run export:web`, CI public-code exclusion check and static-host 404 fallback. Native/admin route roots are preserved; even the native-root development web layout no longer mounts AuthProvider.
- Isolated anonymous Supabase client never persists/restores auth and whitelists only existing public feed/post/comments RPCs and read-only image signing. No database policies, mutation permissions, quotas or safety monitoring changed. Client checks are defense in depth, not a security boundary against independent API clients.
- Browser checked against existing public production data: 30 initial posts → 53 unique posts after pagination, city/meetup filtering, post details, closed meetup wording, image loading, old `/post/:id` URLs, invalid IDs, and app-only URLs `/chat`, `/compose`, `/profile/settings`, `/auth/review`. App-only pages made zero data RPC requests and exposed no login/message inputs.
- 320px responsive DOM and screenshot: no horizontal overflow; desktop inspected at 1357px. Post CTAs preserve the exact post ID in `gling://post/:id`. Physical-device app launching is not newly verified in this task.
- 185 Node tests pass, TypeScript/lint pass, static export/public exclusion check pass. Public bundle excludes app-only route files, admin code, review login and chat mutations. Supabase SDK generic authentication methods remain bundled as part of the dependency but no login UI or account session is used.
- BrandKit existing ink/paper/red palette reused; Pinterest references queried. Kroma/Mobbin research unavailable without SERPER_API_KEY. No new design system or dependencies.
- Apple 1.0.1 remains WAITING_FOR_REVIEW on September 21 readback. Install guidance therefore says launch preparation; it does not claim public store availability. When stores approve, replace this guidance with actual public install links.
- Existing shared-post preview retains its Open Graph metadata and now links to the read-only web detail plus app participation.

Deployment: pending verification. Rollback by reverting this task's commit and redeploying Pages; no database rollback required. Private QA evidence in `~/Library/Application Support/gling/releases/web-read-only-2026-09-21/`.
