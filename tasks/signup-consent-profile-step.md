# Signup consent in the profile step — 2026-09-19

User-approved flow: social authentication → nickname / optional name and birth date → compact consent group → complete signup.

- Removed the pre-login checkboxes and automatic `accept_login_terms` calls from every authentication path. Login still exposes terms/privacy links. Existing consented members do not repeat signup.
- Added initially unchecked required terms, privacy collection/use and external OpenAI safety processing rows. Select-all includes the optional name/birth-date row; every row can be toggled independently. Partial selection is announced as mixed.
- Terms/privacy open their full public URLs. AI and optional personal information expand in place. All-content safety analysis and authorized administrator access remain disclosed and unchanged (ADR-0001).
- The existing transactional profile RPC records required consent timestamps only after explicit checks and successful signup. Optional personal information still requires its separate consent; blank optional fields permit required-only signup. Existing migration/RPC compatibility for build 30 is preserved; no DB migration or production write was needed.
- Member features and automatic location requests wait for an active, consented profile. Signup keeps manual city selection; GPS selection remains available in the existing post-signup location/settings UI.

## Verification

- 181 automated tests passed; added signup UI behavior, failure and optional-information checks and updated all authentication-path regressions.
- TypeScript and Expo lint passed.
- Local Supabase + actual web export: before submit, 0 profiles and 0 automatic login receipts for the new test user. Required-only signup completed with all three required timestamps, consent version `2026-09-02`, and 0 optional personal-info rows.
- Orca in the existing Gling browser workspace: 390×844 and 320×740 views inspected; no horizontal overflow, all/individual selection and detail expansion checked. Space-key DOM event toggled the checkbox. Local user/session and preview server cleaned up; existing App Store Connect tab restored.
- Public export passed `scripts/check-public-web.mjs` (no admin dashboard code).

## Release status

Source change only. Build 30 remains the previously uploaded binary with the old pre-login consent UI. Its review was withdrawn at the user's request. This change has not been uploaded or submitted; native-device verification and an updated device recording are still outstanding before the next review submission.
