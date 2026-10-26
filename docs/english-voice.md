# Gling English UI voice (draft v1, 2026-10-25)

Audience: Korean-Canadian/US 20s–30s plus their English-speaking friends, in Vancouver, Toronto, Calgary, etc. The English must read like it was written by a native product writer at a consumer social app (Instagram, Airbnb, Meetup, Discord, Hinge, Nextdoor). It is NOT a translation of the Korean. Rewrite for meaning and situation, never word-for-word.

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

## Observed reference copy (Mobbin, iOS, viewed 2026-10-25)
Translation controls
- Binance feed: small grey link "See translation" under foreign post; after translating, "See original". https://mobbin.com/screens/9db12099-bcf1-4e58-bc3f-0888cce29bf7
- Kitchen Stories comments: "Show original language: German" and a quiet "translated" tag under a translated comment. https://mobbin.com/screens/3136923d-5ea2-4b15-bb65-4120b925451e
- Bluesky post menu: "Translate". Mammoth: "Translate Post". https://mobbin.com/screens/bcb91ab9-760d-450b-92c5-82da81f20851
Meetups / RSVP (Meetup app)
- Status chips "Going", "Waitlisted"; buttons "Attend", "Join Waitlist", "Add to calendar", "Forward to a friend"; toast "You're not going anymore"; "0 spots left"; "You and 1 guest"; sheet "Update attendance" / "Are you bringing any guests" / "Continue". https://mobbin.com/screens/80bdded1-2649-4675-a195-136cde0f2f8e , https://mobbin.com/screens/274a0456-fa8b-4a40-96ea-0244553d82ef , https://mobbin.com/screens/5999c70c-4a03-4145-b344-aeb0d24e45ba
Empty states
- Airbnb: "You don't have any messages" / "When you receive a new message, it will appear here." https://mobbin.com/screens/71724d46-9317-4b99-bb23-6083d3b101bb
- Linktree: "Your inbox is empty" / "Conversations you have with other Linkers will show up here." https://mobbin.com/screens/ed3d6e75-822d-4c6c-af20-1d6a6a917c78
- Expedia: "No messages yet" / "Send and receive messages from hotels and properties here." https://mobbin.com/screens/1213e1f7-536f-4115-9284-b6781a49ea98
Limits and errors
- Rivian: "You've reached the key limit" / "This vehicle can only have 4 phone keys. To set up this phone as a key, the vehicle owner will need to remove one first." https://mobbin.com/screens/4dede705-8ea4-48f4-9ed5-f853edc9cf6b
- Starling: "Sorry, you can't create any more Connected Spaces." / "You already have 1, which is the limit." https://mobbin.com/screens/ad20f182-7e58-4e96-8375-bbd8f12265f1
- Fuse: "You have 5 free transactions remaining" / "Get Fuse Plus to unlock more." / "Got it". https://mobbin.com/screens/3a516a4b-f477-4eba-ae3a-7f18b2cdcf4c
- KOHO: "Something went wrong…" / "We couldn't complete the action you were attempting. Check your network connection, or try again in a few minutes." https://mobbin.com/screens/10183a4b-cc7d-4e0e-8663-2e52137f0c06
Takeaways: headline = what happened in "You…" form ("You've reached…", "You don't have…"); body = the one fact + the next step ("…will need to remove one first"); acknowledgement buttons "Got it"/"OK"; status words are single adjectives/participles ("Going", "Waitlisted", "Ended"); empty-state body says where things "will show up here".
