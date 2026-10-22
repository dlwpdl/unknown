# Gling meetup upgrade

Approved basis: `unknown/output/reviews/gling-meetup-profile-direction-2026-10-18/review.html`, owner “ㅇㅇ 이대로 진행하자”. This implements that direction in the existing Expo 57 / React Native 0.86 / Supabase stack. It does not authorize Store submission or a new subscription product.

## Outcome

Members manage an independent meetup identity from My Profile, preview its audiences before sharing, create a useful meetup draft from a topic, and use existing membership tiers for host operations. Meetup capacity stays host-selected (currently 2–50 including host); 2:2 is an example only.

## Acceptance and decisions

1. Saving or cancelling meetup edits never writes `profiles.nickname`, `profiles.city_id`, or the general `avatars` object. Separate optional photos (up to three), display name, city, introduction, interests and two selectable prompts are one explicit save. Preferences and availability are owner-only. Existing four-field profiles remain readable; upgrading them never imports or publishes the general photo automatically.
2. A private meetup-photo bucket authorizes each download with account, context, membership, block/report, publication and closure checks. Unrelated authenticated users cannot read an applicant photo by guessing its path. Application revisions retain the selected immutable object paths; do not overwrite an existing photo object. Already downloaded copies cannot be recalled. Rejected/cancelled/left/blocked/closed contexts lose subsequent authorized reads. Owner access and audited existing safety operations remain intact.
3. Applicants preview the exact saved profile and answer shared with the host; optional sharing of selected photos and short introduction with approved members is separately disclosed. Other applicants cannot read it. Application snapshots do not change when the profile is edited. Reapplication follows the existing request-row lifecycle and replaces the prior snapshot after fresh consent. Private answers and preferences never reach the participant roster/chat/reviews.
4. Hosts explicitly confirm their public meetup introduction and selected public photo when publishing. Existing legacy introductions preserve their previous text scope; new private photos are never made public implicitly. Meetup author, application, roster, chat and review presentation uses meetup identity; taps open the scoped meetup profile, not community history. Account IDs continue to enforce global blocks/reports.
5. Existing `draft-post` provider, authorization, quotas, moderation and non-meetup outputs are retained. For meetups, a topic produces purpose, activities, intended participants, preparation and an application question in addition to title/body. Parse and bound all model output. Preview and apply explicitly, preserving edits made while the request is pending. Never invent time, venue, capacity, payment or booking facts; do not auto-publish. Reuse the existing event bridge.
6. Existing Free/Plus/Pro/Premium and 3/5/10/20 open hosted-or-approved-joined slots stay unchanged. Plus adds saved templates and reusable questions. Pro adds proposed weekly/fortnightly session dates, an ordered waitlist with explicit participation invitation, and accepted co-hosts for session/attendance operations. Premium adds aggregate applications, approvals, confirmed attendance and repeat-attendance counts. No paid bypass of safety/privacy. Downgrades preserve groups, history, existing attendance and review access.
7. Recurrence uses the same parent meetup and existing sessions. Preparing dates does not create or publish sessions until the host confirms; no new scheduler/daemon. Co-host invitation requires acceptance and grants no access to private application answers or account management. Waitlist invitation does not auto-approve or reserve/oversell a place.
8. New application and hosting consent binds the saved profile revision. If any photograph to be shared cannot be previewed, consent cannot be submitted; owner editing and already-authorized roster reads remain recoverable. Opting out of member sharing discloses only the meetup name; public hosting shares the chosen public photo and basic introduction, without private prompt answers.
9. Old clients retain their four-field profile save/join/host contracts. Legacy saves preserve new private fields and rotate the revision, while legacy publication shares exactly the original four text fields. Trying the new profile on another device never forces an old client to publish new photos or blocks its existing text-only meetup flow.

## Source and style

Base: isolated stacked checkout from integration `93c0245cfd74735ef64dcf01312fbfff6573e00c`. Reuse `src/lib/chilling-data.ts`, existing forms/cards, membership helpers, attendance/review RPCs, `Pressable`, theme tokens, `useTr` and `useInteractionFeedback().play(...)`.

```ts
const result = await client.rpc('get_my_chilling_profile');
if (result.error) throw result.error;
return result.data;
```

UI follows the approved Hinge profile editing/preview references, with Gling's own brand and components. Design / Apple Design / Patina apply. Use visible loading, error, retry, disabled and feedback states and accessible controls in both themes and languages.

## Commands and verification

- Focused existing tests: `node --experimental-strip-types --test scripts/chilling-data.test.mjs scripts/chilling.test.mjs scripts/chilling-safety.test.mjs scripts/meetup-ai.test.mjs scripts/meetup-reviews.test.mjs`
- Full regressions: `npm test` (capture large output before inspection).
- Types: `npm run typecheck`; lint: `npm run lint`; whitespace: `git diff --check`.
- New security/operation SQL tests use only a disposable local database, with transaction rollback and synthetic users. Prove denial across owner/host/applicant/member/stranger, block/cancel/reject/close, photo paths and tier boundaries, plus concurrency where places/roles are involved.
- Render the actual changed RN components in the existing headless harness, narrow/wide and light/dark, KO/EN. Final native test uses the existing sole F736 installer after source integration; do not reset auth or app data.

## Boundaries

- Always: validate at server boundaries; explicit field allowlists; existing all-content safety monitoring and audited AAL2 admin access; meaningful red/green checks; current-source verification.
- Coordinate: integration, remote SQL/Edge writes and native handoff with existing owners. Local migrations and source are authorized; do not duplicate writers.
- Never: new dependencies/providers/prices, customer test posts/messages, schema reset, broad shared-index commits, Store/deploy/minimum-version changes, second booted simulator or token copies.

## Ownership

Primary owns the contract, profile UI/client and integration. A bounded profile-backend worker owns its new migration and SQL tests only. A bounded AI worker owns the draft Edge/parser and its standalone preview control only. A bounded host-tools worker owns separate host SQL/client/components/tests only. Workers do not edit shared `meetup-create`, membership products, general auth or native config; primary integrates callers sequentially. All writes remain in this isolated checkout.
