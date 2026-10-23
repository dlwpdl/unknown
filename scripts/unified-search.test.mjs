import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const merchant = 'a2350000-0000-4000-8000-000000000001';
const places = { vancouver: [
  { id: 'osm:node:1', cityId: 'vancouver', name: 'Jimoco', address: 'Public address' },
  { id: 'osm:node:2', cityId: 'vancouver', name: 'Jimoco Park', address: 'Park address' },
], toronto: [{ id: 'osm:node:3', cityId: 'toronto', name: 'Jimoco Toronto', address: 'Toronto address' }] };
function setup(change = value => value, catalog = places) {
  const calls = [], exports = {};
  const modules = {
    './city-places.ts': { getCityDiscoveryPlaces: city => catalog[city] ?? [] },
    './delivery-partners.ts': { DELIVERY_PARTNERS: [] },
    './mock.ts': { CITIES: [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }, { id: 'closed', state: 'planned' }] },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/unified-search.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, URL, Set, Map, Error, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  const client = { rpc(name, args) {
    const call = { name, args }; calls.push(call);
    const response = { data: change({ query: args.p_query, cityId: args.p_city_id, kind: args.p_kind, offset: args.p_offset, items: [], links: [], hasMore: false, nextOffset: args.p_offset }), error: null };
    const promise = Promise.resolve(response); promise.abortSignal = signal => { call.signal = signal; return promise; }; return promise;
  } };
  return { load: options => exports.loadUnifiedSearch(client, options), calls };
}
const request = { query: '지모코', cityId: 'vancouver', kind: 'all' };

