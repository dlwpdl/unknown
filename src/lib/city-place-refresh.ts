type CatalogStorage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> };
const CACHE_KEY = 'gling.city-places.v1';
const RETRY_DELAY = 15 * 60 * 1000;
// The daily publisher starts at 04:10 PT and is done by 05:00 PT.
const PUBLISHED_BY = 5 * 60 * 60 * 1000;
const vancouverDay = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
/** The Vancouver day of the newest catalog the server can hold at `time`. */
const publishedDay = (time: number) => vancouverDay(time - PUBLISHED_BY);
let pending: Promise<void> | null = null, hydrated = false, checkedOn = '', retryAfter = 0, catalog: unknown = null, answeredAt = 0;

export function refreshCityPlaces(storage: CatalogStorage, fetchCatalog: () => Promise<unknown>, applyCatalog: (value: unknown) => boolean | void, now = Date.now()): Promise<void> {
  if (pending) return pending;
  const day = vancouverDay(now);
  const applyUsableCatalog = (value: unknown, fallbackDay: string) => {
    const changed = applyCatalog(value);
    const next = value as { recommendationTheme?: string; collectedAt?: string } | null;
    const collectedAt = Date.parse(next?.collectedAt ?? '');
    // The validator returns false for a snapshot that is not newer (e.g. already bundled); it is fully validated if it is ever applied.
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
        // Same 8 MB ceiling as the publisher's read (scripts/refresh-city-places.py).
        if (raw && raw.length <= 8_000_000) {
          const saved = JSON.parse(raw);
          const savedDay = typeof saved.checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.checkedOn) && saved.checkedOn <= day ? saved.checkedOn : '';
          if (saved.catalog != null) applyUsableCatalog(saved.catalog, savedDay);
          if (Number.isFinite(saved.retryAfter) && saved.retryAfter <= now + RETRY_DELAY) retryAfter = saved.retryAfter;
          // 1.5.1 saved `lastCheckedAt` for failed attempts too; it is not read, so an update asks once unless today's catalog is here.
          if (Number.isFinite(saved.answeredAt) && saved.answeredAt <= now) answeredAt = saved.answeredAt;
        }
      } catch { /* Corrupt or unavailable storage leaves the bundled catalog usable. */ }
    }
    // Download at most once per publication (owner 2026-11-11 "하루 한 번만 받기"): skip when today's catalog is here, while a
    // failed request waits 15 minutes, or when the server already answered since the last 04:10 PT publication
    // (a day whose publication failed is not asked again on every visit).
    if (checkedOn === day || now < retryAfter || publishedDay(answeredAt) === publishedDay(now)) return;
    retryAfter = now + RETRY_DELAY;
    try {
      const next = await fetchCatalog();
      applyUsableCatalog(next, day);
      retryAfter = 0; answeredAt = now;
    } catch { /* Preserve the last valid catalog through offline and invalid responses. */ }
    try { await storage.setItem(CACHE_KEY, JSON.stringify({ checkedOn, retryAfter, answeredAt, catalog })); } catch { /* In-memory deduplication still applies. */ }
  })().finally(() => { pending = null; });
  return pending;
}
