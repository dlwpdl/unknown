# Gling relationship UI QA — 2026-09-10

Release web export, Orca Git → gling folder, local Supabase disposable fixtures. No production code changed during QA. Browser viewport 375 × 812; screenshots visually inspected.

## Passed

- Chat initially shows active 1 / locked 1 / available 1 of 3, nearest unlock time, and two separately labeled incoming/outgoing requests.
- Pending request has no message input. Acceptance requires a second explicit confirmation explaining both participants use one slot and only the requester carries the 24-hour exit risk.
- Accepting incoming request changes counts to active 2 / locked 1 / available 0. Active composer appears.
- Recipient ending that conversation shows recipient-specific notice, removes composer, and returns counts to 1 / 1 / 1 immediately.
- Original requester ending the other direct conversation shows requester-specific notice and changes counts to 0 / 2 / 1. Existing messages remain readable.
- My meetups distinguishes host, approved participant and pending request. Only host/approved rows have a group-chat entry.
- Approved group entry routes to its specific conversation. Actual message sender nickname (슬롯확인4) appears with per-message report/block actions.
- Closing a group opened through conversationId clears the URL parameter and stays closed.
- Leaving an approved group through chat shows a 24-hour group-slot notice, removes the conversation and updates membership to group 1 / 1 / 1. Direct slots remain 0 / 2 / 1.
- Membership displays the two independent pools, next unlock times, and 3/5/10 tiers. Unknown or unavailable store products are not presented as purchasable on web.
- Direct navigation to /profile/promotions redirects to /profile. Profile has no promotion/credit menu. No promotion API calls observed.
- 375px chat and membership document/body widths are exactly 375px: no horizontal overflow. All exposed chat buttons/tabs were at least 44px high.
- Browser console contained zero messages at completion. The only observed failing request was the earlier invalid login caused by the first QA export retaining the production API host; corrected export used only local Supabase and local login succeeded. No production session was obtained.
- Created QA tab closed. Existing Gling Instagram edit and local admin tabs preserved.

## Small issue, left unchanged during native build

An ended direct conversation with zero messages displays the same read-only notice in both the empty state and footer. Functionality is correct; a later one-line copy/render cleanup can remove the duplicate. No blocking functional issue found in tested flows.

## Scope limits

Web QA cannot establish native animation/keyboard behavior. Host closing a group, legacy direct-room exit, rejected/cancelled request cooldown and cross-account passive realtime behavior were not exercised visually in this pass; backend/UI automated checks cover their contracts separately.

## Screenshots

1. [Chat requests and initial capacity](01-chat-initial.png)
2. [Explicit request consent](02-request-consent.png)
3. [Membership after direct/group exits](03-membership-after-leaving.png)
