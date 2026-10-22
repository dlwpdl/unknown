# Notification extensions implementation plan

Spec: `docs/specs/notification-extensions-2026-10-09.md`.

## Self-review rulings and ownership

| Concern | Ruling |
| --- | --- |
| Dirty shared mobile checkout | Keep the authorized checkout; use exclusive file ownership. No reset, broad staging, branch switch or unrelated deployment. |
| Shared queue/settings mutations | Root owns migration 0150 and account security 0153; producers consume the shared contracts. SQL checks run serially on the shared local database. |
| Private notification targets | Each producer migration adds its own constraints/visibility gate, preserving all earlier branches. Root integrates the app/worker route allowlists. |
| Existing opt-outs | Preserve them; three new global flags default on, individual saved-business alerts default off. |
| Other scheduled products/GUI | Server preparation can overlap; screen work uses the existing bounded process-owned GUI queue. |
| Authentication device randomness | Generate UUID on the trusted database, persist with installed AsyncStorage/localStorage; never use Math.random or a new dependency. |

## Tasks

1. Root: reserve 0150–0153, capture live functions/constraints/jobs/ACLs, write shared preference/budget tests first, implement 0150.
2. Meetup implementer: own `0151_meetup_notification_delivery.sql`, meetup extension SQL checks and required existing reminder fixture updates. Implement reminders and participant changes/cancellation.
3. Business implementer: own `0152_business_notification_delivery.sql`, business extension SQL checks; saved-post/review/operation producers and private target gates. If the existing Naver trusted failure path needs an Edge state update, coordinate ownership before changing that file.
4. Native implementer: own notification-preferences client/settings, merchant DTO/API/company opt-in UI, relevant Node tests and the existing HTML prototype. Root owns `auth.tsx`, new security-device module, app notification routing and push worker routes.
5. Root: account security tests first, implement 0153 and client registration; serial rollback SQL integration, relevant Node tests, typecheck/lint/export, focused spec and security review.
6. Root: selective guarded production deployment and readback; refresh existing simulator/prototype under shared GUI ownership, save verification and final status.

## Acceptance

All six approved paths implemented and server-registered, settings functional, saved business opt-in explicit, no unauthorized disclosure/send, existing schedules preserved, verification saved, current simulator refreshed. Physical-device push and store/hosting release remain separate evidence.

Completed: tasks 1–6. Production source and worker downloads match verified files; all 14 existing jobs and old preference choices remain. Rollback SQL 520 pass, Node 607 pass / 1 existing skip; typecheck, lint and export pass. Native settings inspected after cold launch and normal button navigation; all three new controls visible, previous message preview off preserved. Existing clickable prototype passes at four widths. Final record: `output/qa/notification-extensions-2026-10-09/verification.json`. No customer test notification or store/hosting release performed.
