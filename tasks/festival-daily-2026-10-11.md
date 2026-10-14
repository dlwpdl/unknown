# Daily festival carousel

2026-10-13 correction supersedes the automatic selection and release steps below: use the same whole-view candidates, not a festival-name keyword; preserve distinct event dates and merge only identical name/venue/start aliases. Show seven real upcoming events through gallery navigation, preserve the selected event on same-city refresh, and retry transient refresh errors after fifteen minutes. Existing manual festival assignments and their validation stay unchanged. The user authorized source fixes and checks only: no commit, push, tag, build/export, production deployment or submission until the later batch instruction. See `tasks/festival-chat-pending-20261013.json` and the updated operations guide. The earlier coverage diagnosis below is historical and superseded by captured all-view data from all five cities.

Approved 2026-10-11: all seven positions default to the soonest upcoming festivals; one shared collection per city/local day, including the 25-hour daylight-saving rollover. Any position can be assigned a festival by the owner, then returns to automatic selection when cleared or expired. Existing card rotation, recommendation cadence and short-lived event details stay in place.

## Acceptance

- Filter past, cancelled, postponed and uncertain starts; sort by absolute start time. Group matching festival name, venue and year so individual day tickets do not consume several positions. Return at most seven real festivals; never invent or repeat events to fill vacancies.
- Reuse `ticketmaster_event_cache`, `reserve_ticketmaster_request`, and existing recommendation job 16. Collect up to 100 candidates once per city/day, with a per-cache-row refresh claim to prevent concurrent duplicate upstream requests. Other event/date/month/detail requests retain their 15-minute cache. A failed fetch cannot be recorded as a successful empty day.
- Existing five-minute recommendation execution and general event discovery continue. Festival discovery runs independently of the notification enable toggle and skips a fresh daily cache. Update only the matching cache-cleanup command; preserve every job identity, owner and active state.
- Any slot 1–7 can be assigned an existing Ticketmaster festival ID through authenticated admin RPCs using the current AAL2 guard and access audit. Store only identifiers and exposure expiry in the override table; never keep a second permanent copy of upstream content. Assignments cannot cross cities, duplicate another position or revive unavailable events.
- The API resolves the seven positions so app and public web agree, including overrides. Refresh on focus/foreground and local-date rollover; card rotation itself makes no API calls. Keep existing feedback, reduced-motion and screen-reader handling.
- Inspect service configuration, saved function bodies, ordinary job execution and actual API responses separately from local checks and native store release.

## Scope and order

1. Shared selection and day/expiry helpers; failing Node examples first. Existing `scripts/ticketmaster-events.test.mjs` remains the runnable check.
2. Private overrides, admin/service RPCs, daily refresh claim and existing cron integration in one dated migration. Add rollback SQL and transactional pgTAP checks in the current local database.
3. Existing Edge Function reads fresh cache, applies overrides and claims only daily refreshes. Test the handler with fake transport/database boundaries to verify real request count, cache hits and failure paths.
4. App/web loaders keep the server's order and re-read on foreground/focus/day change. Add lifecycle checks using the existing Node/React test harness, then verify TypeScript, lint, full Node tests and web export.
5. Review the scoped diff, deploy the isolated migration/function through existing authenticated Supabase tools, and read back jobs/functions/cache plus public responses. Do not stage unrelated dirty source, batch-push migrations, publish marketing or create a new worker/automation/dependency.

## Structure and conventions

Shared pure helpers: `supabase/functions/_shared/ticketmaster.ts`. API: `supabase/functions/ticketmaster-events/index.ts`. Native/public cards: existing carousel files. SQL: one `20261011...` migration and `supabase/tests/festival_daily.test.sql`. Use standard `Map`, `Set`, `Intl.DateTimeFormat`, qualified SQL and `security definer set search_path=''`; e.g. `if (!private.is_admin())` is enforced in SQL, not trusted client state.

## Commands

`node --experimental-strip-types --test scripts/ticketmaster-events.test.mjs scripts/public-festivals.test.mjs scripts/festival-daily.test.mjs`

`docker exec -i supabase_db_gling psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1` with a transaction and rollback for fixtures.

`npm run typecheck`; `npm test`; changed-file `npx --no-install eslint ...`; `GLING_PUBLIC_WEB=1 GLING_LOCAL_ADMIN=0 GLING_MERCHANT_WEB=0 npx --no-install expo export --platform web --output-dir output/qa/festival-daily-2026-10-11/web-build`.

## Evidence and limits

Save scoped source snapshots, SQL/Node results, native automation/GUI ownership preflight and production readback in `output/qa/festival-daily-2026-10-11/`. Existing dirty work is preserved. The scoped change is isolated on the latest released source `4577ad5`; no unrelated working files are included.

The current Ticketmaster search has fewer than seven unique festivals in several cities. This change fixes refresh/selection, not Ticketmaster coverage. Fixed slots initially reference Ticketmaster events; external official-source registration is a separate content-source integration. Changes to a released native bundle require its normal store release.

Design reference: Spotify dated event list https://mobbin.com/screens/33e857e6-817e-4402-98b2-760b8f6ad236; retain the current Gling night cards and interaction behavior. Image generation is not applicable. Official contracts: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ ; https://docs.expo.dev/versions/v57.0.0/ ; https://reactnative.dev/docs/appstate .

Release verification found that a previous assignment could lose its group identity when its source cache expired. `20261012002000_festival_slot_identity.sql` retains only a derived name/venue/year identifier and a database uniqueness constraint, without retaining a second copy of upstream content or changing public contracts. The regression fails before the fix and passes with it.
