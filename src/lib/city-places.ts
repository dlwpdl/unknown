import snapshot from './city-places.catalog.json';
import photoSnapshot from './city-places.photos.json';
import { CITIES } from '@/lib/mock';

export type PlaceCategory = 'all' | 'food' | 'cafe' | 'places';
export type PlacePhoto = {
  placeId: string; cityId: string; uri: string; sourceUrl: string;
  artist: string; license: string; licenseUrl: string; imageSha256: string;
};
export type CityPlace = {
  id: string; cityId: string; name: string; category: Exclude<PlaceCategory, 'all'>;
  latitude: number; longitude: number; address: string; sourceUrl: string;
  website?: string | null; openingHours?: string | null;
  photo?: PlacePhoto | null;
};

const catalog = snapshot as {
  collectedAt: string; cities: Record<string, { coverage: string; places: CityPlace[] }>;
};
const photoCatalog = photoSnapshot as { cities: Record<string, PlacePhoto[]> };
export const CITY_PLACES_COLLECTED_AT = catalog.collectedAt;

// shortcut: real dated OSM catalog; refresh the snapshot before promising live place coverage.
export function getCityPlaces(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  if (!CITIES.some(city => city.id === cityId)) throw new Error('INVALID_PLACE_CITY');
  if (!['all', 'food', 'cafe', 'places'].includes(category)) throw new Error('INVALID_PLACE_CATEGORY');
  const city = catalog.cities[cityId];
  if (!city) throw new Error('PLACE_CATALOG_MISSING');
  // shortcut: verified photos cover a subset; add licensed same-place images as they are checked.
  const photos = photoCatalog.cities[cityId] ?? [];
  const photoOrder = new Map(photos.map((photo, index) => [photo.placeId, index]));
  return city.places.filter(place => category === 'all' || place.category === category)
    .map(place => ({ ...place, photo: photos[photoOrder.get(place.id) ?? -1] ?? null }))
    .sort((a, b) => (photoOrder.get(a.id) ?? photos.length) - (photoOrder.get(b.id) ?? photos.length));
}

export function getCityPlacesCoverage(cityId: string): string {
  getCityPlaces(cityId);
  return catalog.cities[cityId].coverage === 'municipal-boundary' ? '도시 경계 안의 장소' : '도심 주변의 장소';
}
