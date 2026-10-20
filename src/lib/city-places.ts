import snapshot from './city-places.catalog.json';
import photoSnapshot from './city-places.photos.json';
import visitedPlaces from './gling-visited.json';
import { replaceExternalPlaceRatings } from './place-external-ratings';
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
  diningRecommendation?: PlaceRecommendation;
  glingVisited?: { sourceUrl: string };
};
export type PlaceRecommendation = { placeId: string; reason: string; reasonEn?: string; sourceUrl: string; verifiedAt: string };

type PlaceCatalog = {
  photoCatalog?: { cities: Record<string, PlacePhoto[]> }; externalRatings?: unknown;
  collectedAt: string; selectionRevision?: number; recommendationTheme?: 'photo-spots'; cities: Record<string, { coverage: string; places: CityPlace[]; recommendations?: PlaceRecommendation[]; diningRecommendations?: PlaceRecommendation[] }>;
};
let catalog = snapshot as PlaceCatalog;
let photoCatalog = photoSnapshot as { cities: Record<string, PlacePhoto[]> };
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
  const nextSelection = next.selectionRevision ?? 0, currentSelection = catalog.selectionRevision ?? 0;
  if (!Number.isSafeInteger(nextSelection) || nextSelection < 0) invalid();
  for (const city of CITIES) {
    const data = next.cities[city.id];
    if (next.photoCatalog && (!next.photoCatalog.cities || Object.keys(next.photoCatalog.cities).length !== CITIES.length)) invalid();
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
    if (next.photoCatalog) {
      const photos = next.photoCatalog.cities[city.id], seenPhotos = new Set<string>();
      if (!Array.isArray(photos) || photos.length > 200) invalid();
      for (const photo of photos) {
        if (!photo || photo.cityId !== city.id || !ids.has(photo.placeId) || seenPhotos.has(photo.placeId)
          || typeof photo.artist !== 'string' || !photo.artist.trim() || photo.artist.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(photo.artist) || !/^[a-f0-9]{64}$/.test(photo.imageSha256) || !/^(CC BY(?:-SA)? [234]\.0|CC BY(?:-SA)? 2\.5|CC0|Public domain)$/.test(photo.license)
          || !https(photo.uri) || !https(photo.sourceUrl) || !https(photo.licenseUrl)) invalid();
        const image = new URL(photo.uri), source = new URL(photo.sourceUrl), license = new URL(photo.licenseUrl);
        if (!['thumb.wikimedia.org', 'upload.wikimedia.org'].includes(image.hostname) || !image.pathname.startsWith('/wikipedia/commons/')
          || source.hostname !== 'commons.wikimedia.org' || !source.pathname.startsWith('/wiki/File:')
          || license.hostname !== 'creativecommons.org' || !/^\/(licenses|publicdomain)\//.test(license.pathname)) invalid();
        seenPhotos.add(photo.placeId);
      }
    }
    for (const [picks, dining] of [[data.recommendations, false], [data.diningRecommendations ?? [], true]] as const) {
      if (!Array.isArray(picks) || picks.length > 50) invalid();
      const selected = new Set<string>();
      for (const pick of picks!) {
        if (!pick || !ids.has(pick.placeId) || selected.has(pick.placeId) || !text(pick.reason, 500) || (pick.reasonEn !== undefined && !text(pick.reasonEn, 500)) || !https(pick.sourceUrl)
          || !text(pick.verifiedAt, 80) || !Number.isFinite(Date.parse(pick.verifiedAt)) || Date.parse(pick.verifiedAt) > now + 300_000
          || (dining && !data.places.some(p => p.id === pick.placeId && ['food', 'cafe'].includes(p.category)))) invalid();
        selected.add(pick.placeId);
      }
    }
  }
  if (nextSelection < currentSelection || (nextSelection === currentSelection && Date.parse(next.collectedAt) <= Date.parse(catalog.collectedAt))) return false;
  if (next.externalRatings !== undefined) {
    if (!Array.isArray(next.externalRatings) || next.externalRatings.some(row => !row || typeof row !== 'object'
      || !next.cities[row.cityId]?.places.some(place => place.id === row.placeId && place.name === row.placeName))
      || !replaceExternalPlaceRatings(next.externalRatings)) invalid();
  }
  if (next.photoCatalog) photoCatalog = next.photoCatalog;
  catalog = next; CITY_PLACES_COLLECTED_AT = next.collectedAt; revision++;
  listeners.forEach(listener => listener());
  return true;
}

