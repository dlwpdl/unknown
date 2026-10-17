# Creator collaboration costs

Owner request: show recent influencer collaboration costs directly in the directory, sort by those amounts, and retain the history as a reusable business asset.

The existing private admin remains the only surface. Place recent advertising fee, meal support limit and agreed content/date immediately after the creator name. Default to the newest agreement in CAD. Allow CAD/USD and fee/support ascending or descending sorting, with unknown amounts last. Sort the entire server result before pagination, never just the current fifty rows. Do not convert or compare currencies.

Store append-only agreement records with creator, optional existing merchant, agreement date, currency, nullable integer-cent advertising fee and meal support limit, content, source URL and conditions/evidence. Zero means explicitly no fee; null means unknown. The support limit is not an actual expense. Record changes/corrections as new history rather than overwriting old records. Preserve the existing profile notes and campaign lifecycle.

Reuse the current AAL2/live-session admin boundary, actor locking, URL validator, event log, form busy/readback flow, entity picker and interaction feedback. No client or service-role direct table access. Stable request IDs make an uncertain retry idempotent; a different payload with the same ID must fail. Exact saved-record readback must work even for a backdated record outside the newest history page.

Scope: additive private SQL migration and pgTAP checks; existing partnership API, directory/editor/styles and their tests. No dependencies, new service, scheduler, payment, outreach, publication, native release or campaign activation. Use the canonical checkout and existing server. Backfill only the already verified Vancity Bites agreement through the normal admin UI.

Implementation order: (1) agreement persistence, security and server-wide sorting with rollback SQL tests; (2) directory/form/history and API/UI tests; (3) apply this migration only, export the existing admin, save the known agreement and reopen it, then verify actual columns and both sort directions.

Commands: `python3 scripts/check-admin-partnerships.py`, `npm run typecheck`, `npm test`, `npm run lint`, `GLING_LOCAL_ADMIN=1 npx expo export --platform web --output-dir .admin-dist`.

Acceptance: Vancity Bites shows CAD 0 advertising fee, CAD 150 meal support limit and one Reel dated 2026-10-17; unknown creators show no invented zero. Earlier notes/DM evidence remain intact. Historical records and currencies round trip, unknowns sort last, pagination uses the same stable server order, AAL1/non-admin callers fail, identical request retries create one row/event, and both directory selection and saved-record readback still work.


Follow-up — vendor and collaboration day: reuse the existing merchant foreign key per agreement. Add a separate optional collaboration calendar date (planned dates allowed), and a revision timestamp. Display the canonical vendor and collaboration date beside the costs, keeping the agreement date distinct. Existing history gets a “벤더·협업일 연결/수정” editor; a narrow MFA RPC changes only these two bindings after revision checking, with before/after audit data. An identical retry is idempotent; stale different values fail. Keep the original agreement ID, costs, notes, creation metadata and history count. No campaign lifecycle, visitation, payment or publication state changes. Only existing business vendors can be selected. Acceptance includes no duplicate Vancity deal when linking Jimoco and the verified Oct 17 planned date, exact saved readback, concurrent stale correction rejection, and live-session checks after row-lock waits.

Rollback for the vendor/date follow-up: restore the prior private-admin export if the new controls fail; retain the additive columns and saved links. The old client ignores these additional fields. Revoke the narrow link RPC if a security fault is found. Do not drop history or restore old business data, and do not touch public/native release holds.
