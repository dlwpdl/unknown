# URI decoder security fix

The owner requested fixing GHSA-vcc3-ghjq-m6fr. Expo Router 57 uses CommonJS
query-string 7.1.3, whose decoder 0.2.2 exhausts CPU on malformed UTF-8 query
values. Use the official fixed decoder 0.5.0 with its verified registry integrity;
retain the installed Expo and query-string versions. A small reviewed postinstall
patch selects the decoder's ESM default export for this CommonJS caller and fails
if the upstream import changes. Do not change URL limits, routing or auth rules.

Acceptance: the real query-string parser completes the malformed-input regression
in an isolated process; Korean, emoji, plus signs, repeated parameters and synthetic
OAuth callback values retain their semantics. The install patch is idempotent and
refuses an unknown caller. Verify a clean locked install, native npm audit, tests,
lint, typecheck and web exports. Apply the reviewed private export through the
existing server with backups, headers, actual normal-MFA UI and artifact readback.
Native/store and public publication holds remain; installed mobile binaries need
a later authorized app release to receive this source fix.

Scope: package.json, package-lock.json, scripts/fix-uri-decoder.mjs and
scripts/uri-decoder.test.mjs. No new dependency or service.

Reference: https://github.com/advisories/GHSA-vcc3-ghjq-m6fr

Checks: `node --test scripts/uri-decoder.test.mjs`, `npm test`,
`npm run lint`, `npm run typecheck`, `npm audit --json`,
`GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir .admin-dist`.
When dependency lifecycle scripts are disabled, run the reviewed local
`npm run postinstall` after `npm ci --ignore-scripts`; normal `npm ci` applies it
automatically. The existing React Native Node engine range supports require(ESM).
