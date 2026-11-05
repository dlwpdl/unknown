import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LIVE, approximatePoint, clampWithin, shownPoint, demoAllowed, distanceMeters, durationLabel, minutesLeft, noticeBottom, noticeMs, parseLiveMap, postingPlace, visibleNotice } from '../src/lib/live-bubbles.ts';
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

test('pins dragged to the edge of the 100 m circle go out on the ~100 m grid, so three of them no longer lead back home', () => {
  // Security review 2026-11-05 F1: exact edge points sit on one circle around home, and its centre is home.
  const lat = 111195, lng = lat * Math.cos(vancouver.latitude * Math.PI / 180);
  const offCentre = points => {
    const [[ax, ay], [bx, by], [cx, cy]] = points.map(p => [(p.longitude - vancouver.longitude) * lng, (p.latitude - vancouver.latitude) * lat]);
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)), a = ax * ax + ay * ay, b = bx * bx + by * by, c = cx * cx + cy * cy;
    return Math.hypot((a * (by - cy) + b * (cy - ay) + c * (ay - by)) / d, (a * (cx - bx) + b * (ax - cx) + c * (bx - ax)) / d);
  };
  const edge = [0, 120, 240].map(degrees => clampWithin(vancouver, {
    latitude: vancouver.latitude + 900 * Math.cos(degrees * Math.PI / 180) / lat, longitude: vancouver.longitude + 900 * Math.sin(degrees * Math.PI / 180) / lng }));
  assert.ok(offCentre(edge) < 1, 'the exact edge points would give home away');
  const shown = edge.map(approximatePoint);
  for (const point of shown) assert.deepEqual(point, { latitude: Math.round(point.latitude * 1000) / 1000, longitude: Math.round(point.longitude * 1000) / 1000 }, 'on the grid');
  assert.ok(offCentre(shown) > 20, 'the grid points do not');
});

test('the preview shows the point the server will keep: the grid point, or the latest earlier one from its cell or the next', () => {
  // The same cases pgTAP runs through post_live_bubble (review F2, N1, N2), with the same rule and numbers in the migration.
  const at = (latitude, longitude, audience = 'city', createdAt = '2026-11-05T10:00:00Z') => ({ latitude, longitude, audience, createdAt });
  const last = [at(49.264, -123.101)], point = ({ latitude, longitude }) => ({ latitude, longitude });
  assert.deepEqual(shownPoint({ latitude: 49.26345, longitude: -123.1007 }, last, 'city'), point(last[0]), 'the next cell south keeps the earlier point');
  assert.deepEqual(shownPoint({ latitude: 49.2667, longitude: -123.1007 }, last, 'city'), { latitude: 49.267, longitude: -123.101 }, 'three cells away moves');
  assert.deepEqual(shownPoint({ latitude: 49.2652, longitude: -123.1002 }, last, 'city'), point(last[0]), 'a diagonal neighbour keeps it too');
  assert.deepEqual(shownPoint({ latitude: 49.2640, longitude: -123.0990 }, last, 'city'), { latitude: 49.264, longitude: -123.099 }, 'two cells east moves');
  assert.deepEqual(shownPoint({ latitude: 49.26345, longitude: -123.1007 }, [], 'city'), { latitude: 49.263, longitude: -123.101 }, 'with nothing before, the grid point');
  const home = at(49.270, -123.101, 'friends', '2026-11-05T09:00:00Z');
  assert.deepEqual(shownPoint({ latitude: 49.2711, longitude: -123.1007 }, [home], 'city'), { latitude: 49.271, longitude: -123.101 }, 'a friends-only point never shows city-wide');
  assert.deepEqual(shownPoint({ latitude: 49.2711, longitude: -123.1007 }, [home], 'friends'), point(home), 'but friends-only may reuse it');
  const first = at(49.262, -123.100, 'city', '2026-11-05T08:00:00Z'), cafe = at(49.271, -123.101, 'city', '2026-11-05T11:00:00Z');
  assert.deepEqual(shownPoint({ latitude: 49.2614, longitude: -123.1003 }, [cafe, home, first], 'city'), point(first), 'the nearby earlier point wins over the latest far one');
  assert.deepEqual(shownPoint({ latitude: 49.2705, longitude: -123.1007 }, [cafe, at(49.270, -123.101, 'city', '2026-11-05T07:00:00Z')], 'city'), point(cafe), 'of two nearby, the latest');
  const migration = readFileSync(new URL('../supabase/migrations/20261105030000_live_bubbles.sql', import.meta.url), 'utf8');
  assert.match(migration, /lat:=round\(p_latitude::numeric,3\)::double precision; lon:=round\(p_longitude::numeric,3\)::double precision/);
  assert.match(migration, /b\.author_id=uid and b\.kind='member' and abs\(b\.latitude-lat\)<=0\.0011 and abs\(b\.longitude-lon\)<=0\.0011\s+and \(b\.audience='city' or p_audience='friends'\) order by b\.created_at desc limit 1;\s+if near\.id is not null then lat:=near\.latitude; lon:=near\.longitude; end if;/);
  const pgtap = readFileSync(new URL('../supabase/tests/live_bubbles.test.sql', import.meta.url), 'utf8');
  for (const expected of [/'다시 왔어요','city',30,49\.26345,-123\.1007[\s\S]*'\[49\.264,-123\.101\]'/, /'이사 왔어요','city',30,49\.2667,-123\.1007[\s\S]*'\[49\.267,-123\.101\]'/,
    /'집이에요','friends',30,49\.2700,-123\.1007[\s\S]*'옆 카페예요','city',30,49\.2711,-123\.1007[\s\S]*'\[49\.271,-123\.101\]'/, /'다시 남쪽','city',30,49\.2614,-123\.1003[\s\S]*'\[49\.262,-123\.1\]'/]) {
    assert.match(pgtap, expected, 'and pgTAP expects the same points');
  }
});

