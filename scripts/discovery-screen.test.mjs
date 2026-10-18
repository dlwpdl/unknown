import { tr } from '../src/i18n/index.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { discoveryMatches, mergeCityTop25 } from '../src/lib/discovery.ts';
import { isFreshLocation } from '../src/lib/location.ts';

const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const previous = { key: 'viewer-and-city', page: 0, items: [{ id: 'post:old' }], cursor: { id: 'last-post', sortAt: '2026-10-14' }, postMore: true, eventMore: false };

test('a system permission dialog preserves GPS while an actual background transition cancels it', () => {
  const start = source.indexOf("    const listener = AppState.addEventListener('change', state => {");
  const end = source.indexOf('    const revision = locationRevision;', start);
  let listener;
  const locationRevision = { current: 1 }, states = [], times = [], exports = {};
  vm.runInNewContext(compile(source.slice(start, end) + '\nexports.ready = true;'), {
    exports, Date, locationRevision, AppState: { addEventListener: (_event, callback) => { listener = callback; return { remove() {} }; } },
    setLocating: value => states.push(value), setNow: value => times.push(value),
  });
  listener('inactive'); assert.equal(locationRevision.current, 1); assert.equal(states.length, 0);
  listener('active'); assert.equal(times.length, 1);
  listener('background'); assert.equal(locationRevision.current, 2); assert.deepEqual(states, [false]);
});

function gps({ granted = true, fix, defer = false } = {}) {
  const start = source.indexOf('  const locate = async () => {'), end = source.indexOf('  const changeMode = ', start);
  const changes = { center: null, userLocation: null }, calls = [], locationRevision = { current: 0 }, AppState = { currentState: 'active' }, exports = {};
  let finish;
  const value = fix ?? { coords: { latitude: 49.28, longitude: -123.12, accuracy: 10 }, timestamp: Date.now() };
  vm.runInNewContext(compile(source.slice(start, end) + '\nexports.locate = locate;'), {
    exports, locating: false, locationRevision, AppState, isFreshLocation, Date,
    Location: { Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: async () => { calls.push('permission'); return { granted }; },
      getCurrentPositionAsync: async () => { calls.push('gps'); return defer ? new Promise(resolve => { finish = resolve; }) : value; } },
    play: kind => calls.push(kind), setLocating: value => { changes.locating = value; }, setLocationError: value => { changes.error = value; },
    setSelectedId: value => { changes.selectedId = value; }, setCenter: value => { changes.center = value; }, setUserLocation: value => { changes.userLocation = value; }, setTimeout: () => 1, clearTimeout() {},
  });
  return { ...exports, changes, calls, locationRevision, AppState, finish: () => finish(value) };
}

test('My Location uses the actual fresh device fix and sends a new camera request on every press', async () => {
  for (const [latitude, longitude] of [[49.28, -123.12], [37.7749, -122.4194]]) {
    const ui = gps({ fix: { coords: { latitude, longitude, accuracy: 10 }, timestamp: Date.now() } });
    await ui.locate();
    assert.equal(ui.changes.center.latitude, latitude);
    assert.equal(ui.changes.center.longitude, longitude);
    assert.deepEqual({ ...ui.changes.userLocation }, { latitude, longitude });
    const requestId = ui.changes.center.requestId;
    await ui.locate();
    assert.ok(ui.changes.center.requestId > requestId);
    assert.equal(ui.changes.locating, false);
  }
});

test('denied, stale, mocked and inaccurate GPS results never move the map to a fallback city', async () => {
  const denied = gps({ granted: false }); await denied.locate();
  assert.equal(denied.calls.includes('gps'), false);
  assert.equal(denied.changes.center, null);
  assert.equal(denied.changes.userLocation, null);
  assert.ok(denied.changes.error.includes('권한'));
  for (const patch of [{ timestamp: Date.now() - 121000 }, { mocked: true }, { coords: { latitude: 49.28, longitude: -123.12, accuracy: 251 } }, { timestamp: Date.now() + 60000 }]) {
    const ui = gps({ fix: { coords: { latitude: 49.28, longitude: -123.12, accuracy: 10 }, timestamp: Date.now(), ...patch } });
    await ui.locate();
    assert.equal(ui.changes.center, null);
    assert.equal(ui.changes.userLocation, null);
    assert.ok(ui.changes.error);
    assert.equal(ui.changes.locating, false);
  }
});

