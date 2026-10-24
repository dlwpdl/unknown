# Home places ordered by distance

Owner request: replace fixed Home place picks with the nearest places and show approximate distances.

- Rank the selected city's complete discovery catalog before taking the first three Home cards.
- Use a fresh foreground device location; never substitute a city center for the user's location.
- Reuse Map coordinate validation and distance calculations. Distances are approximate straight-line distances.
- Automatically read location only with existing OS permission. Ask for permission or open settings only after an explicit action.
- Keep the existing location-sharing preference unchanged. Never record a location event or send coordinates to a server or route URL.
- Keep an honest fallback when location is denied, inaccurate, stale or unavailable.
- The Home All link opens the same city's nearby list with existing categories and bounded pagination. The default TOP 50 route remains available.
- Reuse existing controls, feedback and visual tokens; verify small screens, large text and both languages.
- Verify sorting, invalid coordinates, stale asynchronous completions, permission denial and zero backend location writes.

Simulator location evidence must remain separate from physical-device location accuracy.
