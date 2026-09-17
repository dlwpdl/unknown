# Chilling deployment — iOS 1.0.1 (26)

User authorized production deployment and a new iOS build on 2026-09-17. Keep the existing 1.0.1 review version; increment the build only. Upload is not App Review resubmission or public release.

## Scope

- Footer remains 모임; discovery segments are 칠링 (one-off) and 모임 (recurring).
- Free profile, hosting, question, consented application, existing approval flow and audited admin review.
- No paid host-tool release, pricing changes or new service subscriptions.

## Deployment

- Pre-deploy schema, application data and auth dumps saved outside Git under `~/Library/Application Support/gling/backups/pre-chilling-26/` (971,628 bytes total). Data dump warned about the existing circular comments foreign key; restore must account for constraints.
- Safety worker deployed first, compatible with existing targets; migrations 0063 and 0064 then applied successfully to project `wjvahbdwmctzpkndqaxa`.
- Native archive/export/upload and public Pages deployment: pending verification below.
- Private dashboard is a local-only `.admin-dist` export, not part of the public site.

## Checks

- Fresh typecheck, lint and 165 Node tests passed.
- Fresh Chilling pgTAP suites: 95 assertions passed. Unrelated legacy SQL fixture failures remain documented in the implementation plan.
- Production dependency audit: 0 high/critical, 16 moderate; not a clean audit.
- Physical devices were unavailable. Device picker and authenticated full-flow smoke testing remain outstanding; prior iOS/web bundle exports passed.

## Recovery

Keep build 25 as the previous client and do not submit build 26 for review automatically. If client problems occur, stop its distribution and retain build 25. For web regression, restore the pre-Chilling web source and redeploy through the existing Pages workflow. Preserve additive private tables, consent snapshots and safety monitoring: do not drop data or roll back migration history. Use a reviewed forward SQL correction for a server defect; the pre-deploy dump preserves original function definitions. No paid AI/email probes or synthetic production posts are used for release verification.
