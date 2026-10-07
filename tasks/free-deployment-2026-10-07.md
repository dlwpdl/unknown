# Free mobile deployment

Approved scope: automate verified releases within free service limits, with local build and manual submission available when cloud execution is unavailable. No paid plan, larger runner, extra storage allowance or usage-based billing may be enabled.

Use the existing public `dlwpdl/gling` repository and standard GitHub-hosted `ubuntu-24.04` and `macos-26` runners. Every job checks that the repository is public; private repositories stop before allocating a runner. No caches or uploaded Actions artifacts are needed. This avoids consuming EAS cloud build quotas. Keep the existing Apple and Android signing identities.

Source baseline is the currently approved 1.1.2 code, copied into an isolated checkout without environment files, credentials, local build output or marketing work. Fix the four existing React Hook lint failures so CI can enforce lint, `npm run typecheck`, `npm test` and Expo export. Do not disable lint rules.

Development pushes and pull requests run verification. A matching `vX.Y.Z` tag on the trusted mobile release branch triggers signed native builds and store submission; a manual workflow run can verify builds without submission. Use store APIs instead of browser automation. iOS review submission remains a separate step from binary upload. Android initially targets the existing internal testing track because public production access is unavailable.

Secrets are stored only in GitHub Secrets and temporary runner files. Pull requests receive no signing or store secrets. Serialize releases, verify the source version against the tag, record binary hashes and remote submission IDs, and stop on failed checks. Never reuse a build number already uploaded to either store.

Implementation order: commit the reproducible approved source baseline; fix and verify lint; add the free-only workflow and minimal release commands; configure existing credentials through protected inputs; verify an actual remote CI run and signed builds; document manual fallback commands. Production submission is triggered only by a future release tag, so setup does not replace the already submitted build 54.

Checks: `npm run lint -- --no-cache`, `npm run typecheck`, `npm test`, `actionlint .github/workflows/*.yml`, Expo export and a real GitHub Actions build run. A small runnable policy test checks that private repositories, paid runner labels, uploaded artifacts and cache storage cannot enter the workflow. Local signing and upload use the same release scripts as CI.

References: https://docs.github.com/en/billing/concepts/product-billing/github-actions ; https://docs.expo.dev/versions/v57.0.0/ ; https://docs.expo.dev/build-reference/local-builds/ ; https://developers.google.com/android-publisher/getting_started .

Verified 2026-10-07:

- Remote configuration was read back from public `dlwpdl/gling`; default branch is `mobile-app`. Both merged setup PRs preserve the existing web work: https://github.com/dlwpdl/gling/pull/1 and https://github.com/dlwpdl/gling/pull/2 .
- Lint, type checking, all 289 tests and the public web export passed on fresh hosted runners. Signed iOS and Android build-only runs both completed successfully: https://github.com/dlwpdl/gling/actions/runs/37660686197 and https://github.com/dlwpdl/gling/actions/runs/37663875680 . The second run tested final release code `e35bb45e2547d62db51e79574f4c3e55851a5f49`. Both runs skipped store submission and deleted native artifacts when runners ended.
- An actual App Store API check rejected a release tag for already released 1.1.2 before any upload. Public Apple lookup reports 1.1.2 released on 2026-10-07 at 16:31:54 UTC: https://itunes.apple.com/lookup?id=6809273242&country=ca .
- The existing Google Play service account originally lacked testing release permission. Added only the Gling app's “Release apps to testing tracks” permission through the existing shared GUI queue, saved it and reopened the settings to verify every checkbox. Production and administrator permissions remain disabled.
- A fresh service-account token successfully validated an identical existing internal-track release for build 54. The temporary edit was deleted without commit; setup did not submit a new store build. Protected local receipts are `.release/play-permission-attempt.json` and `.release/play-release-validation.json`; no credentials were added to source control.
- The manual fallback uses a separate tagged worktree, protected local credentials, the installed CA bundle and the build number allocated from both stores. No extra Mac scheduled job, paid service, cache allowance or native artifact storage was introduced. Future store submissions require a new matching release tag.
