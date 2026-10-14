# Chat photo bundles — 2026-10-13

Owner request: send selected photos together as one chat message, like KakaoTalk. Keep the current compact attachment menu and the existing ordered selection limit of 20. Commit, release builds, deployment and review submission remain on hold; local source checks and simulator refresh are authorized.

One selection produces one atomic image message, one unread item and one notification. The bubble shows a compact grid (up to nine tiles, with a remaining-photo count), one timestamp and the existing message menu/reply/report controls. Opening a tile shows the same ordered bundle in the existing fullscreen viewer, with swipe and accessible previous/next controls. Existing single-photo messages continue to work.

Owner follow-up: long multi-photo preparation and sending must visibly report progress. Display the actual completed/total count while preparing and uploading, then an indeterminate confirmation stage; use the existing loader, accessible progress semantics and disabled sending controls. Success clears the status, and failure restores retry controls without discarding the bundle. Do not show an invented time estimate or percentage.

Reuse compressed private chat uploads, the existing send-message authorization/moderation/rate-limit path, feedback and theme tokens. An interrupted upload retains completed uploads. An uncertain send retains the entire selection, uploaded paths and request ID so retry confirms the same message rather than sending duplicates. Cancel or a changed selection uses the existing protected unsent-image cleanup; committed or retained evidence cannot be removed.

The additive database migration must validate every image's owner, conversation, format and existence; enforce the 20-photo bound; preserve participant visibility and the AAL2/admin audit boundary for every image; clear all public paths on deletion while retaining the full original bundle privately. The existing safety queue continues to cover every message; this change does not add image-model calls or change monitoring schedules.

Affected scope: shared chat record/path/signing/send helpers; ChatRoom draft/send/grid/viewer; admin conversation types, signing and attachment rendering; message constraints/RPC/storage policies/history/deletion; behavioral JavaScript and transaction-only SQL regression checks. No dependency, service, job or production data changes.

Reference inspected: WhatsApp https://mobbin.com/screens/2c807c0a-d708-4011-9437-140913bd920b (two photos and a shared timestamp in one bubble). BrandKit's current Gling assets and existing app theme remain the visual source. Simulator sends to real users are outside the verification scope.

Release review regression: the shared legacy `send_chat_attachment` boundary also rejects paths already used anywhere in an album, under its existing relationship lock and after ownership/format validation. `send_message_v2` delegates to that same boundary. Both installed-client entry points have rollback SQL regressions that first demonstrated reuse and then passed.
