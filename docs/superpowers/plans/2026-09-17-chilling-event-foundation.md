# Chilling event foundation implementation plan

> Execution: inline incremental implementation plus an independent SQL worker and an HTML prototype worker, as authorized by project AGENTS. Each implementation leaves runnable behavior tests.

**Goal:** Implement the first independently testable Chilling slice: distinguish one-off/persistent meetups and safely configure their schedules/capacity. Keep build 25 isolated.

**Architecture:** Add safe public fields to existing room_preview through an owner-only RPC. Add a typed client normalizer and reusable native presentation components; do not switch the live meetup route before design review. HTML is separate, uses fictional demo content, and never calls production APIs.

**Tech stack:** Existing Expo 57, React Native, TypeScript, Supabase/Postgres, Node test runner and pgTAP. No dependencies.

**Spec:** ../specs/2026-09-17-chilling-design.md

## Constraints

- Free users can create both kinds; existing membership limits remain separate from future host limits.
- Missing eventKind means legacy persistent group. Never invent a date for old meetups.
- No profile, private address or application answers in public room_preview.
- Production migration and visible route activation are excluded from this increment.

## Task 1: SQL configure/expiry boundary

Files: supabase/migrations/0063_chilling_event_details.sql and supabase/tests/chilling_event_details.test.sql.

Interface: configure_chilling_event(p_post_id uuid,p_kind text,p_starts_at timestamptz default null,p_ends_at timestamptz default null,p_timezone text default null,p_cadence text default null,p_capacity integer default 8) returns void.

- [ ] pgTAP must fail before migration when the function is absent.
- [ ] Implement active-owner check, once/group validation, future end, timezone, capacity 2..50 and capacity >= existing participants.
- [ ] Direct room_preview writes must not bypass metadata validation; request/approval checks reject expired once events.
- [ ] Apply locally only and run the transactional tests. Preserve legacy close/leave behavior.

## Task 2: TypeScript client and native presentation

Files: src/lib/chilling.ts, src/components/chilling-event.tsx, scripts/chilling.test.mjs.

- [ ] Write failing tests for legacy group classification, independent date/timezone labels, invalid schedules/capacity and free RPC payload.
- [ ] Implement `chillingKind`, `chillingSchedule`, `configureChillingEvent` against the exact SQL signature.
- [ ] Add accessible kind tabs and schedule label, keeping them out of the live route until review. Event creation/editor UX is shown in the HTML; persisted native editor belongs to the following integration increment. Never claim local state was saved remotely.
- [ ] Run `node --experimental-strip-types --test scripts/chilling.test.mjs`, `npx tsc --noEmit`, and ESLint; then full Node tests.

Literal examples: missing eventKind => group; once end before start => reject; America/Vancouver `2026-09-26T17:00:00Z` => 9월 26일 10:00 local; RPC receives p_kind='once' regardless of free tier (server retains authorization).

## Task 3: HTML proposal and readback

File: output/design/chilling/index.html.

- [ ] Show one-off/group switch, profile prompts and sharing preview, application, free hosting and paid-tool comparison.
- [ ] Run browser checks with Orca under Git → gling: all screen transitions, keyboard dialog close, mobile layout and console errors.
- [ ] Present the HTML; record prototype vs production boundaries explicitly.

Remaining spec coverage belongs to separate increments: persisted private profiles/answers, new application consent, paid feature allocation, recurring creation, waitlist, co-host, check-in and analytics. No subscription or price changes in this increment.

## Verification record — 2026-09-17

Implemented Tasks 1–2 and the interactive HTML proposal. New Node checks 5/5; full Node suite 155/155; TypeScript and ESLint exit 0. New pgTAP checks 38/38 and five related SQL files 154/154. SQL applied only to the local database.

Orca browser: seven flow assertions passed; required application consent blocks empty submission; explicit dialog close works; console empty. At 320px no horizontal overflow; date fields stack on narrow screens. Escape via Orca did not close the native dialog, so keyboard dismissal is not claimed as verified. Desktop screenshot inspected. Preview is in Git → gling, page `2d13597e-2b3e-4b49-8996-106133d047e2`.

Integration caveat: existing create_post caps initial capacity at 30; configure_chilling_event supports 2–50. Before native creation integration, make initial creation and event configuration atomic rather than publishing a partial legacy meetup if the second call fails.

Reference boundaries: Apple design skill and official Luma guidance informed the proposal. Mobbin MCP was unavailable (indirect Kroma discovery lacked its configured search key); no Mobbin screens were inspected. No paid services or new dependencies used.

Independent review approved this isolated foundation; one prototype validity issue was reproduced and fixed. Runnable regression in the preview browser console:

```js
document.querySelector('.selector [data-screen=create]').click();
const f = document.querySelector('#create-form');
f.elements.title.value = f.elements.description.value = '테스트';
f.elements.start.value = '2026-09-28T10:00';
f.requestSubmit();
console.assert(!f.checkValidity());
f.elements.start.value = '2026-09-26T10:00';
f.elements.start.dispatchEvent(new Event('input', { bubbles: true }));
console.assert(f.checkValidity());
```

Official references: https://help.luma.com/p/collect-registration-questions and https://help.luma.com/p/managing-your-guest-list ; https://developer.apple.com/design/human-interface-guidelines/segmented-controls and https://developer.apple.com/design/human-interface-guidelines/sheets .
