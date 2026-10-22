import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DISCOVERY_CATEGORIES, discoveryMatches, discoveryPlace, mergeCityTop25, placeMapRoute } from '../src/lib/discovery.ts';

const place = { id: 'osm:node:100', cityId: 'vancouver', name: 'Fixture firsthand restaurant', category: 'food',
  latitude: 49.29, longitude: -123.13, address: 'Fixture address', sourceUrl: 'https://www.openstreetmap.org/node/100' };
const visit = { sourceUrl: 'https://www.instagram.com/reel/fixture/' };

test('team visited filter is independent of dining, curated picks and other branches', () => {
  const visited = discoveryPlace({ ...place, glingVisited: visit });
  const unvisited = discoveryPlace(place);
  assert.equal(discoveryMatches(visited, 'visited', ''), true);
  assert.equal(discoveryMatches(visited, 'dining', ''), true);
  assert.equal(discoveryMatches(visited, 'all', ''), true);
  assert.equal(discoveryMatches(visited, 'cafe', ''), false);
  assert.equal(discoveryMatches(unvisited, 'visited', ''), false);
  assert.equal(discoveryMatches({ ...unvisited, top25: {} }, 'visited', ''), false);
  assert.equal(discoveryMatches(visited, 'visited', 'unmatched venue'), false);
});

test('the exact canonical visited place and its public visit link survive TOP 50 merging', () => {
  const visited = discoveryPlace({ ...place, glingVisited: visit });
  const otherBranch = discoveryPlace({ ...place, id: 'osm:node:101' });
  const pick = { id: place.id, cityId: place.cityId, title: place.name, label: place.address, category: 'dining',
    latitude: place.latitude, longitude: place.longitude, reason: 'Fixture editorial reason',
    sourceUrl: 'https://example.org/fixture-guide', postIds: [] };
  const items = mergeCityTop25([visited, otherBranch], place.cityId, [pick]);
  assert.equal(items.length, 2);
  assert.equal(items.find(item => item.sourceId === place.id).glingVisited.sourceUrl, visit.sourceUrl);
  assert.equal(items.find(item => item.sourceId === otherBranch.sourceId).glingVisited, undefined);
  assert.equal(items.filter(item => discoveryMatches(item, 'visited', '')).length, 1);
  assert.equal(mergeCityTop25([visited], 'toronto', []).length, 0);
});

test('the real dining helper mixes a reviewed cafe into TOP 50 without exposing unreviewed cafes or inventing visits', () => {
  const seed = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url)));
  const chosen = new Set(seed.cities.toronto.recommendations.map(pick => pick.placeId));
  const cafe = seed.cities.toronto.places.find(place => place.category === 'cafe' && !chosen.has(place.id));
  const ordinary = seed.cities.toronto.places.find(place => place.category === 'cafe' && place.id !== cafe.id && !chosen.has(place.id));
  seed.cities.toronto.diningRecommendations = [{ placeId: cafe.id, reason: 'Fixture cafe selection', sourceUrl: 'https://example.org/fixture-guide', verifiedAt: seed.collectedAt }];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/city-places.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, URL, require: name => name.endsWith('city-places.catalog.json') ? seed
    : name.endsWith('city-places.photos.json') ? { cities: {} } : name.endsWith('gling-visited.json') ? []
      : { CITIES: Object.keys(seed.cities).map(id => ({ id })) } });
  const mapped = Array.from(exports.getCityDiscoveryPlaces('toronto'), discoveryPlace);
  const item = mapped.find(item => item.sourceId === cafe.id);
  assert.ok(item);
  assert.equal(discoveryMatches(item, 'cafe', ''), true);
  assert.equal(discoveryMatches(item, 'top25', ''), true);
  assert.equal(item.top25.id, cafe.id);
  assert.equal(item.glingVisited, undefined);
  assert.equal(item.place.photo, null);
  assert.equal(mapped.some(item => item.sourceId === ordinary.id), false);
  assert.equal(exports.getCityBrowsePlaces('toronto', 'cafe').length, 1);
  assert.equal(exports.getCityBrowsePlaces('toronto', 'all').length, Math.min(50, chosen.size + 1));
});