test('time left rounds to whole minutes and reads naturally', () => {
  const now = Date.parse('2026-11-05T10:00:00Z'), at = seconds => new Date(now + seconds * 1000).toISOString();
  assert.equal(minutesLeft(at(3600), now), 60);
  assert.equal(durationLabel(minutesLeft(at(3600 + 29), now)), '1시간', 'a bubble just put up for an hour, read on a clock up to 30 s old, says 1시간 (not 1시간 1분)');
  assert.equal(durationLabel(minutesLeft(at(3600 - 1), now)), '1시간', 'and still 1시간 a second later');
  assert.equal(minutesLeft(at(3600 + 31), now), 61);
  assert.equal(minutesLeft(at(30 * 60 - 29), now), 30);
  assert.equal(minutesLeft(at(30), now), 1, 'the last half minute still reads 1분 while it is up');
  assert.equal(minutesLeft(at(1), now), 1);
  assert.equal(minutesLeft(at(0), now), 0, 'over at the exact end');
  assert.equal(minutesLeft(at(-60), now), 0);
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
  demo.post('me:test', { cityId: 'vancouver', body: ' 커피 ', audience: 'city', minutes: 30, point: vancouver, kind: 'member' }, now);
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
  demo.post('me:wave', { cityId: 'vancouver', body: '산책', audience: 'city', minutes: 60, point: vancouver, kind: 'member' }, now);
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

test('the sibling sheets never share a React key, even before anything was opened', () => {
  const source = readFileSync(new URL('../src/components/live-bubbles.tsx', import.meta.url), 'utf8');
  const sheets = source.slice(source.indexOf('export function LiveSheets'), source.indexOf('const styles = StyleSheet.create'));
  const keys = [...sheets.matchAll(/key=\{`([a-z]+):\$\{/g)].map(match => match[1]);
  assert.deepEqual(keys, ['compose', 'request', 'received'], 'every keyed sheet uses a template key with its own prefix');
  assert.equal([...sheets.matchAll(/ key=\{/g)].length, keys.length, 'no keyed sheet without a prefix');
});

test('posting needs an honest fresh fix; only the development example takes the simulator place or the city centre', () => {
  const now = Date.parse('2026-11-05T18:00:00Z'), centre = { latitude: 49.28, longitude: -123.12 };
  const real = { ...vancouver, accuracy: 20, measuredAt: now - 5000, mocked: false };
  const simulator = { ...vancouver, accuracy: 5, measuredAt: now - 5000, mocked: true };
  assert.deepEqual(postingPlace(real, false, centre, now), vancouver);
  assert.throws(() => postingPlace(simulator, false, centre, now), /MOCKED/, 'a faked place is refused in a release build and against the server');
  assert.throws(() => postingPlace({ ...real, measuredAt: now - 600000 }, false, centre, now), /INACCURATE/);
  assert.throws(() => postingPlace({ ...real, accuracy: 900 }, false, centre, now), /INACCURATE/);
  assert.throws(() => postingPlace(null, false, centre, now), /UNAVAILABLE/);
  assert.deepEqual(postingPlace(simulator, true, centre, now), vancouver, 'the example uses the simulator place');
  assert.deepEqual(postingPlace(null, true, centre, now), centre, 'or the city centre when there is none');
});

test('before posting, the development example still shows the receiving side', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const now = Date.parse('2026-11-05T18:00:00Z'), changed = () => {};
  assert.equal(demo.load('me:early', 'me', vancouver, now, changed).mine, null);
  demo.receive('me:early', now);
  context.mock.timers.tick(3000);
  const map = demo.load('me:early', 'me', vancouver, now, changed);
  assert.ok(map.mine?.demo && distanceMeters(map.mine, vancouver) < 1, 'a sample bubble of mine goes up where the example map is');
  assert.equal(map.waves.length, 1);
  assert.equal(map.received.length, 1);
  context.mock.timers.tick(10000);
  assert.equal(demo.load('me:early', 'me', vancouver, now, changed).waves.length, 1, 'no second automatic round from the sample bubble');
});

test('the safety monitor reads a bubble line through its service-only function (ADR-0001)', async () => {
  const [{ default: ts }, vm] = await Promise.all([import('typescript'), import('node:vm')]);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../supabase/functions/safety-monitor/index.ts', import.meta.url), 'utf8') + '\nexports.loadContent = loadContent;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Deno: { serve() {} }, require: () => ({}) });
  const calls = [];
  const content = await exports.loadContent({ rpc: async (name, args) => { calls.push([name, { ...args }]); return { data: { authorId: 'a', text: '동네 말풍선 · 보는 사람: 도시 전체\n커피' }, error: null }; } }, 'live_bubble', 'b1');
  assert.deepEqual(calls, [['get_live_bubble_safety_content', { p_target_id: 'b1' }]]);
  assert.equal(content.authorId, 'a');
  await assert.rejects(exports.loadContent({ rpc: async () => ({ error: new Error('SERVICE_ROLE_REQUIRED') }) }, 'live_bubble', 'b1'), /SERVICE_ROLE_REQUIRED/);
});

test('live-map alerts read naturally in English, exactly as the migration writes them in Korean', async () => {
  const { englishNotificationBody } = await import('../src/lib/notification-copy.ts');
  const migration = readFileSync(new URL('../supabase/migrations/20261105030000_live_bubbles.sql', import.meta.url), 'utf8');
  const bodies = [...migration.matchAll(/'live_bubble_(request|accepted|wave)',uid,'user',uid,\s*coalesce\(nickname,'이웃'\)\|\|'([^']+)'/g)].map(match => ['live_bubble_' + match[1], '하늘콩' + match[2]]);
  assert.equal(bodies.length, 4, 'two request bodies, one accepted, one wave');
  for (const [kind, body] of bodies) assert.match(englishNotificationBody({ kind, body }), /^하늘콩 [a-z]/, `${kind}: ${body}`);
});

test('every server call the app makes matches a function and its parameter names in the migration', () => {
  const app = readFileSync(new URL('../src/lib/live-bubbles.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261105030000_live_bubbles.sql', import.meta.url), 'utf8');
  const calls = [...app.matchAll(/client\.rpc\('([a-z_]+)'(?:, \{([^}]*)\})?/g)].map(([, name, args = '']) => [name, [...args.matchAll(/(p_[a-z_]+):/g)].map(match => match[1]).sort()]);
  assert.equal(calls.length, 9);
  for (const [name, args] of calls) {
    const declared = new RegExp(`create function public\\.${name}\\(([^)]*)\\)`).exec(migration);
    assert.ok(declared, `${name} exists`);
    assert.deepEqual([...declared[1].matchAll(/(p_[a-z_]+) /g)].map(match => match[1]).sort(), args, `${name} takes exactly what the app sends`);
    assert.match(migration, new RegExp(`grant execute on function[^;]*public\\.${name}\\(`), `${name} is granted to members`);
  }
});

test('a notice goes after its few seconds, never comes back, and sits above the buttons and card it would cover', () => {
  const sent = { id: 1, text: '동네고양이님에게 대화 신청을 보냈어요' }, request = { id: 2, text: '대화 신청이 왔어요', requestId: 'r' };
  assert.equal(visibleNotice(sent, null), sent);
  assert.equal(visibleNotice(sent, 1), null, 'once hidden by its timer it stays hidden (it used to come straight back)');
  assert.equal(visibleNotice(request, 1), request, 'the next notice shows');
  assert.equal(noticeMs(sent), 3000);
  assert.equal(noticeMs(request), 6000, 'a little longer when tapping it opens the request');
  const usual = 34 + 96, screen = 932;
  assert.equal(noticeBottom(usual, screen, []), usual, 'nothing to avoid: the usual place');
  assert.equal(noticeBottom(usual, screen, [792]), 148, 'an open sheet: just above its button row');
  assert.equal(noticeBottom(usual, screen, [792, 727]), 213, 'above the map card too when both are on screen');
  assert.equal(noticeBottom(usual, screen, [900]), usual, 'never lower than usual');
  assert.equal(noticeBottom(usual, screen, [0, 1200]), usual, 'views off screen or not laid out are ignored');
});
