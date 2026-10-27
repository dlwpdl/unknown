import { getLocale, tr } from '../i18n/index.ts';
import { coarseListingPin, neighborhoodName } from './neighborhoods.ts';
import { googleMapsPin, googlePinUrl, postMapBody, type PostPin } from './post-maps.ts';
import type { Post } from './types.ts';
import { EVENT_TIMEZONES, festivalLocalDay, isFestivalEvent, type EventCity, type TicketmasterEvent } from '../../supabase/functions/_shared/ticketmaster.ts';
import { CITY_TOP25, type CityTop25Place } from './city-top25.ts';
import type { CityPlace } from './city-places.ts';

export const TOP25_GOLD = '#F4CA78';

export const DISCOVERY_CATEGORIES = [
  { id: 'housing', label: '부동산', short: '집', color: '#70BFAF' },
  { id: 'used', label: '중고거래', short: '중고', color: '#E9B86C' },
  { id: 'festival', label: '페스티벌', short: '축제', color: '#CBB9FF' },
  { id: 'exhibition', label: '전시', short: '전시', color: '#E7A5C0' },
  { id: 'event', label: '이벤트', short: '행사', color: '#5F7CF3' },
  { id: 'nature', label: '자연', short: '자연', color: '#A8C39B' },
  { id: 'cafe', label: '카페', short: '카페', color: '#D7BD92' },
  { id: 'dining', label: '다이닝', short: '맛집', color: '#D79681' },
  { id: 'shopping', label: '쇼핑', short: '쇼핑', color: '#92C4C7' },
  { id: 'trip', label: '근교 여행', short: '여행', color: '#9BAED1' },
  { id: 'activity', label: '액티비티', short: '활동', color: '#82ADF0' },
  { id: 'nightlife', label: '나이트라이프', short: '밤', color: '#DD737F' },
  { id: 'library', label: '도서관', short: '책', color: '#B8A270' },
  { id: 'place', label: '장소', short: '장소', color: '#B6B9CC' },
] as const;
export type DiscoveryCategory = typeof DISCOVERY_CATEGORIES[number]['id'];
export type DiscoveryFilter = 'all' | 'top25' | 'visited' | 'delivery' | 'nightlife' | 'festival' | 'cafe' | 'dining' | 'places' | 'events' | 'housing' | 'used';
export type DiscoveryDate = 'all' | 'today' | 'week' | 'weekend' | 'date';
export type DiscoveryItem = {
  id: string; source: 'post' | 'event' | 'place'; sourceId: string; cityId: string; title: string;
  category: DiscoveryCategory; label: string; latitude: number | null; longitude: number | null;
  price: number | null; imageUri?: string; post?: Post; event?: TicketmasterEvent;
  startsAt?: string | null; endsAt?: string | null; localDate?: string | null;
  top25?: CityTop25Place;
  place?: CityPlace;
  glingVisited?: { sourceUrl: string };
  delivery?: boolean;
  merchantId?: string;
  webshopDiscount?: number;
};

let placeMapRequestId = 0;
export function placeMapRoute(place: Pick<CityPlace, 'id' | 'cityId' | 'glingVisited'>) {
  return { pathname: '/map' as const, params: { cityId: place.cityId, placeId: place.id, category: place.glingVisited ? 'visited' : 'top25',
    placeRequest: Date.now().toString(36) + '-' + (++placeMapRequestId).toString(36) } };
}

export function discoveryPlace(place: CityPlace): DiscoveryItem | null {
  if (!Number.isFinite(place.latitude) || Math.abs(place.latitude) > 90 || !Number.isFinite(place.longitude) || Math.abs(place.longitude) > 180) return null;
  const category = place.nightlife ? 'nightlife' : place.category === 'food' ? 'dining' : place.category === 'cafe' ? 'cafe' : 'place';
  const pick = place.recommendation?.placeId === place.id ? place.recommendation : null;
  return { id: `place:${place.cityId}:${place.id}`, source: 'place', sourceId: place.id, cityId: place.cityId, title: place.name,
    category, label: place.address || place.name,
    latitude: place.latitude, longitude: place.longitude, price: null, imageUri: place.photo?.uri, place,
    ...(place.glingVisited ? { glingVisited: place.glingVisited } : {}),
    ...(pick ? { top25: { id: place.id, cityId: place.cityId, title: place.name, label: place.address || place.name,
      category, latitude: place.latitude, longitude: place.longitude, reason: pick.reason, reasonEn: pick.reasonEn,
      sourceUrl: pick.sourceUrl, postIds: [] } } : {}) };
}

