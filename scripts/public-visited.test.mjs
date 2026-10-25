import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { placeMapRoute } from '../src/lib/discovery.ts';

const visit = { id: 'osm:node:123', cityId: 'vancouver', name: 'Test café', category: 'cafe', latitude: 49.28, longitude: -123.12,
  address: 'Test public address', sourceUrl: 'https://www.openstreetmap.org/node/123', photo: null,
  glingVisited: { sourceUrl: 'https://www.instagram.com/reel/test/' } };

function app({ query = {}, places = [visit], hydrated = true, catalogError = false, invalidCatalog = false, savedCatalog = null } = {}) {
  const file = new URL('../src/components/public-web/visited.tsx', import.meta.url);
  assert.ok(existsSync(file), 'Public Visited page has not been implemented');
  const state = [], feedback = [], pushes = [], effects = [], reads = [], applied = [];
  const refresh = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/city-place-refresh.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: refresh });
  let index = 0;
  const hooks = {
    useState(initial) { const n = index++; if (!(n in state)) state[n] = typeof initial === 'function' ? initial() : initial; return [state[n], value => { state[n] = typeof value === 'function' ? value(state[n]) : value; }]; },
    useEffect(effect) { effects.push(effect); },
    useSyncExternalStore(_subscribe, snapshot, serverSnapshot) { return hydrated ? snapshot() : serverSnapshot(); },
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'expo-router': { useLocalSearchParams: () => query, useRouter: () => ({ push: target => pushes.push(target) }) },
    'expo-router/head': { __esModule: true, default: 'Head' },
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'local-logo' }) } },
    '@/hooks/use-language': { useLanguage: () => ({ language: 'ko' }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false }) },
    '@/constants/theme': { WebNightColors: {} }, '@/lib/public-seo': { PUBLIC_SITE: 'https://gling.example' },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', state: 'open' }, { id: 'toronto', name: '토론토', englishName: 'Toronto', state: 'open' }] },
    '@/lib/city-places': { cityPlacesRevision: () => 0, subscribeCityPlaces() {}, getCityPlaces: city => places.filter(place => place.cityId === city), replaceCityPlacesCatalog: value => {
      if (value.invalid || (invalidCatalog && value.publicFixture)) throw Error('INVALID_PLACE_CATALOG');
      applied.push(value);
    } },
    '@react-native-async-storage/async-storage': { getItem: async () => savedCatalog ? JSON.stringify({ catalog: savedCatalog }) : null, setItem: async () => {} },
    '@/lib/city-place-refresh': refresh,
    '@/lib/discovery': { placeMapRoute },
    '@/lib/public-web-client': { publicWebClient: { rpc: name => { reads.push(name); return { abortSignal: async () => ({ data: catalogError ? null : { publicFixture: true }, error: catalogError ? Error('offline') : null }) }; } } },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/components/city-place-photo': { CityPlacePhoto: 'PlacePhoto' }, '@/components/discovery-map': { DiscoveryMap: 'DiscoveryMap' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require(name) {
      if (name.endsWith('.css')) return {};
      if (name in imports) return imports[name];
      if (name.includes('assets/')) return name;
      throw Error('Unexpected import ' + name);
    }, URLSearchParams, AbortController, setTimeout, clearTimeout });
  return { render() { index = 0; return exports.default(); }, feedback, pushes, query, effects, reads, applied };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => !tree ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
const plain = value => JSON.parse(JSON.stringify(value));

test('only exact attested city places appear on the public Visited page', () => {
  const ui = app({ places: [visit, { ...visit, id: 'osm:node:456', name: 'Unvisited', glingVisited: undefined }, { ...visit, id: 'osm:node:789', cityId: 'toronto', name: 'Other city' }] });
  const tree = ui.render();
  assert.ok(text(tree).includes('Test café'));
  assert.ok(!text(tree).includes('Unvisited') && !text(tree).includes('Other city'));
  assert.deepEqual(plain(nodes(tree).find(node => node.type === 'DiscoveryMap').props.markers).map(marker => marker.id), [visit.id]);
});

test('card and pin open the same city-scoped canonical destination with feedback', () => {
  const ui = app(); const tree = ui.render();
  nodes(tree).find(node => node.props?.['data-place-id'] === visit.id).props.onClick({ preventDefault() {} });
  const map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  map.props.onSelect(visit.id);
  map.props.onSelect('osm:node:999');
  assert.equal(ui.pushes.length, 2);
  for (const target of ui.pushes) {
    const url = new URL(target, 'https://gling.app');
    assert.equal(url.pathname, '/visited');
    assert.equal(url.searchParams.get('city'), 'vancouver');
    assert.equal(url.searchParams.get('placeId'), visit.id);
  }
  assert.deepEqual(ui.feedback, ['selection', 'selection']);
});

