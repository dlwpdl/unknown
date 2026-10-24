# Unified saved items

## Approved objective

Owner approved the proposed extension on 2026-10-23: “그렇게 진행하고 채팅검수이어서해”. Extend the existing Profile → Saved screen so members can keep and revisit businesses, map places, posts/meetups, hiring posts and people. Continue the separate chat QA. Existing released app and draft PR53 remain separate from this feature; no new store submission, production migration or version gate change is authorized by this implementation task.

## Accepted behaviour

- One private Saved library, with All / Places & businesses / Posts & meetups / Jobs / People filters and search. Default ordering is when the item was saved, newest first.
- Reuse existing `public.post_reactions(kind='save')` saves (including job posts) and merchant saves. Preserve their IDs, timestamps, notification preferences and existing callers.
- Add saving on place details and public personal profiles. Save once immediately; folders are optional organization afterwards.
- A map place connected to a business represents the same branch in this library. Resolve existing authoritative identity links, never names; preserve different branches. Saving through either surface and later linking a previously unlinked place must not produce duplicate cards or contradictory save state.
- Saved business cards with a current webshop offer can open the existing price comparison sheet, then the existing tracked browser handoff. Saving a webshop is saving that business, not a duplicate URL bookmark. Read current offer data; do not freeze a past discount or bypass the Uber notice/price sheet.
- Private optional folders: create, rename, delete, add/remove saved items. Deleting a folder preserves the saves. No forced folder picker on every save and no public sharing.
- Saving a person does not follow, notify or message them. Existing business news notifications stay separate and opt in.
- Respect current account, block/report/deletion and visibility rules at read and write time. Saved references must never expose a previously visible private profile or hidden content. Closed public hiring posts can show their current closed status.
- Preserve loading/error/empty states, pagination and back navigation. No stale response may cross an account/filter/folder boundary.

## Structure and style

Existing Expo57/React Native app; no dependency changes. `src/app/profile/saved.tsx` is the current screen; `src/app/places/[id].tsx` and `src/app/user/[id].tsx` are the missing entry controls. Reuse merchant-conveniences, post save APIs, canonical place identity, theme tokens, ThemedText, shared controls and `useInteractionFeedback().play(...)` on changed controls.

Example house style:

```ts
const result = await client.rpc('set_saved_merchant', { p_merchant_id: merchantId, p_saved: saved });
if (result.error) throw result.error;
if (result.data !== saved) throw new Error('MERCHANT_SAVE_NOT_VERIFIED');
```

First agree the smallest data/RPC contract against the current schema. Prefer existing privacy helpers and indexed, bounded server reads over per-card network queries. Add migrations and tests without applying them to production during the current release hold.

## Design evidence

Read Design, Apple Design and `docs/design-system.md`. Actual Mobbin screens reviewed: Savee saves/boards (`https://mobbin.com/screens/8fbd1638-c71d-4262-b334-6bb131cf8f18`), Doji private collection (`https://mobbin.com/screens/f8831bb6-e06f-4a37-ba5e-100566092df5`), Instagram collection (`https://mobbin.com/screens/fe3e262e-5b13-4bc5-a53b-d014bd1915b1`). Apply private collections and a simple save first; use Gling's existing mixed-content list cards instead of a photo-only grid. Other returned Google Maps screens showed labels/directions rather than the needed library and are not claimed as suitable references.

## Plan and ownership

1. Establish the data contract; preserve existing saves and canonical identity. Root approves the technical contract. Backend owner edits only its migration, SQL tests, new data library and focused library tests.
2. Saved library owner implements the filters/search/folders/cards against that contract, using only its screen and a necessary small UI module/tests.
3. Entry owner implements place/person save controls and shared status integration against the contract, using only those entry files and focused tests.
4. Root integrates, reviews privacy/dedup/performance, renders the actual UI at narrow/desktop widths in light/dark and Korean/English, and verifies existing actions and available native flows. Source/fixture evidence and actual native/backend evidence remain distinct.
5. Run full checks and create a reviewable draft PR. Keep production/store/version policies unchanged pending the existing owner release decision.

## Commands and validation

`npm test`; `npm run typecheck`; `npx eslint <owned files>`; existing local SQL/pgTAP runner for the selected migration. Use the installed Expo export/React fixture renderer for actual responsive rendering, with the shared bounded GUI guard. No new renderer service or dependency.

Meaningful tests cover: retaining old saves, save/remove/reload, unauthenticated denial and user isolation, blocked/hidden/deleted target visibility, branch identity/dedup including link-after-save, job classification, stable ordering/pagination/search, folder ownership and deletion preserving saves, stale response isolation, current webshop sheet handoff and existing notifications remaining opt in.

## Boundaries

Always validate inputs, permissions and current target visibility; keep user and production data intact; verify before committing. Technical choices inside the approved feature use existing patterns and supervisor review. Never change auth roles, forge sessions, send messages, create customer content, add dependencies, apply production migrations or submit another store build for this task. No AI/photo generation is involved.

## Release authorization update — 2026-10-23

The owner authorized completion of all four audited performance fixes followed by Apple and Google submission as 1.4.4. This supersedes the earlier release hold in this document. The Saved migration was applied and independently checked; final integrated SDK58 verification and actual store receipts remain release requirements. Existing public-version availability gates stay unchanged.
