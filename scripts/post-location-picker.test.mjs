import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import * as discovery from '../src/lib/discovery.ts';
import { discoveryMarkers } from '../src/lib/discovery-map-html.ts';
import { CITIES } from '../src/lib/mock.ts';
import * as maps from '../src/lib/post-maps.ts';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const run = (path, imports) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, require: withLanguageImports(name => name in imports ? imports[name] : new Proxy({}, { get: (_, key) => String(key) })), URL, URLSearchParams, Error, Set, Map });
  return exports;
};
const places = run('src/lib/city-places.ts', {
  './city-places.catalog.json': json('src/lib/city-places.catalog.json'), './gling-visited.json': json('src/lib/gling-visited.json'),
  './city-places.photos.json': json('src/lib/city-places.photos.json'), '@/lib/mock': { CITIES },
});

// The compose place picker with recorded feedback and a confirm callback.
function picker({ cityName = 'Vancouver', initialPin = null, initialLabel = '' } = {}) {
  const slots = [], feedback = [], confirmed = [], catalog = { revision: 0 };
  let at = 0;
  const jsx = (type, props) => ({ type, props });
  const ui = run('src/components/post-location-picker.tsx', {
    react: { useState: initial => { const i = at++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; }, useRef: value => ({ current: value }), useEffect() {},
      useMemo: (fn, deps) => { const i = at++, last = slots[i]; if (last && deps.every((dep, k) => Object.is(dep, last.deps[k]))) return last.value; slots[i] = { value: fn(), deps }; return slots[i].value; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', TextInput: 'TextInput', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' }, StyleSheet: { create: value => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'react-native-reanimated': { useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 20 }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/city-place-photo': { CityPlacePhoto: 'CityPlacePhoto' },
    '@/components/discovery-map': { DiscoveryMap: 'DiscoveryMap' }, '@/components/post-pin-map': { PostPinMap: 'PostPinMap' }, '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/clay': { useClay: () => false, ClayIcon: () => null, ClayPillFill: () => null },
    '@/hooks/use-city-places': { useCityPlacesRevision: () => catalog.revision }, '@/hooks/use-theme': { useTheme: () => ({ accent: '#6E4AA2' }) },
    '@/lib/city-places': places, '@/lib/discovery': discovery, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/location': { isFreshLocation: () => true }, '@/lib/mock': { CITIES }, '@/lib/post-maps': maps,
  });
  const render = () => { at = 0; return nodes(ui.PostLocationPicker({ visible: true, initialPin, initialLabel, cityName, onClose() {}, onConfirm: (pin, label) => confirmed.push({ pin, label }) })); };
  const find = (tree, id) => tree.find(node => node.props?.analyticsId === id);
  return { render, find, feedback, confirmed, catalog };
}

test('place add opens on the map tab pins for the city, and a tapped pin is the place that gets attached', () => {
  const app = picker(), list = places.getCityDiscoveryPlaces('vancouver');
  let tree = app.render();
  assert.equal(tree.some(node => node.type === 'PostPinMap'), false, 'the empty pin map is no longer the first thing shown');
  const map = tree.find(node => node.type === 'DiscoveryMap');
  assert.deepEqual(map.props.markers.map(marker => marker.id), list.map(place => place.id), 'every place the writer search lists, nothing else');
  assert.equal(map.props.selectedId, null); assert.equal(map.props.center, null); assert.equal(map.props.zoom, undefined, 'the whole city, as the map tab opens');
  const top = list.find(place => place.recommendation?.placeId === place.id), marker = map.props.markers.find(value => value.id === top.id);
  const category = discovery.DISCOVERY_CATEGORIES.find(value => value.id === discovery.discoveryPlace(top).category);
  assert.equal(marker.color, category.color); assert.equal(marker.icon, category.art); assert.equal(marker.label, top.name);
  assert.equal(marker.top25, true); assert.equal(marker.featured, true);
  // The pins pass the map's own marker checks, which turn the whole map into its error card on any bad one.
  assert.equal(discoveryMarkers(map.props.markers).length, list.length);
  assert.equal(app.find(tree, 'post.location.confirm').props.disabled, true, 'nothing chosen yet');
  // Typing in the search box keeps the same pin list, so the map is not handed every pin again (map lag 2026-11-11); a refreshed catalog is.
  tree.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '장소·주소 검색').props.onChangeText('sci');
  assert.strictEqual(app.render().find(node => node.type === 'DiscoveryMap').props.markers, map.props.markers);
  app.catalog.revision++;
  assert.notStrictEqual(app.render().find(node => node.type === 'DiscoveryMap').props.markers, map.props.markers);

  map.props.onSelect('chosen'); map.props.onSelect('osm:way:0');
  assert.equal(app.render().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '첨부할 위치 이름'), undefined, 'an unknown pin chooses nothing');
  map.props.onSelect(top.id);
  tree = app.render();
  assert.deepEqual(app.feedback, [], 'the map already gave the pin tap its feedback');
  assert.equal(tree.find(node => node.type === 'DiscoveryMap').props.selectedId, top.id);
  assert.equal(tree.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '첨부할 위치 이름').props.value, top.name);
  app.find(tree, 'post.location.confirm').props.onPress();
  assert.deepEqual(plain(app.confirmed), [{ pin: { latitude: top.latitude, longitude: top.longitude }, label: top.name }]);
  assert.deepEqual(app.feedback, ['selection']);
});

