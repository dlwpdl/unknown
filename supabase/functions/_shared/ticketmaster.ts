export const EVENT_CITIES = { vancouver: 'Vancouver', toronto: 'Toronto', montreal: 'Montreal', calgary: 'Calgary', edmonton: 'Edmonton' } as const;
export const EVENT_TIMEZONES = { vancouver: 'America/Vancouver', toronto: 'America/Toronto', montreal: 'America/Toronto', calgary: 'America/Edmonton', edmonton: 'America/Edmonton' } as const;
export const EVENT_CATEGORIES = { all: '', music: 'KZFzniwnSyZfZ7v7nJ', sports: 'KZFzniwnSyZfZ7v7nE', arts: 'KZFzniwnSyZfZ7v7na' } as const;
export type EventCity = keyof typeof EVENT_CITIES;
export type EventCategory = keyof typeof EVENT_CATEGORIES;
export type EventPriceFilter = 'all' | 'free' | 'under50' | 'under100' | 'unknown';
export type EventQuery = { cityId: EventCity; category: EventCategory; page: number; date?: string; month?: string; eventId?: string; festival?: true };
export type TicketmasterEvent = {
  id: string; name: string; ticketUrl: string | null; image: string | null; videoYoutubeId: string | null;
  startsAt: string | null; localDate: string | null; localTime: string | null; timezone: string | null;
  status: string; timeUnconfirmed: boolean; venue: string; city: string; country: string;
  price: { min: number; max: number; currency: string } | null; description: string | null;
};
export function parseEventQuery(value: unknown): EventQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['cityId', 'category', 'page', 'date', 'month', 'eventId', 'festival'].includes(key))) throw new Error('INVALID_INPUT');
  const { cityId, category = 'all', page = 0, date, month, eventId, festival } = input;
  const parsedDate = typeof date === 'string' ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const parsedMonth = typeof month === 'string' ? Date.parse(`${month}-01T00:00:00Z`) : NaN;
  const today = Math.floor(Date.now() / 86400000) * 86400000;
  if (typeof cityId !== 'string' || !Object.hasOwn(EVENT_CITIES, cityId) || typeof category !== 'string' || !Object.hasOwn(EVENT_CATEGORIES, category)
    || typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > 19
    || (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(parsedMonth)
      || new Date(parsedMonth).toISOString().slice(0, 7) !== month || parsedMonth < today - 32 * 86400000 || parsedMonth > today + 366 * 86400000 || page !== 0))
    || [date, month, eventId].filter(value => value !== undefined).length > 1
    || (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate)
      || new Date(parsedDate).toISOString().slice(0, 10) !== date || parsedDate < today - 86400000 || parsedDate > today + 366 * 86400000))
    || (eventId !== undefined && (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(eventId)))
    || (festival !== undefined && (festival !== true || category !== 'all' || page !== 0 || date !== undefined || month !== undefined || eventId !== undefined))) throw new Error('INVALID_INPUT');
  return { cityId: cityId as EventCity, category: category as EventCategory, page, ...(typeof date === 'string' ? { date } : {}), ...(typeof month === 'string' ? { month } : {}), ...(typeof eventId === 'string' ? { eventId } : {}), ...(festival === true ? { festival } : {}) };
}
export function localDayUtcRange(date: string, timezone: string): [string, string] {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const midnight = (day: string) => {
    const target = Date.parse(`${day}T00:00:00Z`);
    let instant = target;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, Number(part.value)]));
      instant += target - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    }
    return new Date(instant).toISOString().replace('.000Z', 'Z');
  };
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return [midnight(date), midnight(next)];
}
export function eventPriceLabel(event: TicketmasterEvent): string {
  if (!event.price) return '가격 정보 없음';
  if (event.price.min === 0) return '최저 무료 표시 · 판매처 확인';
  const amount = new Intl.NumberFormat('en-CA', { style: 'currency', currency: event.price.currency, maximumFractionDigits: 0 }).format(event.price.min);
  return `약 ${event.price.currency === 'CAD' ? `CA${amount}` : amount}부터`;
}
export function eventTime(event: TicketmasterEvent) {
  if (!event.startsAt || event.timeUnconfirmed || !event.timezone) return `${event.localDate ?? '날짜 미정'} · 시간 확정 전`;
  return new Date(event.startsAt).toLocaleString('ko-KR', { timeZone: event.timezone, month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
export function eventMatchesPriceFilter(event: TicketmasterEvent, filter: EventPriceFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'unknown') return !event.price;
  if (event.price?.currency !== 'CAD') return false;
  if (filter === 'free') return event.price.min === 0;
  return event.price.min <= (filter === 'under50' ? 50 : 100);
}
export function safeTicketUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    // Discovery may wrap approved affiliate links in its Ticketmaster tracking domain.
    const hosts = ['ticketmaster.ca', 'ticketmaster.com', 'ticketmaster.evyy.net', 'ticketmaster.prf.hn'];
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
  } catch { return null; }
}
function youtubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase();
    const id = host === 'youtu.be' ? url.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)
        ? url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1]
        : null;
    return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
