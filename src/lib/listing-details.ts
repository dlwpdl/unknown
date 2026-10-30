import { translateUi } from '../i18n/index.ts';
import type { AppLanguage } from '../i18n/language.ts';
import { coarseListingPin, findNeighborhood, neighborhoodName } from './neighborhoods.ts';
import { googleMapsPin, postMapBody } from './post-maps.ts';
import type { ListingStatus, Post } from './types.ts';

// Category fields for 부동산·구인구직·중고거래 (owner-approved mockup 2026-10-27, direction A).
// They are additive: the post body starts with a one-line lead that carries the same facts, so 1.4.4/1.4.5
// (which never read posts.listing_details) still show everything. New apps show the card and drop the lead once.
export const LISTING_CATEGORIES = ['housing', 'jobs', 'used'] as const;
export type ListingCategory = typeof LISTING_CATEGORIES[number];
export const isListingCategory = (slug: string | null | undefined): slug is ListingCategory => (LISTING_CATEGORIES as readonly string[]).includes(slug ?? '');

export const HOUSING_DEALS = ['rent_offer', 'rent_wanted', 'sale', 'buy'] as const;
export const ROOMS = ['room', 'studio', '1b', '1b_den', '2b', '2b2b', '3b', 'basement'] as const;
export const HOUSING_INCLUDES = ['furnished', 'utilities', 'parking', 'pets'] as const;
export const JOB_DEALS = ['hiring', 'seeking'] as const;
export const PAY_UNITS = ['hour', 'month', 'year', 'negotiable'] as const;
export const JOB_TYPES = ['full', 'part', 'weekend', 'contract'] as const;
export const APPLY_WAYS = ['chat', 'email', 'phone', 'visit'] as const;
export const USED_DEALS = ['sell', 'buy'] as const;
export const CONDITIONS = ['new', 'like_new', 'used', 'parts'] as const;

export type HousingDeal = typeof HOUSING_DEALS[number];
export type Room = typeof ROOMS[number];
export type HousingInclude = typeof HOUSING_INCLUDES[number];
export type JobDeal = typeof JOB_DEALS[number];
export type PayUnit = typeof PAY_UNITS[number];
export type JobType = typeof JOB_TYPES[number];
export type ApplyWay = typeof APPLY_WAYS[number];
export type UsedDeal = typeof USED_DEALS[number];
export type Condition = typeof CONDITIONS[number];

// moveIn: 'now' or YYYY-MM-DD. area: a neighborhood id from neighborhoods.ts, never an address.
// extras: the author's own 포함된 것 items (≤5, ≤20 chars), shown only while they are in the body.
export type HousingDetails = { type: 'housing'; deal: HousingDeal; rooms?: Room; moveIn?: string; area?: string; includes?: HousingInclude[]; extras?: string[]; lead?: string };
// pay repeats posts.price for business job posts, which are published without a price.
export type JobsDetails = { type: 'jobs'; deal: JobDeal; payUnit?: PayUnit; pay?: number; jobTypes?: JobType[]; area?: string; hours?: string; duties?: string; apply?: ApplyWay[]; lead?: string };
export type UsedDetails = { type: 'used'; deal: UsedDeal; offers?: boolean; condition?: Condition; area?: string; lead?: string };
export type ListingDetails = HousingDetails | JobsDetails | UsedDetails;

// Korean source strings; English comes from ui-en through translateUi.
export const LISTING_LABELS = {
  housing: { rent_offer: '렌트 내놓음', rent_wanted: '렌트 구함', sale: '매매 판매', buy: '매매 구매' } satisfies Record<HousingDeal, string>,
  jobs: { hiring: '구인', seeking: '구직' } satisfies Record<JobDeal, string>,
  used: { sell: '팝니다', buy: '삽니다' } satisfies Record<UsedDeal, string>,
  rooms: { room: '방 한 칸', studio: '스튜디오', '1b': '1베드', '1b_den': '1+덴', '2b': '2베드', '2b2b': '2베드 2배스', '3b': '3베드 이상', basement: '베이스먼트' } satisfies Record<Room, string>,
  includes: { furnished: '가구 포함', utilities: '유틸 포함', parking: '주차', pets: '반려동물 가능' } satisfies Record<HousingInclude, string>,
  payUnit: { hour: '시급', month: '월급', year: '연봉', negotiable: '협의' } satisfies Record<PayUnit, string>,
  jobTypes: { full: '풀타임', part: '파트타임', weekend: '주말만', contract: '계약직' } satisfies Record<JobType, string>,
  apply: { chat: '글링 대화', email: '이메일', phone: '전화', visit: '직접 방문' } satisfies Record<ApplyWay, string>,
  condition: { new: '새 것', like_new: '거의 새 것', used: '사용감 있음', parts: '고장·부품용' } satisfies Record<Condition, string>,
};

