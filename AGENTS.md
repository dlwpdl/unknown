# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Current private admin runtime — owner correction 2026-10-17

The only current private dashboard source is `/Users/ash/Desktop/Git/Orca/workspace/mobile/gling-admin-current-20261017`, based on b79d0ee6 with creator/vendor/campaign management and the approved admin login/MFA screens. This older checkout's `npm run admin` delegates there. Do not export or serve this checkout's old admin source directly. Keep the existing loopback port 54321 and Tailscale HTTPS origin, AAL2, Keychain connection and saved data. Do not replace the current dashboard with a feature-incomplete export or revive old browser tabs. Native app upload/review remains on the owner's separate hold.

# Orca browser workspace

Keep Gling account, store, and test browser tabs in the existing `Git → gling` folder workspace. Do not create them under Rottery, TMS, or the separate `mobile` Git workspace. Verify the visible browser tab when the user asks to open a page; CLI tab selection alone may leave the terminal visible.

Show browser work in Orca. Close completed task tabs automatically after verifying the result; when pausing or finishing, leave only tabs needed to resolve outstanding blockers. Preserve unsaved work and tabs still in use by the user or another active task. Remove completed duplicate tabs, including misplaced Gling tabs in other workspaces.

# Non-negotiable safety operations

Follow `docs/decisions/0001-safety-monitoring-and-admin-access.md` for every moderation, messaging, privacy, admin, and AI-monitoring change. The owner has explicitly fixed this policy: automated server-side safety monitoring and authorized admin review cover all posts, comments, and conversations, not only reported content. Do not narrow that scope unless the owner explicitly supersedes the decision.

# Non-negotiable design research

For every branding, UI, UX, logo, icon, visual-system, or other design request, use the relevant connected design MCPs before proposing or implementing a direction. Treat BrandKit as the brand source of truth; research current best-practice references with Mobbin, Pinterest, and Kroma; use Penpot for design-file work when its plugin is connected; and use LogoLoom for SVG optimization and final brand exports. These tools do not need to run in a fixed order: run independent research and production work in parallel with agents when that is faster. Do not substitute memory-only design advice when these tools are available.

2026-09-29 owner correction: Gling's current public/product identity is the night palette (`#0B0B12` background, `#CBB9FF` iris accent) and `assets/brand/gling-night-*` logos. Cross-check connected BrandKit responses against `src/constants/theme.ts` and the current assets: its running MCP index may still return superseded visual values until it refreshes. Never use the older identity for new Gling designs. The admin-only light theme is separate.

# Marketing operations

Before Gling marketing work, read `/Users/ash/.codex/memories/marketing-sales-playbook.md`, `.claude/product-marketing-context.md`, and `marketing/launch-kit.md` (회차 실행 지침). The shared 2026-09-11 SNS rule supersedes older direct-link/acquisition CTA instructions. Use `marketing/social-calendar.csv` as the existing queue and run `python3 marketing/check_calendar.py` after edits. Preserve content IDs and publication receipts; missing metrics are not zero. The full course analysis and adoption decisions live in `marketing/learning-2026-09-09-nick-saraev.md`. Skills and source examples do not authorize new paid services or messages outside the user's scope.

Before every personal Threads @chalkakandupload draft or revision, read the 2026-10-05 first section of `marketing/voice.md` and its actual profile samples. Preserve the user's casual Korean voice and varied sentence rhythm; compare the draft with at least two source posts and record the check. Do not substitute brand Instagram copy rules, enforce one recurring opener, or rewrite already-approved copies. If using saved samples because live access is unavailable, say so; do not claim fresh profile or Insights verification.

# Shared Gling Reels process — Codex and Claude Code

## Latest owner caption rule — 2026-10-17

For current requested revisions and future Reels, show Korean one line and English one line together: two lines total. Split at complete words and natural semantic phrases; never cut a word, proper name, price or connected predicate at a caption transition, and never wrap or hyphenate midword. Preserve the entire spoken Korean narration and the verified meaning in brief natural English. Measure actual font widths and reading time with `scripts/gling-caption-plan.py` → `plan_bilingual_captions`; inspect actual rendered captions and safe areas. If a pair is too long, revise/regroup it or allow more time without cutting, overlapping or slowing speech. Read `marketing/reels-editorial-modes.md` for the current full process. This changes new/current draft production; preserve existing approved/public masters and their exact hashes.

