# Creator profile details

The private admin creator directory shows each creator's representative platform, observed audience label and observation date, content category, operating area and collaboration history. Detail and edit views retain every linked platform, contact person, contact text, content description, source evidence and next-proposal notes.

The directory follows the vendor page's compact 64px rows and checkbox selection. Whole-page selection, partial-selection indication, selected count and clear are available. Searching and changing pages clear selection. Selection alone performs no record mutation.

`profile_url` remains the representative link and canonical unique identity. `platforms` stores up to twenty linked accounts as `{platform, url, followers?, checked_on?}`. `followers` is the observed display string (for example `1.4만`), not an invented exact number or cross-platform total. Missing audience labels, dates and contact names remain unconfirmed. A legacy representative may be stored separately from the twenty linked accounts; editing must preserve all of them.

`contact_name`, `content_summary` and `activity_regions` extend the existing creator row. Existing `category`, `contact`, `metrics_note`, `notes`, participation history and campaign conditions keep their meanings. Recording a prospect does not create an application, contact, agreement or payment.

The migration `20261016043500_creator_profile_details.sql` follows `20261015190000_admin_partnerships.sql`. It extends the existing admin RPCs using exact function anchors and fails if those anchors have changed. Apply the schema before serving the updated editor: an old server rejects the new field whitelist. Old registration payloads and partial updates remain compatible after the migration and preserve new details. Admin MFA, actor checks, audit, row locking and exact `updated_at` conflict checks remain required.

Checks: `npm test`, `npx tsc --noEmit`, `npm run lint`, and `python3 scripts/check-admin-partnerships.py`. The database runner uses the existing local Supabase container, rolls its shared-database fixtures back, and deletes its separate concurrency database. No production fixtures or privileged bypass path are required.

The October 15 change is held for review. It does not apply a production migration, publish the admin bundle, update store builds, raise minimum versions, contact creators or enable an external data provider.
