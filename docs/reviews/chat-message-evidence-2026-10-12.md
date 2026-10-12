# Retained chat evidence

The original worker concatenated every earlier message body and sent only its first 12,000 UTF-16 characters. A late dangerous version could therefore remain in storage without reaching the classifier. The existing queue now keeps private progress: each claim reviews one entire retained body or one bounded current-context segment. History progress survives new edits. Context is filtered again before every delayed segment. The queue remains pending until all versions and segments finish, preserves the highest detected risk across successes, failures and later edits, and raises high-risk alerts immediately. Successful progress resets the failure counter; a five-minute abandoned lease can resume in the same scheduled worker. A stale claim cannot advance or fail a newer claim.

The existing provider, model, privacy setting, schedule and per-run claim limit remain in use. Oversized input is rejected before a provider request instead of silently losing its tail. The production v18 trust-review routes and consent-aware conversation context remain available.

Deleted image paths stay in private history. The retained-image Storage policy requires the existing live AAL2 admin boundary and records the message and sender through `log_admin_access`. A participant cannot use another sender's deleted attachment; AAL1 and expired admin sessions are denied. The existing admin investigation RPCs, direct history restrictions and append-only review records are preserved.

Validation: the actual worker/analyze code passed two offline VM regressions with zero network calls. Transactional SQL checks passed 24 evidence cases, 26 chat controls and 99 admin conversation cases. A fresh migration rehearsal rolled back successfully. The full Node suite passed 770 cases with one existing skip; TypeScript and lint passed. Approved bubble UI files remain byte-identical.

Production application and PR merge are held for the requested independent re-review. No production messages, accounts, new paid calls, native tags, builds or store submissions were used. Storage signing's upstream path was inspected: `signObjectUrl` uses `findObject`, whose normal database query commits its transaction; the rollback permission probe is used by other operations. No real deleted user photo was signed or downloaded.

Sources: [Storage object signing](https://github.com/supabase/storage/blob/master/src/storage/object.ts) · [Storage database transactions](https://github.com/supabase/storage/blob/master/src/storage/database/pg.ts)