export const dealLabel = (details: Pick<ListingDetails, 'type' | 'deal'>, language: AppLanguage) =>
  translateUi(language, (LISTING_LABELS[details.type] as Record<string, string>)[details.deal]);

export function formatMoney(value: number) {
  return `$${value.toLocaleString('en-CA', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatMoveIn(value: string, language: AppLanguage) {
  if (value === 'now') return translateUi(language, '바로');
  const [, month, day] = value.split('-').map(Number);
  return language === 'en' ? `${MONTHS[month - 1]} ${day}` : `${month}월 ${day}일`;
}

export const areaName = (cityId: string, area: string | undefined, language: AppLanguage) => {
  const item = findNeighborhood(cityId, area);
  return item ? neighborhoodName(item, language) : null;
};

// Price as a card shows it: "$2,150/월", "예산 ~$1,900/월", "$17.85/시간", "무료 나눔".
export function listingPriceLabel(details: ListingDetails, price: number | null | undefined, language: AppLanguage): string | null {
  const t = (text: string, ...values: unknown[]) => translateUi(language, text, ...values);
  if (details.type === 'jobs') {
    if (details.payUnit === 'negotiable') return t('급여 협의');
    const pay = price ?? details.pay;
    if (pay == null || !details.payUnit) return null;
    const amount = t(({ hour: '{0}/시간', month: '{0}/월', year: '{0}/년' } as const)[details.payUnit], formatMoney(pay));
    return details.deal === 'seeking' ? t('희망 {0}', amount) : amount;
  }
  if (details.type === 'used') {
    if (price == null) return null;
    if (details.deal === 'buy') return t('희망 ~{0}', formatMoney(price));
    return price === 0 ? t('무료 나눔') : formatMoney(price);
  }
  if (price == null) return null;
  const rent = details.deal === 'rent_offer' || details.deal === 'rent_wanted';
  const amount = rent ? t('{0}/월', formatMoney(price)) : formatMoney(price);
  return details.deal === 'rent_wanted' || details.deal === 'buy' ? t('예산 ~{0}', amount) : amount;
}

function includesText(includes: readonly HousingInclude[], language: AppLanguage) {
  if (language === 'en') return includes.map(item => translateUi('en', LISTING_LABELS.includes[item])).join(', ');
  const covered = includes.filter(item => item === 'furnished' || item === 'utilities').map(item => item === 'furnished' ? '가구' : '유틸');
  return [covered.length ? `${covered.join('·')} 포함` : '', ...includes.filter(item => item === 'parking' || item === 'pets').map(item => LISTING_LABELS.includes[item])].filter(Boolean).join(', ');
}

// The first line(s) written into the body. Old app versions read only this text.
export function buildListingLead(details: ListingDetails, input: { title: string; price: number | null; cityId: string }, language: AppLanguage) {
  const t = (text: string, ...values: unknown[]) => translateUi(language, text, ...values);
  const area = areaName(input.cityId, details.area, language);
  const parts: (string | null | undefined)[] = [dealLabel(details, language)];
  const extra: string[] = [];
  if (details.type === 'housing') {
    parts.push(details.rooms && t(LISTING_LABELS.rooms[details.rooms]), listingPriceLabel(details, input.price, language),
      details.moveIn && (details.moveIn === 'now' ? t('바로 입주') : t('{0}부터', formatMoveIn(details.moveIn, language))), area,
      // Extras go in verbatim: the server accepts them only while the body contains them.
      [details.includes?.length ? includesText(details.includes, language) : '', ...details.extras ?? []].filter(Boolean).join(', '));
  } else if (details.type === 'jobs') {
    // Korean reads "시급 $17.85"; English reads "$17.85/hr" like the card.
    const pay = language === 'ko' && details.payUnit && details.payUnit !== 'negotiable' && input.price != null
      ? `${details.deal === 'seeking' ? '희망 ' : ''}${LISTING_LABELS.payUnit[details.payUnit]} ${formatMoney(input.price)}`
      : listingPriceLabel(details, input.price, language);
    parts.push(input.title.trim(), pay, details.jobTypes?.map(item => t(LISTING_LABELS.jobTypes[item])).join(', '), area, details.hours);
    if (details.duties) extra.push(`${t('하는 일')}: ${details.duties}`);
    if (details.apply?.length) extra.push(`${t('지원 방법')}: ${details.apply.map(item => t(LISTING_LABELS.apply[item])).join(', ')}`);
  } else {
    parts.push(listingPriceLabel(details, input.price, language), details.condition && t(LISTING_LABELS.condition[details.condition]), area, details.offers ? t('가격 제안 받아요') : null);
  }
  return [parts.filter(Boolean).join(' · '), ...extra].join('\n');
}

export const withListingLead = (lead: string, body: string) => body.trim() ? `${lead}\n\n${body.trim()}` : lead;

// New apps show the fields, so the lead is dropped once. An edited lead no longer matches and stays visible.
export function stripListingLead(body: string, details: ListingDetails | null | undefined) {
  if (!details?.lead || !body.startsWith(details.lead)) return body;
  return body.slice(details.lead.length).trimStart();
}

// ---- composer draft ---------------------------------------------------------------------------
export type ListingDraft = {
  deal: string; rooms: Room | null; moveIn: string | null; area: string | null; includes: HousingInclude[]; extras: string[];
  payUnit: PayUnit; jobTypes: JobType[]; hours: string; duties: string; apply: ApplyWay[];
  condition: Condition | null; offers: boolean; free: boolean; price: string;
};
export const emptyListingDraft = (category: ListingCategory): ListingDraft => ({
  deal: category === 'housing' ? 'rent_offer' : category === 'jobs' ? 'hiring' : 'sell',
  rooms: null, moveIn: null, area: null, includes: [], extras: [], payUnit: 'hour', jobTypes: [], hours: '', duties: '', apply: [],
  condition: null, offers: false, free: false, price: '',
});
export type ListingMissing = 'deal' | 'rooms' | 'area' | 'price' | 'condition';

const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const MAX_LISTING_EXTRAS = 5;
const PRESET_INCLUDES = new Set(HOUSING_INCLUDES.flatMap(item => [LISTING_LABELS.includes[item], translateUi('en', LISTING_LABELS.includes[item])].map(label => label.toLowerCase())));
// Cleans the author's own 포함된 것 items: 1–20 chars, no repeats or preset names, at most 5. Longer text is dropped, not cut.
export function listingExtras(list: readonly unknown[]): string[] {
  const kept: string[] = [];
  for (const item of list) {
    const text = typeof item === 'string' ? clean(item, 21) : '';
    const key = text.toLowerCase();
    if (text && text.length <= 20 && !PRESET_INCLUDES.has(key) && !kept.some(entry => entry.toLowerCase() === key) && kept.length < MAX_LISTING_EXTRAS) kept.push(text);
  }
  return kept;
}
const pick = <T extends string>(values: readonly T[], value: unknown): T | undefined => values.includes(value as T) ? value as T : undefined;
const pickAll = <T extends string>(values: readonly T[], list: unknown) => Array.isArray(list) ? values.filter(value => list.includes(value)) : [];
export function parsePrice(text: string): number | null {
  const value = text.replace(/[,\s$]/g, '');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  return Number(value);
}

export function listingFromDraft(category: ListingCategory, draft: ListingDraft, input: { title: string; cityId: string }, language: AppLanguage):
  { details: ListingDetails; price: number | null; missing: ListingMissing[] } {
  const missing: ListingMissing[] = [];
  const area = findNeighborhood(input.cityId, draft.area)?.id;
  const typed = draft.price.trim() ? parsePrice(draft.price) : null;
  if (draft.price.trim() && typed == null) missing.push('price');
  let details: ListingDetails, price = typed;
  if (category === 'housing') {
    const deal = pick(HOUSING_DEALS, draft.deal) ?? 'rent_offer';
    details = { type: 'housing', deal, rooms: draft.rooms ?? undefined, moveIn: draft.moveIn ?? undefined, area, includes: pickAll(HOUSING_INCLUDES, draft.includes), extras: listingExtras(draft.extras ?? []) };
    if (!draft.rooms) missing.push('rooms');
    if ((deal === 'rent_offer' || deal === 'sale') && price == null && !missing.includes('price')) missing.push('price');
    if (!area) missing.push('area');
  } else if (category === 'jobs') {
    const deal = pick(JOB_DEALS, draft.deal) ?? 'hiring';
    details = { type: 'jobs', deal, payUnit: draft.payUnit, jobTypes: pickAll(JOB_TYPES, draft.jobTypes), area,
      hours: clean(draft.hours, 40) || undefined, duties: clean(draft.duties, 200) || undefined, apply: deal === 'hiring' ? pickAll(APPLY_WAYS, draft.apply) : [] };
    if (draft.payUnit === 'negotiable') price = null;
    else if (deal === 'hiring' && price == null && !missing.includes('price')) missing.push('price');
    details.pay = price ?? undefined;
    if (deal === 'hiring' && !area) missing.push('area');
  } else {
    const deal = pick(USED_DEALS, draft.deal) ?? 'sell';
    if (deal === 'sell' && draft.free) price = 0;
    details = { type: 'used', deal, offers: deal === 'sell' && !draft.free && draft.offers, condition: deal === 'sell' ? draft.condition ?? undefined : undefined, area };
    if (deal === 'sell' && price == null && !missing.includes('price')) missing.push('price');
    if (deal === 'sell' && !draft.condition) missing.push('condition');
    if (!area) missing.push('area');
  }
  details = compact(details);
  return { details: { ...details, lead: buildListingLead(details, { title: input.title, price, cityId: input.cityId }, language) }, price, missing };
}

function compact<T extends ListingDetails>(details: T): T {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0))) as T;
}

// ---- reading (posts.listing_details is untrusted JSON) -----------------------------------------
export function parseListingDetails(raw: unknown, body: string): ListingDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const area = typeof value.area === 'string' && /^[a-z0-9-]{1,40}$/.test(value.area) ? value.area : undefined;
  // Free text is shown only while the same words are in the body, which the safety monitoring reads.
  const text = (field: unknown, max: number) => typeof field === 'string' && field.length <= max && !/[\u0000-\u001f\u007f]/.test(field) && field.trim() && body.includes(field) ? field : undefined;
  const lead = typeof value.lead === 'string' && value.lead.length <= 600 && body.startsWith(value.lead) ? value.lead : undefined;
  let details: ListingDetails;
  if (value.type === 'housing') {
    const deal = pick(HOUSING_DEALS, value.deal);
    if (!deal) return null;
    const moveIn = value.moveIn === 'now' || (typeof value.moveIn === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value.moveIn)) ? value.moveIn as string : undefined;
    const extras = Array.isArray(value.extras) ? listingExtras(value.extras.filter(item => text(item, 20) === item)).filter(item => body.includes(item)) : [];
    details = { type: 'housing', deal, rooms: pick(ROOMS, value.rooms), moveIn, area, includes: pickAll(HOUSING_INCLUDES, value.includes), extras };
  } else if (value.type === 'jobs') {
    const deal = pick(JOB_DEALS, value.deal);
    if (!deal) return null;
    const pay = typeof value.pay === 'number' && Number.isFinite(value.pay) && value.pay >= 0 && value.pay < 1e8 ? value.pay : undefined;
    details = { type: 'jobs', deal, payUnit: pick(PAY_UNITS, value.payUnit), pay, jobTypes: pickAll(JOB_TYPES, value.jobTypes), area,
      hours: text(value.hours, 40), duties: text(value.duties, 200), apply: pickAll(APPLY_WAYS, value.apply) };
  } else if (value.type === 'used') {
    const deal = pick(USED_DEALS, value.deal);
    if (!deal) return null;
    details = { type: 'used', deal, offers: value.offers === true, condition: pick(CONDITIONS, value.condition), area };
  } else return null;
  return { ...compact(details), ...(lead ? { lead } : {}) };
}

// Status names: job posts say 마감 instead of 거래 완료.
export function listingStatusLabel(category: ListingCategory, status: ListingStatus | undefined) {
  if (category === 'jobs') return status === 'closed' ? '마감' : '모집 중';
  return status === 'closed' ? '거래 완료' : status === 'partial' ? '일부 판매' : '거래 중';
}

// ---- map ---------------------------------------------------------------------------------------
export type ListingPin = { key: string; latitude: number; longitude: number; name: string | null };
// Neighborhood centre only. Older posts with an exact pin are snapped too, so no listing shows a home or meeting point.
export function listingPin(post: Pick<Post, 'cityId' | 'body' | 'listingDetails'>, language: AppLanguage): ListingPin | null {
  const area = findNeighborhood(post.cityId, post.listingDetails?.area);
  if (area) return { key: area.id, latitude: area.latitude, longitude: area.longitude, name: neighborhoodName(area, language) };
  const mapped = postMapBody(post.body), pin = mapped.url ? googleMapsPin(mapped.url) : null;
  if (!pin) return null;
  const coarse = coarseListingPin(post.cityId, pin);
  return { key: coarse.neighborhood?.id ?? `${coarse.latitude},${coarse.longitude}`, latitude: coarse.latitude, longitude: coarse.longitude,
    name: coarse.neighborhood ? neighborhoodName(coarse.neighborhood, language) : null };
}

export type ListingArea<P> = { id: string; latitude: number; longitude: number; name: string | null; label: string; posts: P[] };
export function groupListingsByArea<P extends Pick<Post, 'cityId' | 'body' | 'listingDetails' | 'price'>>(posts: readonly P[], language: AppLanguage): ListingArea<P>[] {
  const areas = new Map<string, ListingArea<P>>();
  for (const post of posts) {
    const pin = listingPin(post, language);
    if (!pin) continue;
    const area = areas.get(pin.key) ?? { id: `area:${pin.key}`, latitude: pin.latitude, longitude: pin.longitude, name: pin.name, label: '', posts: [] };
    area.posts.push(post);
    areas.set(pin.key, area);
  }
  return [...areas.values()].map(area => {
    const [only] = area.posts, price = area.posts.length === 1 && only.listingDetails ? listingPriceLabel(only.listingDetails, only.price, language) : null;
    const name = area.name ?? translateUi(language, '이 근처');
    return { ...area, label: area.posts.length > 1 ? `${name} · ${area.posts.length}` : price ?? name };
  });
}

export type MapBounds = { west: number; south: number; east: number; north: number };
export const inBounds = (bounds: MapBounds, point: { latitude: number; longitude: number }) =>
  point.latitude >= bounds.south && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east;

// ---- filters (shared by list and map) ----------------------------------------------------------
// 부동산 렌트·매매: rent covers 렌트 내놓음/구함, sale covers 매매 판매/구매.
export type HousingMarket = 'rent' | 'sale';
export const housingMarket = (deal: HousingDeal): HousingMarket => deal === 'rent_offer' || deal === 'rent_wanted' ? 'rent' : 'sale';
export type ListingFilters = { market: HousingMarket | null; rooms: Room[]; maxPrice: number | null; moveInBy: string | null; deal: UsedDeal | null; conditions: Condition[];
  jobDeal: JobDeal | null; jobTypes: JobType[]; minWage: number | null; area: string | null };
export const NO_LISTING_FILTERS: ListingFilters = { market: null, rooms: [], maxPrice: null, moveInBy: null, deal: null, conditions: [], jobDeal: null, jobTypes: [], minWage: null, area: null };
export const listingFiltersActive = (filters: ListingFilters) => filters.market != null || filters.rooms.length > 0 || filters.maxPrice != null || filters.moveInBy != null || filters.deal != null || filters.conditions.length > 0
  || filters.jobDeal != null || filters.jobTypes.length > 0 || filters.minWage != null || filters.area != null;

export function matchesListingFilters(post: Pick<Post, 'price' | 'listingDetails'>, filters: ListingFilters, today: string) {
  if (!listingFiltersActive(filters)) return true;
  const details = post.listingDetails;
  if (!details) return false; // a post without fields cannot prove it matches
  if (filters.maxPrice != null && (post.price == null || post.price > filters.maxPrice)) return false;
  if (filters.area && details.area !== filters.area) return false;
  if (details.type === 'housing') {
    if (filters.market && housingMarket(details.deal) !== filters.market) return false;
    if (filters.rooms.length && (!details.rooms || !filters.rooms.includes(details.rooms))) return false;
    if (filters.moveInBy && (!details.moveIn || (details.moveIn === 'now' ? today : details.moveIn) > filters.moveInBy)) return false;
  }
  if (details.type === 'used') {
    if (filters.deal && details.deal !== filters.deal) return false;
    if (filters.conditions.length && (!details.condition || !filters.conditions.includes(details.condition))) return false;
  }
  if (details.type === 'jobs') {
    if (filters.jobDeal && details.deal !== filters.jobDeal) return false;
    if (filters.jobTypes.length && !details.jobTypes?.some(item => filters.jobTypes.includes(item))) return false;
    // Only hourly pay can be compared with a 시급 floor; 월급·연봉·협의 posts drop out.
    const pay = details.pay ?? post.price;
    if (filters.minWage != null && (details.payUnit !== 'hour' || pay == null || pay < filters.minWage)) return false;
  }
  return true;
}

// ---- 중고거래 list/grid choice, remembered per device ----------------------------------------
export type ListingView = 'list' | 'grid';
export const LISTING_VIEW_KEY = 'gling.listing.used.view';
// Separate from 중고거래: photo-first goods and text-first business news are chosen independently.
export const BUSINESS_VIEW_KEY = 'gling.business.view';
export const parseListingView = (value: string | null): ListingView => value === 'grid' ? 'grid' : 'list';
