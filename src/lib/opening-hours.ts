// Reads the OpenStreetMap `opening_hours` values the place catalog already carries.
// Weekday, month and date rules (Jun-Aug:, Dec 25,26, Jun 26-Sep 07), time ranges ending by 48:00, off/closed, 24/7 and the ; and , rule separators are read.
// Anything else (week-of-month offsets like Sep Mo[1], sunrise, comments, open ends like 17:00+, long day names) stays unknown and is never guessed.
// shortcut: PH (public holiday) rules are skipped, so a holiday can show a place as open; add a holiday calendar if that matters.

/** Index 0 is Monday. Minutes from that day's midnight; an end past 1440 runs into the next morning. */
export type WeekHours = [number, number][][];
/** day is the weekday (0 = Monday); year, month (1-12) and date are the city's calendar day, which month and date rules need. */
export type LocalClock = { day: number; minutes: number; year: number; month: number; date: number };

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)';
const SELECTOR = new RegExp(`^${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*$`);
const TIME = '(?:[0-3]\\d|4[0-8]):[0-5]\\d';
const RANGES = new RegExp(`^${TIME}-${TIME}(?:,${TIME}-${TIME})*$`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = `(?:${MONTHS.join('|')})`, MONTH_WORD = new RegExp(`\\b${MONTH}\\b`);
const DOM = '(?:[12]\\d|3[01]|0?[1-9])';
const DATE = `${MONTH}(?:-${MONTH}| ${DOM}(?:-(?:${MONTH} )?${DOM})?)?`;
const RULE = new RegExp(`^(?:(${DATE}(?:,(?:${DATE}|${DOM}(?:-${DOM})?))*):?\\s+)?(?:(\\S+)\\s+)?(\\d\\S*|off|closed)$`);

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
    if (start >= 1440 || end > 2880) return null;
    if (end <= start) end += 1440;
    result.push([start, end]);
  }
  return result;
}

// Each item becomes [from, to] in month * 100 + day, so Dec 25 is 1225 and Sep-Apr wraps the new year; a bare day (Dec 25,26) keeps the last month.
function dateRanges(text: string): [number, number][] | null {
  const result: [number, number][] = [];
  let month = 0;
  for (const item of text.split(',')) {
    const [from, to = from] = item.split('-').map(end => {
      const [, name, day] = /^([A-Z][a-z]{2})? ?(\d*)$/.exec(end)!;
      if (name) month = MONTHS.indexOf(name) + 1;
      return { month, day: Number(day) };
    });
    const start = from.month * 100 + (from.day || 1), end = to.month * 100 + (to.day || 31);
    if (end < start && to.month === from.month) return null; // Dec 25-03 has no clear meaning
    result.push([start, end]);
  }
  return result;
}

// A range joins every range it overlaps or touches, so a day never lists the same hours twice.
const add = (day: [number, number][], range: [number, number]): [number, number][] => {
  const apart = day.filter(([from, to]) => to < range[0] || range[1] < from);
  const joined = day.filter(item => !apart.includes(item)).reduce(([start, end], [from, to]) => [Math.min(start, from), Math.max(end, to)], range);
  return [...apart, joined];
};

const cache = new Map<string, WeekHours | null>();
/** Month and date rules are read for the week holding `today` (the city's clock); without it a value that has them stays unknown. */
export function parseOpeningHours(value: unknown, today?: LocalClock | null): WeekHours | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return null;
  const monday = today ? Date.UTC(today.year, today.month - 1, today.date - today.day) : undefined;
  const key = monday !== undefined && MONTH_WORD.test(value) ? `${monday} ${value}` : value;
  if (cache.has(key)) return cache.get(key)!;
  const result = parse(value.trim(), monday);
  if (cache.size < 2000) cache.set(key, result);
  return result;
}

