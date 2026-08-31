# ADR-0001: Safety monitoring and admin access cover all content

## Status

Accepted — non-negotiable owner decision. Change only through an explicit owner decision that supersedes this ADR.

## Date

2026-08-25

## Context

Gling is a North American Korean community app. The owner prioritizes early detection of credible risks such as self-harm, violent threats, stalking, sexual exploitation, weapons, and doxxing. Waiting for a user report is not sufficient for this safety objective.

## Decision

- Server-side safety monitoring covers every new post, comment, and private or group conversation message. It is not limited to reported content.
- Authorized admins may review all posts, comments, user history, conversations, and messages whether or not a report exists.
- Every admin read and moderation action must be attributable and written to an audit log.
- High-risk signals create a safety alert and notify admins through configured push, email, or SMS channels.
- Repeated commercial promotion, near-duplicate cross-posting, deceptive offers, and attempts to evade posting limits create lower-priority integrity alerts. A business identity alone is not a violation; behavior and frequency are the signals.
- AI is a detection and prioritization aid. AI alone must not permanently ban a user or contact law enforcement.
- High-risk public content may be hidden temporarily while a human reviews it.
- Conversation evidence is preserved according to the retention policy; a human makes the final moderation decision.
- Admin authorization is enforced by Supabase JWT `app_metadata.role`, RLS, and server-side functions. Client-side route guards are not a security boundary, and service-role credentials must never be shipped to a client.
- Private conversations are not represented as end-to-end encrypted. Terms and privacy notices must disclose automated safety analysis and possible human review of flagged content.
- External AI providers must be configured contractually and technically not to train on Gling data and to minimize retention. Initial operation uses inference, not custom-model training.
- Any later custom training requires de-identified, purpose-limited data plus a documented privacy and legal review.

## Operational boundary

Full authorized visibility does not mean casual access. The admin dashboard must require an admin session, record reads, protect secrets server-side, and expose irreversible actions through audited server functions. Model output is untrusted input and cannot directly execute database or external actions.

Public community rules explain what behavior is limited and how a user can appeal. Detection thresholds may remain private when disclosure would make evasion materially easier.

## Consequences

- Database policies must retain an explicit admin path for all covered content.
- The monitoring pipeline must run asynchronously after content insertion so content creation is not blocked by model latency.
- The admin dashboard needs a global safety view in addition to report queues.
- Privacy notices, retention rules, incident response procedures, and administrator access logging are launch requirements.
