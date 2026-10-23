import type { DiscoveryItem } from './discovery.ts';
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

export function sortDiscoveryItems(items: readonly DiscoveryItem[], origin: PostPin | null, order: 'near' | 'discount') {
  return items.map(item => ({ item, distance: discoveryDistanceKm(item, origin) ?? Infinity,
    discount: Number.isFinite(item.webshopDiscount) && item.webshopDiscount! > 0 && item.webshopDiscount! <= 100 ? item.webshopDiscount! : -Infinity }))
    .sort((a, b) => {
      if (order === 'discount' && a.discount !== b.discount) return b.discount-a.discount;
      return a.distance === b.distance ? 0 : a.distance-b.distance;
    }).map(row => row.item);
}
