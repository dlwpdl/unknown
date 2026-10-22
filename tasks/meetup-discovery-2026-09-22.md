# Meetup membership audit and discovery fixes — 2026-09-22

Owner asked to check the paid-membership meetup features and improve the meetups menu for growth. Audit found the server limits (0076: free 2 / plus 4 / premium 7) were correct but three places were stale or missing.

Fixed:

- `src/components/relationship-slot-card.tsx` still allowlisted the retired 3/5/10 limits, so every real tier (2/4/7) returned `null`. The 모임 자리 card, the chat tab counters, and the 내 모임 header had been falling back to "자리 정보를 다시 확인해 주세요" since the 2026-09-21 limit change. Allowed limits now derive from `MEMBERSHIP_LIMITS` so app and SQL cannot drift apart again.
- `scripts/relationship-slot-card.test.mjs` expected 3/5/10 as well, which is why CI stayed green. It now reads the real tier table and fails if the card stops matching it.
- Meetups tab: search (reuses the existing `p_query` argument), 일정 전체/오늘/7일 이내 filter, 자리 남음 toggle, run of the list sorted by event start time instead of `sort_at`, live 모임 자리 line with the membership route, and a 참여 신청 N건 banner that opens the chat request queue.
- Cards now show 남은 자리, 오늘/내일/D-n, and the host trust badge.
- `meetup-create.tsx` checks the slot count before the form is filled in and routes slot-limit errors to the membership screen; `meetup-join.tsx` adds the same membership route when a limit blocks a join.
- `my-meetups.tsx` no longer prints a slot-lock count: group exits stopped locking slots in 0065, so the number was always zero.

New controls need server allowlist rows or the whole behavior batch is rejected, so they are registered in `supabase/migrations/0082_meetup_discovery_analytics.sql` and `scripts/analytics-controls.json`. `scripts/behavior-analytics.test.mjs` now scans every migration instead of only 0073.

`scripts/feed-cards.test.mjs` also failed before this change because it still expected the pre-Montreal city split (3 open / 8 soon). It now derives the section counts from CITIES.

Checks: `npm test` 213/213, `npm run typecheck`, eslint on changed files, local pgTAP `behavior_analytics.test.sql` 21/21 and `relationship_slots.test.sql` 68/68. Layout of the new search row and filter chips is not verified on a device yet.

Deferred: no notification fires when a meetup opens in the user's city. City-wide fanout needs a delivery cap and a preference decision first; propose as a separate step instead of a silent push.

Production: migration 0082 is applied to the live project (via `supabase db push --linked --include-all`, together with 0083/0087/0088). `private.behavior_targets` now holds the nine new ids, so the new search and filter controls are recorded.

## Slot and cooldown verification (same day)

Owner asked whether each tier really gets its own slot headroom and whether the cooldown rules apply. Verified on the local DB through the real RPCs and triggers with `python3 scripts/check-membership-slots.py` (one transaction, rolls back, leaves no rows). 15 checks pass:

- free 2 / plus 4 / premium 7 for both meetups and 1:1 conversations; the cap rejects the next meetup at each tier.
- Slots return the moment a meetup is closed by the host, left by an approved member, or simply ends. Natural expiry records no early-close penalty, and the cron closure is not charged to the host.
- Leaving never locks a meetup slot (the design set in 0065). Instead, three leaves in 24 hours block new joins for 12 hours while slot capacity stays intact.
- Two early closures with approved members block new hosting for 24 hours; one-off hosting is capped at 3 per 24 hours for every tier including premium.
- 1:1 conversations lock only the requester's slot for 24 hours, report the release time, and leave the other side's slots untouched.

Separate rule worth remembering: `private.enforce_rate_limit` also paces meetup requests to one per 60 seconds per user, which is unrelated to the 12-hour participation block.

Caution: `supabase/tests/membership_limits.test.sql` still asserts the retired behaviour "leaving a full pool locks the slot" (three checks). Those are part of the seven pre-existing failures noted on 2026-09-21 and must not be "fixed" by restoring group slot locks.
