import snapshot from './city-places.catalog.json';
import photoSnapshot from './city-places.photos.json';
import visitedPlaces from './gling-visited.json';
import { replaceExternalPlaceRatings } from './place-external-ratings';
import { CITIES } from '@/lib/mock';

export type PlaceCategory = 'all' | 'food' | 'cafe' | 'places';
export type PlacePhoto = {
  placeId: string; cityId: string; uri: string; sourceUrl: string;
  artist: string; license: string; licenseUrl: string; imageSha256: string;
  title?: string; discoveredVia?: 'Wikimedia Commons' | 'Openverse' | 'Flickr' | 'Business site';
};
export type CityPlace = {
  id: string; cityId: string; name: string; category: Exclude<PlaceCategory, 'all'>;
  latitude: number; longitude: number; address: string; sourceUrl: string;
  website?: string | null; openingHours?: string | null;
  nightlife?: true;
  photo?: PlacePhoto | null;
  mapPhotoUri?: string;
  recommendation?: PlaceRecommendation;
  diningRecommendation?: PlaceRecommendation;
  glingVisited?: { sourceUrl: string };
};
export type PlaceRecommendation = { placeId: string; reason: string; reasonEn?: string; sourceUrl: string; verifiedAt: string };

type PhotoCatalog = {
  cities: Record<string, PlacePhoto[]>;
  additionalCatalog?: { cities: Record<string, PlacePhoto[]> };
  flickrCatalog?: { cities: Record<string, PlacePhoto[]> };
};
type PlaceCatalog = {
  photoCatalog?: PhotoCatalog; externalRatings?: unknown;
  collectedAt: string; selectionRevision?: number; recommendationTheme?: 'photo-spots'; cities: Record<string, { coverage: string; places: CityPlace[]; regionalPlaces?: CityPlace[]; regionalPhotos?: PlacePhoto[]; recommendations?: PlaceRecommendation[]; diningRecommendations?: PlaceRecommendation[];
    // Places past the 200 that 1.4.4/1.4.5 accept per city; those apps ignore these fields.
    extraPlaces?: CityPlace[]; extraRecommendations?: PlaceRecommendation[]; extraPhotos?: PlacePhoto[] }>;
};
let catalog = snapshot as PlaceCatalog;
let photoCatalog = photoSnapshot as PhotoCatalog;
export let CITY_PLACES_COLLECTED_AT = catalog.collectedAt;
let revision = 0;
const listeners = new Set<() => void>();
export const cityPlacesRevision = () => revision;
export function subscribeCityPlaces(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function regionalPlacesForCity(cityId: string): CityPlace[] {
  return catalog.cities[cityId].regionalPlaces ?? (snapshot as PlaceCatalog).cities[cityId]?.regionalPlaces ?? [];
}

const addedPlacesForCity = (cityId: string) => [...regionalPlacesForCity(cityId), ...(catalog.cities[cityId].extraPlaces ?? [])];
const diningPicksForCity = (cityId: string) => [...(catalog.cities[cityId].diningRecommendations ?? []), ...(catalog.cities[cityId].extraRecommendations ?? [])];

function photosForCity(cityId: string): PlacePhoto[] {
  const photos = [...(photoCatalog.cities[cityId] ?? [])], ids = new Set(photos.map(photo => photo.placeId));
  for (const group of [photoCatalog.additionalCatalog, photoCatalog.flickrCatalog]) {
    for (const photo of group?.cities[cityId] ?? []) {
      if (ids.has(photo.placeId)) continue;
      ids.add(photo.placeId);
      photos.push(photo);
    }
  }
  for (const photo of [...(catalog.cities[cityId].regionalPhotos ?? (snapshot as PlaceCatalog).cities[cityId]?.regionalPhotos ?? []), ...(catalog.cities[cityId].extraPhotos ?? [])]) {
    if (!ids.has(photo.placeId)) { ids.add(photo.placeId); photos.push(photo); }
  }
  return photos;
}

export function replaceCityPlacesCatalog(value: unknown, now = Date.now()): boolean {
  const next = value as PlaceCatalog;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  const https = (v: unknown) => {
    if (!text(v, 2500)) return false;
    try { const u = new URL(v as string); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
  };
  const invalid = () => { throw new Error('INVALID_PLACE_CATALOG'); };
  const validateFlickrPhoto = (photo: PlacePhoto, cityId: string, ids: Set<string>, discoveredVia: 'Openverse' | 'Flickr') => {
    if (!photo || photo.cityId !== cityId || !ids.has(photo.placeId)
      || !text(photo.artist, 1000) || !text(photo.title, 1000) || photo.discoveredVia !== discoveredVia
      || !/^[a-f0-9]{64}$/.test(photo.imageSha256) || !https(photo.uri) || !https(photo.sourceUrl) || !https(photo.licenseUrl)) invalid();
    const image = new URL(photo.uri), source = new URL(photo.sourceUrl), license = new URL(photo.licenseUrl);
    const imageId = /^\/\d+\/([1-9]\d*)_[a-f0-9]+(?:_[a-z0-9]+)?\.(?:jpe?g|png)$/i.exec(image.pathname)?.[1];
    const sourceId = /^\/photos\/[^/]+\/([1-9]\d*)\/?$/.exec(source.pathname)?.[1];
    const cc = /^CC BY(-SA)? ([234]\.0|2\.5)$/.exec(photo.license);
    const licensePath = photo.license === 'CC0' ? '/publicdomain/zero/1.0' : photo.license === 'Public domain' ? '/publicdomain/mark/1.0'
      : cc ? `/licenses/by${cc[1] ? '-sa' : ''}/${cc[2]}` : null;
    if (image.hostname !== 'live.staticflickr.com' || source.hostname !== 'www.flickr.com' || !sourceId || imageId !== sourceId
      || image.port || image.search || image.hash || source.port || source.search || source.hash
      || license.hostname !== 'creativecommons.org' || license.port || license.search || license.hash
      || !licensePath || license.pathname.replace(/\/$/, '') !== licensePath) invalid();
  };
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
    if (data.regionalPlaces !== undefined && (!Array.isArray(data.regionalPlaces) || data.regionalPlaces.length > 200)) invalid();
    if (data.extraPlaces !== undefined && (!Array.isArray(data.extraPlaces) || data.extraPlaces.length > 300)) invalid();
    for (const rows of [data.places, data.regionalPlaces ?? [], data.extraPlaces ?? []]) {
      const seen = new Set<string>();
      for (const p of rows) {
        if (!p || !text(p.id, 80) || !/^osm:(node|way|relation):[1-9]\d*$/.test(p.id) || seen.has(p.id) || p.cityId !== city.id || !text(p.name, 300)
          || !['food', 'cafe', 'places'].includes(p.category) || !Number.isFinite(p.latitude) || p.latitude < 40 || p.latitude > 85
          || !Number.isFinite(p.longitude) || p.longitude < -142 || p.longitude > -52 || typeof p.address !== 'string' || p.address.length > 1000
          || p.sourceUrl !== `https://www.openstreetmap.org/${p.id.split(':').slice(1).join('/')}`
          || (p.website != null && !https(p.website)) || (p.openingHours != null && !text(p.openingHours, 1000))
          || (p.nightlife !== undefined && p.nightlife !== true)) invalid();
        seen.add(p.id); ids.add(p.id);
      }
    }
    const baseIds = new Set(data.places.map(place => place.id)), extraIds = new Set((data.extraPlaces ?? []).map(place => place.id));
    if ([...extraIds].some(id => baseIds.has(id))) invalid();
    for (const [photos, photoIds, regional, max] of [...(next.photoCatalog ? [[next.photoCatalog.cities[city.id], baseIds, false, 200] as const] : []), ...(data.regionalPhotos !== undefined ? [[data.regionalPhotos, ids, true, 200] as const] : []),
      ...(data.extraPhotos !== undefined ? [[data.extraPhotos, extraIds, false, 300] as const] : [])]) {
      const seenPhotos = new Set<string>();
      if (!Array.isArray(photos) || photos.length > max) invalid();
      for (const photo of photos) {
        if (regional && (photo?.discoveredVia === 'Openverse' || photo?.discoveredVia === 'Flickr')) {
          validateFlickrPhoto(photo, city.id, photoIds, photo.discoveredVia);
          if (seenPhotos.has(photo.placeId)) invalid();
          seenPhotos.add(photo.placeId); continue;
        }
        if (!photo || photo.cityId !== city.id || !photoIds.has(photo.placeId) || seenPhotos.has(photo.placeId)
          || typeof photo.artist !== 'string' || !photo.artist.trim() || photo.artist.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(photo.artist) || !/^[a-f0-9]{64}$/.test(photo.imageSha256) || !https(photo.uri) || !https(photo.sourceUrl) || !https(photo.licenseUrl)) invalid();
        const image = new URL(photo.uri), source = new URL(photo.sourceUrl), license = new URL(photo.licenseUrl);
        if (photo.discoveredVia === 'Business site') {
          // Venue-provided photo: the business page is both image credit and licence reference.
          if (photo.license !== 'Business-provided photo' || photo.licenseUrl !== photo.sourceUrl) invalid();
        } else if (!/^(CC BY(?:-SA)? [234]\.0|CC BY(?:-SA)? 2\.5|CC0|Public domain)$/.test(photo.license)
          || !['thumb.wikimedia.org', 'upload.wikimedia.org'].includes(image.hostname) || !image.pathname.startsWith('/wikipedia/commons/')
          || source.hostname !== 'commons.wikimedia.org' || !source.pathname.startsWith('/wiki/File:')
          || license.hostname !== 'creativecommons.org' || !/^\/(licenses|publicdomain)\//.test(license.pathname)) invalid();
        seenPhotos.add(photo.placeId);
      }
    }
    for (const [picks, dining, pickIds, max] of [[data.recommendations, false, baseIds, 50], [data.diningRecommendations ?? [], true, baseIds, 200], [data.extraRecommendations ?? [], false, extraIds, 300]] as const) {
      if (!Array.isArray(picks) || picks.length > max) invalid();
      const selected = new Set<string>();
      for (const pick of picks!) {
        if (!pick || !pickIds.has(pick.placeId) || selected.has(pick.placeId) || !text(pick.reason, 500) || (pick.reasonEn !== undefined && !text(pick.reasonEn, 500)) || !https(pick.sourceUrl)
          || !text(pick.verifiedAt, 80) || !Number.isFinite(Date.parse(pick.verifiedAt)) || Date.parse(pick.verifiedAt) > now + 300_000
          || (dining && !data.places.some(p => p.id === pick.placeId && ['food', 'cafe'].includes(p.category)))) invalid();
        selected.add(pick.placeId);
      }
    }
  }
  const optional: Pick<PhotoCatalog, 'additionalCatalog' | 'flickrCatalog'> = {};
  for (const [field, discoveredVia] of [['additionalCatalog', 'Openverse'], ['flickrCatalog', 'Flickr']] as const) {
    if (next.photoCatalog?.[field] === undefined) continue;
    try {
      const extra = next.photoCatalog[field];
      if (!extra || !extra.cities || typeof extra.cities !== 'object' || Array.isArray(extra.cities)) invalid();
      for (const [cityId, rows] of Object.entries(extra.cities)) {
        if (!CITIES.some(city => city.id === cityId) || !Array.isArray(rows) || rows.length > 200) invalid();
        const ids = new Set(next.cities[cityId].places.map(place => place.id)), seen = new Set<string>();
        for (const photo of rows) {
          validateFlickrPhoto(photo, cityId, ids, discoveredVia);
          if (seen.has(photo.placeId)) invalid();
          seen.add(photo.placeId);
        }
      }
      optional[field] = extra;
    } catch { /* An invalid optional group must not discard the compatible Commons catalog. */ }
  }
  if (nextSelection < currentSelection || (nextSelection === currentSelection && Date.parse(next.collectedAt) <= Date.parse(catalog.collectedAt))) return false;
  if (next.externalRatings !== undefined) {
    if (!Array.isArray(next.externalRatings) || next.externalRatings.some(row => !row || typeof row !== 'object'
      || !next.cities[row.cityId]?.places.some(place => place.id === row.placeId && place.name === row.placeName))
      || !replaceExternalPlaceRatings(next.externalRatings)) invalid();
  }
  if (next.photoCatalog) photoCatalog = { ...next.photoCatalog, additionalCatalog: optional.additionalCatalog, flickrCatalog: optional.flickrCatalog };
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
  const places = new Map([...(snapshot as PlaceCatalog).cities[cityId].places, ...addedPlacesForCity(cityId), ...city.places].map(place => [place.id, place]));
  const photographed = new Set(photosForCity(cityId).map(photo => photo.placeId));
  const picks = [...reviewedPicks(cityId), ...diningPicksForCity(cityId)];
  const seen = new Set<string>();
  const groups = (['places', 'food', 'cafe'] as const).map(category => picks.filter(pick => {
    if (places.get(pick.placeId)?.category !== category || seen.has(pick.placeId)) return false;
    seen.add(pick.placeId);
    return true;
  }).sort((a, b) => Number(photographed.has(b.placeId)) - Number(photographed.has(a.placeId))));
  const selected: PlaceRecommendation[] = [];
  for (let index = 0; groups.some(group => group[index]); index++) {
    for (const group of groups) if (group[index]) selected.push(group[index]);
  }
  return selected.slice(0, 50);
}

// Keep unselected OSM identities available to existing detail and review links.
export function getCityPlaces(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  if (!CITIES.some(city => city.id === cityId)) throw new Error('INVALID_PLACE_CITY');
  if (!['all', 'food', 'cafe', 'places'].includes(category)) throw new Error('INVALID_PLACE_CATEGORY');
  const city = catalog.cities[cityId];
  if (!city) throw new Error('PLACE_CATALOG_MISSING');
  // shortcut: verified photos cover a subset; add licensed same-place images as they are checked.
  const photos = photosForCity(cityId);
  const photoOrder = new Map(photos.map((photo, index) => [photo.placeId, index]));
  const reviewed = new Map(displayedPicks(cityId).map(pick => [pick.placeId, pick]));
  const dining = new Map(diningPicksForCity(cityId).map(pick => [pick.placeId, pick]));
  const currentIds = new Set(city.places.map(place => place.id));
  const current = [...city.places, ...addedPlacesForCity(cityId).filter(place => !currentIds.has(place.id))];
  for (const place of current) currentIds.add(place.id);
  const archived = (snapshot as PlaceCatalog).cities[cityId]?.places.filter(place => !currentIds.has(place.id)) ?? [];
  return [...current, ...archived].filter(place => category === 'all' || place.category === category)
    .map(place => {
      const visit = (visitedPlaces as { cityId: string; placeId: string; sourceUrl: string; photo?: (typeof photos)[number] }[]).find(row => row.cityId === cityId && row.placeId === place.id);
      return { ...place, photo: photos[photoOrder.get(place.id) ?? -1] ?? visit?.photo ?? null, recommendation: reviewed.get(place.id), diningRecommendation: dining.get(place.id),
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
  const picks = [...reviewedPicks(cityId), ...diningPicksForCity(cityId)];
  const ids = new Set([...picks.map(pick => pick.placeId), ...addedPlacesForCity(cityId).map(place => place.id), ...places.filter(place => place.glingVisited).map(place => place.id)]);
  return [...ids].flatMap(id => { const place = byId.get(id); return place ? [place] : []; });
}

export function getCityBrowsePlaces(cityId: string, category: PlaceCategory = 'all'): CityPlace[] {
  getCityPlaces(cityId, category);
  return category === 'all' ? getCityRecommendations(cityId) : getCityDiscoveryPlaces(cityId).filter(place => place.category === category);
}

export function getCityPlacesCoverage(cityId: string): string {
  getCityPlaces(cityId);
  if (regionalPlacesForCity(cityId).length) return '도시와 인근 지역의 장소';
  return catalog.cities[cityId].coverage === 'municipal-boundary' ? '도시 경계 안의 장소' : '도심 주변의 장소';
}