test('deep-linked selection, photo and app map retain the same exact place', () => {
  const ui = app({ query: { city: 'vancouver', placeId: visit.id } }); const tree = ui.render();
  const map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  assert.equal(map.props.selectedId, visit.id);
  assert.deepEqual(plain(map.props.center), { latitude: visit.latitude, longitude: visit.longitude });
  const link = nodes(tree).find(node => node.type === 'a' && node.props.href?.startsWith('gling://map?'));
  const url = new URL(link.props.href);
  assert.equal(url.searchParams.get('cityId'), visit.cityId); assert.equal(url.searchParams.get('placeId'), visit.id);
  assert.equal(url.searchParams.get('category'), 'visited');
  const event = { currentTarget: { href: link.props.href } };
  link.props.onClick(event);
  const first = new URL(event.currentTarget.href);
  link.props.onClick(event);
  const second = new URL(event.currentTarget.href);
  assert.equal(first.searchParams.get('placeId'), visit.id);
  assert.ok(first.searchParams.get('placeRequest'));
  assert.notEqual(first.searchParams.get('placeRequest'), second.searchParams.get('placeRequest'));
  assert.equal(nodes(tree).find(node => node.type === 'PlacePhoto').props.place.id, visit.id);
});

test('each city passes its actual map center name rather than silently using the Vancouver fallback', () => {
  const tree = app({ query: { city: 'toronto' }, places: [{ ...visit, cityId: 'toronto' }] }).render();
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.cityName, 'Toronto');
});

test('a remote catalog flag cannot attest a team visit or leak a different branch', () => {
  const seed = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8'));
  const current = seed.cities.vancouver.places[0];
  current.glingVisited = { sourceUrl: 'https://www.instagram.com/reel/forged/' };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/city-places.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, URL, require: name => name.endsWith('city-places.catalog.json') ? seed
    : name.endsWith('city-places.photos.json') ? { cities: {} } : name.endsWith('gling-visited.json') ? []
      : { CITIES: Object.keys(seed.cities).map(id => ({ id })) } });
  const remote = structuredClone(seed);
  remote.selectionRevision = seed.selectionRevision + 1;
  assert.equal(exports.replaceCityPlacesCatalog(remote, Date.parse(remote.collectedAt)), true);
  assert.ok(exports.getCityPlaces('vancouver').every(place => !place.glingVisited));
});

test('a stale or different-city destination cannot silently open another place', () => {
  const ui = app({ query: { city: 'toronto', placeId: visit.id } }); const tree = ui.render();
  assert.ok(!nodes(tree).some(node => node.type === 'DiscoveryMap' || node.props?.href?.startsWith('gling://map?')));
  assert.ok(text(tree).includes('아직 등록된 방문 장소가 없어요'));
  const stale = app({ query: { city: 'vancouver', placeId: 'osm:node:999' } }).render();
  assert.equal(nodes(stale).find(node => node.type === 'DiscoveryMap').props.selectedId, null);
  assert.ok(!nodes(stale).some(node => node.props?.href?.startsWith('gling://map?')));
});

test('initial static export never starts the web map and preserves an honest empty city', () => {
  const tree = app({ places: [], hydrated: false }).render();
  assert.ok(!nodes(tree).some(node => node.type === 'DiscoveryMap'));
  assert.ok(text(tree).includes('아직 등록된 방문 장소가 없어요'));
  const source = readFileSync(new URL('../src/components/public-web/visited.tsx', import.meta.url), 'utf8');
  for (const forbidden of ['getCurrentPosition', 'requestForegroundPermissions', 'getSession', 'loadDiscoveryPosts', 'create_meetup_with_post']) assert.ok(!source.includes(forbidden), forbidden);
});

test('catalog refresh uses the public client and passes untrusted data through the existing validator', async () => {
  const ui = app(); ui.render();
  const cleanup = ui.effects[0]();
  await new Promise(setImmediate);
  assert.deepEqual(ui.reads, ['get_city_place_catalog']);
  assert.deepEqual(plain(ui.applied), [{ publicFixture: true }]);
  assert.ok(!text(ui.render()).includes('최신 장소 정보를 확인하고 있어요'));
  cleanup();
});

test('a failed catalog read keeps the saved visit and distinguishes failure from an empty result', async () => {
  const ui = app({ catalogError: true }); ui.render();
  const cleanup = ui.effects[0]();
  await new Promise(setImmediate);
  const tree = ui.render();
  assert.ok(text(tree).includes('최신 장소 정보를 불러오지 못했어요'));
  assert.ok(text(tree).includes(visit.name));
  assert.ok(!text(tree).includes('아직 등록된 방문 장소가 없어요'));
  assert.equal(ui.applied.length, 0);
  cleanup();
});

test('an invalid RPC catalog preserves the saved visit and shows the fallback warning after the refresh helper catches validation', async () => {
  const ui = app({ invalidCatalog: true, savedCatalog: { savedFixture: true } }); ui.render();
  const cleanup = ui.effects[0]();
  await new Promise(setImmediate);
  const tree = ui.render();
  assert.ok(text(tree).includes('최신 장소 정보를 불러오지 못했어요'));
  assert.ok(text(tree).includes(visit.name));
  assert.deepEqual(plain(ui.applied), [{ savedFixture: true }]);
  cleanup();
});

test('a valid remote catalog clears a corrupt-cache warning in the same refresh', async () => {
  const ui = app({ savedCatalog: { invalid: true } }); ui.render();
  const cleanup = ui.effects[0]();
  await new Promise(setImmediate);
  assert.ok(!text(ui.render()).includes('최신 장소 정보를 불러오지 못했어요'));
  assert.deepEqual(plain(ui.applied), [{ publicFixture: true }]);
  cleanup();
});
