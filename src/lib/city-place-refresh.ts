type CatalogStorage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> };
const CACHE_KEY = 'gling.city-places.v1';
const RETRY_DELAY = 15 * 60 * 1000;
const vancouverDay = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
let pending: Promise<void> | null = null, hydrated = false, checkedOn = '', retryAfter = 0, catalog: unknown = null;
let checkedThisSession = false, lastCheckedAt = 0;

export function refreshCityPlaces(storage: CatalogStorage, fetchCatalog: () => Promise<unknown>, applyCatalog: (value: unknown) => boolean | void, now = Date.now()): Promise<void> {
  if (pending) return pending;
  const day = vancouverDay(now);
  const applyUsableCatalog = (value: unknown, fallbackDay: string) => {
    const changed = applyCatalog(value);
    const next = value as { recommendationTheme?: string; collectedAt?: string } | null;
    const collectedAt = Date.parse(next?.collectedAt ?? '');
    // The validator also returns false for a valid photo snapshot already bundled with the app.
    const photoCatalog = next?.recommendationTheme === 'photo-spots' && Number.isFinite(collectedAt);
    if (changed === false && !photoCatalog) return;
    if (changed !== false || catalog === null) catalog = value;
    checkedOn = photoCatalog ? vancouverDay(collectedAt) : fallbackDay;
  };
  pending = (async () => {
    if (!hydrated) {
      hydrated = true;
      try {
        const raw = await storage.getItem(CACHE_KEY);
        if (raw && raw.length <= 2_000_000) {
          const saved = JSON.parse(raw);
          const savedDay = typeof saved.checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.checkedOn) && saved.checkedOn <= day ? saved.checkedOn : '';
          if (saved.catalog != null) applyUsableCatalog(saved.catalog, savedDay);
          if (Number.isFinite(saved.retryAfter) && saved.retryAfter <= now + RETRY_DELAY) retryAfter = saved.retryAfter;
        }
      } catch { /* Corrupt or unavailable storage leaves the bundled catalog usable. */ }
    }
    // Hydrate immediately, then read our saved DB snapshot on a new launch or after 15 minutes.
    // External place providers still refresh only in the existing daily producer.
    if ((checkedThisSession && checkedOn === day && now - lastCheckedAt < RETRY_DELAY) || now < retryAfter) return;
    checkedThisSession = true; lastCheckedAt = now;
    retryAfter = now + RETRY_DELAY;
    try {
      const next = await fetchCatalog();
      applyUsableCatalog(next, day);
      if (checkedOn === day) retryAfter = 0;
    } catch { /* Preserve the last valid catalog through offline and invalid responses. */ }
    try { await storage.setItem(CACHE_KEY, JSON.stringify({ checkedOn, retryAfter, catalog })); } catch { /* In-memory deduplication still applies. */ }
  })().finally(() => { pending = null; });
  return pending;
}
