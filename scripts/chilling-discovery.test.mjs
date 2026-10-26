import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryCursor, hasOpenSeat, matchesChilling, matchesChillingWindow, sortChillings } from '../src/lib/chilling-discovery.ts';
import * as discovery from '../src/lib/chilling-discovery.ts';

test('ALL includes both real types but still excludes expired, closed and ordinary posts', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(matchesChilling({ room: { eventKind: 'group', cadence: 'weekly' } }, 'all', 'all', now), true);
  assert.equal(matchesChilling({ room: { eventKind: 'once', endsAt: '2026-10-26T12:00:00Z' } }, 'all', 'all', now), true);
  assert.equal(matchesChilling({ room: { capacity: 8 } }, 'all', 'all', now), true, 'legacy recurring groups remain discoverable');
  assert.equal(matchesChilling({ room: { eventKind: 'once', endsAt: '2026-10-24T12:00:00Z' } }, 'all', 'all', now), false);
  assert.equal(matchesChilling({ room: { closed: true } }, 'all', 'all', now), false);
  assert.equal(matchesChilling({}, 'all', 'all', now), false);
});

test('discovery preference defaults to ALL and preserves only supported view/type choices', () => {
  for (const raw of [null, '', 'not-json', '[]', '{"kind":"bad","view":"bad"}']) {
    assert.deepEqual(discovery.parseChillingDiscoveryPreference(raw), { kind: 'all', view: 'browse' });
  }
  assert.deepEqual(discovery.parseChillingDiscoveryPreference('{"kind":"group","view":"mine"}'), { kind: 'group', view: 'mine' });
  assert.deepEqual(discovery.parseChillingDiscoveryPreference('{"kind":"once","view":"browse"}'), { kind: 'once', view: 'browse' });
  assert.deepEqual(discovery.chillingCreateKindParams('all'), {});
  assert.deepEqual(discovery.chillingCreateKindParams('once'), { kind: 'once' });
  assert.deepEqual(discovery.chillingCreateKindParams('group'), { kind: 'group' });
});
test('advance from raw rows even when kind hides the entire page', () => {
  const page = Array.from({ length: 30 }, (_, i) => ({ id: String(i), createdAt: '2026-09-17', sortAt: '2026-09-18', room: { eventKind: 'group' } }));
  assert.equal(page.filter(p => matchesChilling(p, 'once', 'all')).length, 0);
  assert.deepEqual(discoveryCursor(page), { id: '29', createdAt: '2026-09-17', sortAt: '2026-09-18' });
  assert.equal(matchesChilling({ room: { eventKind: 'group' } }, 'group', 'hobby'), false);
  assert.equal(matchesChilling({ room: { eventKind: 'once', category: 'hobby', closed: true } }, 'once', 'hobby'), false);
  assert.equal(matchesChilling({ room: { eventKind: 'once', endsAt: '2026-09-17T12:00:00Z' } }, 'once', 'all', Date.parse('2026-09-17T12:00:00Z')), false);
});

test('date window keeps today and the next seven days, and never hides recurring meetups', () => {
  const now = new Date('2026-09-22T10:00:00').getTime();
  const at = iso => ({ room: { eventKind: 'once', startsAt: iso } });
  assert.equal(matchesChillingWindow(at('2026-09-22T20:00:00'), 'today', now), true);
  assert.equal(matchesChillingWindow(at('2026-09-23T09:00:00'), 'today', now), false);
  assert.equal(matchesChillingWindow(at('2026-09-23T09:00:00'), 'week', now), true);
  assert.equal(matchesChillingWindow(at('2026-10-01T09:00:00'), 'week', now), false);
  assert.equal(matchesChillingWindow(at('아직 미정'), 'today', now), false);
  assert.equal(matchesChillingWindow({ room: { eventKind: 'group', cadence: '매주 토요일' } }, 'today', now), true);
  assert.equal(matchesChillingWindow(at('2026-10-01T09:00:00'), 'all', now), true);
});

test('seat filter treats unknown capacity as open and fills up at capacity', () => {
  assert.equal(hasOpenSeat({ capacity: 4, memberCount: 4 }), false);
  assert.equal(hasOpenSeat({ capacity: 4, memberCount: 3 }), true);
  assert.equal(hasOpenSeat({ memberCount: 9 }), true);
  assert.equal(hasOpenSeat(undefined), true);
});

test('upcoming one-off events sort by start time and recurring meetups keep server order', () => {
  const once = (id, startsAt) => ({ id, createdAt: '2026-09-20T00:00:00Z', room: { eventKind: 'once', startsAt, endsAt: '2026-12-01T00:00:00Z' } });
  const sorted = sortChillings([once('c', '2026-10-05T00:00:00Z'), once('a', '2026-09-23T00:00:00Z'), once('b', '2026-09-23T00:00:00Z')], 'once');
  assert.deepEqual(sorted.map(post => post.id), ['a', 'b', 'c']);
  const group = [{ id: 'x', createdAt: '2026-09-01T00:00:00Z', room: { eventKind: 'group' } }, { id: 'y', createdAt: '2026-09-20T00:00:00Z', room: { eventKind: 'group' } }];
  assert.deepEqual(sortChillings(group, 'group'), group);
  assert.deepEqual(sortChillings([{ id: 'z', createdAt: '2026-09-20T00:00:00Z', room: { eventKind: 'once' } }], 'once').map(post => post.id), ['z']);
});
