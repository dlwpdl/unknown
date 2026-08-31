# Spec: Gling Web Home

## Objective
Build a web home for Gling that reads like a real product website, not a scrollytelling landing experiment. It must explain what Gling is, where it is opening first, how the community flow works, how trust and policy are handled, and how to join the first cohort.

## Assumptions
- The web root stays inside the existing Expo web runtime.
- This first rebuild prioritizes information architecture and strong product presentation over WebGL-heavy effects.
- Store links are not finalized yet, so waitlist signup is the live primary CTA and store buttons are marked as coming soon.

## Commands
- Dev: `npm run web`
- Test: `npm run test:web-home`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`

## Project Structure
- `src/app/index.web.tsx` → web home route
- `src/app/index.web.css` → web home styles
- `src/lib/web-home.ts` → copy and derived city summaries
- `scripts/web-home.test.mjs` → smallest logic check for web-home data

## Code Style
- Use existing brand assets and real app screenshots.
- Prefer split layouts, clear hierarchy, and one dominant visual per section.
- Keep the route direct; avoid scene engines, WebGL plumbing, and decorative placeholder art.

## Testing Strategy
- One small Node test for city summary fallback/order and required policy disclosures
- `npm run typecheck`
- `npm run lint`
- Manual web verification in browser

## Boundaries
- Always: preserve core app facts, launch-city truth, and required policy disclosures.
- Ask first: adding dependencies, inventing live store URLs, or changing trust-policy scope.
- Never: fake a QR asset or imply download links are live when they are not.

## Success Criteria
- Web root presents Gling as a polished app website rather than an in-app feed or design report.
- Hero explains the app and offers a clear CTA.
- The site shows launch cities, community mechanics, trust/policy disclosures, and contact.
- Download area is prominent and honest about current store-link status.
- The old scene-based landing structure is removed.