test('직접 핀 놓기 keeps the old free pin map, and a spot that is not one of our places shows as its own pin', () => {
  const app = picker({ initialPin: { latitude: 49.3, longitude: -123.2 }, initialLabel: '내 위치' });
  let tree = app.render(), map = tree.find(node => node.type === 'DiscoveryMap');
  discoveryMarkers(map.props.markers);
  assert.deepEqual(plain(map.props.markers.at(-1)), { id: 'chosen', latitude: 49.3, longitude: -123.2, color: '#6E4AA2', label: '선택한 위치', featured: true });
  assert.equal(map.props.selectedId, 'chosen'); assert.deepEqual(plain(map.props.center), { latitude: 49.3, longitude: -123.2, requestId: 0 }); assert.equal(map.props.zoom, 15);
  const mode = app.find(tree, 'post.location.mode');
  assert.ok(nodes(mode).some(node => node.props?.children === '직접 핀 놓기'));
  mode.props.onPress();
  tree = app.render();
  assert.equal(tree.some(node => node.type === 'DiscoveryMap'), false);
  const free = tree.find(node => node.type === 'PostPinMap');
  assert.deepEqual(plain(free.props.pin), { latitude: 49.3, longitude: -123.2 });
  assert.ok(nodes(app.find(tree, 'post.location.mode')).some(node => node.props?.children === '글링 장소 보기'));
  free.props.onSelect({ latitude: 49.31, longitude: -123.21 }, '');
  assert.deepEqual(app.feedback, ['selection', 'selection'], 'the switch and a free map tap each answer once');
  app.find(app.render(), 'post.location.mode').props.onPress();
  map = app.render().find(node => node.type === 'DiscoveryMap');
  assert.equal(map.props.center.latitude, 49.31, 'back on our pins, the camera starts where the pin now is');
});

test('a city without map places opens the free pin map with no switch', () => {
  const app = picker({ cityName: 'Seoul' }), tree = app.render();
  assert.ok(tree.some(node => node.type === 'PostPinMap'));
  assert.equal(tree.some(node => node.type === 'DiscoveryMap'), false);
  assert.equal(app.find(tree, 'post.location.mode'), undefined);
  assert.ok(tree.some(node => node.props?.children === '가게를 누르거나, 원하는 지점으로 핀을 옮겨보세요.'));
});
