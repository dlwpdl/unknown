import { CITY_ZONE, clockZone } from './chilling-date.ts';

// owner 2026-11-12 "행사 표시: 진행": a festival post also stands as a schema.org Event, but only when its public text gives
// one start date ("2026년 11월 16일", optionally a day range or a same-day time) and at least one "Venue(street address)".
// Search engines require name, startDate and a location with a name and an address; anything vaguer stays a plain post.
// Posts carry no event fields of their own (the app's festival row reads a separate ticketing feed), so the text is the only source.
const REGION: Record<string, string> = { vancouver: 'BC', toronto: 'ON', montreal: 'QC' };
const WEEKDAY = '(?:\\s*\\([월화수목금토일]\\))?';
// 1-4 start (year, month, day, "일"), 5-7 range end (year, month, day), 8-11 same-day start and end time.
const WHEN = new RegExp(`^(20\\d\\d)년\\s*(\\d{1,2})월\\s*(\\d{1,2})(일${WEEKDAY})?(?:\\s*(?:부터|[–~-])\\s*(?:(20\\d\\d)년\\s*)?(?:(\\d{1,2})월\\s*)?(\\d{1,2})일${WEEKDAY}|[\\s·,]*(\\d{1,2}):(\\d{2})(?:\\s*[–~-]\\s*(\\d{1,2}):(\\d{2}))?)?`);
const WORD = "[A-ZÀ-Þ][A-Za-zÀ-ÿ0-9.'’&-]*";
const VENUE = new RegExp(`(${WORD}(?: (?:${WORD}|de|du|des|la|le|of|the|and|et))*)\\s*\\((\\d{1,6}[A-Za-z]?(?:-\\d{1,6})? [^()\\n…]{2,80})\\)`, 'g');
const STREET = /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|pl|place|lane|ln|cres|crescent|hwy|highway|sq|square|pkwy|parkway|ct|court|terrace|trail|mall|rue|chemin|côte|cote|quai)\b/i;

const pad = (value: number) => String(value).padStart(2, '0');
function day(year: number, month: number, date: number) {
  const at = Date.UTC(year, month - 1, date);
  const value = new Date(at);
  return value.getUTCMonth() === month - 1 && value.getUTCDate() === date ? { at, text: `${year}-${pad(month)}-${pad(date)}` } : null;
}
// The city's UTC offset that day, read at 12:00 UTC (early morning in Canada, after any 2 a.m. clock change).
function offset(zone: string, at: number) {
  const noon = at + 12 * 3600000;
  const name = new Intl.DateTimeFormat('en-US', { timeZone: clockZone(zone, noon), timeZoneName: 'longOffset' }).formatToParts(noon).find(part => part.type === 'timeZoneName')?.value ?? '';
  return /^GMT[+-]\d\d:\d\d$/.test(name) ? name.slice(3) : null;
}
const clock = (hour?: string, minute?: string) => hour != null && +hour < 24 && +minute! < 60 ? `${pad(+hour)}:${minute}` : null;

export function publicPostEvent(post: { id: string; title: string; cityId?: string | null; tagSlug?: string | null; text?: string | null; imageUrl?: string | null }, url: string) {
  const text = String(post.text ?? ''), zone = post.cityId ? CITY_ZONE[post.cityId] : undefined, region = post.cityId ? REGION[post.cityId] : undefined;
  if (post.tagSlug !== 'festival' || !zone || !region) return null;
  // The first year-dated day is the event's; a yearless day before it ("11월13일–2027년1월3일") would make that one the end.
  const first = text.search(/20\d\d년/), when = first < 0 ? null : WHEN.exec(text.slice(first));
  if (!when || /\d{1,2}월\s*\d{1,2}일/.test(text.slice(0, first))) return null;
  const start = day(+when[1], +when[2], +when[3]);
  const ranged = when[7] != null;
  // "17·18일" or a bare "17" is not one clear day.
  if (!start || (!ranged && !when[4])) return null;
  let startDate = start.text, endDate: string | undefined;
  if (ranged) {
    const end = day(+(when[5] ?? when[1]), +(when[6] ?? when[2]), +when[7]);
    if (!end || end.at <= start.at) return null;
    endDate = end.text;
  } else {
    const from = clock(when[8], when[9]), to = clock(when[10], when[11]), tz = from ? offset(zone, start.at) : null;
    if (from && tz) {
      startDate = `${start.text}T${from}:00${tz}`;
      if (to && to > from) endDate = `${start.text}T${to}:00${tz}`;
    }
  }
  // No addressLocality: a city feed's venue can sit in a neighbouring municipality; the text states only the street.
  const places = new Map<string, object>();
  for (const [, name, street] of text.matchAll(VENUE)) {
    if (STREET.test(street)) places.set(`${name}|${street}`, { '@type': 'Place', name, address: { '@type': 'PostalAddress', streetAddress: street.trim(), addressRegion: region, addressCountry: 'CA' } });
  }
  const name = post.title.split(/: | · | — | – | \| /)[0].trim();
  if (!places.size || !name) return null;
  return {
    '@type': 'Event', '@id': `${url}#event`, name, startDate, ...(endDate ? { endDate } : {}),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: places.size === 1 ? [...places.values()][0] : [...places.values()],
    ...(post.imageUrl ? { image: post.imageUrl } : {}),
  };
}
