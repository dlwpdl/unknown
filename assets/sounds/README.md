# Gling interaction sounds

Owner-selected on 2026-11-08 ("컨펌 답 (앱 효과음)") after listening to the board in
`unknown/output/reviews/app-sounds-2026-11-08/` (kit and `manifest.json` with each file's SHA-256 and loudness).
One file per `useInteractionFeedback().play(kind)`; the files are bundled exactly as made.

| Kind | File | Sound |
| --- | --- | --- |
| selection (taps) | `selection-B1.wav` | soft "tok" |
| reaction (like) | `reaction-B1.wav` | water-drop "pop" |
| message | `message-B2.wav` | two marimba notes |
| warning | `warning-B1.wav` | marimba "hm-hm" |
| success | `success-B2.wav` | kalimba "ting" |
| meetupRequested | `meetupRequested-B1.wav` | marimba knock |
| meetup (host approved) | `meetup-B1.wav` | kalimba "ding-dong" |
| postUploaded | `postUploaded-B1.wav` | bubble + bell |
| meetupCreated | `meetupCreated-B1.wav` | rising marimba |
| postPublished (first post) | `postPublished-B2.wav` | xylophone fanfare; also used for the membership, first-meetup and invite celebrations |
| verification2 / verification3 | `verification2-B2.wav` / `verification3-B2.wav` | rising kalimba / bigger kalimba with bells |

All files are 44.1 kHz, mono, signed 16-bit PCM WAV, synthesized for Gling with no rights restrictions
(Epidemic Sound previews were only listened to as a reference, not mixed in).
They are 4–13 dB louder than the previous set, so `interaction-feedback.tsx` lowers each with `player.volume`
instead of editing the files. Sounds respect the silent switch (Android: silent/vibrate) and mix with other apps' audio.
