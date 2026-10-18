# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Current private admin runtime — owner correction 2026-10-17

The canonical private administrator dashboard is `/Users/ash/Desktop/Git/Orca/workspace/mobile/gling-admin-current-20261017`. Keep creator, vendor, campaign and benefit management together with the approved admin LoginPanel and AdminMfaGate. Run `npm run admin` in that canonical checkout; the older `/Users/ash/Desktop/Git/unknown/mobile` command delegates there and its `.admin-dist` points there. Keep the same loopback port 54321 and Tailscale HTTPS origin. Never restore a feature-incomplete export or overwrite the approved admin login/MFA from a native-only or integration checkout. Preserve normal AAL2, Keychain connection, saved data and the separate native upload/review hold.

# Orca browser workspace

Keep Gling account, store, and test browser tabs in the existing `Git → gling` folder workspace. Do not create them under Rottery, TMS, or the separate `mobile` Git workspace. Verify the visible browser tab when the user asks to open a page; CLI tab selection alone may leave the terminal visible.

`orca tab create` resolves its default workspace from the CLI working directory. For Gling, invoke browser creation from `/Users/ash/Desktop/Git/unknown` and verify the resulting tab belongs to `folder:e88d505b-f6bb-47d6-ba41-904ef2a72a8b`. Run git/build commands in the isolated source checkout. If the workspace mapping changes, discover it again before opening a tab.

Show browser work in Orca. Close completed task tabs automatically after verifying the result; when pausing or finishing, leave only tabs needed to resolve outstanding blockers. Preserve unsaved work and tabs still in use by the user or another active task. Remove completed duplicate tabs, including misplaced Gling tabs in other workspaces.

# Non-negotiable safety operations

Follow `docs/decisions/0001-safety-monitoring-and-admin-access.md` for every moderation, messaging, privacy, admin, and AI-monitoring change. The owner has explicitly fixed this policy: automated server-side safety monitoring and authorized admin review cover all posts, comments, and conversations, not only reported content. Do not narrow that scope unless the owner explicitly supersedes the decision.

# Non-negotiable design research

For every branding, UI, UX, logo, icon, visual-system, or other design request, use the relevant connected design MCPs before proposing or implementing a direction. Treat BrandKit as the brand source of truth; research current best-practice references with Mobbin, Pinterest, and Kroma; use Penpot for design-file work when its plugin is connected; and use LogoLoom for SVG optimization and final brand exports. These tools do not need to run in a fixed order: run independent research and production work in parallel with agents when that is faster. Do not substitute memory-only design advice when these tools are available.

# Marketing operations

Before Gling marketing work, read `/Users/ash/.codex/memories/marketing-sales-playbook.md`, `.claude/product-marketing-context.md`, and `marketing/launch-kit.md` (회차 실행 지침). The shared 2026-09-11 SNS rule supersedes older direct-link/acquisition CTA instructions. Use `marketing/social-calendar.csv` as the existing queue and run `python3 marketing/check_calendar.py` after edits. Preserve content IDs and publication receipts; missing metrics are not zero. The full course analysis and adoption decisions live in `marketing/learning-2026-09-09-nick-saraev.md`. Skills and source examples do not authorize new paid services or messages outside the user's scope.
