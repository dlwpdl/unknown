# Three-channel automation cleanup

> Execute inline with the existing operational workspace and owners. The user approved this design in the current conversation; no new worker or repeated approval is needed.

**Goal:** Connect each of the three account workflows while preserving publication times, approvals, holds and the sole existing publisher per account.

**Architecture:** Reuse native Orca jobs and their existing queues. G9 owns production/source pointers; G8 reads explicitly frozen revisions and writes only version-bound review receipts. Existing Meta API publishers keep all account, source, timing and once-only attempt checks. Common current rules replace historical instructions embedded in native prompts.

**Tech stack:** Existing Python standard library, Orca CLI and local Markdown/JSON. No server, daemon, dependency, lock or publisher.

**Spec:** User-approved in-chat proposal: three independent account flows, one content writer, completed-revision review, shared bounded GUI use, independent official responses and combined performance reporting.

## Constraints

- Preserve all current native IDs, enabled states, workspace/provider, schedules and API publishing prechecks. Reuse the newly existing personal job a4bbe3d1; never restore the deleted personal jobs.
- GUI uses the existing process-owned guard for at most55 seconds. Preserve manual owners, user inputs, account identity, unfinished submissions and original deadlines.
- Existing content/approvals/CSV/attempt/public receipts remain untouched by this cleanup. No test post or manual automation run.
- Preserve HyperFrames, fixed30-second natural1x voice, current photo/cover/music/reference gates, same-city app readback, Patina, account-specific authority, explicit holds and paid limits.
- The shared operational workspace has unrelated live changes. Back up exact files and native settings, compare before writing, and do not commit other actors' changes.

## Execution

- [x] Add `marketing/test_review_ready.py` first. Test that incomplete, expired, mutated and already-reviewed revisions do not start G8; a fresh complete revision does. Observe failure before implementation.
- [x] Add the smallest read-only `marketing/review_ready.py`. It reads `channels.instagram.review_request`, verifies local hashes and future slot, and emits ready candidates. It never edits the ledger, publishes, performs GUI work or starts another job. Run the focused tests.
- [x] Write `marketing/automation-current.md` with common rules and role-specific contracts. Freeze originals in the private cleanup evidence folder. Replace native prompt histories with concise role instructions and exact references; add the G8 precheck only after tests pass.
- [x] Reconcile current document entrypoints and personal single-job references. Preserve historical bodies under an explicit archive boundary. Link the central runbook to the current contract.
- [x] Reread each native setting and compare all preserved fields. Run review-gate, existing API/GUI coordination tests and calendar checks; inspect own diffs and authority coverage.
- [x] Create an HTML report from actual saved native prompts: per-job schedule, inputs, actions, outputs, stops, changes, current rules and retained historical evidence. Show it in the owning Orca workspace and distinguish configuration from future execution verification.

Evidence: /Users/ash/Library/Application Support/gling/operations/automation-manager/three-channel-cleanup-20261013T072247Z/final-verification.json and report.html. First actual new handoff/publication remains for the next normal run; no job was manually triggered.
