# Private member name and date of birth

The owner requested names, dates of birth and ages in member administration. Existing code only exposes an editable social login name and hard-codes DOB/age to null. Complete the collection → private storage → audited admin display flow.

- New accounts may provide their name and birth date with a separate, explicit notice acceptance; existing members can add, correct or remove them in Settings. Both fields are required when opting in; neither is required to continue using the app. Never backfill from owner conversation facts or unapproved social metadata.
- Store the current self-reported name and calendar birth date privately, linked to the account. Compute completed years on the UTC calendar date at read time. Do not store a stale age, assert verified identity, change trust levels, or expose these fields through public profiles/feed/AI requests.
- Reuse the existing admin directory, search, detail and access logs. Show input name separately from social login name, DOB, age, source and update time. Existing missing values remain missing.
- Validate full names (1–200 characters, no controls) and real dates within the last 120 years, rejecting future dates. Save/clear only for the signed-in account, guard account switches, and serialize with account deletion. Remove private data on consent withdrawal and account deletion.

Implementation: Supabase migration + pgTAP checks first; native/web form and admin fields against that contract; then build and inspect in Orca. Existing TypeScript, React Native, themed fields and SQL security-definer/RLS patterns apply. Example: `if (p_user_id is distinct from auth.uid()) then raise exception 'AUTH_CONTEXT_CHANGED'; end if;`.

Checks: `node --experimental-strip-types --test scripts/personal-info.test.mjs`, `supabase test db`, `npm run typecheck`, `npm run lint`, `npm test`, `GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir .admin-dist`. Verify non-admin denial, no public disclosure, date boundaries, account switch/deletion, optional atomic onboarding and audited admin reads. Public web export must pass `npm run check:public-web`.

Boundaries: no new dependencies, paid identity verification, provider scope changes, fabricated values, unsolicited messages or changes to other contributors' work. The owner's implementation request authorizes the additive private schema and UI; paid services still require owner approval. Real identity verification remains unintegrated and must be labeled accordingly.

## Kakao preference and verified constraint — 2026-09-12

The owner prefers importing Kakao name/birth date and correctly reminded us that D-U-N-S business registration is already complete. Live app 1558027 is a Biz app with the registered overseas business. Its `name`, `birthday` and `birthyear` rows each still show “권한 없음”; additional-feature review has no approval state and opening its request leads to business-information review. Do not repeat Biz-app conversion or imply it failed.

[Kakao's app setup documentation](https://developers.kakao.com/docs/ko/app-setting/app) distinguishes Biz-app registration from additional-feature review. [User information](https://developers.kakao.com/docs/ko/kakaologin/rest-api) requires birthday and birthyear to construct a full birth date; lunar/partial birthdays cannot be silently treated as solar dates. Never label ordinary Kakao profile data verified identity. After permissions are granted, implement server-validated Kakao account binding and source labels, retain direct input for unavailable information, and only then extend login scopes. Current manual fields are the working fallback; there is no inactive import button or speculative provider integration.
