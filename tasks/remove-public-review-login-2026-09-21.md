# Remove the public review login entry

Owner requested that iOS and Android stop showing the review-account login link to ordinary users, including the next store build and screenshots.

Removed the link from shared LoginPanel, covering profile, chat, notifications, promotions, membership and authentication sheets. Removed its unused router import/style and retired its client analytics registry entry. Historical server analytics allowlist remains unchanged.

Existing /auth/review route and server-validated review-account authentication remain available through gling://auth/review. No credentials, roles or permissions changed. New reviewer instructions: release/app-review/2026-09-21/review-access.txt. Historical review records remain unchanged.

The already-published iOS binary cannot be changed by this source edit. Store updates must use a rebuilt artifact; the earlier 1.0.2-33 archives predate this fix and must not be used for it. Rebuilt artifacts go under ~/Library/Application Support/gling/releases/1.0.2-33-review-link-fix/.

Validation: TypeScript, lint and 191 Node tests pass. The new rendered-component check covers iOS and Android public login and the explicit review form; it fails against the previous source and passes against the fix. The old web navigation script cannot exercise native login after the public web became read-only; no web-login success is claimed.


## Store artifacts and outstanding work

- iOS archive/export succeeded for 1.0.2 (33); altool returned exit 0 / UPLOAD SUCCEEDED. Apple responded with transient 500/502 errors during upload but the tool ultimately reported success. Independent final Apple API readback confirms build 33 is VALID, ID 45ebc83a-abc7-441f-b149-879a7306a2bb. Published Apple version remains 1.0.1 / READY_FOR_SALE.
- Signed Android AAB/APK rebuilt. Existing upload certificate matched; 16 KB ZIP alignment passed. Both Android bundles and the archived iOS bundle omit the retired public-link analytics identifier. Local SHA-256 receipts are in the private release folder.
- Google Play Console accepted 33 / 1.0.2. Alpha release 2 saved to Publishing overview, replacing pending 32. One nonblocking R8 mapping warning. Fresh overview confirms 14 changes NOT submitted and Submit disabled pending Child Safety Standards.
- APK installed on Gling_Release_API_36 (emulator 5560); package readback confirms 33 / 1.0.2. Emulator System UI repeatedly became unresponsive, so usable screenshots and native deep-link/login smoke confirmation are not yet complete. Do not replace store screenshots with these diagnostic captures.
- Child safety public-policy draft: release/google-play/child-safety-policy.md. Actual-response procedure: docs/operations/child-safety-response.md. Owner confirmed gling@ej-entertainment.com as the actual response contact on 2026-09-21. Public policy is implemented at /child-safety using the existing legal page; deployment and Console submission are in progress.
- Before submission: update reviewer entry instructions in each store for this build; verify the native deep link; finish current screenshots; reconcile privacy declarations with the analytics already included in build 33.
