# Place list and native score followup

The owner requests actual city Top50 place lists and photos through the existing API Anything workflow, plus a fix for clipped rating digits. The existing own-first Gling score, separate external fallback, approved purple icon and two themes remain.

- Native red: expanded external cards on F736/fd61 clip the top of 4.5 and 4.1. Counts are intact. The inline icon reuses a fixed 14-point masked-bar line height inside a 26/34-point numeric text line. Separate inline typography from bar-mask typography; preserve numeric size, bar fills and accessibility.
- Support at most 50 source-reviewed entries per city. Fetch own rating summaries in two existing 25-ID RPC batches with one account-scoped snapshot, retaining known data if either batch fails. No new RPC or per-card provider call.
- Root source coordinator owns catalog/photos, API/cache/seed/publisher and refresh-script changes. This checkout owns the UI, client list-capacity helper and focused tests only. Do not manufacture rankings, dates, photos, counts or ratings.
- Check native regression, 50-entry validation/order/pagination, batch/account isolation, dark/light 320/390px, TypeScript, changed-file lint and full tests. Then hand exact commits/hashes to the same source coordinator and sole installer6ac for a new F736 native receipt.

User explicitly released the old QA writer scratch. Preserve stored account/data/GPS, one Booted device, production privacy and Store/minimum-version holds. Current installed fd61 is a valid baseline, not evidence of the followup fix.

2026-10-19 source checks: 45 focused tests passed; full suite 1,484 passed, one existing skip, zero failures (1,485 total). TypeScript, changed-source ESLint and diff whitespace checks pass. Actual-source RN Web rendering passed 24 language/width/state combinations in isolated headless Chromium, with zero remote requests; both themes and the expanded 4.5/4.1 score cards were viewed. This rendering verifies layout only. The same-device iOS glyph check and actual Top50/photo data acceptance remain pending.