export function mergeCityTop25(items: DiscoveryItem[], cityId: string, picks: readonly CityTop25Place[] = CITY_TOP25): DiscoveryItem[] {
  const ids = new Set<string>(), bindings = new Set<string>(), counts = new Map<string, number>();
  for (const pick of picks) {
    const key = `${pick.cityId}:${pick.id}`;
    let source: URL;
    try { source = new URL(pick.sourceUrl); } catch { throw new Error('INVALID_TOP25_SOURCE'); }
    if (source.protocol !== 'https:' || source.username || source.password
      || ![pick.id, pick.cityId, pick.title, pick.label, pick.reason].every(value => typeof value === 'string' && value.trim() && value.length <= 500)
      || pick.id.length > 80 || pick.cityId.length > 64 || /[\u0000-\u001f\u007f]/.test(pick.id + pick.cityId)
      || !Number.isFinite(pick.latitude) || Math.abs(pick.latitude) > 90 || !Number.isFinite(pick.longitude) || Math.abs(pick.longitude) > 180
      || !DISCOVERY_CATEGORIES.some(category => category.id === pick.category) || ['housing', 'used', 'event', 'festival'].includes(pick.category)
      || ids.has(key) || !Array.isArray(pick.postIds) || pick.postIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 180)) throw new Error('INVALID_TOP25_PLACE');
    ids.add(key);
    const count = (counts.get(pick.cityId) ?? 0) + 1;
    if (count > 50) throw new Error('TOP25_CITY_LIMIT');
    counts.set(pick.cityId, count);
    for (const postId of pick.postIds) {
      const binding = `${pick.cityId}:${postId}`;
      if (bindings.has(binding)) throw new Error('AMBIGUOUS_TOP25_POST');
      bindings.add(binding);
    }
  }
  const visible = items.filter(item => item.cityId === cityId), merged = new Set<string>();
  const places = picks.filter(pick => pick.cityId === cityId).map(pick => {
    const catalog = visible.find(item => item.source === 'place' && item.place && item.sourceId === pick.id);
    if (catalog) merged.add(catalog.id);
    const recommendations = visible.filter(item => item.source === 'post' && item.post && item.post.kind !== 'listing'
      && !['housing', 'used', 'event', 'festival'].includes(item.category) && pick.postIds.includes(item.sourceId));
    recommendations.forEach(item => merged.add(item.id));
    const first = recommendations[0];
    return { id: `place:${cityId}:${pick.id}`, source: 'place' as const, sourceId: pick.id, cityId, title: pick.title,
      category: pick.category, label: pick.label, latitude: pick.latitude, longitude: pick.longitude,
      price: first?.price ?? null, imageUri: first?.imageUri ?? catalog?.imageUri, post: first?.post, top25: pick, place: catalog?.place,
      ...(catalog?.glingVisited ? { glingVisited: catalog.glingVisited } : {}) };
  });
  return [...places, ...visible.filter(item => !merged.has(item.id))];
}
const categoryFor = (post: Post): DiscoveryCategory => {
  if (post.tag.slug === 'housing' || post.tag.slug === 'used' || post.tag.slug === 'festival') return post.tag.slug;
  const tags = (post.hashtags ?? []).join(' ');
  for (const [pattern, category] of [
    [/전시|exhibition/i, 'exhibition'], [/도서관|library/i, 'library'], [/카페|cafe|café/i, 'cafe'],
    [/나이트라이프|클럽|nightlife/i, 'nightlife'], [/페스티벌|축제|festival/i, 'festival'],
    [/이벤트|event/i, 'event'], [/자연|하이킹|산책|nature/i, 'nature'], [/액티비티|activity/i, 'activity'],
  ] as const) if (pattern.test(tags)) return category;
  return ({ festival: 'festival', food: 'dining', travel: 'trip', shopping: 'shopping' } as Partial<Record<Post['tag']['slug'], DiscoveryCategory>>)[post.tag.slug] ?? 'place';
};
export function discoveryPost(post: Post, now = Date.now()): DiscoveryItem | null {
  if (!['housing', 'used', 'food', 'travel', 'festival', 'shopping'].includes(post.tag.slug)) return null;
  if (post.kind === 'listing' && (!['open', 'partial'].includes(post.listingStatus ?? '') || !(Date.parse(post.expiresAt ?? '') > now))) return null;
  const location = postMapBody(post.body), exact = location.url ? googleMapsPin(location.url) : null;
  if (!location.url) return null;
  const address = new URL(location.url).searchParams.get('query');
  // 부동산·중고거래 never show a home or meeting point: snap to the neighborhood centre and name only the neighborhood.
  const listing = post.tag.slug === 'housing' || post.tag.slug === 'used', coarse = listing && exact ? coarseListingPin(post.cityId, exact) : null, pin = coarse ?? exact;
  const label = listing ? coarse?.neighborhood ? neighborhoodName(coarse.neighborhood, getLocale() === 'en-CA' ? 'en' : 'ko') : tr('이 근처') : location.label ?? (!pin && address ? address : tr('공개 위치'));
  return { id: `post:${post.id}`, source: 'post', sourceId: post.id, cityId: post.cityId, title: post.title,
    category: categoryFor(post), label, latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null,
    price: typeof post.price === 'number' && Number.isFinite(post.price) ? post.price : null, imageUri: post.imageThumbs?.[0] ?? post.imageUris?.[0], post };
}
export function discoveryEvent(event: TicketmasterEvent, cityId: string, now = Date.now()): DiscoveryItem | null {
  if (['canceled', 'cancelled', 'postponed', 'unavailable'].includes(event.status)
    || (event.endsAt && Date.parse(event.endsAt) <= now)
    || (!event.endsAt && event.localDate && event.localDate < festivalLocalDay(cityId as EventCity, now))) return null;
  let pin: PostPin | null = null;
  try { if (event.location) { googlePinUrl(event.location); pin = event.location; } } catch { /* Missing venue coordinates stay in the list. */ }
  return { id: `event:${event.id}`, source: 'event', sourceId: event.id, cityId, title: event.name,
    category: isFestivalEvent(event) ? 'festival' : 'event', label: event.venue || event.city,
    latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null, price: event.price?.min ?? null,
    imageUri: event.image ?? undefined, startsAt: event.startsAt, endsAt: event.endsAt, localDate: event.localDate, event };
}
export function directionsUrl(pin: PostPin, app: 'google' | 'waze') {
  googlePinUrl(pin);
  const coordinate = `${pin.latitude},${pin.longitude}`;
  return app === 'google'
    ? `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: coordinate, dir_action: 'navigate' })}`
    : `https://waze.com/ul?${new URLSearchParams({ ll: coordinate, navigate: 'yes' })}`;
}
export function discoveryDays(filter: DiscoveryDate, cityId: string, date = '', now = Date.now()): string[] {
  if (filter === 'all') return [];
  const timezone = EVENT_TIMEZONES[cityId as EventCity];
  if (!timezone) throw new Error('UNSUPPORTED_EVENT_CITY');
  const today = festivalLocalDay(cityId as EventCity, now);
  if (filter === 'today') return [today];
  if (filter === 'date') {
    const value = Date.parse(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('INVALID_MAP_DATE');
    return [date];
  }
  const day = new Date(`${today}T12:00:00Z`), weekday = day.getUTCDay();
  if (filter === 'week') return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(day); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10);
  });
  if (weekday === 0) return [today];
  day.setUTCDate(day.getUTCDate() + (6 - weekday));
  const saturday = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 1);
  return [saturday, day.toISOString().slice(0, 10)];
}
export function discoveryEventOnDays(item: DiscoveryItem, days: readonly string[]): boolean {
  if (!days.length || item.source !== 'event') return true;
  if (!Object.hasOwn(EVENT_TIMEZONES, item.cityId)) return false;
  const startTime = Date.parse(item.startsAt ?? '');
  const start = Number.isFinite(startTime) ? festivalLocalDay(item.cityId as EventCity, startTime) : item.localDate;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  const endTime = Date.parse(item.endsAt ?? '');
  if (Number.isFinite(endTime) && Number.isFinite(startTime) && endTime < startTime) return false;
  const end = Number.isFinite(endTime) ? festivalLocalDay(item.cityId as EventCity, endTime - 1) : start;
  return days.some(day => day >= start && day <= end);
}
// 배달 할인은 참여 가게 데이터가 붙기 전까지 항상 비어 있다(필터는 미리 노출).
export function discoveryMatches(item: DiscoveryItem, filters: DiscoveryFilter | readonly DiscoveryFilter[], query: string, top25Only = false) {
  const category = item.category;
  const selected = typeof filters === 'string' ? [filters] : filters;
  return (!top25Only || !!item.top25) && (!selected.length || selected.some(filter => filter === 'all'
    || (filter === 'top25' ? !!item.top25 : filter === 'visited' ? !!item.glingVisited : filter === 'delivery' ? !!item.delivery : filter === 'events' ? item.source !== 'place' && ['festival', 'exhibition', 'event'].includes(category)
      : filter === 'places' ? !['housing', 'used', 'festival', 'event', 'nightlife', 'cafe', 'dining'].includes(category) : category === filter)))
    && `${item.title} ${item.label} ${item.top25?.reason ?? ''} ${item.post?.business?.name ?? ''} ${item.post?.body ?? ''} ${(item.post?.hashtags ?? []).join(' ')} ${DISCOVERY_CATEGORIES.find(value => value.id === category)?.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
