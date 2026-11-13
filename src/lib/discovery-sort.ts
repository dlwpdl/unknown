import type { DiscoveryItem } from './discovery.ts';
import { isFreshNearbyLocation, type LocationFix } from './location.ts';
import type { PostPin } from './post-maps.ts';

export function discoveryDistanceKm(item: Pick<DiscoveryItem, 'latitude' | 'longitude'>, origin: PostPin | null): number | null {
  const { latitude, longitude } = item;
  if (!origin || latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)
    || Math.abs(origin.latitude) > 90 || Math.abs(origin.longitude) > 180) return null;
  const rad = Math.PI / 180, dLat = (latitude-origin.latitude)*rad, dLon = (longitude-origin.longitude)*rad;
  const a = Math.sin(dLat/2)**2 + Math.cos(origin.latitude*rad)*Math.cos(latitude*rad)*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1, a)));
}

export function sortDiscoveryItems(items: readonly DiscoveryItem[], origin: PostPin | null, order: 'near' | 'discount' | 'saves', saverCount: (item: DiscoveryItem) => number = () => 0) {
  return items.map(item => ({ item, distance: discoveryDistanceKm(item, origin) ?? Infinity, saves: order === 'saves' ? saverCount(item) : 0,
    discount: Number.isFinite(item.webshopDiscount) && item.webshopDiscount! > 0 && item.webshopDiscount! <= 100 ? item.webshopDiscount! : -Infinity }))
    .sort((a, b) => {
      if (order === 'discount' && a.discount !== b.discount) return b.discount-a.discount;
      if (a.saves !== b.saves) return b.saves-a.saves;
      return a.distance === b.distance ? 0 : a.distance-b.distance;
    }).map(row => row.item);
}


export function rankPlacesByDistance<T extends { latitude: number | null; longitude: number | null }>(places: readonly T[], fix: LocationFix | null, now = Date.now()) {
  const origin = fix && isFreshNearbyLocation(fix, now) ? fix : null;
  return places.map((place, index) => ({ place, index, distance: discoveryDistanceKm(place, origin) }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.index - b.index);
}

export function formatNearbyDistance(distance: number | null, tr: (text: string, ...values: unknown[]) => string) {
  return distance !== null && Number.isFinite(distance) && distance >= 0
    ? distance < .1 ? tr('100m 이내') : tr('약 {0}km', distance.toFixed(1)) : null;
}

// Places Gling members actually go to come first: server-ranked ratings/saves, then Gling's own visits; the rest keep their order.
export function preferVisitedPlaces<T extends { place: { id: string; glingVisited?: unknown } }>(rows: readonly T[], signalIds: readonly string[]) {
  const rank = ({ place }: T) => { const index = signalIds.indexOf(place.id); return index >= 0 ? index : place.glingVisited ? signalIds.length : signalIds.length + 1; };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

// Event lists (QA C22-3): one row per event id even when loaded pages overlap, then the city's own day and start time; an event with no time yet goes last on its day, ties keep load order.
export function sortEventList<T extends { id: string; localDate?: string | null; startsAt?: string | null }>(events: readonly T[]): T[] {
  const seen = new Set<string>(), day = (event: T) => event.localDate ?? '9999-12-31', time = (event: T) => Date.parse(event.startsAt ?? '') || Infinity;
  return events.filter(event => !seen.has(event.id) && !!seen.add(event.id)).sort((a, b) => day(a).localeCompare(day(b)) || time(a) - time(b) || 0);
}
