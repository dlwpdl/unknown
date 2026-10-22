# Ticketmaster events → Gling meetup (2026-09-24)

## Objective and approved assumptions
Discover upcoming Canadian events in the selected Gling city, inspect local event time and venue, create a normal Gling meetup with trustworthy prefilled event information, and open Ticketmaster's returned purchase URL. Purchases remain external; actual availability and final price are confirmed there. Revenue reporting is a separate admin slice.

## Structure / style
Expo 57 / React Native / existing Supabase. `src/app/events/` contains list/detail, `src/lib/ticketmaster.ts` contains the client and formatting helpers, `supabase/functions/ticketmaster-events` authenticates and proxies Discovery v2, `_shared/ticketmaster.ts` contains pure validation/normalization. Existing meetup rules, approval/chat flows, theme, StateCard, and interaction feedback are reused. Example: `if (!event.startsAt) throw new Error('EVENT_UNAVAILABLE');` No new dependencies.

## Success criteria
- Selected open CA city, fixed category choices and bounded pagination; malformed input rejected server-side.
- Authenticated requests only; server-only API key; private shared cache and atomic account quota guard. Missing configuration and upstream errors never appear as an empty list.
- Event timezone, cancelled/postponed/rescheduled/TBA/TBD and missing time handled. Past or uncertain events cannot prefill a meetup.
- Only event ID + city travel in route params; create screen reloads normalized server data and preserves edited drafts on return. The actual meetup uses the device timezone because its existing picker does.
- Event reference and returned purchase URL included in the meetup body. No claim of guaranteed availability, price or commission.
- New controls use existing feedback. Reuse standard Gling typography, cards, fixed headers, accent selection; date/venue sit below title, based on Luma event list https://mobbin.com/screens/b6891245-d834-49c3-b75d-a6f9946eeeb9 and Spotify event list https://mobbin.com/screens/5a19d958-26cd-4035-a58c-b7410b031981.

## Plan and verification
1. Pure input/data contract + node tests; private cache/quota migration + pgTAP tests.
2. Authenticated Edge Function, API client, list/detail and existing meetup entry/prefill.
3. `node --experimental-strip-types --test scripts/ticketmaster-events.test.mjs`, `npx tsc --noEmit`, `npm test`; local DB tests if available, renderable HTML review artifact from parent.

## Boundaries and open setup
Always validate inputs, redact upstream failures, preserve dirty files. Never read/copy live credentials, deploy, create affiliate contracts, or invent settlement data. Production needs TICKETMASTER_API_KEY, linked/approved Impact publisher account, migration and function deployment by the authorized release operator. Verify live affiliate URL tracking and partner terms before release. Cache TTL 15 minutes, removal after 24 hours; quota reserves headroom at 4,500/day and at most 2/second. No free-text/date filter in v1: keeps cache cardinality bounded.
