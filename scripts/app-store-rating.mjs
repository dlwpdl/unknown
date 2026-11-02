// Prints the live Canadian App Store rating as "<score>:<count>" (e.g. "5.0:3") for EXPO_PUBLIC_APP_STORE_RATING.
// Any failure prints nothing, so the web build goes on and simply shows no rating. Never a made-up figure.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_STORE_LOOKUP = 'https://itunes.apple.com/lookup?id=6809273242&country=ca';

export function ratingValue(lookup) {
  const app = lookup?.results?.[0];
  const score = app?.averageUserRating, count = app?.userRatingCount;
  return typeof score === 'number' && score >= 1 && score <= 5 && Number.isSafeInteger(count) && count > 0 ? `${score.toFixed(1)}:${count}` : '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const response = await fetch(APP_STORE_LOOKUP, { signal: AbortSignal.timeout(8000) });
    process.stdout.write(response.ok ? ratingValue(await response.json()) : '');
  } catch { /* Offline or Apple down: no rating this build. */ }
}
