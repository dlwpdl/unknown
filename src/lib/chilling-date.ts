export function localDateInput(iso: string) {
  if (!iso) return '';
  const date = new Date(iso), pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(value);
  // Reject impossible calendar dates and local times skipped by daylight saving.
  return Number.isFinite(date.getTime()) && localDateInput(date.toISOString()) === value ? date.toISOString() : '';
}

export function mergePickerDate(iso: string, selected: Date, mode: 'date' | 'time') {
  const current = new Date(iso);
  // The picker takes and returns local Dates; @expo/ui converts to Material's UTC day itself.
  return mode === 'date'
    ? new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), current.getHours(), current.getMinutes()).toISOString()
    : new Date(current.getFullYear(), current.getMonth(), current.getDate(), selected.getHours(), selected.getMinutes()).toISOString();
}

// Calendar days (YYYY-MM-DD, local) for date-only pickers. Noon keeps the day stable across DST changes.
export const localDay = (iso: string) => localDateInput(iso).slice(0, 10);
export const parseLocalDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDateInput(`${value}T12:00`) : '';

// dateOnly hides the time; callers read the day with localDay.
export type ChillingDateInputProps = { analyticsId?: string; label: string; value: string; onChange: (iso: string) => void; disabled?: boolean; dateOnly?: boolean; zone?: string | null };

// Same as public.cities.timezone. A meetup runs on its city's clock, wherever the phone is.
export const CITY_ZONE: Record<string, string> = { vancouver: 'America/Vancouver', toronto: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto', calgary: 'America/Edmonton', edmonton: 'America/Edmonton', winnipeg: 'America/Winnipeg', saskatoon: 'America/Regina', regina: 'America/Regina', 'saint-john': 'America/Moncton', halifax: 'America/Halifax' };

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const knownZone = (zone: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; } };

/** A stored zone wins so every screen agrees with the meetup card. Regular meetups store none and follow their city. */
export function meetupZone(room?: { timezone?: string | null } | null, cityId?: string | null) {
  const zone = room?.timezone || (cityId ? CITY_ZONE[cityId] : null);
  return zone && knownZone(zone) ? zone : deviceZone();
}

// B.C. stays on UTC-7 from this instant (tz 2026b). Phones and servers with older zone data still drop America/Vancouver to UTC-8, which would save and show meetups an hour off. Phoenix is UTC-7 in every version. Only calculations use it: the stored zone stays America/Vancouver.
// shortcut: open cities only. Edmonton and Winnipeg also differ between old and new zone data; add them here before those cities open. Remove this once old zone data is no longer in use.
const BC_FIXED_FROM = Date.UTC(2026, 10, 1, 9);
export const clockZone = (zone: string, at: number) => zone === 'America/Vancouver' && at >= BC_FIXED_FROM ? 'America/Phoenix' : zone;

export function formatMeetupTime(iso: string, locale: string, zone: string, options: Intl.DateTimeFormatOptions) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Intl.DateTimeFormat(locale, { ...options, timeZone: clockZone(zone, at) }).format(new Date(at)) : '';
}

function offsetAt(zone: string, at: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: clockZone(zone, at), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute'), part('second')) - Math.floor(at / 1000) * 1000;
}
// Clock readings are kept as UTC numbers so calendar math never touches the device zone. Two passes land on the right side of a clock change.
const toWall = (at: number, zone: string) => at + offsetAt(zone, at);
const fromWall = (wall: number, zone: string) => wall - offsetAt(zone, wall - offsetAt(zone, wall));

// Native pickers only show device time, so they carry the city's clock numbers in a device-local Date.
// shortcut: a time the device itself skips for daylight saving (one hour, one night a year) can't be picked; accept unless hosts schedule 2 a.m. meetups.
export function toPickerValue(iso: string, zone?: string | null) {
  const at = Date.parse(iso);
  if (!zone || !Number.isFinite(at)) return iso;
  const wall = new Date(toWall(at, zone));
  return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes()).toISOString();
}
export function fromPickerValue(iso: string, zone?: string | null) {
  const at = Date.parse(iso);
  if (!zone || !Number.isFinite(at)) return iso;
  const local = new Date(at);
  return new Date(fromWall(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()), zone)).toISOString();
}

/** Tomorrow 7 p.m. on the city's calendar. */
export function defaultMeetupStart(zone: string, now = Date.now()) {
  const today = new Date(toWall(now, zone));
  return new Date(fromWall(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 19), zone)).toISOString();
}

export function moveMeetupZone(iso: string, from: string, to: string) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(fromWall(toWall(at, from), to)).toISOString() : iso;
}

const DAY = 86400000;
export const zoneDayGap = (from: number, to: number, zone: string) => Math.floor(toWall(to, zone) / DAY) - Math.floor(toWall(from, zone) / DAY);
