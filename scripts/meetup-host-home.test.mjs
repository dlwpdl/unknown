import assert from 'node:assert/strict';
import test from 'node:test';
import { daysLeftToConfirm, focusSession, hostTodos, inAttendanceWindow, liveSession, pastSessions, sessionRange, sessionToConfirm, sessionWhen, upcomingSessions, withOnceSession } from '../src/lib/meetup-host-home.ts';

const HOUR = 3600000, DAY = 24 * HOUR, now = Date.parse('2026-10-31T18:00:00Z');
const at = time => new Date(time).toISOString();
const session = (id, start, more = {}) => ({ id, startsAt: at(now + start), endsAt: at(now + start + 2 * HOUR), checkedIn: false, verified: false, canReview: false, reviewStatus: null, claimStatus: 'none', members: [], ...more });
const met = { id: 'm', nickname: 'M', checkedIn: true, confirmedByMe: false, verified: false };

test('sessions split into live, coming and past, nearest first', () => {
  const live = session('live', -HOUR), next = session('next', DAY), later = session('later', 8 * DAY), old = session('old', -9 * DAY), recent = session('recent', -2 * DAY), list = [later, old, live, recent, next];
  assert.equal(liveSession(list, now), live);
  assert.deepEqual(upcomingSessions(list, now).map(item => item.id), ['live', 'next', 'later']);
  assert.deepEqual(pastSessions(list, now).map(item => item.id), ['recent', 'old']);
  assert.equal(liveSession([next, old], now), null);
});

test('the confirmation window runs seven days after the end, then closes', () => {
  const ended = session('a', -3 * HOUR);
  assert.equal(inAttendanceWindow(ended, now), true); assert.equal(daysLeftToConfirm(ended, now), 7);
  assert.equal(inAttendanceWindow(session('live', -HOUR), now), false);
  assert.equal(inAttendanceWindow(session('b', -8 * DAY), now), false);
  assert.equal(daysLeftToConfirm(session('c', -7 * DAY - HOUR), now), 1, 'the last hours still read as one day left');
});

test('only someone checked in with an unconfirmed person has a session to confirm', () => {
  const ready = session('ready', -DAY, { checkedIn: true, members: [met] });
  assert.equal(sessionToConfirm([ready], now), ready);
  assert.equal(sessionToConfirm([session('a', -DAY, { members: [met] })], now), null, 'not checked in');
  assert.equal(sessionToConfirm([session('b', -DAY, { checkedIn: true, members: [{ ...met, confirmedByMe: true }] })], now), null, 'already confirmed');
  assert.equal(sessionToConfirm([session('c', -9 * DAY, { checkedIn: true, members: [met] })], now), null, 'window closed');
});

test('focus: live, then one to confirm, then one to review, then the next', () => {
  const live = session('live', -HOUR), confirm = session('confirm', -DAY, { checkedIn: true, members: [met] }), review = session('review', -2 * DAY, { canReview: true }), next = session('next', DAY);
  assert.equal(focusSession([next, review, confirm, live], now), live);
  assert.equal(focusSession([next, review, confirm], now), confirm);
  assert.equal(focusSession([next, review], now), review);
  assert.equal(focusSession([next, { ...review, reviewStatus: 'published' }], now), next);
  assert.equal(focusSession([session('old', -9 * DAY)], now), null);
});

test('host to-dos are ordered by urgency and unpaid fees come last', () => {
  const live = session('live', -HOUR), confirm = session('confirm', -DAY, { checkedIn: true, members: [met] });
  assert.deepEqual(hostTodos({ sessions: [live, confirm], pending: 2, unpaid: 1, now }).map(item => item.kind), ['live', 'requests', 'confirm', 'unpaid']);
  assert.deepEqual(hostTodos({ sessions: [], pending: 0, unpaid: 3, now }).map(item => item.kind), ['unpaid']);
  assert.deepEqual(hostTodos({ sessions: [], pending: 0, unpaid: 0, now }), []);
});

test('session wording says today and tomorrow, and always shows a range', () => {
  const tr = (key, ...values) => values.reduce((out, value, index) => out.replace(`{${index}}`, value), key);
  const noon = new Date(now); noon.setHours(12, 0, 0, 0);
  const today = noon.getTime() + HOUR, tomorrow = noon.getTime() + DAY;
  assert.match(sessionWhen(at(today), 'ko-KR', noon.getTime(), tr), /^오늘 /);
  assert.match(sessionWhen(at(tomorrow), 'ko-KR', noon.getTime(), tr), /^내일 /);
  assert.doesNotMatch(sessionWhen(at(noon.getTime() + 5 * DAY), 'ko-KR', noon.getTime(), tr), /오늘|내일/);
  assert.match(sessionRange(session('a', 0), 'en-CA'), /–/);
});

test('a one-time meetup with no session row yet shows its own time; a real row or a group never gets a stand-in', () => {
  const room = { eventKind: 'once', startsAt: at(now + DAY), endsAt: at(now + DAY + 2 * HOUR) };
  const [standIn] = withOnceSession([], room);
  assert.equal(standIn.id, '');
  assert.equal(upcomingSessions([standIn], now)[0], standIn, 'the host screen and the meetup page name the same next time');
  assert.deepEqual(withOnceSession([], { ...room, startsAt: at(now - 3 * HOUR), endsAt: at(now - HOUR) }).map(item => pastSessions([item], now).length), [1], 'after it ends it is past, not coming');
  const real = session('real', DAY);
  assert.deepEqual(withOnceSession([real], room), [real], 'attendance opened: the real row is the session');
  assert.deepEqual(withOnceSession([], { ...room, eventKind: 'group' }), []);
  assert.deepEqual(withOnceSession([], null), []);
  assert.deepEqual(withOnceSession([], { eventKind: 'once', startsAt: room.startsAt, endsAt: null }), [], 'no end time, nothing to place');
});
