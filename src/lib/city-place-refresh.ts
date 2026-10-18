type CatalogStorage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> };
const CACHE_KEY = 'gling.city-places.v1';
let pending: Promise<void> | null = null, hydrated = false, checkedOn = '', catalog: unknown = null;

export function refreshCityPlaces(storage: CatalogStorage, fetchCatalog: () => Promise<unknown>, applyCatalog: (value: unknown) => boolean | void, now = Date.now()): Promise<void> {
  if (pending) return pending;
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
  pending = (async () => {
    if (!hydrated) {
      hydrated = true;
      try {
        const raw = await storage.getItem(CACHE_KEY);
        if (raw && raw.length <= 2_000_000) {
          const saved = JSON.parse(raw);
          if (saved.catalog === null || applyCatalog(saved.catalog) !== false) catalog = saved.catalog;
          if (typeof saved.checkedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.checkedOn) && saved.checkedOn <= day) checkedOn = saved.checkedOn;
        }
      } catch { /* Corrupt or unavailable storage leaves the bundled catalog usable. */ }
    }
    if (checkedOn === day) return;
    checkedOn = day;
    try {
      const next = await fetchCatalog();
      if (applyCatalog(next) !== false) catalog = next;
    } catch { /* Preserve the last valid catalog through offline and invalid responses. */ }
    try { await storage.setItem(CACHE_KEY, JSON.stringify({ checkedOn, catalog })); } catch { /* In-memory daily deduplication still applies. */ }
  })().finally(() => { pending = null; });
  return pending;
}
