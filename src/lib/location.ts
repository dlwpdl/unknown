export type LocationFix = {
  latitude: number; longitude: number; accuracy: number | null; measuredAt: number; mocked: boolean;
};
export const LOCATION_CONSENT_VERSION = '2026-09-11';

export function isFreshLocation(fix: LocationFix, now = Date.now()) {
  return !fix.mocked && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && fix.accuracy != null && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 10000
    && Number.isFinite(fix.measuredAt) && now - fix.measuredAt <= 300000 && fix.measuredAt - now <= 30000;
}

export function nearbyCommunity(fix: LocationFix, now = Date.now()): string | null {
  if (!isFreshLocation(fix, now)) return null;
  // ponytail: approximate community catchments, not municipal boundaries; add centers as cities open.
  const centers = [{ id: 'vancouver', lat: 49.28, lon: -123.12 }, { id: 'toronto', lat: 43.65, lon: -79.38 }];
  const rad = Math.PI / 180;
  for (const city of centers) {
    const a = Math.sin((fix.latitude - city.lat) * rad / 2) ** 2
      + Math.cos(city.lat * rad) * Math.cos(fix.latitude * rad) * Math.sin((fix.longitude - city.lon) * rad / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    if (km + fix.accuracy! / 1000 <= 75) return city.id;
  }
  return null;
}
