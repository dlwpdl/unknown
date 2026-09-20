# Build 32 — recommended meetup ages

Owner requested a new build after approving recommended ages instead of participation restrictions. Version 1.0.1 (32), source `d464994`, includes `d0f53fb`: optional recommended ages for one-off/recurring events, private age guidance only with new-purpose consent, and self-reported/unverified birth-date wording. Actual identity-provider verification is not implemented. Previous signup consent and cover-photo changes remain included.

## Preflight and backend

- 183 Node tests, TypeScript and lint passed. Feature pgTAP suites previously passed 113 assertions. Audit: 16 existing moderate, zero high/critical; no dependency changes.
- Production migration 0072 applied after dry-run showed exactly that migration. Schema and private-data backups: `~/Library/Application Support/gling/backups/pre-build32-2026-09-19/`, private file permissions. Old consent receipts and client versions remain supported without backfill.
- Production readback confirmed migration ledger, range-validation trigger, create/configure support, both consent versions, owner-only receipt version and anonymous access denial. Subsequent dry-run reports no pending migrations.
- Pushed source to `origin/mobile-app`. GitHub Pages run `35494946332` succeeded. Orca browser on the live `/privacy` page confirmed the new purpose and explicit unverified/no-level-increase disclosure.
- Artifacts and receipts: `~/Library/Application Support/gling/releases/1.0.1-32/`. Production Supabase configuration checked before archive.

## Release state

iOS archive and App Store export succeeded. Verified bundle ID `com.dlwpdl.gling`, version `1.0.1`, build `32`, Apple Distribution signature/team, production backend and recommended-age/new-consent/unverified strings inside the actual Hermes bundle. IPA SHA-256: `4fd5a7411c9ed26bb91a51231ce77ecee0c2f187ecb47ab5240b870393ea6fe3`.

Uploaded Apple build `b3199442-7fa6-4983-8005-212052f09c0d`; independent API readback confirms `VALID`, `IN_BETA_TESTING`, and existing `Gling Internal` (`03fefab3-98b9-4f9c-a6a0-450fdd703efb`). Korean What to Test notes supplied. App Store version remains `DEVELOPER_REJECTED` with build 30 attached, verified again after upload. No App Review or external beta submission, or new invitations.

Rollback: keep the additive migration and recorded consents; distribute build 31 and revert the client feature if necessary. Do not restore the full production database or overwrite new receipts. Physical-device signup/photo selection and updated review video remain unverified.

## App Review resubmission — 2026-09-20

At the owner's explicit request, reviewed the supplied `ScreenRecording_09-20-2026 00-40-09_1.MP4` (27.165 seconds). It shows TestFlight 1.0.1 (32), initial profile setup, individual consent checkboxes, Terms/Privacy links, select-all, AI disclosure and completed signup with optional name/date-of-birth fields empty. This supplies current signup evidence; it does not establish physical-device cover-photo QA.

Apple permits only one review attachment. Preserved both originals outside git and replaced the old attachment with `gling-build32-consent-and-historical-demo.mp4` (129.72 seconds, original 1290×2796 resolution, audio retained): new build 32 signup first, then the previous historical feature/reporting/blocking video. Independently verified attachment `06bbdc3d-0059-4369-8de9-af17e0a35c2b` delivery `COMPLETE`. Notes explicitly distinguish current and historical footage and explain that the existing review account does not repeat first-signup onboarding. Review credentials/contact remained unchanged.

Attached build 32 and restored all six items in fresh submission `2c53890c-700a-4061-829a-c1037c15705d`: app version, four existing subscription versions and the existing subscription group version. Submitted at `2026-09-20T08:21:45.840Z` (September 20, 01:21 PDT). Independent status and version readback both confirm `WAITING_FOR_REVIEW`, with build 32 attached. This is submission, not approval or public release.

Reviewer notes: [September 20 notes](../release/app-review/2026-09-20/review-notes.txt). Videos, hashes and API receipts: `~/Library/Application Support/gling/releases/1.0.1-32/review-2026-09-20/`.
