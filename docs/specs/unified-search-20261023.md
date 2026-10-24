# Unified search — 2026-10-23

## Objective and approved scope

The owner approved one app-wide search for businesses, places, people, posts and meetups. Reuse the Home magnifier and Map search entry. Default to the currently selected city. The owner explicitly restored an optional Canada-wide scope; broaden only after the user selects it. Changing search scope must not change the app's saved city or request GPS permission. Keep the query, scope, selected kind and prior map state when navigating back.

Kinds: `all`, `business`, `place`, `person`, `post`, `meetup`. Include job listings in posts with their existing category label. Show up to three results per populated kind in All and a way to open the corresponding kind. Filtered kinds use bounded pagination. Display each result's city in Canada-wide results. Exact names precede prefixes and partial matches; keep a stable tie-break order. Support the approved Jimoco/지모코 names using existing partner/alias patterns rather than an external translation service.

Business and place records for the same connected branch appear once in All. Prefer that branch's business profile; unconnected places open the existing map place information. Different branches remain distinct. Business results open `/company/[id]`, people open `/user/[id]`, and posts/meetups use their existing detail routes. People are public nickname/profile results, never live map locations or contact-directory searches.

## Shared client contract

The backend/helper owner creates `src/lib/unified-search.ts` with this UI-facing contract. Notify root and the UI owner before changing it.

```ts
export type UnifiedSearchKind = 'all' | 'business' | 'place' | 'person' | 'post' | 'meetup';
export type UnifiedSearchItem = {
  kind: Exclude<UnifiedSearchKind, 'all'>;
  id: string;
  cityId: string;
  title: string;
  subtitle: string;
  merchantId?: string;
  placeId?: string;
  imageUri?: string;
};
export type UnifiedSearchPage = { items: UnifiedSearchItem[]; hasMore: boolean; nextOffset: number };
export function loadUnifiedSearch(client: SupabaseClient, options: {
  query: string; cityId: string | null; kind: UnifiedSearchKind;
  offset?: number; signal?: AbortSignal;
}): Promise<UnifiedSearchPage>;
```

`cityId: null` is the explicitly selected Canada-wide scope; callers always initialize a real city ID. Use existing curated place data and public business/place links. The server query and link resolution must be bounded and avoid one RPC per result/city. A new narrowly projected read RPC may be added; reuse current publication, account, report/block and business-consent guards. The helper must validate result identity/kind/city and reject a mismatched response. Raw private business uploader/actor keys, email, phone, private meetup body/contact/application fields and full post bodies do not belong in search results. Business photos, if used, retain existing opaque public media URLs. No new search service, dependency, privileged production client, or background job.

## UI and current project structure

- React Native/Expo Router, TypeScript, existing Supabase client.
- New `src/app/search.tsx` and focused shared component if needed, using current Gling tokens, `useLanguage`, keyboard and feedback patterns.
- Existing `src/components/feed-screen.tsx` and `src/app/map.tsx` are the entry callers. Preserve existing hashtag behavior and map filters/camera on return.
- Backend helper/migration/tests are a separate ownership boundary from UI/callers.
- Existing result/profile components and loading/empty/error states take precedence over new abstractions. All changed controls get `useInteractionFeedback().play(...)`, correct accessibility labels, 44pt targets and enlarged-text support.

Design references actually observed: [Fresha grouped places/people search](https://mobbin.com/screens/3f9f8d23-9c63-4363-9b3f-d2d07cfa87e9), [Tripadvisor typed results and map continuation](https://mobbin.com/screens/2c1b5e60-835d-4e4f-8b09-232cb3f039bf). Reuse the installed Design and Apple Design workflow and the current design system; these are structure references, not measured conversion evidence.

## Commands and checks

```sh
node --experimental-strip-types --test scripts/unified-search.test.mjs scripts/unified-search-ui.test.mjs
npm run typecheck
node --experimental-strip-types --test --test-concurrency=8 scripts/*.test.mjs
```

Use existing local PostgreSQL fixtures and pgTAP runners for real SQL execution. Add a bounded query-plan/performance fixture with representative matching and hidden data; do not rely on SQL text matching as proof. Root owns native F736 QA and final integration, with the existing process-owned GUI guard and normal account preserved. Source SSR fixtures are synthetic and are reported separately from device/backend integration. No guessed production RPC fallback may silently claim to search all kinds.

## Acceptance and boundaries

1. Home and Map reach the same search experience. Current city is the default; explicit Canada-wide selection changes all result kinds and shows cities.
2. Businesses, local places, people, posts and meetups return their correct scoped, current public destinations. Same-branch aliases deduplicate; different branches remain separate.
3. Rapid input, scope/kind changes, account changes, unmount and retained callbacks cannot show or open another request's result. Cancel old requests and reject stale completion/selection.
4. Empty/error/loading states are distinct; failed pagination preserves current results. Query strings and private destinations are not analytics targets. Use fixed control IDs only.
5. Local schema/permission tests, helper/UI tests, types, lint, export/privacy checks and representative source/native QA are recorded with actual source hashes and limitations.
6. Existing drafts, sessions, app data, messages and store release/minimum-version settings remain intact. Production deployment remains held; preparing this feature is not permission to apply held migrations or submit another store build.

## Implementation and remaining owner requests

- Root: contract/spec, integration, P02 actual native QA, final report and source/CI evidence.
- Search backend owner: new helper, bounded read RPC, direct unit/SQL checks. No UI edits or production operations.
- Search UI owner: native search route/component, Home/Map callers and direct UI tests. No SQL/production operations.
- Chat owner: close-animation lifetime, meetup-management placement, location address/map preview, nested overview close returning to the same chat, and member-first upcoming-session overview. Existing session/attendance APIs only; no invented RSVP or per-session venue data.

After search and P02, inspect performance across search, feed, map, business profiles and chat. Measure before changing code, reuse the already held query optimization, fix reproduced bottlenecks, and separate local/simulator observations from physical-device or production performance claims. P02 must not be changed from partial to passed merely because public linked news/jobs/reviews are absent; use actual allowed content where available and label local fixture coverage separately. Do not publish test posts or send messages to another person to manufacture evidence.