test('a late GPS completion cannot override a chosen pin or a backgrounded screen', async () => {
  for (const cancel of [ui => { ui.locationRevision.current++; }, ui => { ui.AppState.currentState = 'background'; }]) {
    const ui = gps({ defer: true }), pending = ui.locate(); await tick();
    cancel(ui); ui.finish(); await pending;
    assert.equal(ui.changes.center, null);
    assert.equal(ui.changes.userLocation, null);
  }
});

test('Top 25 merges only visible recommendations before filtering and keeps the 500-row bound', () => {
  const start = source.indexOf('  const publicItems = '), end = source.indexOf('  const pins = ', start);
  assert.ok(start > 0 && end > start, 'the map needs a privacy-filtered Top 25 merge');
  const pick = { id: 'park', cityId: 'vancouver', title: '공원', label: '공개 장소', category: 'nature', latitude: 49.28, longitude: -123.12, reason: '선정 이유', sourceUrl: 'https://example.org/park', postIds: ['hidden-post'] };
  const exports = {};
  const item = { id: 'post:hidden-post', source: 'post', sourceId: 'hidden-post', cityId: 'vancouver', title: '비공개 제목', category: 'nature', label: '공개 위치', latitude: 49.28, longitude: -123.12, price: null, imageUri: 'private-image', post: { id: 'hidden-post', kind: 'story', author: { id: 'blocked-author' } } };
  const context = { exports, catalogItems: [], current: { items: [item], limited: false }, city: { id: 'vancouver' }, now: Date.now(), selectedFilters: ['top25'], query: '', days: [], hidden: () => true,
    discoveryMatches, mergeCityTop25: (items, city) => mergeCityTop25(items, city, [pick]), discoveryEvent: () => null };
  vm.runInNewContext(compile(`export function run() { ${source.slice(start, end)} return { items, limited }; }`), context);
  const result = exports.run();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, '공원');
  assert.equal(result.items[0].post, undefined);
  assert.equal(result.items[0].imageUri, undefined);
  pick.category = 'exhibition';
  context.days = ['2026-10-15'];
  assert.equal(exports.run().items.length, 1, 'a curated venue stays visible when event dates change');
  pick.category = 'nature';
  context.days = [];
  context.hidden = () => false;
  context.selectedFilters = [];
  context.current.items = Array.from({ length: 500 }, (_, i) => ({ ...item, id: `post:${i}`, sourceId: String(i), post: { ...item.post, id: String(i) } }));
  const bounded = exports.run();
  assert.equal(bounded.items.length, 500);
  assert.equal(bounded.limited, true);
});

test('changing accounts remounts the map and clears the previous private GPS camera state', () => {
  const start = source.indexOf('export default function MapScreen()'), end = source.indexOf('function CityMap()', start);
  let auth = { isAuthed: true, me: { id: 'viewer-a' } };
  const exports = {};
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, CityMap: 'CityMap', useAuth: () => auth, useCommunityCity: () => ({ city: { id: 'vancouver' } }),
    require: () => ({ jsx: (_type, _props, key) => ({ key }) }),
  });
  const first = exports.default().key;
  auth = { isAuthed: true, me: { id: 'viewer-b' } };
  assert.notEqual(exports.default().key, first);
  auth = { isAuthed: false, me: { id: 'viewer-a' } };
  assert.notEqual(exports.default().key, first);
});

