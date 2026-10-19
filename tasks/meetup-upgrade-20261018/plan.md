# Implementation plan

The approved HTML is the reviewed product specification. Routine implementation decisions are recorded in `spec.md`; no additional product-approval round is required.

1. Freeze contracts and file boundaries against the latest integration. Profile security is the first risk: define separate media ownership, snapshot audiences and guarded identity reads before UI integration.
2. Implement the independent profile save/upload/read path and owner management UI, then join/host preview and meetup identity callers. Test cancellation, failure cleanup, legacy text and access revocation.
3. In parallel, expand the existing AI endpoint/parser and add explicit preview/application; integrate the control into `meetup-create` after contract verification.
4. In parallel, build existing-plan host templates, recurring session proposals, waitlist invitations, accepted co-host operations and aggregates using existing parent/session foundations. Integrate the form and host surface sequentially.
5. Review combined changes independently, run meaningful local SQL and client regressions, types/lint and actual-source visual checks. Prepare one exact manifest for the existing integration owner and sole native installer. Retain release hold.

No source changes are made in the shared integration checkout by this task. Remote deployment is distinct from local source completion and simulator acceptance.
