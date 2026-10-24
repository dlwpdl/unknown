# SDK 58 recovery · 2026-10-23

The prepared branch is `dlwpdl/gling-sdk58-rollback-ready-20261023` in `dlwpdl/unknown`.
It restores SDK 57 while retaining the approved fixes made before the SDK upgrade.
Preparing this branch does not roll back the deployed application.

## Recovery anchors

- SDK change: `adc30100f579758c0f63bf6e6a9de3f86e7fb82b`.
- SDK merge on `mobile-app`: `e75c2c66ecc5e01f35587bac3ae953f8f229f328`.
- Pre-upgrade source: `f2495ae19d958b8f4d43f702805b81c8cedc870c` (SDK commit's first parent).
- Published iOS version at preparation: 1.4.3, built with SDK 57.
- Published release tag: `v1.4.3`, at `e19e0801f0ac04f10e109682b5ff06c7538c0fe6`.
- Fallback dependencies: Expo 57.0.20, React Native 0.86.3, React 19.2.3.

This branch was made from the SDK merge using `git revert --no-commit adc30100f579758c0f63bf6e6a9de3f86e7fb82b`.
Before adding this document, its entire tracked tree matched the pre-upgrade source exactly.
The old `package-lock.json` is included; use `npm ci` to reproduce its dependencies.
Do not revert the whole merge: that would also remove approved fixes carried into that merge.

## When recovery is needed

Investigate reproducible SDK-related crashes, blocked login, broken navigation, payment
failures or a material error increase against the last good release. Keep the failing
platform, version/build, reproduction and logs. Do not erase app storage or uninstall
the app as a recovery step.

## Code and public web recovery

1. Use the existing prepared rollback pull request. Do not change the active SDK branch
   or the release owner's dirty working tree.
2. If `mobile-app` has advanced, update the rollback branch from current `origin/mobile-app`.
   Resolve conflicts while preserving subsequent feature and security fixes. Changes
   that depend on SDK 58 need review; an older green result does not validate a new head.
3. Require a successful **Verify app** run for the exact rollback head. The local checks
   are `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run export:web`,
   `npm run check:public-web` and `npm run check:merchant-web`.
4. Only when recovery is requested, mark that draft ready and merge it into `mobile-app`
   using the existing GitHub process. This triggers the existing Verify app and Pages
   workflows; verify both runs succeed for the actual merge commit.
5. Check the deployed public/merchant pages and the affected flow. Pages deployment
   does not replace a separately running local administrator server or a store app.

The exact SDK source can also be restored in a new isolated worktree by reverting
`adc30100f579758c0f63bf6e6a9de3f86e7fb82b` and reviewing any conflicts against current main.
Do not use a force push or reset shared main. Do not blindly replace whole source
files with their old copies after later development.

## Store app recovery

Before an SDK 58 binary is published, the installed 1.4.3 store app remains on SDK 57;
there is no native SDK rollback to distribute yet.

After SDK 58 is published, installed binaries cannot be downgraded through a Git
rollback or a JavaScript update. Build the SDK 57 source as a new recovery release:

1. The existing native release owner first reconciles current approved fixes, including
   any work not yet merged from its active worktree. Keep the same bundle/application
   ID, signing identity, upload key, store accounts, tracks and tester permissions.
2. Choose a new store-acceptable app version above the released version and add its
   notes using the existing release process. Do not reuse 1.4.3 or its old build numbers.
3. Use the existing `mobile-release.yml` and `scripts/release.py prepare` process.
   It reads both stores and allocates a build number above store and local values.
   Do not create a tag, submit a build or consume paid build capacity merely to
   prepare this fallback branch.
4. Verify signed builds and the affected login, navigation, map, notifications and
   payment flows on devices, then submit through the existing authorized release path.
5. Keep the current minimum-version/build gate until the recovery release has completed
   review and is actually installable in the public store. Approval, TestFlight,
   upload success and manual-release waiting are insufficient.

Store review and distribution take time; this is not an instant binary rollback.
The SDK change has no database migration. Preserve user content, business data,
merchant configuration and existing schema; do not run database down-migrations.

## Validation limits

The prepared source uses the exact historical lockfile. Expo's online dependency
check recommends newer SDK 57 patch versions; those were not substituted into this
fallback. Its existing upstream development-tool audit findings remain. The prepared
branch is not a signed recovery binary, device acceptance or a store submission.
