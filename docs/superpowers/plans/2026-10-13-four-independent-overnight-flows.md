# Four independent flows and approval-relative publication

Owner direction: keep Gling app, Instagram, official Threads and personal Threads independent. Prepare complete drafts during Vancouver 02:00–08:00, without a candidate quota. The owner reviews at 08:00 or later. Only then assign publication times to the selected eight, relative to the actual approval time. Existing authorization, budgets, reservations and uncertain submissions remain protected.

Scope: existing native IDs, their prompts/prechecks/config mirrors, the city staging/receipt helper and its installed copies, Meta API scheduling validation, G8 draft admission and the common runbooks. No new worker, daemon, lock file, service or automation ID. The existing GUI guard remains the only screen coordinator. Existing channel counts imply eight per account unless the owner selects a smaller or mixed batch.

- [x] Snapshot current native schedules/runs/owners; notify existing coordinators of file ownership.
- [x] Reproduce v2 queue overwrite and concurrent same-post/different-post receipt races before the fix.
- [x] Publish immutable city queues with create-only atomic links. Keep old receipt JSON and store new independent per-post receipts; reject repeat attempts.
- [x] Reject new G6 stories owned by the personal pipeline and require the existing source-derived UUID5.
- [x] Add isolated `APP_RECEIPT` support to the existing publisher; update both installed runtime copies and verify hashes.
- [x] Admit frozen morning video drafts for quality review before a publication time or public app post exists.
- [x] Bind new API intents to exact owner-approved batch IDs/hashes. Plan up to eight items approximately three hours apart, anchored to consent, with small random offsets on the existing five-minute checks.
- [x] Keep legacy reservations/windows and uncertain attempts intact. Use the existing three account publishers and account-specific receipts.
- [x] Reuse G7/G9/G8/G4/P/G6 and the central 08:00 report; save and read back seven changed native settings. Preserve account/workspace/provider/enabled state.
- [x] Update current runbooks and local native mirrors; preserve old content/approval ledgers.
- [x] Verify Python suites (102 social/GUI + 20 city + 9 persona, with two DB integration checks skipped), all 12 shell-publisher tests, shell syntax and 274 calendar rows. The previously clock-dependent publisher integration test now uses a fixed clock and mocked HTTP and passed at night.

Evidence: `/Users/ash/Library/Application Support/gling/operations/automation-manager/four-flow-collision-fix-20261013T083352Z/`.

First scheduled 02:00 observation: G6 preserved the existing city queue; three account prechecks skipped empty/outside publication slots without starting AI; G7 dispatched. This is admission evidence, not completed research, accepted videos, publication or performance. Full overnight execution and the first actual owner-approved batch publication remain unverified. The local scheduler requires the Mac and Orca to remain available.