const map = ts.createSourceFile('map.tsx', readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = (root, predicate) => {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root); return found;
};
const run = (code, context) => vm.runInNewContext(ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText, context);

test('the real map marker and explicit map entry identify team visits without changing the place pin', () => {
  const expression = nodes(map, node => ts.isVariableDeclaration(node) && node.name.getText(map) === 'markers')[0].initializer;
  const visited = discoveryPlace({ ...place, glingVisited: visit });
  const markers = run(expression.getText(map), { pins: [visited, discoveryPlace({ ...place, id: 'osm:node:101' })], DISCOVERY_CATEGORIES,
    tr: value => value, hasAdLabel: () => false });
  assert.equal(markers[0].label, 'gling Visited');
  assert.equal(markers[0].color, '#CBB9FF');
  assert.equal(markers[0].latitude, place.latitude);
  assert.equal(markers[0].longitude, place.longitude);
  assert.equal(markers[1].label, '맛집');
  assert.notEqual(markers[1].color, markers[0].color);
  const route = placeMapRoute({ ...place, glingVisited: visit });
  assert.equal(route.params.category, 'visited');
  assert.equal(route.params.cityId, place.cityId);
  assert.equal(route.params.placeId, place.id);
});

test('the real visit action opens only its supplied public visit link and gives press/error feedback', async () => {
  const fn = nodes(map, node => ts.isFunctionDeclaration(node) && node.name?.text === 'GlingVisitNote')[0];
  assert.ok(fn);
  const feedback = [], links = [], alerts = [], exports = {};
  let reject = false;
  run(fn.getText(map) + '\nexports.render = GlingVisitNote;', { exports, View: 'view', ThemedText: 'text', Pressable: 'button', styles: {},
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useTheme: () => ({ line: '#343443' }), useLanguage: () => ({ tr: (value, title) => value.replace('{0}', title) }),
    useInteractionFeedback: () => ({ play: value => feedback.push(value) }),
    Linking: { openURL: url => { links.push(url); return reject ? Promise.reject(new Error('offline')) : Promise.resolve(); } },
    Alert: { alert: (...args) => alerts.push(args) },
  });
  assert.equal(exports.render({ item: discoveryPlace(place) }), null);
  const note = exports.render({ item: discoveryPlace({ ...place, glingVisited: visit }) });
  const button = note.props.children.find(child => child.type === 'button');
  assert.equal(button.props.accessibilityRole, 'link');
  assert.ok(button.props.accessibilityLabel.includes(place.name));
  button.props.onPress(); await new Promise(setImmediate);
  assert.deepEqual(links, [visit.sourceUrl]);
  assert.deepEqual(feedback, ['selection']);
  reject = true; button.props.onPress(); await new Promise(setImmediate);
  assert.deepEqual(feedback, ['selection', 'selection', 'warning']);
  assert.equal(alerts.length, 1);
});

test('a visited place falls back to its own business photo when the licence catalogue has none', () => {
  const seed = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url)));
  const place = seed.cities.toronto.places.find(p => p.category === 'food');
  const venuePhoto = { artist: 'Fixture venue', title: 'Fixture plate', license: 'Business-provided photo',
    uri: 'https://example.org/venue.jpg', sourceUrl: 'https://example.org', licenseUrl: 'https://example.org',
    imageSha256: '0'.repeat(64) };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/city-places.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, URL, require: name => name.endsWith('city-places.catalog.json') ? seed
    : name.endsWith('city-places.photos.json') ? { cities: {} }
      : name.endsWith('gling-visited.json') ? [{ cityId: 'toronto', placeId: place.id, sourceUrl: 'https://www.instagram.com/reel/fixture/', photo: venuePhoto }]
        : { CITIES: Object.keys(seed.cities).map(id => ({ id })) } });
  const mapped = Array.from(exports.getCityDiscoveryPlaces('toronto'), discoveryPlace);
  const item = mapped.find(item => item.sourceId === place.id);
  assert.equal(item.place.photo.uri, venuePhoto.uri);
  assert.equal(item.place.photo.license, 'Business-provided photo');
  assert.equal(item.glingVisited.sourceUrl, 'https://www.instagram.com/reel/fixture/');
});
