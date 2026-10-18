# Business and personal direct messages

Owner request: switching to a business must send and receive DMs as that business;
switching to a personal profile must use personal DMs. Hiring inquiries must reach
the business, without revealing its linked personal account.

## Behavior

- A selected conversation profile is shown in the inbox and composer. A business
  connection is rechecked before switching. Personal mode is the default after
  sign-out or account change. This is a client preference, never authorization.
- Personal, business-to-person, and business-to-business conversations have
  distinct immutable endpoints. Changing the active profile never relabels an
  existing room or silently sends under a different profile.
- A business post/profile inquiry resolves the business ID, including hiring
  posts. It never resolves the private linked owner as the public recipient.
- Current verified owners and connected operators can respond for their business.
  This includes admins with a real owner/operator connection; administrative
  access to a business alone never makes it a selectable conversation profile.
  Revoking access immediately prevents further reads and sends. Existing private
  personal history remains personal; no historical message migration/relabeling.
- Public business messages, inbox previews, replies, participant data, storage
  paths, notifications and reports expose business identity only. Actual human
  actors remain private for existing safety analysis and audited AAL2 admin review.
- Text, images/albums, location, replies, edits/deletion, read positions, reactions,
  blocking, reporting and conversation ending retain their existing protections.
  New business APIs fail closed if not installed. No fallback to personal sending.
- The existing free/unlimited direct-message policy and anti-spam limits remain.

## Boundaries

Use existing Supabase, messages/safety pipeline, React Native controls, image
storage and connection permissions. No dependency, service, synthetic auth user,
MFA bypass, paid call, real customer test DM, automatic external message, App Store
submission, public web release, or minimum-supported-version change.

Root owns client/chat integration and consequential design decisions. Existing
backend owner is reused only after its prior read-only review finishes. Map and
daily catalog owners retain their files and the sole native controller retains
Simulator/build/install ownership. Live SQL requires the existing DB writer window
and a reviewed exact migration/rollback packet; this is internal coordination,
not a new user permission gate.

## Verification

Write failing behavior/security tests first. Check profile separation, stale
responses after switching, no sender fallback, revoked roles, personal-room
compatibility, business media/notification redaction, concurrent room creation,
report/block/read/reply boundaries and ordinary raw-table denial. Run relevant
Node tests, local pgTAP rollback probes, typecheck and lint, then the full suite.
Render changed controls at 320/390px and inspect actual pixels; use the existing
native owner for the final bounded Simulator update if the full client is ready.
Never use a customer message as a test fixture.

Commands: `npm test`, `npm run typecheck`, `npm run lint`; backend tests use the
existing `scripts/check-business-identity.py` and Postgres rollback-check pattern.

## Design references actually inspected

- [Instagram inbox](https://mobbin.com/screens/fafb59d5-9aa6-4c27-8ead-ddd7098eb85b):
  active account name and chevron above the list; keep identity above list filters.
- [Quo inbox](https://mobbin.com/screens/13068f2b-386b-4078-a8f9-627a8624893c):
  avatar/name at top and clear separation of scope and conversation content.
- Apple Design: predictable identity, instant control feedback, 44px targets,
  reduced motion and existing Gling theme tokens. BrandKit Gling overview read;
  its historical paper taste primer does not replace the owner's current native
  night-theme source tokens. Kroma lookup failed (missing API key); Pinterest
  search returned unrelated results, which are not adopted as visual evidence.
