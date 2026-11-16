import { defaultMeetupStart, formatMeetupTime, nextWeeklyStart, zoneClockIso } from './chilling-date.ts';

// The one-screen quick meetup (칠링) fills what the host did not ask about with these defaults.
export type QuickWhen = 'tonight' | 'tomorrow' | 'weekend' | 'pick';
const HOUR = 3600000, QUICK_HOURS = 2;

/** Start on the city's clock; null when a preset has already passed (tonight after 7 p.m.). */
export function quickStart(when: Exclude<QuickWhen, 'pick'>, zone: string, now = Date.now()): string | null {
  if (when === 'tomorrow') return defaultMeetupStart(zone, now);
  const at = when === 'tonight' ? Date.parse(zoneClockIso('19:00', zone, now)) : nextWeeklyStart([6], '14:00', zone, now);
  return at && at > now ? new Date(at).toISOString() : null;
}

export const quickEnd = (startsAt: string) => new Date(Date.parse(startsAt) + QUICK_HOURS * HOUR).toISOString();

/** The intro line made from the title and the time, used until the host writes their own. */
export function quickIntro(title: string, when: QuickWhen, startsAt: string, zone: string, language: 'ko' | 'en'): string {
  const ko = language !== 'en';
  const pick = formatMeetupTime(startsAt, ko ? 'ko-KR' : 'en-CA', zone, { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const line = ko
    ? { tonight: '오늘 저녁 7시에 만나요.', tomorrow: '내일 저녁 7시에 만나요.', weekend: '이번 주 토요일 오후 2시에 만나요.', pick: `${pick}에 만나요.` }[when]
    : { tonight: "We're meeting tonight at 7 p.m.", tomorrow: "We're meeting tomorrow at 7 p.m.", weekend: "We're meeting this Saturday at 2 p.m.", pick: `We're meeting ${pick}.` }[when];
  const name = title.trim(), head = name && (/[.!?…]$/.test(name) ? name : `${name}.`);
  return [head, line, ko ? '같이 하실 분은 신청해 주세요.' : 'Request to join if you’re in.'].filter(Boolean).join(' ');
}
