# Gling push delivery

Apply migrations through `0041`, configure the native EAS project and FCM/APNs credentials, then deploy `push-notifications`. Nothing in the migration creates a network scheduler or sends a test alert.

The worker requires `PUSH_NOTIFICATIONS_SECRET` (a random server-only secret). Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Set optional `EXPO_ACCESS_TOKEN` when enhanced push security is enabled in EAS. Never put these secrets in Expo public environment variables or commit them.

Configure a server scheduler to invoke once per minute, keeping the header secret in its secret store:

```sh
curl --fail --silent --show-error --request POST \
  "$SUPABASE_URL/functions/v1/push-notifications" \
  --header "x-push-secret: $PUSH_NOTIFICATIONS_SECRET"
```

The request body is ignored; callers cannot supply recipients or notification content. A call claims up to 100 sends and 100 due receipts. Responses contain counts only: `tickets`, `providerAccepted`, `retrying`, `failed`. Monitor non-2xx responses and `failed`; stored `last_error` values contain only sanitized error codes, never tokens or provider messages.

Client RPCs are `register_push_device(p_token text, p_user_id uuid)` and `unregister_push_device(p_token text, p_user_id uuid)`, both returning void. Expected owner must match `auth.uid()`. Registration also requires a live `auth.jwt().session_id` belonging to that owner. Unregister with a token removes that binding; `p_token: null` removes all bindings in the current authenticated session, preserving other sessions and accounts. Before logout, await `unregister_push_device(null, currentUserId)` and stop logout if it fails; no local token storage is needed. Session revocation, token transfer, and inactive/deleted accounts remove their bindings and queued work. Registration alone does not opt in; the existing preferences API sets `push_enabled` after the native permission succeeds. Tokens remain private even from direct service-role table reads.

Push data is `{notificationId, userId, category, route}` with Android channel `gling-activity`. Payloads reuse generic notification copy, never message/comment bodies. The worker allows only known internal routes and falls back to `/notifications`. Every send claim rechecks opt-in, category, actor blocks, target visibility, unread status, account status, and session validity. This activity channel does not change safety monitoring, audit records, or existing admin alert delivery.

Each claim has a two-minute lease; transient sends retry with exponential backoff, at most five attempts, and expire after 24 hours. Receipt polling starts after 15 minutes and stops after 24 hours. `DeviceNotRegistered` disables a device until a fresh registration. Queue rows are pruned after seven days when the worker runs. A successful Expo ticket only means Expo accepted the request; `provider_accepted` means APNs/FCM accepted it, not that a device received it. Expo has no request idempotency key: a lost HTTP response can cause a retry, so stable notification IDs collapse duplicate alerts where supported. Alerts already handed to Expo cannot be recalled on logout or opt-out; a five-minute TTL bounds provider buffering.

Run the offline checks with `node --experimental-strip-types --test scripts/push-delivery.test.mjs` and `supabase test db supabase/tests/push_notifications.test.sql --local`. Actual device delivery remains unverified until EAS/project credentials and an owner-approved test device are available.

Protocol reference: [Expo sending notifications, tickets, receipts and errors](https://docs.expo.dev/push-notifications/sending-notifications/).