Before planning, producing, editing or reviewing Gling Reels, read `marketing/festival-template.json.current_production`, the first sections of `marketing/instagram-editorial-system.md` and `marketing/event-prepublication-check.md`, and `marketing/gling-reel-cover-standard-2026-10-09.md`. These are the same current source of truth for every agent; do not keep a separate Claude template or revive archived short production defaults.

Current owner-approved delivery supersedes the historical2026-10-11 fixed30s/natural1x instruction: retain the configured Younha/맘마미아 voice, complete raw1x take → one atempo1.2 transform → HyperFrames1x. Duration may extend to preserve every word and speech tail; never slow, pad silence, trim words or overlap narration to meet30seconds or caption limits. Handson's requested40–50seconds remains a target. Keep the approved cover's colored line beside its exact primary-category label. The current full standard is `marketing/reels-editorial-modes.md`.

Reuse existing discovery/reference evidence -> verified story -> directed scenes/required photographs/exact input roles and hashes -> existing Gling-owned approved direct-API provider/model/voice -> editable HyperFrames project and save/reopen/source manifest -> actual measured render with complete speech -> per-photo original/final-crop brightness/resolution/relevance/face consent/rights, pronunciation/listening, whole-word bilingual captions and existing audio-route review -> exact same-city Gling saved readback -> final acceptance and authorized once-only Meta API publication -> measured feedback. Existing approval/hold/attempted/public receipts are separate from configuration or render success.

Before any automation or GUI work, read `/Users/ash/Desktop/Git/automation-coordination.md`; reuse its existing55s GUI queue/publication priority and original sole writer/account/deadline/permission/unfinished-attempt rules. Preserve existing jobs and current runs; changing the agent does not grant a new job, paid call, login, upload, reservation, retry or publication authority. Claude Code imports this file through the existing `CLAUDE.md`.

## City editorial personas — owner approved 2026-10-12

All existing and future synthetic city profiles must carry the fixed v4 details in `marketing/profile-personas.md` and the same profile-bound server `gling_persona` metadata. Run the existing `scripts/profile-personas.py --apply` sync before normal G6 drafting and after creating a synthetic profile; confirm saved data before use. Preserve each existing identity and traits, use only the selected author’s detailed setting and actual recent posts, then verify voice/facts/continuity before the original distributed schedule. The existing publisher refuses a missing persona. Human, business, admin and tester profiles are excluded. The separate Lua fiction/story hold remains. No extra jobs/accounts/comments, expired reruns or schedule/budget/publication changes.


## Community story slots — owner reaffirmed2026-10-12

The existing G6 city writer targets five regular posts plus one overseas-life community story per city (30 across five cities). Use actually read original bodies from Blind, Casmo (`https://cafe.daum.net/skc67`) and other approved source research, not search snippets or copied prose/private identities. Read the selected fixed persona and recent posts, adapt the conflict with recorded fictional changes, apply Patina in the same writer and retain the disclosure `해외생활 사연을 참고해 재구성한 이야기예요.`. Save actual source/meaning/persona checks as directed in `docs/operations/daily-city-posts.md`. The specific held Lua prototype remains held. Reuse the existing random queue and publisher: new30-post version2; preserve existing25-post version1 and all attempts. If stories are not ready, stage only verified regular25 and report the unmet five-story target. No new job/account, expired rerun, immediate publication, fabricated engagement or authority expansion.

## Human writing — owner direction2026-10-12: Patina required

Whenever writing or revising prose that should sound human, apply the installed `patina:patina` skill (`/Users/ash/.agents/skills/patina/SKILL.md`) before delivery/publication. This covers community posts, profile introductions, SNS copy, video narration, replies and other human-facing prose across current and future products. Detect and fix repetitive structure, clipped rhythm, translationese, filler and stock endings; preserve each speaker’s persona/register and every verified fact, name, number and meaning. Perform the skill in the existing writing agent; it does not authorize a new worker, backend/model, paid call, schedule, account or publication. Keep source/correction/meaning checks outside the public body and retain existing approved artifacts/holds. Configuration/data literals and machine-readable identifiers are not rewritten as prose.
## 2026-10-15 owner correction — city posts must reflect distinct personas

For city editorial work, read the newest section of docs/operations/daily-city-posts.md before older generic voice instructions. Use the selected fixed persona and their actual recent posts; choose a real interest, opinion or question rather than repeating official facts followed by an invented plan. Apply Patina to each draft and review topic, opening, ending and rhythm across the batch. Preserve factual evidence, operated-profile disclosure, all existing frozen queues and publication permissions. No invented firsthand experiences or retroactive public rewrites follow from this style correction.

