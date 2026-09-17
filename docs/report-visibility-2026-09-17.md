# Report and block visibility — 2026-09-17

Implemented for App Review submission `2f7fe5c9-e421-4276-b793-846621e5d4b8` (reviewed build 20).

- Reporting a post/comment/message hides that target for the reporter; reporting a user alone does not block them.
- Blocking immediately filters the author's already-loaded content and subsequent responses. Server queries persist the restriction across sessions.
- Reports and blocks notify admins and enter the existing report queue. Reblocking can reopen an existing user report.
- Admins can hide a reported post/comment/message globally without suspending its author. This retains the content row and records the action/access log.
- New reports capture the reported row as evidence. Existing reports are not retroactively presented as historical snapshots.
- This is not a legal hold or indefinite retention system. Existing account deletion/retention behavior remains; image paths are captured, not independent copies of image bytes.

Deployment: migration `0062_report_visibility.sql` applied to the linked production database; local admin export rebuilt and checked at `http://localhost:54321/?section=reports`. Existing reports were inspected but not moderated. Pre-change schema backup is outside Git in the Gling credentials-area backups directory.

Verification:

- TypeScript, ESLint, 150 Node tests passed (including rendered chat report/block and late-response regression).
- 124 pgTAP assertions passed across report_visibility, chat_inbox_pages, admin_console, admin_user_activity and push_notifications.
- Public web export passed the private-admin-code exclusion check; private dashboard export and iOS bundle export passed. Browser confirmation checked with cancellation, without production moderation.
- The full DB runner is not green: legacy seed expectations and non-TAP check scripts cause unrelated failures/fixture collisions. Do not treat it as a passing full database suite.

Still required for resubmission: build/upload a new iOS binary, test on a physical device, record pre-auth terms + reporting + blocking/immediate disappearance, attach the recording in App Review Information Notes and reply to App Review. None of those submission actions were performed here.