function reviewedPicks(cityId: string): PlaceRecommendation[] {
  if (catalog.recommendationTheme !== 'photo-spots') return [];
  const current = catalog.cities[cityId].recommendations ?? [];
  // Bundled additions belong only to the same editorial selection.
  const additions = (catalog.selectionRevision === (snapshot as PlaceCatalog).selectionRevision ? (snapshot as PlaceCatalog).cities[cityId].recommendations ?? [] : [])
    .filter(pick => Date.parse(pick.verifiedAt) > Date.parse(catalog.collectedAt) && !current.some(item => item.placeId === pick.placeId));
  return [...current, ...additions].slice(0, 50);
}

function displayedPicks(cityId: string): PlaceRecommendation[] {
  if (catalog.recommendationTheme !== 'photo-spots') return [];
  const city = catalog.cities[cityId];
  const places = new Map([...(snapshot as PlaceCatalog).cities[cityId].places, ...city.places].map(place => [place.id, place]));
  const photographed = new Set((photoCatalog.cities[cityId] ?? []).map(photo => photo.placeId));
  const main = reviewedPicks(cityId);
  const picks = [...main, ...(city.diningRecommendations ?? []).filter(pick => photographed.has(pick.placeId))];
  const seen = new Set<string>();
  const groups = (['places', 'food', 'cafe'] as const).map(category => picks.filter(pick => {
    if (!photographed.has(pick.placeId) || places.get(pick.placeId)?.category !== category || seen.has(pick.placeId)) return false;
    seen.add(pick.placeId);
    return true;
  }));
  const selected: PlaceRecommendation[] = [];
  for (let index = 0; groups.some(group => group[index]); index++) {
    for (const group of groups) if (group[index]) selected.push(group[index]);
  }
  const fallback = main.filter(pick => !photographed.has(pick.placeId));
  return [...selected.slice(0, 50 - fallback.length), ...fallback];
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
  const reviewed = new Map(displayedPicks(cityId).map(pick => [pick.placeId, pick]));
  const dining = new Map((city.diningRecommendations ?? []).map(pick => [pick.placeId, pick]));
  const currentIds = new Set(city.places.map(place => place.id));
  const archived = (snapshot as PlaceCatalog).cities[cityId]?.places.filter(place => !currentIds.has(place.id)) ?? [];
  return [...city.places, ...archived].filter(place => category === 'all' || place.category === category)
    .map(place => {
      const visit = (visitedPlaces as { cityId: string; placeId: string; sourceUrl: string }[]).find(row => row.cityId === cityId && row.placeId === place.id);
      return { ...place, photo: photos[photoOrder.get(place.id) ?? -1] ?? null, recommendation: reviewed.get(place.id), diningRecommendation: dining.get(place.id),
        glingVisited: visit ? { sourceUrl: visit.sourceUrl } : undefined };
    })
    .sort((a, b) => (photoOrder.get(a.id) ?? photos.length) - (photoOrder.get(b.id) ?? photos.length));
}

export function getCityRecommendations(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  const places = getCityPlaces(cityId, category), picks = displayedPicks(cityId);
  const byId = new Map(places.map(place => [place.id, place]));
  return picks.flatMap(pick => {
    const place = byId.get(pick.placeId);
    return place ? [{ ...place, recommendation: pick }] : [];
  });
}

// Keep all admitted map destinations even when the displayed Top list is capped.
export function getCityDiscoveryPlaces(cityId: string): CityPlace[] {
  const places = getCityPlaces(cityId), byId = new Map(places.map(place => [place.id, place]));
  const picks = [...reviewedPicks(cityId), ...(catalog.cities[cityId].diningRecommendations ?? [])];
  const ids = new Set([...picks.map(pick => pick.placeId), ...places.filter(place => place.glingVisited).map(place => place.id)]);
  return [...ids].flatMap(id => { const place = byId.get(id); return place ? [place] : []; });
}

export function getCityBrowsePlaces(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  getCityPlaces(cityId, category);
  return category === 'all' ? getCityRecommendations(cityId) : getCityDiscoveryPlaces(cityId).filter(place => place.category === category);
}

export function getCityPlacesCoverage(cityId: string): string {
  getCityPlaces(cityId);
  return catalog.cities[cityId].coverage === 'municipal-boundary' ? '도시 경계 안의 장소' : '도심 주변의 장소';
}
