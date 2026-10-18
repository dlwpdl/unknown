# Account identity work

- [x] Shared nickname save, stale-write/security checks, app settings and admin editor; run focused tests.
- [x] Admin member-to-business selection, reviewed connection reuse, named profile writer entry; verify owner/operator/revoked boundaries.
- [x] Official business authorship and bounded public hydration through all post readers; preserve actor and curated records.
- [x] Full tests/type/lint/exports/DB checks, actual UI review, scoped commits and final evidence; preserve release hold.

Evidence and release limitations: docs/specs/account-nickname-and-business-identity-2026-10-17.md. Current app/server/store holds remain; existing served admin and minimum versions preserved.

Follow-on owner correction: business logo/banner, business-authored-only profile, and public/personal-correlation privacy layer are pending a separate bounded implementation. This local checkpoint must not be deployed before that work.
