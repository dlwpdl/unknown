# Gling English UI voice (draft v1, 2026-10-25)

Audience: Korean-Canadian/US 20s–30s plus their English-speaking friends, in Vancouver, Toronto, Calgary, etc. The English must read like it was written by a native product writer at a consumer social app. It is NOT a translation of the Korean. Rewrite for meaning and situation, never word-for-word.

## Rules
1. Sentence case everywhere (buttons, titles, tabs). No Title Case Except Proper Nouns.
2. Contractions: "Couldn't", "You'll", "Can't", "It's". Never "Could not load…", "You cannot…".
3. Error pattern: say what happened in plain words + what to do. "Couldn't load chats. Pull down to try again." Drop "Please" in most cases; keep it only when asking the user for a favour. Don't repeat "Check your connection and try again" when a shorter "Try again." works.
4. Buttons are verbs, 1–3 words: "Join", "Send request", "Save", "Try again". Not "Proceed with joining".
5. Second person, active voice. "You've used all your meetup slots" not "Meetup slots are unavailable".
6. Short. English UI text should be no more than ~1.3x the Korean visual length for labels/buttons; split long policy text into a short headline + one-sentence body. Keep every fact and number (limits, hours, prices, tiers).
7. Canadian spelling (app locale en-CA): neighbourhood, favourite, colour, cancelled, centre. Dates/times via existing locale formatter, not hand-written.
8. Korean-isms to remove: "Me" tab → "Profile"; "Post city" → "City"; "Neighbourhood stories" OK; avoid "slot" overuse where "spot" is the natural word for people (meetup spots), keep "slot" only where it's a product quota term already defined in membership copy — be consistent within a file.
9. Don't translate proper nouns, brand names, place names, menu items, store names or user-entered content. Product terms: Gling (capital G in prose; keep existing lowercase `appName` value untouched), Chilling, Meetups, Today. Membership tiers: Basic, Plus, Pro, Premium.
10. Placeholders `{0}`, `${…}`, `\n`, emoji and punctuation tokens like `·` stay. You may reorder placeholders when English word order needs it. Keep pluralisation correct ("1 person", "2 people").
11. Friendly but not cute: no exclamation marks except greetings/celebrations ("Say hi!"), no "Oops".
12. Legal/safety/privacy wording: keep the exact obligation and scope; simplify the sentence, never the meaning.

## Examples
- "Could not load notifications." → "Couldn't load notifications."
- "Open up today\nin your neighbourhood." → "See what's happening\nin your neighbourhood."
- "Meetup slots depend on your membership" → "Your plan sets how many meetups you can host"
- "This person has not completed identity verification." → "This person hasn't verified their ID."
- "Please take a short break" / "This action was repeated too often." → "Slow down a little" / "You're doing that too often. Try again in a moment."

## Copy patterns
Headline = what happened in "You…" form ("You've reached…", "You don't have…"); body = the one fact + the next step ("…will need to remove one first"); acknowledgement buttons "Got it"/"OK"; status words are single adjectives/participles ("Going", "Waitlisted", "Ended"); empty-state body says where things "will show up here".
