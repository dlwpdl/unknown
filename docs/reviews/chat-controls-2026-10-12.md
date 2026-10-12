# Chat controls — local implementation, deployment held

Direct and group ChatRoom share a 400ms long-press menu. Visible messages can be quoted; authors can edit their text or confirm deletion. Edits keep the composer draft and use the original server revision. Deletes leave a tombstone, clear attachment metadata and preserve earlier versions privately. Realtime updates revalidate RLS and update quotes. Existing reporting, blocking, pagination and double-tap reactions remain available.

The attachment menu opens **위치 공유하기**. Google Maps JavaScript and Places (New) support place search and choosing a map point; current location requests permission only on an explicit tap. Sending requires a selected, bounded point. A failed send preserves it. The map adapters use the installed WebView on native and an iframe on web; no dependency was added. Ordinary messages retain their previous API path and read schema.

The local migration restricts mutation to active accounts and conversations, the author and the current revision. Replies require a visible parent in the same room. Closed/expired groups cannot mutate content. Earlier content stays in private history, feeds the existing safety worker and queue hash, and is available to a live AAL2 admin through an audited RPC. The existing bounded AI input and provider remain unchanged.

57 focused checks and 26 transactional pgTAP checks passed. TypeScript and targeted ESLint passed. Offline actual React checks exercise direct/group replies, edits, deletion, failed drafts, place/current-location selection and four widths. The interactive HTML also passed four widths, 44px controls and 200% type. The full suite has 732 passing, one skipped and the existing festival-daily expiry fixture failure; the same failure was reproduced before this chat change.

Google Maps is not configured: add a Gling-specific `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` with Maps JavaScript and Places (New) enabled and the correct HTTP referrer restrictions before live map verification. No Google billing, paid request or new service was started. Device gestures, haptics and native WebView referrers still need an actual device check. Deployment of the migration, safety-monitor update and app must be coordinated later; none was deployed under the owner's hold. The existing v1.1.9 submission is preserved.

[Interactive preview](../../output/design/gling-chat-controls-2026-10-12.html) · [Check record](../../output/qa/chat-controls-2026-10-12/verification.json)

The initial Orca preview could not execute because its global `close` function collided with Orca’s protected `window.close`. The script now uses a local scope. The regression check freezes `window.close` and confirms three initial bubbles and the long-press menu; the corrected file also passed inside Orca’s Gling folder. This fix changes only the preview and its checks.
