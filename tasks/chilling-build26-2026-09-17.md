# Chilling deployment — iOS 1.0.1 (26)

User authorized production deployment and a new iOS build on 2026-09-17. Keep the existing 1.0.1 review version; increment the build only. Upload is not App Review resubmission or public release.

## Scope

- Footer remains 모임; discovery segments are 칠링 (one-off) and 모임 (recurring).
- Free profile, hosting, question, consented application, existing approval flow and audited admin review.
- No paid host-tool release, pricing changes or new service subscriptions.

## Deployment

- Pre-deploy schema, application data and auth dumps saved outside Git under `~/Library/Application Support/gling/backups/pre-chilling-26/` (971,628 bytes total). Data dump warned about the existing circular comments foreign key; restore must account for constraints.
- Safety worker deployed first, compatible with existing targets; migrations 0063 and 0064 then applied successfully to project `wjvahbdwmctzpkndqaxa`.
- Native archive/export succeeded; Apple upload `696964ef-fa29-489e-bb61-ea4f5eec201d` is build 1.0.1 (26), processing state `VALID`. Archive, IPA and logs are under `~/Library/Application Support/gling/releases/1.0.1-26/`.
- Public Pages deployment of `8cbaf8e` succeeded: https://github.com/dlwpdl/gling/actions/runs/35264926712. Homepage and privacy endpoint returned HTTP 200.
- Private dashboard is a local-only `.admin-dist` export, not part of the public site.

## Checks

- Fresh typecheck, lint and 165 Node tests passed.
- Fresh Chilling pgTAP suites: 95 assertions passed. Unrelated legacy SQL fixture failures remain documented in the implementation plan.
- Production dependency audit: 0 high/critical, 16 moderate; not a clean audit.
- Physical devices were unavailable. Device picker and authenticated full-flow smoke testing remain outstanding; prior iOS/web bundle exports passed.
- Production RPC presence and access boundaries verified: anonymous profile RPC returns 401, direct authenticated private-profile SELECT is denied, anonymous application RPC permission is denied. Public feed returns HTTP 200. Migrations are up to date.
- Safety worker version 11 is ACTIVE. Queue has no pending items; its one failed message predates this release (last updated September 8). No new paid classifier calls were made for verification.
- Local private dashboard rebuilt successfully and its existing local server returned HTTP 200.

## TestFlight

The user reported seeing only build 24: confirmed only 24 was connected to `Gling Internal`, while 25 had no group. User explicitly requested build 26 in TestFlight. Build 26 was connected to existing internal group `03fefab3-98b9-4f9c-a6a0-450fdd703efb`; the relationship was re-read and `internalBuildState=IN_BETA_TESTING` confirmed. No new testers, outside invitations, external beta review or App Review submission.

## Recovery

Keep build 25 as the previous client and do not submit build 26 for review automatically. If client problems occur, stop its distribution and retain build 25. For web regression, restore the pre-Chilling web source and redeploy through the existing Pages workflow. Preserve additive private tables, consent snapshots and safety monitoring: do not drop data or roll back migration history. Use a reviewed forward SQL correction for a server defect; the pre-deploy dump preserves original function definitions. No paid AI/email probes or synthetic production posts are used for release verification.
