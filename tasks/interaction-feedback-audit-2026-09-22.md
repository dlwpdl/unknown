# Interaction feedback audit — 2026-09-22

Owner reported that deleting a post felt like it had no interaction effect and asked for a sweep of missing feedback. Audit compared every action against the shared `useInteractionFeedback().play(kind)` calls.

## Behaviour kept

Only two feedback kinds carry a sound today: `reaction` (reaction-pop), `message` (message-paper), `success` (post-stamp) and `meetup` (meetup-knock). `selection` and `warning` are haptics only (light tick and warning notification). Deleting a post or comment only played `selection`, so a destructive action was announced with the weakest cue and no sound.

## Fixed

Destructive completions now use the warning cue: post delete, comment delete, conversation end, block, cover photo removal, personal information removal, sign out, account deletion.

Added where feedback was missing entirely:

- Meetups tab: city picker, 칠링/모임 tabs, category chips, date chips, 자리 남음 toggle, search, clear, seat line, pending-approval banner, more button.
- Meetup cards and host profile: card open, host profile, report sheet, profile disclosure.
- Meeting flow: opening a meetup and requesting to join (`meetup`), saving the meetup profile (`success`).
- Chat: approving a join request (`meetup`), rejecting it (`warning`), accepting/rejecting a 1:1 request, ending a conversation, blocking, member list open/close, filter tabs.
- Notifications tab: row tap and settings.
- Profile: photo change (`success`), photo removal, sign out, account deletion, personal information save/remove, notification settings save, membership purchase/restore/manage, external links.
- Signup: login buttons (Apple/Kakao/Google/admin) and onboarding completion.
- Post card: share completion.
- Meetup cover picker: photo prepared (`success`), removal, failure.

Four test harnesses needed the interaction-feedback stub (`login-panel`, `signup-consent`, `login-terms`, `meetup-cover-ui`).

## Out of scope

`src/app/profile/promotions.tsx` sits behind `PROMOTIONS_PREVIEW_ENABLED` and the local admin console (`src/components/admin`) has its own screens; neither carries app feedback today and both were left untouched.

Checks: `npm test` 220/220, `npm run typecheck`, eslint on the 22 app files and 4 test files. Feedback calls now cover 31 files (was 15).
