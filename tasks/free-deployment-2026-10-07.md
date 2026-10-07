# Free mobile deployment

Approved scope: automate verified releases within free service limits, with local build and manual submission available when cloud execution is unavailable. No paid plan, larger runner, extra storage allowance or usage-based billing may be enabled.

Use the existing public `dlwpdl/gling` repository and standard GitHub-hosted `ubuntu-24.04` and `macos-26` runners. Every job checks that the repository is public; private repositories stop before allocating a runner. No caches or uploaded Actions artifacts are needed. This avoids consuming EAS cloud build quotas. Keep the existing Apple and Android signing identities.

Source baseline is the currently approved 1.1.2 code, copied into an isolated checkout without environment files, credentials, local build output or marketing work. Fix the four existing React Hook lint failures so CI can enforce lint, `npm run typecheck`, `npm test` and Expo export. Do not disable lint rules.

Development pushes and pull requests run verification. A matching `vX.Y.Z` tag on the trusted mobile release branch triggers signed native builds and store submission; a manual workflow run can verify builds without submission. Use store APIs instead of browser automation. iOS review submission remains a separate step from binary upload. Android initially targets the existing internal testing track because public production access is unavailable.

Secrets are stored only in GitHub Secrets and temporary runner files. Pull requests receive no signing or store secrets. Serialize releases, verify the source version against the tag, record binary hashes and remote submission IDs, and stop on failed checks. Never reuse a build number already uploaded to either store.

Implementation order: commit the reproducible approved source baseline; fix and verify lint; add the free-only workflow and minimal release commands; configure existing credentials through protected inputs; verify an actual remote CI run and signed builds; document manual fallback commands. Production submission is triggered only by a future release tag, so setup does not replace the already submitted build 54.

Checks: `npm run lint -- --no-cache`, `npm run typecheck`, `npm test`, `actionlint .github/workflows/*.yml`, Expo export and a real GitHub Actions build run. A small runnable policy test checks that private repositories, paid runner labels, uploaded artifacts and cache storage cannot enter the workflow. Local signing and upload use the same release scripts as CI.

References: https://docs.github.com/en/billing/concepts/product-billing/github-actions ; https://docs.expo.dev/versions/v57.0.0/ ; https://docs.expo.dev/build-reference/local-builds/ ; https://developers.google.com/android-publisher/getting_started .
