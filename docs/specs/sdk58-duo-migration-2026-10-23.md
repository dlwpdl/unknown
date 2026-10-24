# SDK 58 migration for Duo — 2026-10-23

The owner approved migrating the SDK after reviewing the Duo research. Scope is Expo 58 stable, its compatible React Native/dependencies, required API changes, generated Scene lifecycle, and build tooling. Preserve UI, app identity/version, authentication/privacy/security, user data, canonical private admin runtime, release ownership, and public update policy. Wider map layouts and store assets remain separate follow-up work.

Baseline: committed f2495ae; existing post-release QA changes belong to their current owner and must be reconciled before integration. Upgrade only this isolated checkout, with its own node_modules. Use the current repository patterns and built-in node test runner; no new app architecture or test framework.

1. Install locked SDK57 dependencies; record baseline npm test, typecheck and lint.
2. Read versioned Expo57/58 documentation and SDK58 migration/breaking changes. Upgrade with official Expo dependency alignment, remove obsolete compatibility patches only when verified, then run Expo install --check and doctor.
3. Apply necessary API/build configuration adjustments; inspect prebuild output in this isolated checkout and verify Scene window creation, auth URL handling, permissions, entitlements, notifications and native SDK integration. No installs over the existing simulator or publication.
4. Run npm test, npm run typecheck, npm run lint, public/merchant web checks, native bundle/export checks, and available native builds. Record missing toolchain/device checks explicitly. Commit the verified scoped change and provide evidence; do not claim native validation from a web build.

Success: coherent Expo58 dependency tree and lockfile; required checks pass; generated native configuration matches current app capabilities; native build results and limitations are explicit. Preserve existing release availability gating and installer coordination. Official sources: https://docs.expo.dev/versions/v58.0.0/ , https://expo.dev/changelog/sdk-58 , https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md .

## Implemented compatibility changes

Expo58.0.17, Router58.0.25, React19.3.0 and RN0.88.0 use the matching Expo native package versions. Strict refs/list contracts, web keyboard event shapes, WebView14 props, nullable styles and notification named imports were updated without layout or permission changes. SDK58 no longer uses the query-string parser or xcode UUID dependency, so the corresponding overrides/install patch were removed; malformed-link and native project-ID behavior still have executable regression checks. YAML is now an explicit dev dependency because the release tests already import it and SDK58 removed its former transitive copy.

SDK58 requires custom HTML documents to forward useServerDocumentContext nodes and attributes, and static routes to export generateMetadata. Public and merchant documents now retain their assets/hydration nodes, public routes retain metadata, protected routes remain noindex, and the home schema uses the existing safe JSON-LD serializer. The public document marks only the existing dynamic Head metadata as Helmet-owned to avoid conflicting canonical/robots tags after hydration; resources and document settings remain untouched.

## CI/CD and rollout boundaries

The three existing CI, Pages and mobile-release workflows are unchanged. Their public-only/free-runner guards, branch/tag triggers, source trust checks, signing, store submission queue and published-availability update gating remain intact. No version tag, store upload, active admin export, simulator installation or minimum-version change is part of this migration verification.

Local native validation uses Xcode26.6/iOS26.5 SDK and the existing Android SDK/JDK17. Full Duo edge-to-edge validation needs Xcode27.1/iOS27.1 SDK. Apple requires macOS26.6+ for that Xcode; this Mac is26.5.1. No OS upgrade is attempted, and ordinary native build success does not establish Duo device readiness. The current release workflow still selects Xcode26.5; a verified newer CI toolchain is a separate prerequisite before calling a shipped build Duo-optimized.

The current dependency audit reports5high findings in Expo CLI transitives (down from7 in the locked SDK57 baseline), with0critical. node-forge's latest release still has the advisory; overriding the CLI's Zod3 to Zod4 is a major API change and was not forced. These existing toolchain findings remain recorded rather than hidden or addressed by downgrading Expo. See the local review evidence for exact advisories and checked versions.

Evidence: /Users/ash/Desktop/Git/unknown/output/reviews/gling-sdk58-upgrade-2026-10-23/ . Native builds, final browser checks and remote CI results are recorded there as they complete.
