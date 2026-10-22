# Gling social API migration — 2026-10-10

Owner: `term_e7df71ac-9f8e-4a01-a5a9-b0276e1c8bb2`. Authorization: “그거까지 검증해서 이제는 api로 자동화 다 전환해야지”. Existing coordinator notified; existing jobs and account ownership remain authoritative.

Use the existing G4/G5/G7/G8/G9/G10 jobs, credentials, content records and HyperFrames projects. Add one standard-library API command and its security/duplicate-submission checks. No service, dependency, worker, duplicate queue or public test post.

Acceptance:

- Fresh API identity must match the exact platform's `@gling.app` account before reading or writing; secrets and private conversations remain outside Git, with mode 0600.
- Retrieve actual own posts, per-post insights and comments/replies. Missing metrics remain unknown. Do not use official credentials for the personal Threads account.
- Validate an existing editable HyperFrames project/source manifest and rendered video; upload an unpublished Instagram container and create an unpublished Threads container. Probes cannot be published.
- Publishing and reply commands persist an exclusive attempt receipt before sending. Native reservations, holds, stale slots and uncertain submissions cannot be silently retried. Read back a returned public ID before claiming publication.
- Keep the existing six Threads publication times and four Instagram slots. Existing native reservations stay native; new accepted content uses the local records and API publication at its original due time.
- Refresh eligible long-lived tokens through the existing jobs; do not refresh tokens before their first 24 hours or call unverified refresh successful.
- Re-read saved native prompts/schedules/workspaces after migration; run the focused security checks and existing calendar/GUI coordination checks.
- Preserve existing Threads DM/native topic evidence and unconnected personal-account holds until supported contracts/credentials exist. Under the latest API-only correction these stages are blocked/null, with no new SNS GUI or browser fallback; they cannot be represented as API migration success.

Steps: failing checks → API command → live read/upload probes → existing job/runbook updates → saved native configuration verification → coordinator handoff with actual proof and remaining limits. No image/voice generation is needed; image-model preflight is not applicable.

## Implementation and verification outcome

Implementation and saved native API-only configuration are verified. Live own-account reads, three unpublished FINISHED container probes, editable HyperFrames source/reopen evidence, 52 focused checks, restrictive media role rollback SQL, and the 271-row calendar check passed. The actual 16:00 due precheck skipped safely; the 16:15 existing preparation run read API posts/insights and held replenishment because native future reservations cannot be verified through this API.

Public post/reply, first eligible token refresh and a newly accepted final HyperFrames production remain unobserved. No new SNS GUI fallback, public test send, old-slot replay, personal-account substitution, paid generation, worker or job. See [verification.md](verification.md) for evidence and operating limits.