// shortcut: Monday's small hours borrow this week's Sunday (isOpenAt wraps the week), so a date rule on last Sunday can be off for that night; carry last Sunday if that matters.
function parse(text: string, monday?: number): WeekHours | null {
  if (text === '24/7') return DAYS.map(() => [[0, 1440]]);
  const week: WeekHours = DAYS.map(() => []);
  const calendar = monday === undefined ? undefined : DAYS.map((_, day) => { const date = new Date(monday + day * 86400000); return (date.getUTCMonth() + 1) * 100 + date.getUTCDate(); });
  // A value made only of single-date lines (Dec 24 11:00-17:00; Dec 25 off) lists holidays and says nothing about a normal week.
  let sawRule = false, general = false;
  for (const group of text.split(';')) {
    // A comma before a weekday starts an additional rule only after times or off; otherwise it continues the day list (Sa, Su 10:00-17:00).
    const rules: string[] = [];
    for (const piece of group.split(new RegExp(`,(?=\\s*${DAY}\\b)`))) {
      const previous = rules.at(-1);
      if (previous !== undefined && !/\d|\b(?:off|closed)$/.test(previous)) rules[rules.length - 1] = `${previous},${piece.trim()}`;
      else rules.push(piece.trim());
    }
    let dates: [number, number][] | null | undefined, dateText: string | undefined;
    for (const [index, rule] of rules.entries()) {
      const match = RULE.exec(rule.replace(/,\s+/g, ','));
      if (!match) return null;
      const [, ruleDates, selector, times] = match;
      // A , rule without months keeps the previous rule's: Jun-Aug: Mo-Fr 11:00-23:00, Sa-Su 10:00-23:00 means summer hours for every day.
      if (index === 0 || ruleDates !== undefined) { dateText = ruleDates; dates = dateText === undefined ? undefined : dateRanges(dateText); }
      if (dates === null || (dates && !calendar)) return null;
      if (selector !== undefined && !SELECTOR.test(selector)) return null;
      const selected = selector === undefined ? [0, 1, 2, 3, 4, 5, 6] : days(selector);
      if (!selected) return null;
      const closed = times === 'off' || times === 'closed';
      const open = closed ? [] : RANGES.test(times) ? ranges(times) : null;
      if (!open) return null;
      if (!selected.length) continue; // PH-only rule
      sawRule = true;
      if (!dateText || !/\d/.test(dateText)) general = true;
      for (const day of selected) {
        const date = calendar?.[day] ?? 0;
        if (dates && !dates.some(([from, to]) => from <= to ? from <= date && date <= to : date >= from || date <= to)) continue;
        week[day] = index === 0 || closed ? [...open] : open.reduce(add, week[day]);
      }
    }
  }
  return sawRule && general ? week : null;
}

const clocks = new Map<string, Intl.DateTimeFormat>();
export function localClock(timeZone: string, now = Date.now()): LocalClock {
  let format = clocks.get(timeZone);
  if (!format) { format = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); clocks.set(timeZone, format); }
  const parts = Object.fromEntries(format.formatToParts(now).map(part => [part.type, part.value]));
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute),
    year: Number(parts.year), month: Number(parts.month), date: Number(parts.day) };
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
    const ahead = Math.floor(end / 1440); // 48:00 ends two days on
    const next = hours[(day + offset + ahead + 7) % 7].find(([start]) => start === end - ahead * 1440);
    if (!next) break;
    offset += ahead; end = next[1];
  }
  return offset * 1440 + end - at;
}

export const cityClock = (cityId: string, now = Date.now()) => Object.hasOwn(CITY_TIME_ZONES, cityId) ? localClock(CITY_TIME_ZONES[cityId], now) : null;

/** open/closed only when the catalog value can be read; everything else is unknown. */
export function openState(openingHours: unknown, clock: LocalClock | null): 'open' | 'closed' | 'unknown' {
  const hours = parseOpeningHours(openingHours, clock);
  return !hours || !clock ? 'unknown' : isOpenAt(hours, clock) ? 'open' : 'closed';
}

// Minutes are wall-clock numbers, so UTC only keeps the formatter from shifting them.
export const formatTime = (value: number, locale?: string) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format((value % 1440) * 60000);
export const formatRanges = (day: [number, number][], locale?: string) => day.map(([start, end]) => `${formatTime(start, locale)}–${formatTime(end, locale)}`).join(', ');
