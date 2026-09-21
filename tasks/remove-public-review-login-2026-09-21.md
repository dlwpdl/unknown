# Remove the public review login entry

Owner requested that iOS and Android stop showing the review-account login link to ordinary users, including the next store build and screenshots.

Removed the link from shared LoginPanel, covering profile, chat, notifications, promotions, membership and authentication sheets. Removed its unused router import/style and retired its client analytics registry entry. Historical server analytics allowlist remains unchanged.

Existing /auth/review route and server-validated review-account authentication remain available through gling://auth/review. No credentials, roles or permissions changed. New reviewer instructions: release/app-review/2026-09-21/review-access.txt. Historical review records remain unchanged.

The already-published iOS binary cannot be changed by this source edit. Store updates must use a rebuilt artifact; the earlier 1.0.2-33 archives predate this fix and must not be used for it. Rebuilt artifacts go under ~/Library/Application Support/gling/releases/1.0.2-33-review-link-fix/.

Validation: TypeScript, lint and 191 Node tests pass. The new rendered-component check covers iOS and Android public login and the explicit review form; it fails against the previous source and passes against the fix. The old web navigation script cannot exercise native login after the public web became read-only; no web-login success is claimed.


## Release receipt — 2026-09-21

- iOS 1.0.2 (33) archive/export/upload succeeded. Apple independently confirms build `45ebc83a-abc7-441f-b149-879a7306a2bb` VALID. Created version `2b88fa4f-a384-4408-aba9-75b67f46886a`, attached build 33, updated reviewer deep-link instructions and release notes, and submitted. API confirms `WAITING_FOR_REVIEW`; Console confirms one item submitted. Automatic release after approval. Published 1.0.1 remains unchanged until approval and release.
- Android signed AAB/APK rebuilt; existing upload certificate and 16 KB ZIP alignment verified. Alpha release `1.0.2 (33) 로그인 화면 정리` submitted with pending store changes. Console now says `검토 중인 변경사항`; automatic quick checks are still running and will forward the changes when successful. This is CLOSED ALPHA, not public production access.
- Replaced four older Google phone screenshots with three unedited captures from signed build 33, stored in `release/google-play/phone-build33/`. Existing iOS screenshots retained. Android public profile login visibly omits review entry; `gling://auth/review` opens the existing form. Emulator initially had System UI ANRs; later captures succeeded. Full native typed-credential login was not verified because emulator input dropped characters. Independently authenticated the existing review credentials against the real server and asserted the exact email-provider/review_access/non-admin gate; passed. No credentials or tokens were logged or committed.
- Published and visually verified https://gling.ej-entertainment.com/child-safety. Owner confirmed gling@ej-entertainment.com as actual response contact. Child Safety Standards URL/contact/two declarations saved; app-content attention list is clear. Procedure: `docs/operations/child-safety-response.md`.
- Both stores now instruct reviewers to open `gling://auth/review`; server/member permissions unchanged. Google Data Safety now includes Analytics for User ID and Other Personal Info; existing approximate-location/app-interaction Analytics disclosures verified. Apple Sensitive Info now includes Analytics, retaining linked-to-user and no-tracking choices; existing User ID, approximate location and product interaction Analytics disclosures verified.
- Website validation caught missing shared legal-page CSS variables. Restored colors using existing dark theme tokens for all legal pages and added export assertion. Export, public-route check, TypeScript and lint passed. GitHub Pages runs 35656607063 and 35657045600 succeeded; visual live check passed.
- Private build hashes and final store receipts are under `~/Library/Application Support/gling/releases/1.0.2-33-review-link-fix/`. Source commits: d71acb1 and 3d26367. Unrelated dirty marketing files preserved.
