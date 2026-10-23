import type { SupabaseClient } from '@supabase/supabase-js';
import { merchantEventId } from './merchant-source.ts';
import type { DiscoveryItem } from './discovery.ts';

export type WebshopItem = { id: string; name: string; uberCents: number; webCents: number };
export type CheckoutQuote = { itemsCents: number; deliveryCents: number; serviceCents: number; discountCents: number; taxCents: number; tipCents: number; totalCents: number };
export type CheckoutComparison = { verifiedAt: string; fulfillment: 'delivery' | 'pickup'; basketLabel: string; sameConditionsConfirmed: true; uber: CheckoutQuote; webshop: CheckoutQuote };
export type Webshop = { merchantId: string; cityId: string; url: string; provider: 'uber'; placeKeys: string[]; comparisons: WebshopItem[]; verifiedAt: string | null; promoCode: string | null; checkoutComparison: CheckoutComparison | null };
export type WebshopPlatform = 'ios' | 'android' | 'web';
export type WebshopSource = 'business_profile' | 'comparison_sheet' | 'map' | 'place_detail';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PLACE_KEY = /^(?:osm:(?:node|way|relation):[1-9][0-9]{0,19}|partner:[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 99_999_999;
const instant = (value: unknown): value is string => text(value, 50) && Number.isFinite(Date.parse(value));
const invalid = (): never => { throw new Error('INVALID_WEBSHOP'); };

export function safeWebshopUrl(value: unknown): string | null {
  if (!text(value, 2048) || !/^https:\/\/(?:www\.)?order\.store\/ca\/store\/[a-z0-9-]+(?:%26[a-z0-9-]+)*\/[A-Za-z0-9_-]{20,80}$/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['order.store', 'www.order.store'].includes(url.hostname) && !url.username && !url.password
      && !url.port && !url.search && !url.hash && /^\/ca\/store\/[^/]+\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function quote(value: unknown): CheckoutQuote {
  const row = value as CheckoutQuote;
  if (!row || !['itemsCents', 'deliveryCents', 'serviceCents', 'discountCents', 'taxCents', 'tipCents', 'totalCents'].every(key => cents(row[key as keyof CheckoutQuote]))
    || row.totalCents !== row.itemsCents + row.deliveryCents + row.serviceCents + row.taxCents + row.tipCents - row.discountCents) invalid();
  return { itemsCents: row.itemsCents, deliveryCents: row.deliveryCents, serviceCents: row.serviceCents, discountCents: row.discountCents, taxCents: row.taxCents, tipCents: row.tipCents, totalCents: row.totalCents };
}

export function parseWebshop(value: unknown): Webshop | null {
  if (value == null) return null;
  const row = value as Webshop, url = safeWebshopUrl(row.url);
  if (!row || !UUID.test(row.merchantId) || !text(row.cityId, 100) || !url || row.provider !== 'uber' || row.verifiedAt !== null && !instant(row.verifiedAt)
    || !Array.isArray(row.placeKeys) || row.placeKeys.length > 50 || row.placeKeys.some(key => !text(key, 120) || !PLACE_KEY.test(key))
    || !Array.isArray(row.comparisons) || row.comparisons.length > 30 || row.comparisons.some(item => !item || !text(item.id, 64) || !/^[a-z0-9][a-z0-9_-]*$/.test(item.id) || !text(item.name, 120) || !cents(item.uberCents) || item.uberCents === 0 || !cents(item.webCents))
    || row.comparisons.length > 0 && row.verifiedAt == null
    || new Set(row.comparisons.map(item => item.id)).size !== row.comparisons.length
    || row.promoCode != null && (!text(row.promoCode, 40) || !/^[A-Za-z0-9_-]+$/.test(row.promoCode))) return invalid();
  let checkoutComparison: CheckoutComparison | null = null;
  if (row.checkoutComparison != null) {
    const comparison = row.checkoutComparison;
    if (!instant(comparison.verifiedAt) || !['delivery', 'pickup'].includes(comparison.fulfillment) || !text(comparison.basketLabel) || comparison.sameConditionsConfirmed !== true) invalid();
    checkoutComparison = { verifiedAt: comparison.verifiedAt, fulfillment: comparison.fulfillment, basketLabel: comparison.basketLabel,
      sameConditionsConfirmed: true, uber: quote(comparison.uber), webshop: quote(comparison.webshop) };
  }
  return { merchantId: row.merchantId.toLowerCase(), cityId: row.cityId, url, provider: 'uber', placeKeys: [...row.placeKeys],
    comparisons: row.comparisons.map(item => ({ id: item.id, name: item.name, uberCents: item.uberCents, webCents: item.webCents })),
    verifiedAt: row.verifiedAt, promoCode: row.promoCode ?? null, checkoutComparison };
}

export function compareWebshopPrices(shop: Webshop) {
  const items = shop.comparisons.map(item => ({ ...item, savingCents: item.uberCents - item.webCents,
    percent: Number(((item.uberCents - item.webCents) / item.uberCents * 100).toFixed(1)) }));
  const uberCents = items.reduce((sum, item) => sum + item.uberCents, 0), webCents = items.reduce((sum, item) => sum + item.webCents, 0);
  const checkout = shop.checkoutComparison;
  return { items, maximumPercent: Math.max(0, ...items.map(item => item.percent)), summary: checkout
    ? { kind: 'checkout' as const, uberCents: checkout.uber.totalCents, webCents: checkout.webshop.totalCents, savingCents: checkout.uber.totalCents - checkout.webshop.totalCents }
    : { kind: 'menu' as const, uberCents, webCents, savingCents: uberCents - webCents } };
}

export function parseBusinessPlaceLinks(value: unknown): Record<string, string> {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('INVALID_BUSINESS_PLACE_LINKS');
  const links: Record<string, string> = {};
  for (const row of value) {
    if (!row || !text(row.placeKey, 120) || !PLACE_KEY.test(row.placeKey) || typeof row.merchantId !== 'string' || !UUID.test(row.merchantId)
      || links[row.placeKey] && links[row.placeKey] !== row.merchantId.toLowerCase()) throw new Error('INVALID_BUSINESS_PLACE_LINKS');
    links[row.placeKey] = row.merchantId.toLowerCase();
  }
  return links;
}

export async function loadPublicWebshop(client: SupabaseClient, merchantId: string, signal?: AbortSignal): Promise<Webshop | null> {
  if (!UUID.test(merchantId)) invalid();
  const request = client.rpc('get_public_webshop', { p_merchant_id: merchantId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error?.code === 'PGRST202') return null;
  if (error) throw error;
  const shop = parseWebshop(data);
  if (shop && shop.merchantId !== merchantId.toLowerCase()) invalid();
  return shop;
}

export async function loadCityBusinessLinks(client: SupabaseClient, cityId: string, signal?: AbortSignal) {
  const request = client.rpc('get_city_business_links', { p_city_id: cityId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error?.code === 'PGRST202') return {};
  if (error) throw error;
  return parseBusinessPlaceLinks(data);
}

export async function loadCityWebshops(client: SupabaseClient, cityId: string, signal?: AbortSignal): Promise<Webshop[]> {
  const request = client.rpc('get_city_webshops', { p_city_id: cityId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error?.code === 'PGRST202') return [];
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 1000) return invalid();
  return data.map(value => { const shop = parseWebshop(value); return shop?.cityId === cityId ? shop : invalid(); });
}

export function bindBusinessPlaces(items: DiscoveryItem[], links: Record<string, string>, shops: Webshop[]): DiscoveryItem[] {
  const result: DiscoveryItem[] = [], branches = new Map<string, number>();
  const byMerchant = new Map(shops.map(shop => [shop.merchantId, shop]));
  for (const item of items) {
    const merchantId = item.source === 'place' ? links[item.place?.id ?? (item.id.startsWith('partner:') ? item.id : item.sourceId)] : undefined;
    const shop = merchantId ? byMerchant.get(merchantId) : undefined;
    const discount = shop?.cityId === item.cityId ? compareWebshopPrices(shop).maximumPercent : 0;
    const next = { ...item, ...(merchantId ? { merchantId } : {}), delivery: discount > 0, webshopDiscount: discount };
    const branch = merchantId ? `${item.cityId}:${merchantId}` : '', existing = branches.get(branch);
    if (branch && existing !== undefined) {
      if (item.glingVisited) result[existing] = { ...result[existing], glingVisited: item.glingVisited };
    } else { if (branch) branches.set(branch, result.length); result.push(next); }
  }
  return result;
}

// Correlation only, never an authentication credential; expires with this app process/page.
const session = `webshop-${merchantEventId()}`;
export function webshopRedirectUrl(origin: string, merchantId: string, context: { eventId: string; session: string; platform: WebshopPlatform; source: WebshopSource }) {
  let base: URL;
  try { base = new URL(origin); } catch { return invalid(); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)
    || !UUID.test(merchantId) || !UUID.test(context.eventId) || !/^[A-Za-z0-9_-]{20,80}$/.test(context.session)
    || !['ios', 'android', 'web'].includes(context.platform) || !['business_profile', 'comparison_sheet', 'map', 'place_detail'].includes(context.source)) invalid();
  const url = new URL('/functions/v1/webshop-redirect', base);
  url.search = new URLSearchParams({ merchantId, eventId: context.eventId, session: context.session, platform: context.platform, source: context.source }).toString();
  return url.href;
}

export const webshopOrderUrl = (merchantId: string, platform: WebshopPlatform) => webshopRedirectUrl(process.env.EXPO_PUBLIC_SUPABASE_URL!, merchantId,
  { eventId: merchantEventId(), session, platform, source: 'comparison_sheet' });

export async function recordWebshopSheetView(client: SupabaseClient, merchantId: string, platform: WebshopPlatform) {
  try {
    const { error } = await client.rpc('record_webshop_event', { p_merchant_id: merchantId, p_event_id: merchantEventId(), p_session: session,
      p_platform: platform, p_source: 'business_profile', p_kind: 'sheet_view' });
    return !error;
  } catch { return false; }
}
