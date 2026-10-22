# Approved notification extensions — 2026-10-09

Owner approval: “오 좋다 이거 다 등록해”, following the six-item notification gap review. Extend the existing inbox, push queue, worker and settings; no new service, schedule or real-user test send.

## Required behavior

1. Participating meetup reminders at 24 hours and 1 hour also reach phone push. Preserve the existing morning inbox reminder. Current membership, event schedule, cancellation and notification preferences win when delivery is claimed.
2. Actual meetup time/place changes and early closure/cancellation notify the host/current approved participants as appropriate, once per change. Natural expiry and unchanged saves do not send cancellation alerts. Private membership notices never reach unrelated users.
3. A saved business has an explicit “새 소식 받기” choice, initially off for every business. Published linked posts notify only users who saved and opted in. The global `merchant_updates` preference can pause them. Recheck saved state, opt-in, visibility and blocks before delivery. Share city/discovery daily limits, quiet hours, spacing and target deduplication.
4. New published usage reviews notify the current authorized business owner once. Preserve private/unverified usage visibility, employment-proof restrictions, review moderation and the existing reviewer result/reply notifications. Do not put review text or evidence into push payloads.
5. A trusted terminal publishing failure, uncertain result requiring verification, or external connection becoming unusable notifies only its current authorized business owner. Normal user cancellation is not failure. Do not retry an uncertain publication automatically. Routes are internal; external URLs/tokens/errors are not push text.
6. Trusted authentication events notify the account owner about new device/browser logins and confirmed email/password changes. Baseline existing sessions without historical alerts; refreshes and repeat registration do not notify. Reuse installation/browser storage with a server-generated random identifier, store only its hash server-side, and validate the current session plus expected user. An unregistered login falls back to a generic login alert through the existing worker. Keep auth-provider security mail unchanged.

## Shared contracts

- Global booleans/categories: `merchant_updates`, `merchant_operations`, `account_security`, default true. Existing flags and opt-outs stay unchanged. Existing `meetups` and `merchant_reviews` cover meetup and incoming-review events.
- `private.saved_merchants.notifications_enabled boolean not null default false`.
- `public.set_saved_merchant_notifications(p_merchant_id uuid,p_enabled boolean) returns boolean`: authenticated, active account, already-saved visible business only. DTO property `notifications_enabled`; client `setSavedMerchantNotifications(client,id,enabled)`.
- Kinds: `saved_merchant_post`, `merchant_review_received`, `merchant_operation`, `account_security`, plus meetup kinds owned by the meetup migration.
- Targets: existing `post`, `merchant_review`; private `merchant_operation`, `account_security`, and if needed `meetup_notice`. Extend kind/category/target constraints without removing old values; define private target visibility gates before producers become active.
- Business operation route: existing `/profile/merchant` with a validated merchant UUID if that route consumes one; account security `/profile/settings`. Update app routing and Edge allowlists together.
- UI keeps current Apple-style rows and compact native switches, existing feedback/accessibility/loading/error behavior. Update the existing clickable HTML prototype without changing another live tab or draft.

## Scope and verification

No new dependency, cron, daemon, auth-provider mail setting, broad migration push, public hosting/store release, or customer test notification. Preserve safety monitoring and protected admin MFA. Verify permission boundaries, idempotence, opt-outs, delivery-time changes, deduplication, account switching, queued stale events and publication uncertainty with rollback SQL and focused client tests, then typecheck/lint and export. Deploy only migrations and worker code owned by this task with live-definition guards, backups, rollback dry run and readback. Refresh the existing Journal simulator under the shared GUI queue and inspect actual screens.

Status: complete for the approved scope. All six paths implemented; production migrations 0150–0153 and push/Naver workers registered with source readback. Existing preferences and 14 scheduled jobs preserved. Rollback SQL: 520 passed; Node: 607 passed, 1 existing skip. Typecheck, lint, export, clickable prototype and refreshed native settings passed. Evidence: `output/qa/notification-extensions-2026-10-09/verification.json`. Physical-device push receipt and store/hosting releases are not claimed.