type RawEvent = {
  id?: string; name?: string; url?: string; info?: string; images?: { url?: string; ratio?: string; width?: number }[];
  externalLinks?: { youtube?: { url?: string }[] };
  dates?: { start?: { dateTime?: string; localDate?: string; localTime?: string; dateTBD?: boolean; dateTBA?: boolean; timeTBA?: boolean; noSpecificTime?: boolean }; timezone?: string; status?: { code?: string } };
  _embedded?: { venues?: { name?: string; city?: { name?: string }; country?: { countryCode?: string }; timezone?: string }[]; attractions?: { externalLinks?: { youtube?: { url?: string }[] } }[] };
  priceRanges?: { min?: number; max?: number; currency?: string }[];
};
export function normalizeEvent(value: unknown): TicketmasterEvent {
  const raw = value as RawEvent;
  if (!raw || typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.id) || typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('INVALID_UPSTREAM');
  const start = raw.dates?.start;
  const venue = raw._embedded?.venues?.[0];
  const range = raw.priceRanges?.[0];
  const image = raw.images?.filter(item => typeof item.url === 'string' && item.url.startsWith('https://')).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
  const startsAt = start?.dateTime && Number.isFinite(Date.parse(start.dateTime)) ? start.dateTime : null;
  let timezone = raw.dates?.timezone ?? venue?.timezone ?? null;
  try { if (timezone) new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { timezone = null; }
  return {
    id: raw.id, name: raw.name.slice(0, 300), ticketUrl: safeTicketUrl(raw.url), image,
    videoYoutubeId: [raw.externalLinks?.youtube, ...(raw._embedded?.attractions ?? []).map(item => item.externalLinks?.youtube)]
      .flatMap(links => Array.isArray(links) ? links : []).map(link => youtubeVideoId(link?.url)).find(Boolean) ?? null, startsAt,
    localDate: start?.localDate ?? null, localTime: start?.localTime ?? null, timezone,
    status: raw.dates?.status?.code ?? 'unknown', timeUnconfirmed: !!(start?.dateTBD || start?.dateTBA || start?.timeTBA || start?.noSpecificTime || !startsAt || !timezone),
    venue: venue?.name?.slice(0, 200) ?? '', city: venue?.city?.name?.slice(0, 100) ?? '', country: venue?.country?.countryCode ?? '',
    price: range && typeof range.min === 'number' && typeof range.max === 'number' && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min >= 0 && range.max >= range.min && /^[A-Z]{3}$/.test(range.currency ?? '') ? { min: range.min, max: range.max, currency: range.currency! } : null,
    description: typeof raw.info === 'string' ? raw.info.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280) || null : null,
  };
}
export function meetupAllowed(event: TicketmasterEvent, now = Date.now()) {
  return event.country === 'CA' && event.status === 'onsale' && !event.timeUnconfirmed && !!event.startsAt && Date.parse(event.startsAt) > now && !!event.ticketUrl;
}
export function featuredLocalEvents(events: TicketmasterEvent[], now = Date.now()) {
  return events.filter(event => event.startsAt && Date.parse(event.startsAt) > now && !['canceled', 'cancelled', 'postponed'].includes(event.status)).slice(0, 5);
}
export function spotlightLocalEvents(events: TicketmasterEvent[], now = Date.now()) {
  return featuredLocalEvents([...events].sort((a, b) => Number(isFestivalEvent(b)) - Number(isFestivalEvent(a))), now).slice(0, 3);
}
export const isFestivalEvent = (event: TicketmasterEvent) => /festival|fest\b|페스티벌|축제/i.test(event.name);
// A body reference only offers navigation; the destination must fetch and verify the event again.
export function ticketmasterReference(body: string): string | null {
  return body.slice(0, 5000).match(/(?:^|\n)행사 ID: ([A-Za-z0-9_-]{1,100})(?:\r?\n|$)/)?.[1] ?? null;
}
