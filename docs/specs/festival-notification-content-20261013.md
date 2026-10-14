# Event notification content — 2026-10-13

Owner request: use the festival/event name as the notification title. The body must explain the event and end with `같이 갈 사람!?`; replace generic introductions such as `이런 행사도 있네요!` and the fixed `글링` title for event recommendations.

Reuse the existing recommendation producer, verified cache helper, recipient/city/consent/visibility checks, push queue and scheduled workers. Preserve all schedules, leases, retries, routes, category limits, private message previews and admin safety notifications. Commit, store builds, production changes and actual push sending remain on hold.

Add an optional stored notification title and populate event title/body at the trusted database insertion boundary from the current cached event. Backfill only unread matching event notifications without requeueing, changing read state or resending. Send claims expose the event title only in the send phase for a visible event recommendation; receipt claims carry no new content. Keep existing post preview fields and legacy jobs compatible.

Use a meaningful source introduction when available. Treat entry/refund rules and venue advertising as operational copy rather than the event's description. When an introduction is unavailable, describe the official event category/genre plus verified venue and local date/time. Retain nullable segment/genre from the existing upstream response on its next normal collection; no extra API, AI calls, dependencies or jobs. Legacy caches without a classification use the broad word `행사`.

The app inbox shows the same optional event title above its description. Use an existing full-row selection so source previews remain compatible with older databases without the title column. Preserve existing press feedback, routing, unread presentation and accessible row labels.

Affected callers: Ticketmaster normalization and fixtures; notification schema/trusted stamp/read view; protected push claim and worker; AppNotification/loadNotifications and native inbox rendering; Node behavioral tests and transaction-only SQL coverage for content, fresh cache data, all recipient guards, receipt privacy and old claims.

Reference: owner supplied Blind's title/description convention. Mobbin returned Ro's actual notification list (bold specific titles followed by explanatory text): https://mobbin.com/screens/3a78b2df-aebe-475c-89b6-df853ef212aa. BrandKit's current Gling assets and app tokens remain unchanged. Official contracts read: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/ and https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ .
