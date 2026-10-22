# Guest festival discovery

Goal: Guests see upcoming event cards on Today, can browse the event calendar and details, and are asked to join only when they choose a meetup action.

Acceptance: Event data is public read-only; event meetup creation and joining remain behind the existing sign-in sheet. The Today preview prioritizes actual festivals, while the full event list retains all categories. Existing event meetups can be found from the event detail. Invalid event queries and the Ticketmaster request budget remain enforced.

Check: `node --test scripts/ticketmaster-events.test.mjs`, `npx tsc --noEmit`, `npm test`, anonymous Edge Function request, and guest iPhone simulator flow. No store build upload or review submission.

Verified: Anonymous Vancouver event and festival requests returned 200; invalid city returned 400. The iPhone 17 Pro Max showed the festival card, public detail, full event list and event-specific meetup list; the sign-in sheet appeared when creating a meetup. Existing meetup participation uses the same gate. `npm test` passed 253/253; TypeScript and changed-file lint passed. Deployed only the read-only event Edge Function and behavior target migration 0110. Store build upload remains on hold.
