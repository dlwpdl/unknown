# Build 29 — review consent and meetup details

## Approved scope (2026-09-17)

- Before signup/login: unchecked required Terms of Use/community-rules agreement, readable terms link, explicit no-tolerance notice for objectionable content and abusive behavior. All public providers and review access enforce it. Keep the separate OpenAI safety consent in onboarding.
- Free optional one-photo cover on both one-off and recurring meetup creation. Existing post image display/moderation/storage; no new dependency.
- Group conversation member list with nickname/avatar/host label. Message time and date separators. No read receipts, presence or last-seen indicators.

## Implementation boundaries

- `accept_login_terms(text)` writes authenticated caller + exact version + server timestamp to a private RLS-enabled receipt table. It cannot create AI consent or grant membership. No user-supplied user ID/time. Account purge removes receipts. No historical acceptance backfill.
- Login callbacks require the current version; unsuccessful receipt storage signs out locally. Apple receipt precedes optional metadata update. Authenticated UI waits for completion; reopening the modal resets the checkbox.
- `0068` preserves the five-argument event RPC and delegates to a six-argument atomic implementation. `0069` roster access requires current conversation permission and excludes blocked users. ADR-0001 remains unchanged.
- Rollback: distribute build 28 and revert the web UI commits if needed; keep additive RPCs/receipts. Do not restore the entire production DB or remove new evidence.

## Verification

- `npm test`: 180 passing (including actual LoginPanel/AuthProvider callback tests and Apple metadata-failure regression).
- `npm run typecheck`, `npm run lint`, `git diff --check`: passing.
- Selected pgTAP suites: login_terms, meetup_cover, chat_members, chilling_free_flow, chilling_event_details, relationship_slots, meetup_abuse_limits, chat_inbox_pages, account_lifecycle: 261 passing.
- Production web export + public-route check; Orca Gling workspace at 390×844: unchecked disables login; checked enables login and exposes checked=true to accessibility.
- Independent read-only review: Apple receipt ordering issue fixed; no remaining critical/important findings.
- `npm audit`: 16 existing moderate, zero high/critical. Existing Expo toolchain deferral/recheck 2026-10-01 remains; no forced upgrade.
- BrandKit tokens reused. Mobbin/Kroma unavailable because SERPER_API_KEY is missing; no fabricated research results.
- Production migrations 0068–0070 applied after dry-run and schema/data backup in `~/Library/Application Support/gling/backups/pre-build29-2026-09-17/`. Data dump has existing circular comments-FK restore caveat.
- Physical-device picker/auth QA and a new real-device terms recording require the owner's device; web checks are not represented as physical-device evidence.

## Release

Superseded on 2026-09-19 by version 1.0.1 (30), which includes these changes and separate required privacy consent. Build 29 was archived locally but never uploaded. Build 30 is VALID / IN_BETA_TESTING in Gling Internal; see [build 30 release record](build-30-required-privacy-consent.md).
App Review is not submitted automatically.

## Existing review evidence

Combined September 11 + September 17 recording uploaded successfully as `gling-combined-review-2026-09-17.mp4` (102.53 seconds), attachment `207c01ac-ff78-46a7-b86a-ebc8fca45383`, delivery COMPLETE. Originals retained outside git. Review notes distinguish recording dates. This recording predates the new pre-login checkbox; append a real-device recording after installing build 29.
