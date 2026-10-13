# Post notification previews

The owner supplied a Blind notification screenshot and requested the actual post title with a short body preview, rather than a weekly rank announcement. Posts ranked 1–5 may be recommended.

The owner viewed the HTML preview and approved implementation on 2026-10-12: “알람시안봤는데 좋더라 진행해”.

Use the current push worker and notification generators. Recommendation pushes show the original post title and a whitespace-normalized excerpt of the current readable body. Tapping opens the same post. Do not invent headlines or summaries. Keep other notification categories and private-message preview preferences intact.

Expand eligible popular candidates to the top five and choose one per existing delivery opportunity. Weekly selection is stable for each recipient/week. Preserve opt-outs, city and account scope, target visibility, quiet hours, spacing, daily limits, deduplication, cron identities and schedules. No new jobs, dependencies, manual broadcasts or test messages to real devices.

The service-only claim RPC may add optional post title/preview fields. Its existing columns, lease handling, token protection and message-preview branch remain compatible with the old worker. The updated worker falls back to the original payload when new fields are absent or the destination is invalid.

The excerpt uses the first 180 Unicode characters, adding an ellipsis when longer. The operating system decides visible lines and truncation.

Verification: offline actual-worker payload tests; transactional pgTAP checks for top-five selection, visibility, opt-outs, current body, receipt privacy and stable retries; `npx tsc --noEmit`; `npm run lint -- --no-cache`; relevant Node regressions, then full suite before integration. A clickable HTML preview lives in `output/design/` and is shown in the existing Gling Orca folder. Physical-device checks are deferred until deployment at the owner's request.

References: the owner's screenshot; Apple notification HIG; Expo SDK 57 notifications and Expo Push payload contract. Mobbin's Insight Timer discussion screen and Mindtrip Updates screen confirm readable title/body hierarchy; they are not lock-screen examples. No image generation is involved.

Deployment uses the existing single DB/Edge operator. Before applying, recheck the captured live function definitions, owner/ACL, push v13 source and all 14 cron identities. Run the migration in a rollback transaction against that baseline, then apply the DB migration before the worker. Read back the service-only claim columns, postgres owner, empty search path and unchanged cron schedules. Download the active Edge bundle and verify the source hash. Do not invoke producers, claim the real queue, or send test notifications.

To roll back, restore the captured v13 worker first; it accepts the added RPC columns and keeps using the original body. If the DB must also be restored, use the captured three definitions in one transaction, dropping/recreating the claim because its return type changed. Restore postgres ownership, revoke PUBLIC/anon/authenticated/service_role execution and grant only service_role on the claim. Keep the private producers executable only by postgres. Recheck the current definitions before restoring so later changes are not overwritten. Do not alter schedules or clear the queue.
