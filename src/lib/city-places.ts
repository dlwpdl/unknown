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
  recommendation?: PlaceRecommendation;
};
export type PlaceRecommendation = { placeId: string; reason: string; reasonEn?: string; sourceUrl: string; verifiedAt: string };

type PlaceCatalog = {
  collectedAt: string; recommendationTheme?: 'photo-spots'; cities: Record<string, { coverage: string; places: CityPlace[]; recommendations?: PlaceRecommendation[] }>;
};
let catalog = snapshot as PlaceCatalog;
const photoCatalog = photoSnapshot as { cities: Record<string, PlacePhoto[]> };
export let CITY_PLACES_COLLECTED_AT = catalog.collectedAt;
let revision = 0;
const listeners = new Set<() => void>();
export const cityPlacesRevision = () => revision;
export function subscribeCityPlaces(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function replaceCityPlacesCatalog(value: unknown, now = Date.now()): boolean {
  const next = value as PlaceCatalog;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  const https = (v: unknown) => {
    if (!text(v, 2500)) return false;
    try { const u = new URL(v as string); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
  };
  const invalid = () => { throw new Error('INVALID_PLACE_CATALOG'); };
  if (!next || !text(next.collectedAt, 80) || !Number.isFinite(Date.parse(next.collectedAt)) || Date.parse(next.collectedAt) > now + 300_000
    || !next.cities || Object.keys(next.cities).length !== CITIES.length || Object.keys(next.cities).some(id => !CITIES.some(c => c.id === id))) invalid();
  if (next.recommendationTheme !== 'photo-spots') return false;
  for (const city of CITIES) {
    const data = next.cities[city.id];
    if (!data || !['municipal-boundary', 'city-center'].includes(data.coverage) || !Array.isArray(data.places) || !data.places.length || data.places.length > 200) invalid();
    const ids = new Set<string>();
    for (const p of data.places) {
      if (!p || !text(p.id, 80) || !/^osm:(node|way|relation):[1-9]\d*$/.test(p.id) || ids.has(p.id) || p.cityId !== city.id || !text(p.name, 300)
        || !['food', 'cafe', 'places'].includes(p.category) || !Number.isFinite(p.latitude) || p.latitude < 40 || p.latitude > 85
        || !Number.isFinite(p.longitude) || p.longitude < -142 || p.longitude > -52 || typeof p.address !== 'string' || p.address.length > 1000
        || p.sourceUrl !== `https://www.openstreetmap.org/${p.id.split(':').slice(1).join('/')}`
        || (p.website != null && !https(p.website)) || (p.openingHours != null && !text(p.openingHours, 1000))) invalid();
      ids.add(p.id);
    }
    if (!Array.isArray(data.recommendations) || data.recommendations.length > 25) invalid();
    const selected = new Set<string>();
    for (const pick of data.recommendations!) {
      if (!pick || !ids.has(pick.placeId) || selected.has(pick.placeId) || !text(pick.reason, 500) || (pick.reasonEn !== undefined && !text(pick.reasonEn, 500)) || !https(pick.sourceUrl)
        || !text(pick.verifiedAt, 80) || !Number.isFinite(Date.parse(pick.verifiedAt)) || Date.parse(pick.verifiedAt) > now + 300_000) invalid();
      selected.add(pick.placeId);
    }
  }
  if (Date.parse(next.collectedAt) <= Date.parse(catalog.collectedAt)) return false;
  catalog = next; CITY_PLACES_COLLECTED_AT = next.collectedAt; revision++;
  listeners.forEach(listener => listener());
  return true;
}

function reviewedPicks(cityId: string): PlaceRecommendation[] {
  if (catalog.recommendationTheme !== 'photo-spots') return [];
  const current = catalog.cities[cityId].recommendations ?? [];
  // An older daily snapshot has not seen newly reviewed bundled additions yet.
  const additions = ((snapshot as PlaceCatalog).cities[cityId].recommendations ?? [])
    .filter(pick => Date.parse(pick.verifiedAt) > Date.parse(catalog.collectedAt) && !current.some(item => item.placeId === pick.placeId));
  return [...current, ...additions].slice(0, 25);
}

// Keep unselected OSM identities available to existing detail and review links.
export function getCityPlaces(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  if (!CITIES.some(city => city.id === cityId)) throw new Error('INVALID_PLACE_CITY');
  if (!['all', 'food', 'cafe', 'places'].includes(category)) throw new Error('INVALID_PLACE_CATEGORY');
  const city = catalog.cities[cityId];
  if (!city) throw new Error('PLACE_CATALOG_MISSING');
  // shortcut: verified photos cover a subset; add licensed same-place images as they are checked.
  const photos = photoCatalog.cities[cityId] ?? [];
  const photoOrder = new Map(photos.map((photo, index) => [photo.placeId, index]));
  const reviewed = new Map(reviewedPicks(cityId).map(pick => [pick.placeId, pick]));
  const currentIds = new Set(city.places.map(place => place.id));
  const archived = (snapshot as PlaceCatalog).cities[cityId]?.places.filter(place => !currentIds.has(place.id)) ?? [];
  return [...city.places, ...archived].filter(place => category === 'all' || place.category === category)
    .map(place => ({ ...place, photo: photos[photoOrder.get(place.id) ?? -1] ?? null, recommendation: reviewed.get(place.id) }))
    .sort((a, b) => (photoOrder.get(a.id) ?? photos.length) - (photoOrder.get(b.id) ?? photos.length));
}

export function getCityRecommendations(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  const places = getCityPlaces(cityId, category), picks = reviewedPicks(cityId);
  const byId = new Map(places.map(place => [place.id, place]));
  return picks.flatMap(pick => {
    const place = byId.get(pick.placeId);
    return place ? [{ ...place, recommendation: pick }] : [];
  });
}

export function getCityPlacesCoverage(cityId: string): string {
  getCityPlaces(cityId);
  return catalog.cities[cityId].coverage === 'municipal-boundary' ? '도시 경계 안의 장소' : '도심 주변의 장소';
}
