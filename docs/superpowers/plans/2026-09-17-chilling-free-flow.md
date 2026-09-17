# Approved native free flow

User approved prototype and implementation; bottom tab stays 모임, inner 칠링/모임. Reuse existing posting, membership limits, notifications, report/block, and approved group chat. No new dependency, service, price, or production deployment.

1. Add atomic creation + private profile/application RPCs with local pgTAP authorization tests. Host sees canonical consented snapshot only while pending/approved; blocked/withdrawn/rejected access ends. Existing legacy members keep access. Connect new text to asynchronous safety and audited admin reads per ADR0001. Never test paid model calls.
2. Native discovery and create screens matching approved HTML, real feed only, loading/error/empty states. Explicit zoned dates, text labels distinguishing kinds, free creation and one question. New profile and application routes with a preview and unchecked sharing consent; existing detail and host inbox link into them.
3. Node tests, TypeScript, lint, local SQL regression, web/native export and visual check. Commit verified increment. Do not claim paid hosting tools or App Store release completed.

Boundaries: public room_preview contains only schedule/type/capacity/question. Detailed meeting location stays in the existing approved group chat, not new public form fields. Profiles contain only intro, interests, two prompts; no sensitive demographic filters. Threats tested: forged owner, cross-applicant reads, stale sharing after block/rejection, legacy RPC consent bypass, failed creation leaving a partial post.

RPC contract: save_chilling_profile(p_profile jsonb); get_my_chilling_profile(); get_chilling_host_profile(p_post_id uuid); request_chilling_join(p_post_id uuid,p_answer text,p_consent_version text='chilling-v1' supplied explicitly); get_chilling_application(p_request_id uuid); create_chilling_event(p_city_id text,p_title text,p_body text,p_event jsonb,p_question text). Profile: intro, interests:string[], promptOne, promptTwo. Application: profile, answer, consentVersion, consentedAt. The server captures the profile; client never supplies identity or a forged snapshot.

## Verification — 2026-09-17

- `npm run typecheck`, `npm run lint`, `npm test`: passed; 165 Node assertions/tests.
- Six related local pgTAP suites: 211 assertions passed. Full legacy SQL suite is not green: unrelated seed collisions, count assumptions and outdated function/preference expectations remain.
- `npx expo export --platform ios --platform web --output-dir /tmp/gling-chilling-export-20260917`: passed. Public export privacy check passed; no admin dashboard code shipped in public web output.
- Independent review fixes verified: stale profile-save completion cannot navigate after unmount; maximum-length Unicode post still sends the application question and cadence to safety classification. Classifier test uses fake fetch, not a paid call.
- Browser discovery screen visually inspected: footer 모임 and internal 칠링 (일회성)/모임 (정기모임) render correctly. Authenticated browser end-to-end and physical-device picker testing are not complete. Expo development environment still resolved `.env.local` values despite local process overrides; stopped authenticated QA rather than write test content to production.
- SQL changes were exercised only in local PostgreSQL. Production migration, safety-worker deployment, Chilling binary upload and physical-device review recording remain pending. Paid host tools remain candidates, not implemented features.
