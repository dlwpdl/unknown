import type { SupabaseClient } from '@supabase/supabase-js';
import { getCityDiscoveryPlaces } from './city-places.ts';
import { DELIVERY_PARTNERS } from './delivery-partners.ts';
import { CITIES } from './mock.ts';

export type UnifiedSearchKind = 'all' | 'business' | 'place' | 'person' | 'post' | 'meetup';
export type UnifiedSearchItem = { kind: Exclude<UnifiedSearchKind, 'all'>; id: string; cityId: string; title: string; subtitle: string; merchantId?: string; placeId?: string; imageUri?: string };
export type UnifiedSearchPage = { items: UnifiedSearchItem[]; hasMore: boolean; nextOffset: number };
const kinds = ['all', 'business', 'place', 'person', 'post', 'meetup'];
const cities = CITIES.filter(city => city.state === 'open').map(city => city.id);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const placeKey = /^(?:osm:(?:node|way|relation):[1-9][0-9]{0,19}|partner:[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const fold = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase().replaceAll('지모코', 'jimoco');
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never { throw new Error('INVALID_UNIFIED_SEARCH_RESPONSE'); }

export async function loadUnifiedSearch(client: SupabaseClient, options: { query: string; cityId: string | null; kind: UnifiedSearchKind; offset?: number; signal?: AbortSignal }): Promise<UnifiedSearchPage> {
  const { cityId, kind, signal } = options, offset = options.offset ?? 0;
  if (typeof options.query !== 'string' || options.query.trim().length > 120 || (cityId !== null && !cities.includes(cityId)) || !kinds.includes(kind)
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_600 || (kind === 'all' && offset !== 0)) throw new Error('INVALID_UNIFIED_SEARCH_REQUEST');
  if (signal?.aborted) throw new Error('SEARCH_ABORTED');
  const query = fold(options.query);
  if (!query) return { items: [], hasMore: false, nextOffset: 0 };
  const cafeQuery = ['cafe', 'café', 'coffee', '카페', '커피'].includes(query);
  const local = (cityId === null ? cities : [cityId]).flatMap(city => [
    ...getCityDiscoveryPlaces(city).map(place => ({ id: place.id, cityId: city, title: place.name, subtitle: place.address, category: place.category })),
    ...DELIVERY_PARTNERS.filter(place => place.cityId === city).map(place => ({ id: `partner:${place.id}`, cityId: city, title: place.name, subtitle: place.label, category: place.category })),
  ]).flatMap(place => {
    const title = fold(place.title), index = title.indexOf(query);
    return index < 0 && !(cafeQuery && place.category === 'cafe') ? [] : [{ ...place, rank: title === query ? 0 : index === 0 ? 1 : 2, sort: title }];
  }).sort((a, b) => a.rank - b.rank || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.cityId < b.cityId ? -1 : a.cityId > b.cityId ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const candidates = [...new Map(local.map(place => [`${place.cityId}:${place.id}`, place])).values()];
  // Current open-city curated/partner set is 360; cap also bounds Canada-wide link resolution.
  if (candidates.length > 2200) throw new Error('SEARCH_PLACE_LIMIT');
  const requested = new Map(candidates.map(place => [`${place.cityId}:${place.id}`, place]));
  const request = client.rpc('search_public_directory', { p_query: query, p_city_id: cityId, p_kind: kind, p_offset: offset,
    p_places: candidates.map(place => ({ cityId: place.cityId, placeId: place.id, rank: place.rank })) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (signal?.aborted) throw new Error('SEARCH_ABORTED');
  if (error) throw error;
  if (!record(data) || data.query !== query || data.cityId !== cityId || data.kind !== kind || data.offset !== offset || !Array.isArray(data.items)
    || data.items.length > (kind === 'all' ? 12 : 20) || !Array.isArray(data.links) || data.links.length > candidates.length
    || typeof data.hasMore !== 'boolean' || !Number.isSafeInteger(data.nextOffset)) invalid();
  const links = new Map<string, string>();
  for (const link of data.links) {
    if (!record(link) || typeof link.cityId !== 'string' || typeof link.placeId !== 'string' || typeof link.merchantId !== 'string' || !uuid.test(link.merchantId)) invalid();
    const key = `${link.cityId}:${link.placeId}`;
    if (!requested.has(key) || links.has(key)) invalid();
    links.set(key, link.merchantId.toLowerCase());
  }
  const seen = new Set<string>(), counts = new Map<string, number>();
  const items = data.items.map((row): UnifiedSearchItem => {
    if (!record(row) || !['business', 'person', 'post', 'meetup'].includes(row.kind as string) || (kind !== 'all' && row.kind !== kind)
      || typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.cityId !== 'string' || !cities.includes(row.cityId) || (cityId !== null && row.cityId !== cityId)
      || !text(row.title, 300) || !row.title.trim() || !text(row.subtitle, 1000)
      || Object.keys(row).some(key => !['kind', 'id', 'cityId', 'title', 'subtitle', 'merchantId'].includes(key))
      || (row.merchantId !== undefined && (row.kind !== 'business' || row.merchantId !== row.id))) invalid();
    const key = `${row.kind}:${row.id.toLowerCase()}`, count = (counts.get(row.kind as string) ?? 0) + 1;
    if (seen.has(key) || (kind === 'all' && count > 3)) invalid();
    seen.add(key); counts.set(row.kind as string, count);
    return { kind: row.kind as UnifiedSearchItem['kind'], id: row.id.toLowerCase(), cityId: row.cityId, title: row.title, subtitle: row.subtitle,
      ...(row.kind === 'business' ? { merchantId: row.id.toLowerCase() } : {}) };
  });
  if (kind === 'all' ? data.hasMore || data.nextOffset !== 0 : kind === 'place' ? data.items.length !== 0 || data.hasMore || data.nextOffset !== offset
    : data.nextOffset !== offset + items.length || (data.hasMore && items.length !== 20)) invalid();
  if (kind !== 'all' && kind !== 'place') return { items, hasMore: data.hasMore, nextOffset: data.nextOffset as number };
  const branches = new Set<string>();
  const places = candidates.flatMap(place => {
    if (!placeKey.test(place.id)) invalid();
    const merchantId = links.get(`${place.cityId}:${place.id}`);
    if (kind === 'all' && merchantId) return [];
    const branch = merchantId ? `${place.cityId}:${merchantId}` : `${place.cityId}:${place.id}`;
    if (branches.has(branch)) return [];
    branches.add(branch);
    return [{ kind: 'place' as const, id: place.id, placeId: place.id, cityId: place.cityId, title: place.title, subtitle: place.subtitle, ...(merchantId ? { merchantId } : {}) }];
  });
  if (kind === 'all') return { items: [...items, ...places.slice(0, 3)], hasMore: false, nextOffset: 0 };
  const page = places.slice(offset, offset + 20);
  return { items: page, hasMore: places.length > offset + page.length, nextOffset: offset + page.length };
}
