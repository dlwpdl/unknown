# Meetup workflow readability

Owner selection: participant concept 02, host concept 01 from the six local Gling meetup prototypes dated 2026-10-25.

## Outcome

Members can distinguish screen titles, sections, values and explanations immediately. Discovery and joining follow participant concept 02; creation and management use host concept 01. These are actions within one app, not separate account modes.

- Use Gling's existing night colors and controls. Screen headings are 28px, major sections 24px, body and input values at least 16px, supporting explanations 14px. Reuse the existing typography roles where they fit; allow text scaling and multiline layout.
- Discovery separates browsing from the member's meetups. Start with all meetup types and remember the member's last selection. Explicit place/event entry stays in its existing city/source context.
- Creation remains a single form with clear sections for basics, time/location and the common meetup profile. Optional AI/template/help and advanced settings stay available without filling the default view with explanations.
- A meetup profile belongs to the account and is separate from its ordinary profile. Reuse it across meetups; retain each meetup/application's explicit sharing consent and profile revision checks.
- Preserve draft values when editing the profile or returning to the form. Show validation at the relevant field and fixed action area; move to the first invalid field.
- Personal free membership permits up to 50 members; active personal paid tiers permit up to 5,000. Business promotion subscriptions do not grant personal seats. Existing members survive a downgrade; new admissions must obey the current host limit.
- Keep the private roster and sender/member photos scoped to the current viewer and room. Load visible photos with bounded requests, rather than downloading 5,000 images at entry.
- Preserve the published client's 50-member roster contract. New clients use the separate v2 roster for up to 5,000 members, with legacy fallback only when that endpoint is absent.
- Keep source-place/event links, membership checks, policy notices, reporting, leaving, cancellation, accessibility and interaction feedback. Do not publish test posts or send real invitations during visual QA.

## Work ownership

Host slice: meetup-create, meetup-profile, common chilling-profile-card, meetup host tools, management sheet and chat overview. Participant slice: meetup discovery, my-meetups, chilling-event/detail and meetup-join. Shared error translations and integration remain with the primary agent. Changes to the general post detail or shared kind control require an explicit narrow file lease.

## Validation

Use existing Node component/logic tests and add only meaningful regressions. Run `npm test`, `npx tsc --noEmit` and `npm run lint` after integration. The capacity policy also has actual isolated PostgreSQL/pgTAP and lock probes. Render the actual changed UI at narrow and wide sizes, then install the exact candidate on the existing Duo simulator and test folded/unfolded layouts, validation, profile return and both roles without publishing.

The functional checkpoint before this visual slice passed 2,016 Node tests, type checking and lint. Its isolated SQL run passed 214 checks plus concurrency/revocation probes; this is not evidence of final visual or store deployment.

## Boundaries and pending decisions

Owner steering on 2026-10-25: integrate the code and verify it locally. Deployment was explicitly withdrawn; do not apply production SQL, publish web changes, push release tags or submit store builds for this task.

No new dependency, provider, service, recurring job or permission model. General members keep existing web/app boundaries. Native tabs and calibrated safe areas remain platform controlled. Keep old store versions available throughout build and review.

Annual-first UI is prepared separately. Live annual v2 store products and their prices are still unresolved; legacy annual products must not be relabeled. The next native store version question is also pending. Neither a build nor this spec authorizes an early minimum-version increase.