test('one scoped RPC merges curated places and canonical business aliases without another city/profile read', async () => {
  const h = setup(value => ({ ...value, items: [{ kind: 'business', id: merchant, merchantId: merchant, cityId: 'vancouver', title: 'Jimoco branch', subtitle: 'Public address' }],
    links: [{ cityId: 'vancouver', placeId: 'osm:node:1', merchantId: merchant }] }));
  const page = await h.load(request);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'search_public_directory');
  assert.equal(h.calls[0].args.p_query, 'jimoco'); assert.equal(h.calls[0].args.p_city_id, 'vancouver');
  assert.equal(h.calls[0].args.p_places.length, 2); assert.deepEqual(Object.keys(h.calls[0].args.p_places[0]).sort(), ['cityId', 'placeId', 'rank']);
  assert.equal(page.items.length, 2); assert.equal(page.items.filter(item => item.kind === 'business').length, 1);
  assert.equal(page.items.find(item => item.kind === 'place').id, 'osm:node:2'); assert.equal(page.hasMore, false);
});
test('Canada null expands curated places explicitly; city and query filtering never changes saved city', async () => {
  const h = setup(); const page = await h.load({ ...request, cityId: null });
  assert.equal(h.calls[0].args.p_city_id, null); assert.equal(page.items.length, 3);
  const empty = setup(); assert.deepEqual(JSON.parse(JSON.stringify(await empty.load({ ...request, query: '  ' }))), { items: [], hasMore: false, nextOffset: 0 }); assert.equal(empty.calls.length, 0);
});
test('Korean and English cafe category searches find curated cafes and keep exact names first', async () => {
  const catalog = { vancouver: [
    { id: 'osm:node:11', name: 'Revolver', category: 'cafe', address: 'Public cafe address' },
    { id: 'osm:node:12', name: '카페', category: 'food', address: '' },
    { id: 'osm:node:13', name: 'Queen Elizabeth Park', category: 'places', address: '' },
  ], toronto: [{ id: 'osm:node:14', name: 'Pilot', category: 'cafe', address: '' }] };
  for (const query of ['카페', 'cafe', 'café', 'coffee', '커피']) {
    const h = setup(value => value, catalog), page = await h.load({ query, cityId: 'vancouver', kind: 'place' });
    assert.ok(page.items.some(item => item.id === 'osm:node:11'), query);
    assert.ok(page.items.every(item => item.cityId === 'vancouver' && item.id !== 'osm:node:13'));
    assert.equal(h.calls.length, 1); assert.ok(h.calls[0].args.p_places.every(place => place.rank >= 0 && place.rank <= 2));
    if (query === '카페') assert.equal(page.items[0].id, 'osm:node:12');
  }
  const canada = await setup(value => value, catalog).load({ query: '카페', cityId: null, kind: 'place' });
  assert.ok(canada.items.some(item => item.cityId === 'toronto'));
});
test('place pagination is real, stable and bounded after canonical branch deduplication', async () => {
  const catalog = { vancouver: Array.from({ length: 43 }, (_, i) => ({ id: `osm:node:${i + 1}`, cityId: 'vancouver', name: `Jimoco ${String(i).padStart(2, '0')}`, address: '' })) };
  const h = setup(value => ({ ...value, links: [{ cityId: 'vancouver', placeId: 'osm:node:1', merchantId: merchant }, { cityId: 'vancouver', placeId: 'osm:node:2', merchantId: merchant }] }), catalog);
  const first = await h.load({ ...request, kind: 'place' }), second = await h.load({ ...request, kind: 'place', offset: first.nextOffset });
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 20);
  assert.equal(second.items.length, 20); assert.equal(second.hasMore, true);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 40);
  assert.equal(first.items[0].merchantId, merchant);
});
test('response scope, kinds, IDs, cities, duplicate rows/links and private fields are rejected', async () => {
  for (const change of [value => ({ ...value, query: 'other' }), value => ({ ...value, cityId: null }), value => ({ ...value, kind: 'post' }),
    value => ({ ...value, offset: 20 }), value => ({ ...value, links: [{ cityId: 'toronto', placeId: 'osm:node:3', merchantId: merchant }] }),
    value => ({ ...value, items: [{ kind: 'person', id: 'bad', cityId: 'vancouver', title: 'Name', subtitle: '' }] }),
    value => ({ ...value, items: [{ kind: 'person', id: merchant, cityId: 'closed', title: 'Name', subtitle: '' }] }),
    value => ({ ...value, items: [{ kind: 'person', id: merchant, cityId: 'toronto', title: 'Name', subtitle: '' }] }),
    value => ({ ...value, items: Array(2).fill({ kind: 'person', id: merchant, cityId: 'vancouver', title: 'Name', subtitle: '' }) }),
    value => ({ ...value, links: Array(2).fill({ cityId: 'vancouver', placeId: 'osm:node:1', merchantId: merchant }) }),
    value => ({ ...value, items: [{ kind: 'place', id: 'osm:node:1', cityId: 'vancouver', title: 'Untrusted place', subtitle: '' }] }),
    value => ({ ...value, items: [{ kind: 'person', id: merchant, cityId: 'vancouver', title: 'Name', subtitle: '', email: 'PRIVATE' }] })]) {
    await assert.rejects(setup(change).load(request), /INVALID_UNIFIED_SEARCH/);
  }
});
test('missing RPC and backend failures never silently claim an empty unified search', async () => {
  const h = setup(() => { throw Error('PGRST202'); });
  await assert.rejects(h.load(request), /PGRST202/); assert.equal(h.calls.length, 1);
});
test('filtered server pagination and abort signals retain the fixed contract and reject false cursors', async () => {
  const controller = new AbortController();
  const rows = Array.from({ length: 20 }, (_, i) => ({ kind: 'person', id: `a2350000-0000-4000-8000-${String(i).padStart(12, '0')}`, cityId: 'vancouver', title: 'Person', subtitle: '' }));
  const h = setup(value => ({ ...value, items: rows, hasMore: true, nextOffset: value.offset + 20 }));
  const page = await h.load({ ...request, kind: 'person', offset: 20, signal: controller.signal });
  assert.equal(page.nextOffset, 40); assert.equal(page.hasMore, true); assert.equal(h.calls[0].signal, controller.signal);
  await assert.rejects(setup(value => ({ ...value, hasMore: true, nextOffset: 0 })).load({ ...request, kind: 'person' }), /INVALID_UNIFIED_SEARCH/);
  controller.abort(); const stopped = setup(); await assert.rejects(stopped.load({ ...request, signal: controller.signal }), /SEARCH_ABORTED/); assert.equal(stopped.calls.length, 0);
});
test('invalid requests and oversized local candidate sets fail before network access', async () => {
  for (const change of [{ cityId: undefined }, { cityId: 'closed' }, { cityId: 'unknown' }, { kind: 'users' }, { offset: -1 }, { offset: 0.5 }, { query: 'x'.repeat(121) }]) {
    const h = setup(); await assert.rejects(h.load({ ...request, ...change }), /INVALID_UNIFIED_SEARCH/); assert.equal(h.calls.length, 0);
  }
  const catalog = { vancouver: Array.from({ length: 2201 }, (_, i) => ({ id: `osm:node:${i + 1}`, cityId: 'vancouver', name: 'Jimoco', address: '' })) };
  const h = setup(value => value, catalog); await assert.rejects(h.load(request), /SEARCH_PLACE_LIMIT/); assert.equal(h.calls.length, 0);
});
