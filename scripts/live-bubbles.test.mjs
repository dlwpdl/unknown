import assert from 'node:assert/strict';
import test from 'node:test';

import { LIVE, approximatePoint, clampWithin, demoAllowed, distanceMeters, durationLabel, minutesLeft, parseLiveMap } from '../src/lib/live-bubbles.ts';
import * as demo from '../src/lib/live-bubbles-demo.ts';

const vancouver = { latitude: 49.2627, longitude: -123.1007 };
const north = (point, meters) => ({ latitude: point.latitude + meters / 111320, longitude: point.longitude });

test('a bubble never moves more than 100 m from where I am', () => {
  assert.ok(Math.abs(distanceMeters(vancouver, north(vancouver, 100)) - 100) < 0.5);
  const near = north(vancouver, 40);
  assert.deepEqual(clampWithin(vancouver, near), near, 'inside the circle stays put');
  const pulled = clampWithin(vancouver, north(vancouver, 900));
  assert.ok(distanceMeters(vancouver, pulled) <= LIVE.moveMeters, 'dragged far, it stops at the edge');
  assert.ok(distanceMeters(vancouver, pulled) > 95, 'and stays on the dragged side');
  for (const latitude of [0, 37.5, 49.28, 60.1]) for (const offset of [0.00049, 0.00051, 0.000123]) {
    const fix = { latitude: latitude + offset, longitude: -123.1 + offset };
    assert.ok(distanceMeters(fix, approximatePoint(fix)) <= LIVE.moveMeters, `grid point at ${latitude}`);
  }
});

test('time left counts whole minutes up and reads naturally', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  assert.equal(minutesLeft('2026-11-05T10:30:00Z', now), 30);
  assert.equal(minutesLeft('2026-11-05T10:00:01Z', now), 1);
  assert.equal(minutesLeft('2026-11-05T09:00:00Z', now), 0);
  assert.equal(minutesLeft('nonsense', now), 0);
  assert.equal(durationLabel(30), '30분');
  assert.equal(durationLabel(60), '1시간');
  assert.equal(durationLabel(90), '1시간 30분');
});

test('example bubbles appear only in a development build whose server lacks the functions', () => {
  assert.equal(demoAllowed({ code: 'PGRST202' }, true), true);
  assert.equal(demoAllowed({ code: '42883' }, true), true);
  assert.equal(demoAllowed({ code: 'PGRST202' }, false), false, 'never in a release build');
  assert.equal(demoAllowed({ code: '500', message: 'boom' }, true), false, 'a real failure is not a reason to pretend');
});

test('server data keeps only well-formed bubbles and requests', () => {
  const author = { id: 'a', nickname: '이웃', trustLevel: 3 };
  const map = parseLiveMap({ requestsLeft: 4, requestLimit: 5,
    bubbles: [{ id: 'b1', author, body: '커피', latitude: 49, longitude: -123, expiresAt: '2026-11-05T11:00:00Z', sent: { id: 'r', status: 'declined', greeting: 1 } },
      { id: 'b2', author, body: 'x'.repeat(41), latitude: 49, longitude: -123, expiresAt: '2026-11-05T11:00:00Z' }, { id: 'b3', author, body: 'no place', expiresAt: 'x' }, null],
    received: [{ id: 'q', bubbleId: 'm', sender: author, greeting: 2 }, { id: 'q2' }] });
  assert.deepEqual(map.bubbles.map(bubble => bubble.id), ['b1']);
  assert.equal(map.bubbles[0].sent.status, 'declined');
  assert.equal(map.received.length, 1);
  assert.equal(map.requestsLeft, 4);
  assert.deepEqual(parseLiveMap(null), { bubbles: [], mine: null, received: [], waves: [], requestLimit: 5, requestsLeft: 0, wavesLeft: 0 });
});

test('the development example counts five requests a day and never refunds one', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const now = Date.parse('2026-11-05T18:00:00Z'), changed = () => {};
  const first = demo.load('me:test', 'me', vancouver, now, changed);
  assert.equal(first.requestsLeft, 5);
  assert.ok(first.bubbles.every(bubble => bubble.demo && distanceMeters(vancouver, bubble) < 1500));
  const target = first.bubbles[0].id;
  const { id } = demo.send('me:test', target, 0, now);
  demo.cancel('me:test', id);
  for (let index = 0; index < 4; index++) demo.send('me:test', target, 0, now);
  assert.equal(demo.load('me:test', 'me', vancouver, now, changed).requestsLeft, 0);
  assert.throws(() => demo.send('me:test', target, 0, now), /REQUEST_LIMIT/);
  assert.equal(demo.load('me:test', 'me', vancouver, now + 86400000, changed).requestsLeft, 5, 'a new day starts again');
  demo.post('me:test', { cityId: 'vancouver', body: ' 커피 ', audience: 'city', minutes: 30, point: vancouver, origin: vancouver, kind: 'member' }, now);
  demo.receive('me:test', now);
  context.mock.timers.tick(3000);
  const mine = demo.load('me:test', 'me', vancouver, now, changed);
  assert.equal(mine.mine.body, '커피');
  assert.equal(mine.waves.length, 1, 'a wave first');
  assert.equal(mine.received.length, 1, 'then a chat request');
  assert.equal(demo.load('me:test', 'me', vancouver, now + 31 * 60000, changed).mine, null, 'it goes down on time with its requests');
});

test('waves: once per bubble, twenty a day, apart from chat requests; the owner sees who waved and can ask back', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const now = Date.parse('2026-11-05T18:00:00Z'), changed = () => {};
  const map = demo.load('me:wave', 'me', vancouver, now, changed);
  assert.equal(map.wavesLeft, LIVE.dailyWaves);
  demo.wave('me:wave', map.bubbles[0].id, now);
  assert.throws(() => demo.wave('me:wave', map.bubbles[0].id, now), /ALREADY_WAVED/);
  const after = demo.load('me:wave', 'me', vancouver, now, changed);
  assert.equal(after.bubbles[0].waved, true);
  assert.equal(after.requestsLeft, LIVE.dailyRequests, 'a wave is not a chat request');
  demo.post('me:wave', { cityId: 'vancouver', body: '산책', audience: 'city', minutes: 60, point: vancouver, origin: vancouver, kind: 'member' }, now);
  demo.receive('me:wave', now);
  const [wave] = demo.load('me:wave', 'me', vancouver, now, changed).waves;
  demo.replyToWave('me:wave', wave.id);
  const replied = demo.load('me:wave', 'me', vancouver, now, changed);
  assert.equal(replied.waves[0].reply.status, 'pending');
  assert.equal(replied.requestsLeft, LIVE.dailyRequests - 1, 'answering a wave is a chat request');
  demo.end('me:wave');
  assert.deepEqual(demo.load('me:wave', 'me', vancouver, now, changed).waves, [], 'waves go down with the bubble');
});

test('notifications may open a live-map request, and nothing else under /discover', async () => {
  const { notificationRoute } = await import('../src/lib/notification-preferences.ts');
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(notificationRoute(`/discover?bubbleRequest=${id}`), `/discover?bubbleRequest=${id}`);
  assert.equal(notificationRoute('/discover'), '/discover');
  assert.notEqual(notificationRoute('/discover?bubbleRequest=../../admin'), '/discover?bubbleRequest=../../admin');
});
