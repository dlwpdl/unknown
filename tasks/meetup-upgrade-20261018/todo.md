# Acceptance ledger

- [x] Separate profile/media server contract and red/green authorization tests.
- [x] Owner profile management, independent draft/save/cancel, selected prompts/preferences and exact previews.
- [x] Host/application/participant/chat/review identity and consent callers.
- [x] Structured AI draft and explicit application preserving concurrent edits.
- [x] Plus templates and reusable questions.
- [x] Pro recurring session proposals, ordered waitlist invitations and accepted co-host operations.
- [x] Premium aggregates; all-tier privacy and downgrade preservation.
- [x] Combined SQL/client regressions, types/lint and independent review.
- [x] Actual-source light/dark and KO/EN rendered checks.
- [ ] Integration and one native handoff through existing owners. No Store action performed by this task; existing separate release authorization is unchanged.

Final isolated-source verification: 1,533 passed / 2 existing skipped / 0 failed; full typecheck and Expo lint exit 0. Combined profile+host replay: 411 pgTAP assertions and 13 real concurrency/revocation/expiry probes. Shared database unchanged and temporary database removed. Actual-source profile renders: 64 states, no overflow/page errors/remote calls; host tools: 8 captures with controls at least 44px. Independent client review returned three actionable P2 findings, reproduced and fixed before final regression.

Evidence: `unknown/output/reviews/gling-meetup-profile-direction-2026-10-18/implementation/`. Native and hosted deployment checks remain explicitly separate from isolated-source verification.
