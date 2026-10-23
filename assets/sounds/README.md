# Gling interaction sounds

Owner-selected on 2026-10-23 after listening to the previews.

| App action | Bundled file | Selected preview | Duration |
| --- | --- | --- | --- |
| Reaction / like | `reaction-pop.wav` | Message A, soft swoosh (`message-air`) | 220 ms |
| Message sent | `message-paper.wav` | Message C, two soft notes (`message-tone`) | 230 ms |
| Success / post published / verification | `post-stamp.wav` | First preview completion chime (`success-soft`) | 539 ms |
| Meetup joined / created | `meetup-knock.wav` | First preview meetup confirmation (`meetup-soft`) | 322 ms |

All files are 44.1 kHz, mono, signed 16-bit PCM WAV. The existing shared
feedback player and sound/haptics preferences consume these paths.

The reaction and message sounds are original local synthesis. The completion
and meetup sounds are edited from `confirmation_002.ogg` and
`confirmation_003.ogg` in [Kenney Interface Sounds 1.0](https://kenney.nl/assets/interface-sounds),
created/distributed by Kenney and released under CC0. Their gain and fades match
the owner-liked preview bytes. See [the original license](LICENSE-Kenney.txt).
