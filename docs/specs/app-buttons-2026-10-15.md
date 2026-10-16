# Flat app controls

The owner reviewed proposal4 on the native simulator, reported puffy small controls and cramped profile sections, then explicitly replaced the 3D direction with 2D: “3d 그냥 없애자 너무 안어울린다 2d가 훨씬 깔끔하고 고급지네”. This is the final direction; the older lens proposal is superseded.

Keep existing button sizes, padding, type, icons, touch targets, labels, callbacks, busy/disabled state and feedback. Use solid brand fills, thin existing outlines, quiet text links and a single selection highlight. Remove lens rims, reflective inset/outset shadows, raised bottom-edge paint and pressed vertical displacement. Reserve old border/base layout space so existing content and targets keep their dimensions. Preserve original corners for ordinary controls; the common primary action uses a quiet14-point radius with existing52/44-point minimum touch heights.

Reuse the existing tracked Pressable and native wrapper. Flatten control-tone GlassSurface, while preserving overlays and native navigation. Keep meaningful tab underlines and selected colors. Do not change backend, authentication, permissions, account data or release state.

The owner specifically requested breathing room between profile groups:16-point vertical gaps between review navigation, the four account shortcuts and business navigation. Buttons and horizontal spacing retain their sizes. The home category bar uses a selected fill and plain inactive labels, with no nested rims or selected outer shadow.

Observed references: [Mindtrip profile](https://mobbin.com/screens/528cd69b-458f-4be3-99ef-cfe9f718934f), with quiet activity tabs and an outlined edit action; [Insight Timer profile](https://mobbin.com/screens/05cfed0c-2142-4190-be94-fb7ddd596029), with flat text tabs and outlined primary actions. Existing day/night brand colors and type remain.

Verify paint-only helper behavior, forwarding of refs/function children/accessibility,52/44-point primary geometry, callbacks/analytics and press feedback. Run full tests, TypeScript, lint, iOS/Android bundle exports and rendered comparisons at375px. Read back the actual simulator's home filters and profile spacing. Physical haptics/audio and store deployment are separate limits.
