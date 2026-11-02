import type { MeetupSession } from './meetup-reviews.ts';

export const ATTENDANCE_WINDOW_MS = 7 * 86400000;

const started = (session: MeetupSession, now: number) => Date.parse(session.startsAt) <= now;
const ended = (session: MeetupSession, now: number) => Date.parse(session.endsAt) <= now;

export function liveSession(sessions: MeetupSession[], now: number) {
  return sessions.find(session => started(session, now) && !ended(session, now)) ?? null;
}

export function upcomingSessions(sessions: MeetupSession[], now: number) {
  return sessions.filter(session => !ended(session, now)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function pastSessions(sessions: MeetupSession[], now: number) {
  return sessions.filter(session => ended(session, now)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}

export function inAttendanceWindow(session: MeetupSession, now: number) {
  return ended(session, now) && now < Date.parse(session.endsAt) + ATTENDANCE_WINDOW_MS;
}

export function daysLeftToConfirm(session: MeetupSession, now: number) {
  return Math.max(1, Math.ceil((Date.parse(session.endsAt) + ATTENDANCE_WINDOW_MS - now) / 86400000));
}

/** The newest ended session where this viewer can still confirm someone they met. */
export function sessionToConfirm(sessions: MeetupSession[], now: number) {
  return pastSessions(sessions, now).find(session => inAttendanceWindow(session, now) && session.checkedIn
    && session.members.some(member => member.checkedIn && !member.confirmedByMe)) ?? null;
}

/** The one session a member should deal with now: live, then one to confirm or review, then the next one. */
export function focusSession(sessions: MeetupSession[], now: number) {
  return liveSession(sessions, now) ?? sessionToConfirm(sessions, now)
    ?? pastSessions(sessions, now).find(session => inAttendanceWindow(session, now) && session.canReview && !session.reviewStatus)
    ?? upcomingSessions(sessions, now)[0] ?? null;
}

export type HostTodo =
  | { kind: 'live'; session: MeetupSession }
  | { kind: 'requests'; count: number }
  | { kind: 'confirm'; session: MeetupSession }
  | { kind: 'unpaid'; count: number };

/** Most urgent first. The first one becomes the bottom button; the rest stay as cards. Unpaid fees never take the button. */
export function hostTodos({ sessions, pending, unpaid, now }: { sessions: MeetupSession[]; pending: number; unpaid: number; now: number }): HostTodo[] {
  const live = liveSession(sessions, now), confirm = sessionToConfirm(sessions, now);
  return [
    ...(live ? [{ kind: 'live', session: live } as const] : []),
    ...(pending > 0 ? [{ kind: 'requests', count: pending } as const] : []),
    ...(confirm ? [{ kind: 'confirm', session: confirm } as const] : []),
    ...(unpaid > 0 ? [{ kind: 'unpaid', count: unpaid } as const] : []),
  ];
}

const DAY = 86400000;
const dayStart = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** "Today 9:00 AM", "Tomorrow 9:00 AM", otherwise month, day, weekday and time. `tr` keeps the wording translatable. */
export function sessionWhen(iso: string, locale: string, now: number, tr: (text: string, ...values: unknown[]) => string) {
  const time = Date.parse(iso), date = new Date(iso);
  const clock = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((dayStart(time) - dayStart(now)) / DAY);
  if (days === 0) return tr('오늘 {0}', clock);
  if (days === 1) return tr('내일 {0}', clock);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function sessionRange(session: { startsAt: string; endsAt: string }, locale: string) {
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${clock(session.startsAt)}–${clock(session.endsAt)}`;
}
