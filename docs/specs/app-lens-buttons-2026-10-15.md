# App buttons: approved lens material

The owner selected proposal 4 from the seven-button preview, then explicitly required the existing sizes to remain unchanged. Apply its thin reflective edge, rounded lens surface and shallow shadow to app action buttons, filters, icon controls and detail-page actions. This is an appearance change, not a layout redesign.

Preserve every caller's dimensions, minimum sizes, padding, margins, font and icon sizes, labels, touch targets, placement, enabled/busy state, accessibility, analytics and action callbacks. Add no arrow, spinner or new content. Cards, conversation bubbles, list rows, modal backdrops, native switches, native navigation tabs and branded system sign-in buttons retain their own semantics and appearance. Do not alter the private admin, public reader or backend.

Use the existing tracked Pressable with an explicit lens opt-in. Keep its non-opted-in behavior intact. A small shared material helper may change only paint properties; retain border widths as layout reservations while replacing the old thick bottom-edge paint. Preserve existing interaction feedback without duplicate sounds. The wide/compact RaisedActionButton keeps its existing 52/44 minimum touch heights and 2-point base reservation.

Reuse current day/night brand colors. The approved preview and its observed references remain in `output/design/gling-buttons-seven-20261015/` in the original checkout. Additional observed reference: [Luma event detail](https://mobbin.com/screens/d0f6cb30-04d6-40ac-9d11-54f3add802a9): small outlined circular header controls, an opaque registration action and quiet secondary actions. Use the established action hierarchy, not its event content.

Expo SDK57 versioned documentation and React Native0.86 View Style Props were read before implementation. Use stable boxShadow for the rim/reflection; the documented experimental background-image API is excluded from production. Android versions without inset shadow support retain the solid fill and rounded outline.

Implementation order: shared material and existing CTA; opt-in existing app controls by screen family; review remaining control inventory; type/lint/full tests; render actual shared components and compare before/after geometry. Keep source-only button commits separate for the existing release owner; no store/public deployment is part of this instruction.

Checks: `node --experimental-strip-types --test scripts/lens-controls.test.mjs`; `npm test`; `npx tsc --noEmit`; changed-file ESLint; actual rendered size comparisons. An AST/source baseline check must show that caller style expressions, geometry and callbacks are unchanged. Test disabled/selected states, reduced motion, day/night, refs and child render functions. Native hardware feedback is a separate verification limit.