function requests({ deferFirst = false, filter = 'used', includeEvents = filter === 'all' || filter === 'events' || filter === 'festival' } = {}) {
  const start = source.indexOf('    request.current?.abort();');
  const end = source.indexOf('  }, [key, isAuthed, filter, city.id, search, viewerScope, daysKey, includeEvents]);', start);
  assert.ok(start > 0 && end > start);
  const calls = [], eventCalls = [], results = [], exports = {}, request = { current: null };
  let finishOld;
  vm.runInNewContext(compile(`export function run(previous) { ${source.slice(start, end)}\n}`), {
    exports, request, tr, key: previous.key, AbortController, Promise, Map, Set, isAuthed: true, filter, includeEvents,
    city: { id: 'vancouver' }, search: '', viewerScope: 'viewer', daysKey: '', supabase: {}, morePending: { current: false },
    setResult: value => results.push(value), setPendingKey() {},
    EVENT_CITIES: { vancouver: 'Vancouver' }, discoveryEvent: event => ({ id: `event:${event.id}` }),
    loadTicketmasterEvents: async query => { eventCalls.push(query); if (query.festival) throw new Error('offline'); return { events: [{ id: 'available' }], hasMore: false }; },
    loadDiscoveryPosts: (...args) => {
      calls.push(args);
      if (deferFirst && calls.length === 1) return new Promise(resolve => { finishOld = resolve; });
      return Promise.resolve({ items: [{ id: 'post:new' }], cursor: null, hasMore: false });
    },
  });
  return { load: exports.run, calls, eventCalls, results, request, finish: () => finishOld({ items: [{ id: 'post:stale' }], cursor: null, hasMore: false }) };
}
test('focus entry starts at page zero and cancels the request on blur', () => {
  const marker = '  useFocusEffect(useCallback(() => {';
  const start = source.indexOf(marker), end = source.indexOf('  }, [loadPage]));', start);
  assert.ok(start > 0 && end > start);
  const calls = [], exports = {}, request = { current: new AbortController() }, locationRevision = { current: 0 };
  const signal = request.current.signal;
  vm.runInNewContext(compile(`export function run() { ${source.slice(start + marker.length, end)}\n}`), {
    exports, request, locationRevision, setLocating() {}, morePending: { current: true }, loadPage: cursor => calls.push(cursor),
  });
  const cleanup = exports.run();
  assert.deepEqual(calls, [null]);
  cleanup();
  assert.equal(signal.aborted, true);
  assert.equal(request.current, null);
  assert.equal(locationRevision.current, 1);
});
test('a refresh replaces cached pages without advancing the old cursor', async () => {
  const ui = requests(); ui.load(null); await tick();
  assert.equal(ui.calls[0][4], null);
  assert.equal(ui.results[0], null);
  assert.equal(ui.results.at(-1).page, 0);
  assert.deepEqual(Array.from(ui.results.at(-1).items, item => item.id), ['post:new']);
});
test('an explicit More request continues from the previous cursor', async () => {
  const ui = requests(); ui.load(previous); await tick();
  assert.equal(ui.calls[0][4].id, 'last-post');
  assert.equal(ui.results.at(-1).page, 1);
  assert.deepEqual(Array.from(ui.results.at(-1).items, item => item.id), ['post:old', 'post:new']);
});
test('late pagination responses cannot restore stale pins after a refresh', async () => {
  const ui = requests({ deferFirst: true }); ui.load(previous); const signal = ui.request.current.signal;
  ui.load(null); await tick(); ui.finish(); await tick();
  assert.equal(signal.aborted, true);
  assert.deepEqual(Array.from(ui.results.at(-1).items, item => item.id), ['post:new']);
});
test('selecting a pin cancels a pending GPS recenter request', () => {
  const marker = '  const selectPin = (id: string) => {';
  const start = source.indexOf(marker), end = source.indexOf('  const locate = async () => {', start);
  const exports = {}, changes = {}, locationRevision = { current: 1 };
  vm.runInNewContext(compile(`export function run(id: string) { ${source.slice(start + marker.length, end).replace(/};\s*$/, '')}\n}`), {
    exports, locationRevision, setLocating: value => { changes.locating = value; }, setLocationError: value => { changes.error = value; },
    setSelectedId: value => { changes.id = value; }, setCenter: value => { changes.center = value; },
  });
  exports.run('post:chosen');
  assert.equal(locationRevision.current, 2);
  assert.deepEqual(changes, { locating: false, error: '', id: 'post:chosen', center: null });
});
test('a failed festival supplement keeps available results and reports the partial failure', async () => {
  const ui = requests({ filter: 'all' }); ui.load(null); await tick();
  assert.deepEqual(Array.from(ui.results.at(-1).items, item => item.id), ['post:new', 'event:available']);
  assert.equal(ui.results.at(-1).errors.length, 1);
});
test('pagination retains a source warning until a full refresh retries it', async () => {
  const ui = requests(); ui.load({ ...previous, errors: ['게시물 위치를 불러오지 못했어요.'] }); await tick();
  assert.equal(ui.results.at(-1).errors.length, 1);
});


test('mixed place or trading selections fetch an unrestricted public post page without unselected event calls', async () => {
  const ui = requests({ filter: 'all', includeEvents: false });
  ui.load(null); await tick();
  assert.equal(ui.calls[0][2], 'all');
  assert.equal(ui.eventCalls.length, 0);
  assert.deepEqual(Array.from(ui.results.at(-1).items, item => item.id), ['post:new']);
});
