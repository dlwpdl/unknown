// Reads the OpenStreetMap `opening_hours` values the place catalog already carries.
// Only weekday rules, time ranges, off/closed, 24/7 and the ; and , rule separators are read.
// Anything else (dates, months, sunrise, comments, open ends like 17:00+) stays unknown and is never guessed.
// shortcut: PH (public holiday) rules are skipped, so a holiday can show a place as open; add a holiday calendar if that matters.

/** Index 0 is Monday. Minutes from that day's midnight; an end past 1440 runs into the next morning. */
export type WeekHours = [number, number][][];
export type LocalClock = { day: number; minutes: number };

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)';
const SELECTOR = new RegExp(`^${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*$`);
const TIME = '(?:[01]\\d|2[0-4]):[0-5]\\d';
const RANGES = new RegExp(`^${TIME}-${TIME}(?:,${TIME}-${TIME})*$`);

export const CITY_TIME_ZONES: Record<string, string> = {
  vancouver: 'America/Vancouver', toronto: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto',
  calgary: 'America/Edmonton', edmonton: 'America/Edmonton', winnipeg: 'America/Winnipeg', saskatoon: 'America/Regina',
  regina: 'America/Regina', 'saint-john': 'America/Moncton', halifax: 'America/Halifax',
};

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function days(selector: string): number[] | null {
  const picked = new Set<number>();
  for (const part of selector.split(',')) {
    if (part === 'PH') continue;
    const [from, to = from] = part.split('-');
    if (from === 'PH' || to === 'PH') return null;
    const start = DAYS.indexOf(from), end = DAYS.indexOf(to);
    for (let day = start; ; day = (day + 1) % 7) { picked.add(day); if (day === end) break; }
  }
  return [...picked];
}

function ranges(text: string): [number, number][] | null {
  const result: [number, number][] = [];
  for (const range of text.split(',')) {
    const [from, to] = range.split('-'), start = minutes(from);
    let end = minutes(to);
    if (start >= 1440 || end > 1440) return null;
    if (end <= start) end += 1440;
    result.push([start, end]);
  }
  return result;
}

const cache = new Map<string, WeekHours | null>();
export function parseOpeningHours(value: unknown): WeekHours | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return null;
  if (cache.has(value)) return cache.get(value)!;
  const result = parse(value.trim());
  if (cache.size < 2000) cache.set(value, result);
  return result;
}

function parse(text: string): WeekHours | null {
  if (text === '24/7') return DAYS.map(() => [[0, 1440]]);
  const week: WeekHours = DAYS.map(() => []);
  let sawRule = false;
  for (const group of text.split(';')) {
    // A comma before a weekday starts an additional rule only after times or off; otherwise it continues the day list (Sa, Su 10:00-17:00).
    const rules: string[] = [];
    for (const piece of group.split(new RegExp(`,(?=\\s*${DAY}\\b)`))) {
      const previous = rules.at(-1);
      if (previous !== undefined && !/\d|\b(?:off|closed)$/.test(previous)) rules[rules.length - 1] = `${previous},${piece.trim()}`;
      else rules.push(piece.trim());
    }
    for (const [index, rule] of rules.entries()) {
      const match = /^(?:(\S+)\s+)?(\d\S*|off|closed)$/.exec(rule.replace(/,\s+/g, ','));
      if (!match) return null;
      const [, selector, times] = match;
      if (selector !== undefined && !SELECTOR.test(selector)) return null;
      const selected = selector === undefined ? [0, 1, 2, 3, 4, 5, 6] : days(selector);
      if (!selected) return null;
      const closed = times === 'off' || times === 'closed';
      const open = closed ? [] : RANGES.test(times) ? ranges(times) : null;
      if (!open) return null;
      if (!selected.length) continue; // PH-only rule
      sawRule = true;
      for (const day of selected) week[day] = index === 0 || closed ? [...open] : [...week[day], ...open];
    }
  }
  return sawRule ? week : null;
}

const clocks = new Map<string, Intl.DateTimeFormat>();
export function localClock(timeZone: string, now = Date.now()): LocalClock {
  let format = clocks.get(timeZone);
  if (!format) { format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); clocks.set(timeZone, format); }
  const parts = Object.fromEntries(format.formatToParts(now).map(part => [part.type, part.value]));
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isOpenAt(hours: WeekHours, { day, minutes: at }: LocalClock): boolean {
  return hours[day].some(([start, end]) => start <= at && at < end) || hours[(day + 6) % 7].some(([, end]) => at + 1440 < end);
}

/** Minutes until a place that is open now closes; null when it is closed or never closes.
 *  A range that ends at or past midnight carries on when the next day opens right then (24/7, 00:00–24:00 days, 18:00–24:00 then 00:00–00:30). */
export function minutesUntilClose(hours: WeekHours, { day, minutes: at }: LocalClock): number | null {
  const today = hours[day].find(([start, end]) => start <= at && at < end);
  const range = today ?? hours[(day + 6) % 7].find(([, end]) => at + 1440 < end);
  if (!range) return null;
  // offset: the range's day relative to today; end: minutes from that day's midnight.
  let offset = today ? 0 : -1, end = range[1];
  for (let step = 0; end >= 1440; step++) {
    if (step === 7) return null;
    const next = hours[(day + offset + 8) % 7].find(([start]) => start === end - 1440);
    if (!next) break;
    offset++; end = next[1];
  }
  return offset * 1440 + end - at;
}

export const cityClock = (cityId: string, now = Date.now()) => Object.hasOwn(CITY_TIME_ZONES, cityId) ? localClock(CITY_TIME_ZONES[cityId], now) : null;

/** open/closed only when the catalog value can be read; everything else is unknown. */
export function openState(openingHours: unknown, clock: LocalClock | null): 'open' | 'closed' | 'unknown' {
  const hours = parseOpeningHours(openingHours);
  return !hours || !clock ? 'unknown' : isOpenAt(hours, clock) ? 'open' : 'closed';
}

// Minutes are wall-clock numbers, so UTC only keeps the formatter from shifting them.
// One formatter per locale (map lag 2026-11-11): building one per time cost about 28 on every list render.
const times = new Map<string, Intl.DateTimeFormat>();
export function formatTime(value: number, locale?: string) {
  let format = times.get(locale ?? '');
  if (!format) { format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }); times.set(locale ?? '', format); }
  return format.format((value % 1440) * 60000);
}
export const formatRanges = (day: [number, number][], locale?: string) => day.map(([start, end]) => `${formatTime(start, locale)}–${formatTime(end, locale)}`).join(', ');
