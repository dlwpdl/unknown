import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers } from '../src/lib/discovery-map-html.ts';
import { MAP_PIN_ART } from '../src/lib/map-pin-art.ts';
import { MAP_ZOOM_ART } from '../src/lib/map-zoom-art.ts';
import { facingDegrees } from '../src/lib/location.ts';


const marker = { id: 'place:1', latitude: 49.28, longitude: -123.12, color: '#d86632', label: '카페' };
const sessionId = 'canvas-1';
const options = { markers: [marker], cityName: 'Vancouver', sessionId, parentOrigin: 'https://gling.app' };

test('native map startup has a bounded fallback, cancels after ready and rearms on retry; loading and failure never show together (QA C14-1)', () => {
  const slots = [], timers = new Map();
  let index = 0, nextTimer = 0, effects = [];
  const react = {
    useId: () => 'native-canvas', useMemo: fn => fn(), useCallback: fn => fn,
    useRef(value) { const slot = index++; return slots[slot] ??= { current: value }; },
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useEffect(fn, deps) {
      const slot = index++, previous = slots[slot];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      effects.push(() => { previous?.cleanup?.(); slots[slot] = { deps, cleanup: fn() }; });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'ios' }, View: 'View', StyleSheet: { create: value => value } },
    'react-native-webview': { __esModule: true, default: 'WebView' },
    '@/hooks/use-language': { useLanguage: () => ({ language: 'ko', tr: value => value }) },
    '@/components/clay': { useClay: () => true, useDark: () => false }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/gling-loader': { GlingLoader: 'GlingLoader' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/discovery-map-html': { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers },
    'expo-location': {}, '@/lib/location': { facingDegrees },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/discovery-map.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, require(name) { assert.ok(name in imports, name); return imports[name]; },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const props = { markers: [marker], cityName: 'Vancouver', onSelect() {} };
  const Canvas = exports.DiscoveryMap(props).type;
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const render = () => { index = 0; effects = []; const tree = Canvas(props); effects.forEach(fn => fn()); return nodes(tree); };
  const failed = tree => tree.some(node => node.props?.accessibilityLiveRegion === 'polite');
  const loader = tree => tree.find(node => node.type === 'GlingLoader')?.props.accessibilityLabel;
  props.active = false;
  let tree = render();
  assert.equal(timers.size, 0, 'a map tab mounted in the background does not count its slow start as a failure');
  assert.equal(loader(tree), '지도 불러오는 중');
  props.active = true;
  tree = render();
  assert.equal(failed(tree), false);
  assert.equal(loader(tree), '지도 불러오는 중', 'the first load shows the logo, not the failure card');
  assert.equal(timers.size, 1, 'native startup cannot rely on JavaScript inside a stalled WebView');
  assert.equal([...timers.values()][0].delay, 15000);
  [...timers.values()][0].fn();
  tree = render(); assert.equal(failed(tree), true); assert.equal(loader(tree), undefined, 'no logo on top of the failure');
  tree.find(node => node.props?.analyticsId === 'discovery.map.retry').props.onPress();
  tree = render(); assert.equal(failed(tree), false); assert.equal(timers.size, 1);
  const web = tree.find(node => node.type === 'WebView');
  assert.ok(web.props.cacheEnabled !== false && !web.props.incognito, 'base-map tiles stay cached between visits (map lag 2026-11-11)');
  assert.equal(web.props.sharedCookiesEnabled, false);
  web.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready', sessionId: 'native-canvas.0' }) } });
  render(); assert.equal(timers.size, 1, 'old map readiness cannot cancel the new attempt');
  web.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready', sessionId: 'native-canvas.1' }) } });
  tree = render(); assert.equal(failed(tree), false); assert.equal(timers.size, 0); assert.equal(loader(tree), undefined);
  props.loading = true;
  tree = render(); assert.equal(loader(tree), '지도 결과 불러오는 중', 'results loading shows over the drawn map');
  const cover = tree.find(node => [node.props?.children].flat().some(child => child?.type === 'GlingLoader'));
  assert.equal(cover.props.pointerEvents, 'none');
  assert.ok(![cover.props.style].flat().some(style => style && 'backgroundColor' in style), 'a drawn map stays visible under the results loader');
  props.loading = false;
  props.markers = [{ ...marker, label: 'updated' }];
  render(); assert.equal(timers.size, 0, 'ordinary marker updates do not restart a loaded map');
  slots.forEach(slot => slot?.cleanup?.());
});

test('zoom buttons are clay only while 3D is on, and the picture pins stay either way', () => {
  const page = clay => discoveryMapHtml({ markers: [], cityName: 'vancouver', sessionId: 's', clay });
  assert.match(page(true), /maplibregl-ctrl-zoom-in \.maplibregl-ctrl-icon\{background:url\(data:image\/png/);
  assert.doesNotMatch(page(false), /maplibregl-ctrl-zoom-in \.maplibregl-ctrl-icon\{background:url/);
  assert.match(page(false), /\.maplibregl-ctrl-group button\{width:44px;height:44px\}/);
  assert.equal(page(false).includes(Object.values(MAP_PIN_ART)[0]), page(true).includes(Object.values(MAP_PIN_ART)[0]));
});

test('the dark theme draws the free dark style, and the map own tags, counts, pills and zoom art in the dark palette', () => {
  const dark = { background: '#0B0B12', card: '#171722', text: '#F6F3F0', textSecondary: '#B7B4C3', line: '#343443', backgroundSelected: '#343443' };
  const light = discoveryMapHtml(options), night = discoveryMapHtml({ ...options, dark });
  assert.ok(light.includes("style:'https://tiles.openfreemap.org/styles/positron'") && !light.includes('styles/dark'));
  assert.ok(night.includes("style:'https://tiles.openfreemap.org/styles/dark'") && !night.includes('styles/positron'));
  assert.ok(light.includes("namePaint={'text-color':'#302047'}") && light.includes("tx.fillStyle='rgba(255,255,255,0.95)'"));
  assert.ok(night.includes("namePaint={'text-color':'#F6F3F0'}") && night.includes("tx.fillStyle='#171722f2'") && night.includes("'circle-color':'#171722','circle-stroke-color':'#9283ac'"));
  assert.ok(night.includes('.city-pill{border-color:#343443;background:#171722;color:#F6F3F0}') && night.includes('html,body,#map{background:#0B0B12}'));
  assert.ok(night.includes(`url(${MAP_ZOOM_ART.inDark})`) && !light.includes(MAP_ZOOM_ART.inDark));
  assert.ok(discoveryMapHtml({ ...options, dark, clay: false }).includes('.maplibregl-ctrl-icon{filter:invert(1)}'));
  assert.ok(night.includes('© OpenStreetMap</a>'));
  assert.throws(() => discoveryMapHtml({ ...options, dark: { ...dark, card: '#fff' } }));
});

test('validates marker bounds, coordinates, unique identifiers and CSS colors', () => {
  assert.deepEqual(discoveryMarkers([{ ...marker, privateText: 'never pass through' }]), [marker]);
  for (const bad of [
    { id: '' }, { id: 'x'.repeat(181) }, { id: 'bad\u0000id' }, { label: 'x'.repeat(81) },
    { latitude: NaN }, { latitude: Infinity }, { latitude: 91 }, { longitude: -181 },
    { latitude: '49' }, { color: 'red' }, { color: '#fff;display:none' },
  ]) assert.throws(() => discoveryMarkers([{ ...marker, ...bad }]));
  assert.throws(() => discoveryMarkers([marker, marker]));
  assert.throws(() => discoveryMarkers(Array.from({ length: 501 }, (_, i) => ({ ...marker, id: String(i) }))));
  assert.equal(discoveryMarkers(Array.from({ length: 500 }, (_, i) => ({ ...marker, id: String(i) }))).length, 500);
});

test('escapes dynamic JSON in HTML and injected scripts without forwarding extra data', () => {
  const attack = '</script><script>globalThis.pwned=true</script>\u2028\u2029';
  const markers = [{ ...marker, id: attack, label: attack, token: 'secret-auth' }];
  const html = discoveryMapHtml({ ...options, markers });
  assert.ok(!html.includes(attack));
  assert.ok(!html.includes('secret-auth'));
  assert.ok(html.includes('\\u003c/script>'));
  const script = discoveryMapScript({ markers, selectedId: attack, center: null }, sessionId);
  assert.ok(!script.includes('</script>'));
  const calls = [];
  vm.runInNewContext(script, { window: { glingDiscoveryUpdate: (...args) => calls.push(args) } });
  assert.equal(calls[0][1].markers[0].id, attack);
  assert.deepEqual(Object.keys(calls[0][1].markers[0]).sort(), Object.keys(marker).sort());
});

test('only accepts current session messages, known selection IDs and exact credit URLs', () => {
  const parse = message => discoveryMapMessage(JSON.stringify({ sessionId, ...message }), sessionId, [marker]);
  for (const type of ['ready', 'error', 'feedback']) assert.deepEqual(parse({ type, privateText: 'secret' }), { type });
  assert.deepEqual(parse({ type: 'select', id: marker.id }), { type: 'select', id: marker.id });
  for (const url of ['https://openfreemap.org/', 'https://www.openmaptiles.org/', 'https://www.openstreetmap.org/copyright']) {
    assert.deepEqual(parse({ type: 'credits', url }), { type: 'credits', url });
  }
  for (const message of [
    { type: 'select', id: 'unknown' }, { type: 'pick', id: marker.id }, { type: 'snapshot', uri: 'secret' },
    { type: 'ready', sessionId: 'stale' }, { type: 'credits', url: 'javascript:alert(1)' },
    { type: 'credits', url: 'https://openfreemap.org.evil.test/' },
    { type: 'credits', url: 'https://www.openstreetmap.org/copyright?token=secret' },
  ]) assert.equal(parse(message), null);
  for (const raw of ['oops', 'null', '[]', '{}', 'x'.repeat(2049)]) assert.equal(discoveryMapMessage(raw, sessionId, [marker]), null);
});

function canvas(markers = [marker], providedHtml, extra = {}, globals = {}) {
  const messages = [], listeners = {}, cameras = [], sources = {}, layers = [], images = {}, paddingCalls = [], userMarkers = [], cityMarkers = [], labels = [];
  const rootVars = {}, credits = { 'credits-links': { hidden: true }, 'credits-toggle': { setAttribute(name, value) { this[name] = value; } } };
  const container = { clientHeight: 400, style: { setProperty(name, value) { this[name] = value; }, getPropertyValue(name) { return this[name] ?? ''; } } };
  let map;
  class Map {
    constructor(config) { this.config = config; this.zoom = 11; map = this; }
    on(type, callback) { listeners[type] = callback; }
    addControl() {}
    addSource(id, source) { sources[id] = { ...source, setData(data) { this.data = data; } }; }
    addLayer(layer) { layers.push(layer); }
    hasImage(id) { return Boolean(images[id]); }
    addImage(id, image, options) { images[id] = { image, options }; }
    getSource(id) { return sources[id]; }
    setFilter(id, filter) { layers.find(layer => layer.id === id).filter = filter; }
    easeTo(camera) { cameras.push(camera); }
    getZoom() { return this.zoom; }
    getCanvas() { return { style: {} }; }
    queryRenderedFeatures(_point, options) { this.queryOptions = options; return this.hits ?? []; }
    isStyleLoaded() { return true; }
    getContainer() { return container; }
    setPadding(padding) { this.padding = padding; paddingCalls.push(padding); }
  }
  const window = { devicePixelRatio: globals.devicePixelRatio, parent: { postMessage: message => messages.push(JSON.parse(message)) }, addEventListener: (type, callback) => { listeners['window:' + type] = callback; }, matchMedia: () => ({ matches: true }) };
  const drawing = { scale() {}, arc() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {}, measureText: text => ({ width: text.length * 6 }), fillText(text) { labels.push(text); }, getImageData: (_x, _y, width, height) => ({ width, height, data: new Uint8Array(width * height * 4) }) };
  class Marker {
    constructor({ element }) { this.element = element; (element.className === 'city-pill' ? cityMarkers : userMarkers).push(this); }
    setLngLat(point) { this.point = Array.from(point); return this; }
    addTo() { return this; }
    remove() { this.removed = true; }
    getElement() { return this.element; }
    setRotation(degrees) { this.rotation = degrees; return this; }
  }
  const context = { window, document: { createElement: () => ({ getContext: () => drawing, setAttribute(name, value) { this[name] = value; } }), addEventListener: (type, callback) => { listeners['document:' + type] = callback; }, documentElement: { style: { setProperty(name, value) { rootVars[name] = value; } } }, getElementById: id => credits[id] ?? null }, maplibregl: { Map, Marker, NavigationControl: class {} }, setTimeout: () => 1, clearTimeout() {}, console, ...globals };
  const html = providedHtml ?? discoveryMapHtml({ ...options, markers, ...extra });
  const script = [...html.matchAll(/<script nonce="gling-map">([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInNewContext(script, context);
  if (!globals.deferLoad) listeners.load();
  return { window, listeners, cameras, sources, layers, images, paddingCalls, messages, map, html, userMarkers, cityMarkers, labels, rootVars, credits };
}

test('a passing map error while loading never shows the failure; one that outlasts 5s does (owner b09e6df1)', () => {
  const run = () => { const timers = []; const c = canvas([marker], undefined, {}, { deferLoad: true, setTimeout: (fn, ms) => timers.push({ fn, ms }) }); return { c, timers, errors: () => c.messages.filter(m => m.type === 'error').length, grace: () => timers.filter(t => t.ms === 5000) }; };
  const passing = run();
  passing.c.listeners.error({}); passing.c.listeners.error({});
  assert.equal(passing.errors(), 0, 'no failure card while still loading');
  assert.equal(passing.grace().length, 1, 'one grace timer for many errors');
  passing.c.listeners.load(); passing.grace()[0].fn();
  assert.equal(passing.errors(), 0); assert.ok(passing.c.messages.some(m => m.type === 'ready'));
  const stuck = run();
  stuck.c.listeners.error({}); stuck.grace()[0].fn();
  assert.equal(stuck.errors(), 1, 'still not loaded after the grace: show the failure');
});

test('the map canvas draws at most two pixels per point (map lag 2026-11-11 "지도 화질 2배")', () => {
  for (const [device, drawn] of [[undefined, 1], [1, 1], [2, 2], [3, 2]]) assert.equal(canvas([marker], undefined, {}, { devicePixelRatio: device }).map.config.pixelRatio, drawn, String(device));
});

test('own GPS marker stays separate from camera and place selection, updates and clears explicitly', () => {
  const c = canvas();
  const userLocation = { latitude: 49.29, longitude: -123.14 };
  const state = { markers: [marker], selectedId: null, center: null, userLocation };
  assert.equal(c.userMarkers.length, 0, 'no position is invented before a successful GPS fix');
  vm.runInNewContext(discoveryMapScript(state, sessionId), { window: c.window });
  assert.equal(c.userMarkers.length, 1);
  const ownMarker = c.userMarkers[0];
  assert.deepEqual(ownMarker.point, [userLocation.longitude, userLocation.latitude]);
  assert.equal(ownMarker.element.role, 'img');
  assert.equal(ownMarker.element['aria-label'], '내 위치');
  assert.equal(c.cameras.length, 0, 'showing a position does not move a manually panned camera');
  c.window.glingDiscoveryUpdate(sessionId, { ...state, selectedId: marker.id });
  assert.equal(c.userMarkers.length, 1);
  assert.equal(ownMarker.removed, undefined);
  assert.deepEqual(ownMarker.point, [userLocation.longitude, userLocation.latitude]);
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [marker.longitude, marker.latitude]);
  c.window.glingDiscoveryUpdate(sessionId, { ...state, userLocation: { latitude: 49.3, longitude: -123.15 } });
  assert.equal(c.userMarkers.length, 1, 'reuse the location dot rather than accumulate markers');
  assert.deepEqual(ownMarker.point, [-123.15, 49.3]);
  c.window.glingDiscoveryUpdate(sessionId, { ...state, userLocation: null });
  assert.equal(ownMarker.removed, true);
});

test('M7: the location dot grows a facing cone only while a heading arrives, turned to it and dropped without one', () => {
  const c = canvas();
  const state = { markers: [marker], userLocation: { latitude: 49.29, longitude: -123.14 } };
  c.window.glingDiscoveryUpdate(sessionId, state);
  const dot = c.userMarkers[0];
  assert.equal(dot.element['data-facing'], undefined, 'no heading keeps the plain dot');
  c.window.glingDiscoveryUpdate(sessionId, { ...state, heading: 90 });
  assert.equal(dot.element['data-facing'], '1');
  assert.equal(dot.rotation, 90);
  c.window.glingDiscoveryUpdate(sessionId, { ...state, heading: null });
  assert.equal(dot.element['data-facing'], '0');
  assert.equal(c.userMarkers.length, 1, 'the same dot is reused');
  for (const heading of [-5, 360, NaN, '90']) {
    assert.throws(() => discoveryMapScript({ ...state, heading }, sessionId));
    c.window.glingDiscoveryUpdate(sessionId, { ...state, heading });
    assert.equal(dot.element['data-facing'], '0', 'an invalid embedded heading never turns the cone on');
  }
  assert.ok(c.html.includes('.user-location-marker[data-facing="1"]::before'));
});

test('M1: a state colour crosses the map boundary only as a hex value and draws its dot above the pins', () => {
  assert.deepEqual(discoveryMarkers([{ ...marker, statusColor: '#E8743B' }]), [{ ...marker, statusColor: '#E8743B' }]);
  assert.deepEqual(discoveryMarkers([marker]), [marker], 'a place without a state stays as it was');
  for (const bad of ['orange', 7, '#fff', '#E8743B;background:url(x)']) assert.throws(() => discoveryMarkers([{ ...marker, statusColor: bad }]), /INVALID_DISCOVERY_MARKER/);
  const c = canvas([{ ...marker, statusColor: '#E8743B' }, { ...marker, id: 'place:2' }]);
  assert.deepEqual(Array.from(c.sources.discovery.data.features, feature => feature.properties.statusColor), ['#E8743B', '']);
  const layer = c.layers.find(layer => layer.id === 'discovery-status');
  assert.equal(JSON.stringify(layer.filter.at(-2)), '["!=",["get","statusColor"],""]', 'up close every place with a state');
  assert.equal(JSON.stringify(c.layers.find(value => value.id === 'discovery-status-grouped').filter.at(-2)), '["!=",["get","statusColor"],""]');
  assert.equal(JSON.stringify(layer.paint['circle-color']), '["get","statusColor"]');
  assert.ok(c.layers.indexOf(layer) > c.layers.findIndex(value => value.id === 'discovery-selected'), 'a chosen pin keeps its dot');
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker, { ...marker, id: 'place:2', statusColor: '#E0559A' }] });
  assert.deepEqual(Array.from(c.sources.discovery.data.features, feature => feature.properties.statusColor), ['', '#E0559A'], 'a new read moves the dot without a reload');
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker, { ...marker, id: 'place:2', statusColor: 'url(x)' }] });
  assert.deepEqual(Array.from(c.sources.discovery.data.features, feature => feature.properties.statusColor), ['', '#E0559A'], 'the page refuses a bad colour too');
  assert.ok(c.html.includes('주황색 점은 요즘 뜨는 곳, 분홍색 점은 인기 있는 곳이에요.'), 'the map label says what the colours mean');
});

test('M5: a saved flag crosses the map boundary only as a boolean and draws the bookmark mark above the pins', () => {
  assert.deepEqual(discoveryMarkers([{ ...marker, saved: true }]), [{ ...marker, saved: true }]);
  assert.deepEqual(discoveryMarkers([{ ...marker, saved: false }]), [marker]);
  assert.throws(() => discoveryMarkers([{ ...marker, saved: 'yes' }]), /INVALID_DISCOVERY_MARKER/);
  const c = canvas([{ ...marker, saved: true }, { ...marker, id: 'place:2' }]);
  assert.deepEqual(Array.from(c.sources.discovery.data.features, feature => feature.properties.saved), [true, false]);
  assert.ok(c.images['saved-mark']);
  const layer = c.layers.find(layer => layer.id === 'discovery-saved');
  assert.equal(JSON.stringify(layer.filter.at(-2)), '["==",["get","saved"],true]', 'up close every saved place');
  assert.equal(JSON.stringify(c.layers.find(value => value.id === 'discovery-saved-grouped').filter.at(-2)), '["==",["get","saved"],true]');
  assert.ok(c.layers.indexOf(layer) > c.layers.findIndex(value => value.id === 'discovery-selected'), 'a chosen saved pin keeps its mark');
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker, { ...marker, id: 'place:2', saved: true }] });
  assert.deepEqual(Array.from(c.sources.discovery.data.features, feature => feature.properties.saved), [false, true], 'saving from the card moves the mark without a reload');
});

test('Q05: base-map words like the city name give way to every place pin, saved or plain', () => {
  const c = canvas([{ ...marker, saved: true }, { ...marker, id: 'place:2' }]), index = id => c.layers.findIndex(layer => layer.id === id);
  for (const id of ['discovery-room', 'discovery-room-grouped']) {
    const { layout, paint } = c.layers[index(id)];
    assert.equal(layout['icon-allow-overlap'], true, id + ': always placed');
    assert.notEqual(layout['icon-ignore-placement'], true, id + ': keeps its box so the base map labels placed after it hide');
    assert.equal(paint['icon-opacity'], 0);
  }
  // Placement runs from the top layer down, so the box must sit under every place layer: ours are placed first, the base map's labels after it.
  assert.ok(c.layers.slice(0, 2).every(layer => layer.id.startsWith('discovery-room')), 'the lowest of the map\'s own layers');
  assert.equal(JSON.stringify(c.layers[index('discovery-room-grouped')].filter[1]), '["!",["has","point_count"]]', 'a place inside a count leaves the words alone');
});

test('own location validates both update boundaries and only forwards coordinates', () => {
  const state = { markers: [marker], userLocation: { latitude: 49.29, longitude: -123.14, privateText: 'private-location-context' } };
  const script = discoveryMapScript(state, sessionId);
  assert.ok(!script.includes('private-location-context'));
  const c = canvas();
  for (const userLocation of [{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 49, longitude: -181 }, { latitude: '49', longitude: 0 }]) {
    assert.throws(() => discoveryMapScript({ ...state, userLocation }, sessionId));
    c.window.glingDiscoveryUpdate(sessionId, { ...state, userLocation });
    assert.equal(c.userMarkers.length, 0);
  }
});

test('each explicit current-location request recenters even when GPS coordinates have not changed', () => {
  const c = canvas();
  const state = { markers: [marker], selectedId: null, center: { latitude: 49.28, longitude: -123.12, requestId: 1 } };
  vm.runInNewContext(discoveryMapScript(state, sessionId), { window: c.window });
  const count = c.cameras.length;
  vm.runInNewContext(discoveryMapScript(state, sessionId), { window: c.window });
  assert.equal(c.cameras.length, count, 'ordinary pin updates preserve a manual pan');
  vm.runInNewContext(discoveryMapScript({ ...state, center: { ...state.center, requestId: 2 } }, sessionId), { window: c.window });
  assert.equal(c.cameras.length, count + 1, 'pressing My Location again returns to the same GPS point');
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [-123.12, 49.28]);
});

test('unchanged inset does not interrupt camera motion, and resized cards finish recentering the current target', () => {
  const c = canvas([{ ...marker, top25: true }]);
  const state = { markers: [{ ...marker, top25: true }], selectedId: marker.id, center: null, bottomInset: 220 };
  c.window.glingDiscoveryUpdate(sessionId, state);
  const count = c.paddingCalls.length, cameras = c.cameras.length;
  c.window.glingDiscoveryUpdate(sessionId, state);
  assert.equal(c.paddingCalls.length, count, 'setPadding interrupts an in-flight MapLibre camera transition');
  assert.equal(c.cameras.length, cameras);
  c.window.glingDiscoveryUpdate(sessionId, { ...state, bottomInset: 250 });
  assert.equal(c.cameras.length, cameras + 1);
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [marker.longitude, marker.latitude]);
  const center = { latitude: 43.65, longitude: -79.38 };
  c.window.glingDiscoveryUpdate(sessionId, { ...state, center, bottomInset: 250 });
  c.window.glingDiscoveryUpdate(sessionId, { ...state, center, bottomInset: 270 });
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [center.longitude, center.latitude]);
});

test('only a typed Top 25 flag crosses the embedded map boundary', () => {
  const curated = { ...marker, top25: true };
  assert.deepEqual(discoveryMarkers([{ ...curated, reason: 'private text', sourceUrl: 'https://example.org', postIds: ['secret'] }]), [curated]);
  assert.throws(() => discoveryMarkers([{ ...marker, top25: 'true' }]));
});

test('Top 50 uses a circular outline and a selected-only label while preserving category colors', () => {
  const c = canvas([{ ...marker, top25: true }]);
  assert.deepEqual(c.labels, ['TOP 50']);
  assert.equal(c.sources.discovery.data.features[0].properties.top25, true);
  assert.equal(c.sources.discovery.data.features[0].properties.color, marker.color);
  assert.equal(c.images['top25-small'], undefined, 'ordinary map points do not carry a floating flag icon');
  assert.ok(c.images['top25-full']);
  assert.equal(c.images['top25-full'].options.pixelRatio, 2);
  assert.equal(c.layers.find(layer => layer.id === 'discovery-top25').type, 'circle');
  assert.ok(c.layers.some(layer => layer.id === 'discovery-selected-top25' && layer.source === 'discovery-selection'));
  c.window.glingDiscoveryUpdate(sessionId, { markers: [{ ...marker, top25: 'true' }], selectedId: null });
  assert.equal(c.sources.discovery.data.features[0].properties.top25, true);
});

test('crowded TOP 50 places fold only among themselves into a gold count with no name tag, only as far apart as they touch; saved, discount and chosen TOP 50 stay single (owner 2026-11-10)', async () => {
  const a = { ...marker, id: 'a', featured: true, top25: true }, b = { ...marker, id: 'b', latitude: 49.2801, top25: true };
  const savedTop = { ...marker, id: 'saved-top', latitude: 49.2802, featured: true, top25: true, saved: true }, dealTop = { ...marker, id: 'deal-top', latitude: 49.2803, featured: true, top25: true, discount: 10 };
  const plain = { ...marker, id: 'plain', latitude: 49.2804 }, visited = { ...marker, id: 'visited', latitude: 49.2805, featured: true };
  const markers = [a, b, savedTop, dealTop, plain, visited], c = canvas(markers), tick = () => new Promise(done => setImmediate(done));
  const tops = ['discovery-top', 'discovery-top-near'], ids = source => Array.from(c.sources[source].data.features.map(feature => feature.properties.id));
  const top = () => { assert.deepEqual(ids('discovery-top-near'), ids('discovery-top')); return ids('discovery-top'); };
  const layer = id => c.layers.find(value => value.id === id), index = id => c.layers.findIndex(value => value.id === id);
  // Mid stage folds within the 27px mid picture pin, close up within the 46px ringed pin. Only the two closest (Vancouver Art Gallery, Robson Square) still touch at 16, so TOP 50 folds through 16 and is single from 17.
  for (const [source, radius] of [['discovery-top', 28], ['discovery-top-near', 48]]) {
    assert.equal(c.sources[source].cluster, true, source);
    assert.equal(c.sources[source].clusterMaxZoom, 16, source);
    assert.equal(c.sources[source].clusterRadius, radius, source + ': as wide as the widest TOP 50 mark at its stage, so two marks never touch unfolded');
    // A source is loaded only while one of its layers is in zoom range; its gold circle stays in range so the other stage finds its tiles ready.
    assert.ok(c.layers.some(value => value.source === source && value.minzoom === 8 && value.maxzoom === undefined), source + ' stays loaded at every zoom');
  }
  assert.deepEqual(top(), ['a', 'b'], 'saved and discount TOP 50 places stay single (owner 2026-11-08)');
  assert.deepEqual(Array.from(c.sources['discovery-grouped'].data.features.map(feature => feature.properties.id)), ['plain'], 'TOP 50 never joins an ordinary count');
  assert.equal(JSON.stringify(c.sources.discovery.data.features.map(feature => [feature.properties.id, feature.properties.fold])), JSON.stringify([['a', true], ['b', true], ['saved-top', false], ['deal-top', false], ['plain', false], ['visited', false]]));
  // The count: the ordinary count's shape with the TOP 50 ring's gold at each stage, shown only at its own stage, and nothing written beside it.
  const grey = layer('discovery-clusters').paint['circle-radius'];
  for (const [source, width, shown] of [['discovery-top', 1.5, [1, 0]], ['discovery-top-near', 2, [0, 1]]]) {
    const circle = layer(source + '-clusters'), count = layer(source + '-counts');
    assert.equal(circle.type, 'circle');
    assert.equal(JSON.stringify(circle.paint['circle-radius']), JSON.stringify(grey), source + ': same size as a grey count');
    assert.equal(circle.paint['circle-stroke-color'], '#9C7637');
    assert.equal(circle.paint['circle-stroke-width'], width, source + ': the TOP 50 ring width at its stage');
    assert.equal(JSON.stringify(circle.paint['circle-opacity']), JSON.stringify(['step', ['zoom'], shown[0], 13, shown[1]]));
    assert.equal(JSON.stringify(circle.paint['circle-stroke-opacity']), JSON.stringify(circle.paint['circle-opacity']));
    // No zoom range on either: a layer out of range gets no bucket in the tile still on screen while the zoom crosses 13.
    assert.deepEqual([circle.minzoom, circle.maxzoom, count.minzoom, count.maxzoom], [8, undefined, 8, undefined]);
    assert.equal(JSON.stringify(count.paint['text-opacity']), JSON.stringify(circle.paint['circle-opacity']));
    assert.equal(count.paint['text-color'], '#6F5129');
    assert.ok(index('discovery-counts') < index(source + '-clusters') && index(source + '-counts') < index('discovery-pins-grouped'), 'gold counts sit above grey ones and under the places');
  }
  // Only the circle, its number, the tap area and its invisible room draw a folded count: a gold count carries no name tag.
  assert.deepEqual(Array.from(c.layers.filter(value => tops.includes(value.source) && !JSON.stringify(value.filter ?? null).includes('["!",["has","point_count"]]')).map(value => value.id)), ['discovery-top-clusters', 'discovery-top-counts', 'discovery-top-near-clusters', 'discovery-top-near-counts', 'discovery-hit-top', 'discovery-hit-top-near', 'discovery-top-near-room']);
  // Every mark a single TOP 50 place has comes from its copy on the source of each stage the mark shows at; saved and discount marks never fold, so they have none.
  // Circles (dot, ring, state dot) are drawn by both copies at every zoom and fade by stage, so the tile on screen while crossing 13 still holds them; names and mid picture pins keep their own zoom range, as before.
  const stage = (value, mid) => { const v = value ?? 1, [m, n] = Array.isArray(v) && v[0] === 'step' ? [v[2], v[4]] : [v, v]; return JSON.stringify(mid ? ['step', ['zoom'], m, 13, 0] : ['step', ['zoom'], 0, 13, n]); };
  for (const id of ['discovery-pins', 'discovery-status', 'discovery-top25']) {
    const own = layer(id);
    for (const [suffix, source, mid] of [['-top', 'discovery-top', true], ['-top-near', 'discovery-top-near', false]]) {
      const copy = layer(id + suffix);
      assert.equal(copy.source, source, id);
      assert.equal(JSON.stringify(copy.filter[1]), '["!",["has","point_count"]]', id + ': a place inside a gold count draws no mark of its own');
      assert.deepEqual([copy.minzoom, copy.maxzoom], [own.minzoom, own.maxzoom], id + suffix);
      for (const key of ['circle-opacity', 'circle-stroke-opacity']) assert.equal(JSON.stringify(copy.paint[key]), stage(own.paint[key], mid), id + suffix + ' ' + key);
      assert.ok(index(copy.id) < index(id), id + ': the single copy (chosen, saved, discount) stays on top');
    }
  }
  for (const id of ['discovery-art', 'discovery-labels', 'discovery-featured-labels', 'discovery-art-featured', 'discovery-art-featured-labels']) {
    const own = layer(id), mid = layer(id + '-top'), near = layer(id + '-top-near');
    assert.equal(!!mid, !(own.minzoom >= 13), id + ': a mid copy only where the mark shows below 13');
    assert.equal(!!near, !(own.maxzoom <= 13), id + ': a close-up copy only where the mark shows from 13');
    for (const [copy, source, range] of [[mid, 'discovery-top', [own.minzoom, 13]], [near, 'discovery-top-near', [13, own.maxzoom]]]) {
      if (!copy) continue;
      assert.equal(copy.source, source, id);
      assert.equal(JSON.stringify(copy.filter[1]), '["!",["has","point_count"]]', id + ': a place inside a gold count draws no mark of its own');
      assert.deepEqual([copy.minzoom, copy.maxzoom], range, id);
      assert.ok(index(copy.id) < index(id), id + ': the single copy (chosen, saved, discount) stays on top');
    }
  }
  for (const id of ['discovery-saved', 'discovery-discount', 'discovery-discount-dot']) assert.equal(layer(id + '-top') ?? layer(id + '-top-near'), undefined, id);
  assert.ok(index('discovery-hit-grouped') < index('discovery-hit-top') && index('discovery-hit-top') < index('discovery-hit-top-near') && index('discovery-hit-top-near') < index('discovery-hit'));
  assert.deepEqual([layer('discovery-hit-top').maxzoom, layer('discovery-hit-top-near').minzoom], [13, 13], 'a tap only finds the count drawn at that stage');
  // The single source keeps only the TOP 50 places that cannot fold.
  for (const id of ['discovery-top25', 'discovery-featured-labels', 'discovery-art-featured', 'discovery-art-featured-labels']) assert.match(JSON.stringify(layer(id).filter), /\["!=",\["get","fold"\],true\]/, id);
  // Choosing a TOP 50 place no longer re-folds (owner 2026-11-11 3A): it stays counted, and its copies skip it so only its own chosen pin draws it.
  c.window.glingDiscoveryUpdate(sessionId, { markers, selectedId: 'b', center: null });
  assert.deepEqual(top(), ['a', 'b']);
  for (const id of ['discovery-pins-top', 'discovery-pins-top-near', 'discovery-art-top-near', 'discovery-labels-top-near']) assert.equal(JSON.stringify(layer(id).filter.at(-1)), '["!=",["get","id"],"b"]', id);
  c.window.glingDiscoveryUpdate(sessionId, { markers, selectedId: null, center: null });
  assert.deepEqual(top(), ['a', 'b']);
  assert.equal(JSON.stringify(layer('discovery-pins-top').filter.at(-1)), '["!=",["get","id"],""]');
  // A gold count opens from the source it was drawn from. A mid count that opens at 13 or later would still be one close-up count there (wider fold), so it goes one zoom further.
  c.sources['discovery-grouped'].getClusterExpansionZoom = async () => assert.fail('grey source asked for a gold count');
  for (const [source, opens, lands] of [['discovery-top', 12, 12], ['discovery-top', 13, 14], ['discovery-top-near', 17, 17], ['discovery-top-near', 13, 13]]) {
    for (const other of tops) c.sources[other].getClusterExpansionZoom = async id => (assert.equal(other, source), assert.equal(id, 3), opens);
    c.map.hits = [{ source, properties: { cluster: true, cluster_id: 3, point_count: 2 }, geometry: { type: 'Point', coordinates: [-123.12, 49.28] } }];
    await c.listeners.click({ point: { x: 1, y: 1 } }); await tick();
    assert.equal(c.cameras.at(-1).zoom, lands, source + ' ' + opens);
  }
  assert.ok(!c.messages.some(message => message.type === 'select'), 'a gold count is not a place');
  // Real MapLibre answers an unknown layer id with nothing at all, so every tap layer has to exist.
  assert.ok(c.map.queryOptions.layers.includes('discovery-hit-top') && c.map.queryOptions.layers.includes('discovery-hit-top-near'));
  for (const id of c.map.queryOptions.layers) assert.ok(layer(id), id + ' exists');
  // The faded ring copies have no zoom range, and a query ignores opacity, so they never take taps; the 44px hit areas cover TOP 50 at each stage.
  assert.ok(!c.map.queryOptions.layers.some(id => /-top(-near)?$/.test(id) && layer(id).type === 'circle' && layer(id).maxzoom === undefined && layer(id).minzoom === 8 && !id.startsWith('discovery-hit')));
  assert.ok(c.html.includes('붙어 있는 TOP 50끼리는 금색 테두리 동그라미로 따로 묶여요.'), 'the map label says what a gold count is');
});

test('close-up pins and Gling-visited places are never counted, keep 44px targets and preserve the camera for result updates', async () => {
  const c = canvas();
  assert.equal(c.map.config.zoom, 11);
  assert.deepEqual(Array.from(c.map.config.center), [-123.12, 49.28]);
  // Owner 2026-11-04 kept three zoom stages; owner 2026-11-08 "멀리서묶어보기" counts crowded ordinary places on their own source, up to zoom 14 ("줌 14까지 묶기").
  assert.equal(c.sources.discovery.cluster, undefined);
  assert.equal(c.sources['discovery-grouped'].cluster, true);
  assert.equal(c.sources['discovery-grouped'].clusterMaxZoom, 14, 'ordinary places fold into counts up to zoom 14 (owner 2026-11-08 "줌 14까지 묶기"), single from 15');
  assert.ok(c.layers.every(layer => layer.source !== 'discovery-grouped' || layer.maxzoom === undefined), 'above clusterMaxZoom the grouped source itself gives single places');
  assert.ok(c.layers.some(layer => layer.paint?.['circle-radius'] === 22));
  c.window.glingDiscoveryUpdate(sessionId, { markers: [{ ...marker, longitude: -123 }], selectedId: null, center: null });
  assert.equal(c.cameras.length, 0);
  c.window.glingDiscoveryUpdate('stale', { markers: [], selectedId: null, center: null });
  assert.equal(c.sources.discovery.data.features.length, 1);
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], selectedId: marker.id, center: null });
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [marker.longitude, marker.latitude]);
  assert.equal(c.sources['discovery-selection'].data.features[0].properties.id, marker.id);
  assert.equal(c.sources['discovery-selection'].cluster, undefined);
  assert.equal(c.layers.find(layer => layer.id === 'discovery-selected').source, 'discovery-selection');
  const cameraCount = c.cameras.length;
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], selectedId: marker.id, center: null });
  assert.equal(c.cameras.length, cameraCount);
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], selectedId: marker.id, center: { latitude: 43.65, longitude: -79.38 } });
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [-79.38, 43.65]);
  c.map.hits = [{ properties: { id: marker.id }, geometry: { type: 'Point', coordinates: [-123.12, 49.28] } }];
  await c.listeners.click({ point: { x: 10, y: 10 } });
  assert.ok(c.messages.some(message => message.type === 'select' && message.id === marker.id));
  assert.equal(c.messages.filter(message => message.type === 'feedback').length, 1);
});

test('mid-zoom crowded places fold into counts; Gling-visited, saved, discount and the chosen place stay single, TOP 50 folds on its own, and a count opens where it splits (owner 2026-11-08)', async () => {
  const plain = { ...marker, id: 'plain' }, top = { ...marker, id: 'top', latitude: 49.281, featured: true, top25: true }, visited = { ...marker, id: 'visited', latitude: 49.282, featured: true }, topOnly = { ...marker, id: 'top-only', latitude: 49.283, top25: true };
  // Saved and discount places stay single (owner 2026-11-08 "저장한 곳·할인 가게도 따로 보이기").
  const saved = { ...marker, id: 'saved', latitude: 49.284, saved: true }, deal = { ...marker, id: 'deal', latitude: 49.285, discount: 20 };
  // Live bubbles and meetups stay single too: grouped, they hid until zoom 15 (git-76 review of #125).
  const bubble = { ...marker, id: 'bubble:b1', latitude: 49.286 }, meetup = { ...marker, id: 'meetup:m1', latitude: 49.287 };
  const markers = [plain, top, visited, topOnly, saved, deal, bubble, meetup], c = canvas(markers), tick = () => new Promise(done => setImmediate(done));
  const grouped = () => Array.from(c.sources['discovery-grouped'].data.features.map(feature => feature.properties.id));
  assert.deepEqual(grouped(), ['plain']);
  assert.equal(c.sources.discovery.data.features.length, 8, 'up close every place still comes from the single source');
  const pins = c.layers.find(layer => layer.id === 'discovery-pins'), index = id => c.layers.findIndex(layer => layer.id === id);
  assert.equal(JSON.stringify(pins.filter), '["all",["any",["all",["==",["get","featured"],true],["!=",["get","fold"],true]],["==",["get","saved"],true],[">",["get","discount"],0],["==",["slice",["get","id"],0,7],"bubble:"],["==",["slice",["get","id"],0,7],"meetup:"],["==",["get","id"],""]],true,true]', 'at every zoom the single source draws only Gling-visited, saved, discount, live bubbles, meetups and the chosen place; other TOP 50 places come from discovery-top');
  // Each place has one source and no stage is switched by zoom, so a tile kept on screen while zooming past NEAR still draws every place (supervisor review, PR #125).
  const ours = c.layers.filter(layer => layer.id.includes('-grouped') || layer.id === 'discovery-clusters' || layer.id === 'discovery-counts' || ['discovery-pins', 'discovery-hit', 'discovery-saved', 'discovery-status', 'discovery-discount-dot'].includes(layer.id));
  assert.ok(ours.every(layer => layer.maxzoom === undefined && !JSON.stringify(layer.filter ?? null).includes('"zoom"')), 'no stage switch in the grouping layers');
  for (const id of ['discovery-art', 'discovery-labels', 'discovery-discount']) assert.equal(c.layers.find(layer => layer.id === id + '-grouped').minzoom, c.layers.find(layer => layer.id === id).minzoom, id + ': the grouped copy keeps the close-up start');
  for (const id of ['discovery-pins', 'discovery-saved', 'discovery-status', 'discovery-discount-dot', 'discovery-art', 'discovery-labels', 'discovery-discount']) {
    const copy = c.layers.find(layer => layer.id === id + '-grouped');
    assert.equal(copy.source, 'discovery-grouped');
    assert.equal(JSON.stringify(copy.filter[1]), '["!",["has","point_count"]]', id + ': a place inside a count draws no mark of its own');
  }
  assert.ok(index('discovery-clusters') < index('discovery-pins-grouped') && index('discovery-counts') < index('discovery-pins-grouped'), 'counts sit under the places');
  assert.ok(index('discovery-pins-grouped') < index('discovery-pins'), 'a TOP 50 dot is drawn above a plain one');
  assert.ok(index('discovery-hit-grouped') < index('discovery-hit'), 'a TOP 50 pin beside a count wins the tap');
  c.window.glingDiscoveryUpdate(sessionId, { markers, selectedId: 'plain', center: null });
  assert.deepEqual(grouped(), ['plain'], 'the chosen place stays in its count (owner 2026-11-11 3A: choosing never re-folds)');
  for (const id of ['discovery-pins-grouped', 'discovery-labels-grouped', 'discovery-art-grouped']) assert.equal(JSON.stringify(c.layers.find(layer => layer.id === id).filter.at(-1)), '["!=",["get","id"],"plain"]', id + ': its own chosen pin draws it, not the copy');
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-room-grouped').filter), '["all",["!",["has","point_count"]],true]', 'the invisible room box is left as it was');
  assert.match(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-saved').filter[1]), /"plain"/);
  // Names: the single source keeps only single places and leaves the chosen one to its own label, so no plain name is laid out twice.
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-labels').filter), '["all",["any",["all",["==",["get","featured"],true],["!=",["get","fold"],true]],["==",["get","saved"],true],[">",["get","discount"],0],["==",["slice",["get","id"],0,7],"bubble:"],["==",["slice",["get","id"],0,7],"meetup:"],["==",["get","id"],"plain"]],true,["!",["==",["get","id"],"plain"]]]');
  c.window.glingDiscoveryUpdate(sessionId, { markers, selectedId: null, center: null });
  assert.deepEqual(grouped(), ['plain']);

  const cameras = c.cameras.length, count = { source: 'discovery-grouped', properties: { cluster: true, cluster_id: 7, point_count: 5 }, geometry: { type: 'Point', coordinates: [-123.1, 49.2] } };
  c.sources['discovery-grouped'].getClusterExpansionZoom = async id => (assert.equal(id, 7), 12.5);
  c.map.hits = [count];
  await c.listeners.click({ point: { x: 1, y: 1 } }); await tick();
  assert.equal(c.cameras.length, cameras + 1);
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [-123.1, 49.2]);
  assert.equal(c.cameras.at(-1).zoom, 12.5);
  assert.ok(!c.messages.some(message => message.type === 'select'), 'a count is not a place');
  let answer;
  c.sources['discovery-grouped'].getClusterExpansionZoom = () => new Promise(done => { answer = done; });
  await c.listeners.click({ point: { x: 1, y: 1 } });
  c.window.glingDiscoveryUpdate(sessionId, { markers, selectedId: 'top', center: null });
  answer(12); await tick();
  assert.equal(c.cameras.at(-1).zoom, 12, 'choosing a pin keeps the counts, so the open count still opens');
  c.sources['discovery-grouped'].getClusterExpansionZoom = () => new Promise(done => { answer = done; });
  await c.listeners.click({ point: { x: 1, y: 1 } });
  c.window.glingDiscoveryUpdate(sessionId, { markers: markers.slice(1), selectedId: 'top', center: null });
  const afterUpdate = c.cameras.length;
  answer(13); await tick();
  assert.equal(c.cameras.length, afterUpdate, 'a count from before new markers no longer exists');
  c.sources['discovery-grouped'].getClusterExpansionZoom = async () => { throw Error('No cluster with the specified id'); };
  await c.listeners.click({ point: { x: 1, y: 1 } }); await tick();
  assert.ok(!c.messages.some(message => message.type === 'error'), 'a stale count leaves the map as it is');
  assert.ok(c.html.includes('개수가 적힌 동그라미로 묶이고, 누르면 펼쳐져요.'), 'the map label says what a count is');
});

test('embedded updates require the parent source, exact origin, type and session', () => {
  const c = canvas();
  const update = { type: 'discovery.update', sessionId, state: { markers: [], selectedId: null, center: null } };
  for (const event of [
    { source: {}, origin: options.parentOrigin, data: update },
    { source: c.window.parent, origin: 'https://evil.test', data: update },
    { source: c.window.parent, origin: options.parentOrigin, data: { ...update, type: 'unknown' } },
    { source: c.window.parent, origin: options.parentOrigin, data: { ...update, sessionId: 'old' } },
    { source: c.window.parent, origin: options.parentOrigin, data: { ...update, state: { markers: [{ ...marker, latitude: 91 }] } } },
  ]) {
    c.listeners['window:message'](event);
    assert.equal(c.sources.discovery.data.features.length, 1);
  }
  c.listeners['window:message']({ source: c.window.parent, origin: options.parentOrigin, data: update });
  assert.equal(c.sources.discovery.data.features.length, 0);
  assert.equal(c.cameras.length, 0);
});

test('credits and zoom controls send feedback but never open arbitrary links through the bridge', () => {
  const c = canvas();
  const clickCredit = href => c.listeners['document:click']({ target: { closest: selector => selector === '#credits a' ? { href } : null }, preventDefault() {} });
  clickCredit('https://evil.test/');
  assert.equal(c.messages.filter(message => message.type === 'credits').length, 0);
  clickCredit('https://openfreemap.org/');
  assert.equal(c.messages.at(-1).url, 'https://openfreemap.org/');
  assert.equal(c.messages.at(-2).type, 'feedback');
  c.listeners['document:click']({ target: { closest: selector => selector === '.maplibregl-ctrl-group button' ? {} : null } });
  assert.equal(c.messages.at(-1).type, 'feedback');
});

test('credits fold into an ⓘ on the floating row and close when the map moves (owner 691cf630)', () => {
  const c = canvas([marker], undefined, { bottomInset: 120 });
  assert.equal(c.rootVars['--map-bottom-inset'], '120px', 'the ⓘ sits on the same row as the list pill');
  assert.ok(c.html.includes('<span id="credits-links" hidden>') && c.html.includes('© OpenStreetMap'), 'attribution stays one tap away');
  const toggle = () => c.listeners['document:click']({ target: { closest: selector => selector === '#credits-toggle' ? {} : null } });
  toggle();
  assert.equal(c.credits['credits-links'].hidden, false);
  assert.equal(c.credits['credits-toggle']['aria-expanded'], 'true');
  assert.equal(c.messages.at(-1).type, 'feedback');
  c.listeners.movestart();
  assert.equal(c.credits['credits-links'].hidden, true);
  assert.equal(c.credits['credits-toggle']['aria-expanded'], 'false');
});

test('a strip too short for the zoom buttons over the ⓘ moves the ⓘ beside them (QA new-map-attrib-over-zoom)', () => {
  const c = canvas([marker], undefined, { bottomInset: 120 });
  assert.ok(c.html.includes('#credits{position:absolute;left:var(--map-credits-left,10px);'));
  assert.equal(c.rootVars['--map-credits-left'], '10px', '400px map, 120px under the list row: the ⓘ stays in the corner under the buttons');
  // The festival list sheet half open: chips 100px on top, the sheet 200px from the bottom leave a 100px strip.
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], topInset: 100, bottomInset: 200 });
  assert.equal(c.rootVars['--map-credits-left'], '66px', 'beside the 44px buttons at 12px, not on top of +');
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], topInset: 100, bottomInset: 0 });
  assert.equal(c.rootVars['--map-credits-left'], '10px', 'the sheet closed: back to the corner');
});

test('a place name gives way to a count circle instead of covering it (QA C17-1)', () => {
  const c = canvas([marker, { ...marker, id: 'place:2' }]), index = id => c.layers.findIndex(layer => layer.id === id);
  const names = c.layers.filter(layer => layer.type === 'symbol' && layer.layout['text-field'] && !layer.id.startsWith('discovery-selected')).map(layer => layer.id);
  assert.ok(names.includes('discovery-labels') && names.includes('discovery-art-featured-labels'));
  // Further out the mid picture pins (icon-allow-overlap false) would collide with a room and drop back to dots, so the rooms start at NEAR.
  assert.equal(index('discovery-top-room'), -1, 'no room for the mid gold count');
  for (const source of ['discovery-grouped', 'discovery-top-near']) {
    const room = c.layers[index(source + '-room')];
    assert.ok(room, source + ': every close-up count has a room');
    assert.equal(JSON.stringify(room.filter), '["has","point_count"]');
    assert.deepEqual([room.minzoom, room.maxzoom], [13, undefined], source + ': up close only');
    assert.equal(room.layout['icon-allow-overlap'], true, 'the count is always drawn, so its box always counts');
    assert.notEqual(room.layout['icon-ignore-placement'], true, 'its box is kept for the names placed after it');
    assert.equal(room.paint['icon-opacity'], 0);
    // saved-mark is 18px: the box is the 12/15/18px circle itself, and the name's own 4px text padding keeps it off the stroke.
    assert.equal(JSON.stringify(room.layout['icon-size']), '["step",["get","point_count"],1.4,10,1.7,50,2]');
    assert.equal(room.layout['icon-padding'], 0, 'no extra margin that would hide names that only come near');
    for (const [size, radius] of [[1.4, 12], [1.7, 15], [2, 18]]) assert.ok(Math.abs(18 * size - 2 * radius) <= 1.5, source + ': box covers a ' + radius + 'px count');
    // MapLibre places the top layer first: the room has to sit above every name.
    for (const id of names) assert.ok(index(source + '-room') > index(id), source + '-room above ' + id);
  }
});

test('keeps bundled CSP and attribution, and rejects invalid explicit centers', () => {
  const { html } = canvas();
  assert.ok(html.includes("script-src 'nonce-gling-map' blob:"));
  assert.ok(html.includes('connect-src https://tiles.openfreemap.org'));
  assert.ok(html.includes('.maplibregl-ctrl-group button{width:44px;height:44px}'));
  assert.ok(html.includes('OpenStreetMap'));
  assert.ok(!html.includes('<script src='));
  assert.ok(!html.includes('new maplibregl.GeolocateControl'));
  const runtime = [...html.matchAll(/<script nonce="gling-map">([\s\S]*?)<\/script>/g)].at(-1)[1];
  assert.ok(!runtime.includes('fitBounds('));
  assert.throws(() => discoveryMapScript({ markers: [], center: { latitude: 100, longitude: 0 } }, sessionId));
  assert.throws(() => discoveryMapHtml({ ...options, accent: '</style>' }));
});

test('pins and selected pins show tappable labels with the live style glyph font', async () => {
  const c = canvas();
  const labels = c.layers.find(layer => layer.id === 'discovery-labels');
  assert.equal(labels.type, 'symbol');
  assert.ok(JSON.stringify(labels.layout['text-field']).includes('["get","label"]'));
  assert.deepEqual(Array.from(labels.layout['text-font']), ['Noto Sans Regular']);
  assert.ok(labels.filter);
  const selectedLabel = c.layers.find(layer => layer.id === 'discovery-selected-label');
  assert.equal(selectedLabel.source, 'discovery-selection');
  assert.deepEqual(Array.from(selectedLabel.layout['text-field']), ['get', 'label']);
  for (const id of ['discovery-labels', 'discovery-featured-labels', 'discovery-art-featured-labels', 'discovery-selected-label']) {
    const { layout, paint } = c.layers.find(layer => layer.id === id);
    assert.equal(layout['icon-image'], 'name-tag', `${id} names sit on a white tag`);
    assert.equal(layout['icon-text-fit'], 'both');
    assert.equal(paint['text-halo-width'], undefined);
  }
  assert.ok(c.images['name-tag'].options.stretchX, 'the tag stretches around the name');
  assert.equal(c.layers.find(layer => layer.id === 'discovery-art-featured').layout['text-field'], undefined, 'the picture pin keeps its own image');
  // MapLibre places the higher name layer before the pin: the name's left edge (tag padding 6 + icon padding 2) must clear the pin's right edge, or the pin is dropped (QA W6-3).
  for (const [pinId, tagId, pinSize] of [['discovery-art-featured', 'discovery-art-featured-labels', 36 * 0.75], ['discovery-art', 'discovery-labels', 36]]) {
    const pin = c.layers.find(layer => layer.id === pinId).layout, tag = c.layers.find(layer => layer.id === tagId).layout;
    const offset = tag['text-offset'][0] === 'case' ? tag['text-offset'][2][1][0] : tag['text-offset'][0], size = tag['text-size'];
    assert.equal(pin['icon-size'] ?? 1, pinSize / 36);
    assert.ok(offset * size - 8 > pinSize / 2 + 2, `${tagId} clears its ${pinSize}px pin`);
  }
  await c.listeners.click({ point: { x: 0, y: 0 } });
  assert.ok(c.map.queryOptions.layers.includes('discovery-labels'));
  assert.ok(c.map.queryOptions.layers.includes('discovery-selected-label'));
});
test('reserves visible map space above the detail card without resetting selection', () => {
  const c = canvas();
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], selectedId: marker.id, center: null, bottomInset: 220 });
  assert.equal(c.map.padding.bottom, 220);
  const count = c.cameras.length;
  c.window.glingDiscoveryUpdate(sessionId, { markers: [marker], selectedId: marker.id, center: null, bottomInset: 380 });
  assert.equal(c.map.padding.bottom, 356);
  assert.equal(c.cameras.length, count + 1);
  assert.deepEqual(Array.from(c.cameras.at(-1).center), [marker.longitude, marker.latitude]);
  assert.equal(c.sources['discovery-selection'].data.features[0].properties.id, marker.id);
  assert.throws(() => discoveryMapScript({ markers: [marker], bottomInset: NaN }, sessionId));
  assert.throws(() => discoveryMapScript({ markers: [marker], bottomInset: 1001 }, sessionId));
});


test('embedded map labels follow the selected interface language', () => {
  const html = discoveryMapHtml({ ...options, language: 'en' });
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('City discovery map. Places are also available in the list.'));
  assert.throws(() => discoveryMapHtml({ ...options, language: 'bad\" onload=alert(1)' }));
});


test('floating filter inset moves zoom controls and camera padding below the chips', () => {
  const c = canvas();
  const state = { markers: [marker], selectedId: marker.id, topInset: 68, bottomInset: 220 };
  c.window.glingDiscoveryUpdate(sessionId, state);
  assert.equal(c.paddingCalls.at(-1).top, 68);
  assert.equal(c.paddingCalls.at(-1).bottom, 220);
  assert.equal(c.map.getContainer().style.getPropertyValue('--map-top-inset'), '68px');
  const count = c.paddingCalls.length;
  c.window.glingDiscoveryUpdate(sessionId, state);
  assert.equal(c.paddingCalls.length, count);
  for (const topInset of [-1, 1001, NaN, Infinity, '68']) {
    assert.throws(() => discoveryMapScript({ ...state, topInset }, sessionId));
    c.window.glingDiscoveryUpdate(sessionId, { ...state, topInset });
    assert.equal(c.paddingCalls.length, count);
  }
});

test('verified webshop discounts get a separate mint badge while the restaurant pin keeps its category color', () => {
  const discounted = { ...marker, discount: 20.8 };
  assert.equal(discoveryMarkers([discounted])[0].discount, 20.8);
  for (const discount of [NaN, Infinity, -1, 0, 100.1, '20.8']) {
    assert.throws(() => discoveryMarkers([{ ...marker, discount }]), /INVALID_DISCOVERY_MARKER/);
  }
  const c = canvas([discounted]);
  assert.ok(c.images['discount-20.8']);
  assert.equal(c.images['discount-20.8'].options.pixelRatio, 2);
  assert.ok(c.labels.includes('20.8%'));
  assert.ok(!c.labels.some(label => /최대|Up to/.test(label)), 'map artwork shows only the current numeric percentage');
  assert.ok(c.images['discount-20.8'].image.width <= 120, 'numeric badge stays at most 60 CSS pixels wide');
  assert.equal(c.images['discount-20.8'].image.height, 40);
  assert.equal(c.sources.discovery.data.features[0].properties.color, marker.color);
  assert.equal(c.sources.discovery.data.features[0].properties.discount, 20.8);
  assert.equal(c.layers.find(layer => layer.id === 'discovery-discount').source, 'discovery');
  assert.equal(c.layers.find(layer => layer.id === 'discovery-selected-discount').source, 'discovery-selection');
  c.window.glingDiscoveryUpdate(sessionId, { markers: [discounted], selectedId: marker.id });
  assert.equal(c.sources['discovery-selection'].data.features[0].properties.discount, 20.8);
  assert.equal(c.sources['discovery-selection'].data.features[0].properties.color, marker.color);
  const previous = c.sources.discovery.data;
  c.window.glingDiscoveryUpdate(sessionId, { markers: [{ ...marker, discount: '100%' }], selectedId: marker.id });
  assert.equal(c.sources.discovery.data, previous, 'untrusted embedded updates cannot turn invalid data into a saving claim');
});

test('discount dots stay compact below neighborhood zoom and percentages reuse label collision and selection policy', () => {
  const discounted = { ...marker, discount: 20.8, top25: true };
  const c = canvas([discounted]);
  for (const [id, source, selected] of [['discovery-discount', 'discovery', false], ['discovery-selected-discount', 'discovery-selection', true]]) {
    const dot = c.layers.find(layer => layer.id === id + '-dot');
    const number = c.layers.find(layer => layer.id === id);
    assert.equal(dot.type, 'circle'); assert.equal(dot.source, source);
    assert.equal(dot.paint['circle-radius'], 4); assert.equal(dot.paint['circle-color'], '#8FD9C4');
    assert.equal(dot.paint['circle-translate-anchor'], 'viewport', 'dot stays next to the upright number when the map rotates');
    assert.ok(JSON.stringify(dot.paint['circle-translate']).includes('[-12,10]'), 'close-up dot sits beside the full-size pin');
    assert.ok(dot.minzoom <= c.map.config.zoom, 'mint signal stays available at the initial city zoom');
    assert.equal(number.minzoom, 14, 'number starts at neighborhood zoom');
    assert.equal(number.layout['icon-allow-overlap'], selected);
    assert.equal(number.layout['icon-ignore-placement'], selected);
    assert.equal(number.layout['icon-anchor'], 'right');
    assert.deepEqual(Array.from(number.layout['icon-offset']), [-20, 10], 'percentage stays opposite the right-anchored place name, outside its collision box');
    assert.equal(c.map.config.zoom < number.minzoom, true, 'initial city view shows the dot without a percentage');
  }
  c.window.glingDiscoveryUpdate(sessionId, { markers: [discounted], selectedId: marker.id });
  for (const id of ['discovery-discount', 'discovery-discount-dot']) {
    assert.ok(JSON.stringify(c.layers.find(layer => layer.id === id).filter).includes(marker.id), 'selected point is excluded from ordinary badges');
  }
  assert.equal(c.sources['discovery-selection'].data.features.length, 1);
  assert.equal(c.layers.find(layer => layer.id === 'discovery-pins').paint['circle-color'][1], 'color');
  assert.equal(c.layers.find(layer => layer.id === 'discovery-selected-pin').paint['circle-color'][1], 'color');
  c.map.hits = [{ properties: { id: marker.id } }];
  c.listeners.click({ point: { x: 1, y: 2 } });
  assert.ok(c.map.queryOptions.layers.includes('discovery-discount-dot'));
  assert.ok(c.map.queryOptions.layers.includes('discovery-selected-discount-dot'));
  assert.equal(c.messages.at(-1).type, 'select'); assert.equal(c.messages.at(-1).id, marker.id);
  assert.match(c.html, /민트색 점.*대표 메뉴 최대 할인율/);
  assert.match(discoveryMapHtml({ ...options, language: 'en', markers: [discounted] }), /Mint dots.*maximum verified representative-menu saving/);
});

function trackSourceWrites(c) {
  const writes = [];
  for (const [id, source] of Object.entries(c.sources)) {
    const original = source.setData;
    source.setData = function(data) { writes.push({ source: id, features: data.features.length }); return original.call(this, data); };
  }
  return writes;
}

test('500 markers are not rewritten for ten selection/padding changes, including equivalent full updates', t => {
  const markers = Array.from({ length: 500 }, (_, i) => ({ ...marker, id: `place:${i}`, longitude: marker.longitude + i / 10000 }));
  const c = canvas(markers), writes = trackSourceWrites(c);
  for (let i = 0; i < 10; i++) {
    c.window.glingDiscoveryUpdate(sessionId, { markers: markers.map(pin => ({ ...pin })), selectedId: markers[i].id, bottomInset: 100 + i });
    assert.equal(c.sources['discovery-selection'].data.features[0].properties.id, markers[i].id);
    assert.equal(c.map.padding.bottom, 100 + i);
  }
  const clusterWrites = writes.filter(row => row.source !== 'discovery-selection');
  t.diagnostic(JSON.stringify({ markers: 500, updates: 10, fullClusterSourceWrites: clusterWrites.length, fullSourceFeaturesResubmitted: clusterWrites.reduce((n, row) => n + row.features, 0), selectionSourceWrites: writes.filter(row => row.source === 'discovery-selection').length }));
  assert.equal(clusterWrites.length, 0, 'selection and padding rewrite no place source, folding ones included (owner 2026-11-11 3A)');
  assert.equal(writes.filter(row => row.source === 'discovery-selection').length, 10);
  const selectedWrites = writes.length;
  vm.runInNewContext(discoveryMapScript({ selectedId: markers[9].id, bottomInset: 120, topInset: 40, userLocation: { latitude: 49.3, longitude: -123.1 } }, sessionId), { window: c.window });
  assert.equal(writes.length, selectedWrites, 'location and padding do not rewrite selection data either');
  assert.equal(c.userMarkers.length, 1);
  assert.equal(c.map.padding.top, 40);
});

test('marker changes refresh places and selected details while transient updates retain current data and boundary guards', () => {
  const c = canvas(), writes = trackSourceWrites(c);
  const update = state => vm.runInNewContext(discoveryMapScript(state, sessionId), { window: c.window });
  update({ selectedId: marker.id });
  const changed = { ...marker, latitude: 49.3, color: '#654321', label: 'Changed place', top25: true, discount: 20.8 };
  update({ markers: [changed], selectedId: marker.id });
  assert.equal(writes.filter(row => row.source === 'discovery').length, 1);
  for (const source of ['discovery', 'discovery-selection']) {
    const feature = c.sources[source].data.features[0];
    assert.equal(feature.properties.label, changed.label); assert.equal(feature.properties.color, changed.color);
    assert.equal(feature.properties.top25, true); assert.equal(feature.properties.discount, 20.8);
    assert.deepEqual(Array.from(feature.geometry.coordinates), [changed.longitude, changed.latitude]);
  }
  assert.ok(c.images['discount-20.8']); assert.ok(c.images['top25-full']);
  update({ selectedId: null });
  assert.equal(c.sources['discovery-selection'].data.features.length, 0);
  assert.equal(c.sources.discovery.data.features.length, 1);
  update({ markers: [], selectedId: marker.id });
  assert.equal(c.sources.discovery.data.features.length, 0);
  assert.equal(c.sources['discovery-selection'].data.features.length, 0, 'removed/hidden pins cannot remain selected');
  const before = writes.length;
  for (const state of [{ markers: null }, { markers: [changed], topInset: NaN }, { markers: [changed], selectedId: 'bad\u0000id' }]) c.window.glingDiscoveryUpdate(sessionId, state);
  c.window.glingDiscoveryUpdate('stale-city', { markers: [changed], selectedId: changed.id });
  assert.equal(writes.length, before, 'malformed and stale updates are rejected atomically');
  assert.throws(() => discoveryMapScript({ userLocation: { latitude: 91, longitude: 0 } }, sessionId));
  assert.throws(() => discoveryMapHtml({ ...options, markers: undefined }));
});

test('each rendered marker field changes the place source, while optional false and unrelated fields do not', () => {
  const c = canvas(), writes = trackSourceWrites(c);
  let pin = { ...marker };
  for (const patch of [{ color: '#123456' }, { label: 'New name' }, { sublabel: '데이트' }, { featured: true }, { icon: 'dining' }, { latitude: 49.3 }, { longitude: -123.1 }, { top25: true }, { discount: 10 }, { discount: 20.8 }, { top25: false }]) {
    const before = writes.filter(row => row.source === 'discovery').length;
    pin = { ...pin, ...patch };
    c.window.glingDiscoveryUpdate(sessionId, { markers: [pin], selectedId: pin.id });
    assert.equal(writes.filter(row => row.source === 'discovery').length, before + 1, JSON.stringify(patch));
    assert.equal(c.sources['discovery-selection'].data.features[0].properties.color, pin.color);
  }
  const before = writes.length;
  const { top25, ...samePin } = pin; // top25 is false here, so dropping it renders the same pin.
  c.window.glingDiscoveryUpdate(sessionId, { markers: [{ ...samePin, ignored: 'not rendered' }], selectedId: pin.id });
  assert.equal(writes.length, before, 'semantic equality is limited to validated rendered marker fields');
});

function mountedBridge(props, platform) {
  const slots = [], calls = [], listeners = {}, timers = new Map(), compass = { watches: [], removed: 0 };
  let index = 0, effects = [], nextTimer = 0, embedded;
  const memo = (factory, deps) => { const at = index++, prior = slots[at]; if (prior && deps.every((v, i) => Object.is(v, prior.deps[i]))) return prior.value; const value = factory(); slots[at] = { deps, value }; return value; };
  const react = {
    useId: () => 'mounted-canvas', useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps),
    useRef(value) { const at = index++; return slots[at] ??= { current: value }; },
    useState(initial) { const at = index++; if (!(at in slots)) slots[at] = initial; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; }]; },
    useEffect(fn, deps) { const at = index++, prior = slots[at]; if (prior && deps.every((v, i) => Object.is(v, prior.deps[i]))) return; effects.push(() => { prior?.cleanup?.(); slots[at] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: platform }, View: 'View', StyleSheet: { create: value => value }, Linking: { openURL() {} } },
    'react-native-webview': { __esModule: true, default: 'WebView' },
    '@/hooks/use-language': { useLanguage: () => ({ language: 'ko', tr: value => value }) },
    '@/components/clay': { useClay: () => true, useDark: () => false }, '@/hooks/use-theme': { useTheme: () => ({}) }, '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/gling-loader': { GlingLoader: 'GlingLoader' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/discovery-map-html': { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers },
    'expo-location': { watchHeadingAsync: async fn => { compass.watches.push(fn); return { remove() { compass.removed++; } }; } }, '@/lib/location': { facingDegrees },
  };
  const exports = {}, host = { location: { protocol: 'https:', origin: options.parentOrigin }, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/discovery-map.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, window: host, require(name) { assert.ok(name in imports, name); return imports[name]; },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
  });
  const Canvas = exports.DiscoveryMap(props).type;
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  function render() {
    index = 0; effects = []; const tree = nodes(Canvas(props));
    const node = tree.find(n => n.type === (platform === 'web' ? 'iframe' : 'WebView'));
    const html = platform === 'web' ? node.props.srcDoc : node.props.source.html;
    if (!embedded || embedded.html !== html) embedded = canvas(props.markers, html);
    const nativeTarget = { injectJavaScript(script) { calls.push({ bytes: Buffer.byteLength(script), script }); vm.runInNewContext(script, { window: embedded.window }); } };
    const contentWindow = { postMessage(message, origin) { assert.equal(origin, options.parentOrigin); calls.push({ bytes: Buffer.byteLength(JSON.stringify(message)), state: message.state }); embedded.listeners['window:message']({ source: embedded.window.parent, origin, data: message }); } };
    node.props.ref.current = platform === 'web' ? { contentWindow } : nativeTarget;
    effects.forEach(fn => fn());
    return { node, tree, contentWindow };
  }
  function notify(rendered, type = 'ready', extra = {}) {
    const data = JSON.stringify({ ...embedded.messages.find(m => m.type === 'ready'), type, ...extra });
    if (platform === 'web') listeners.message({ source: rendered.contentWindow, origin: options.parentOrigin, data });
    else rendered.node.props.onMessage({ nativeEvent: { data } });
  }
  return { render, ready: rendered => notify(rendered), notify, calls, compass, timers, reload() { embedded = canvas(props.markers, embedded.html); }, get embedded() { return embedded; } };
}

for (const platform of ['ios', 'web']) test(`${platform} bridge sends marker data only when changed, including equivalent rebuilt props and reload recovery`, t => {
  const pins = Array.from({ length: 500 }, (_, i) => ({ ...marker, id: `place:${i}`, longitude: marker.longitude + i / 10000 }));
  const selections = [], props = { markers: pins, cityName: 'Vancouver', onSelect: id => selections.push(id) };
  const app = mountedBridge(props, platform); let rendered = app.render(); app.ready(rendered); app.render();
  const c = app.embedded, writes = trackSourceWrites(c), start = app.calls.length;
  for (let i = 0; i < 10; i++) { props.markers = pins.map(pin => ({ ...pin })); props.selectedId = pins[i].id; props.bottomInset = 100 + i; rendered = app.render(); }
  const updates = app.calls.slice(start), full = updates.filter(call => call.state ? Object.hasOwn(call.state, 'markers') : call.script.includes('"markers"'));
  const baselineBytes = Buffer.byteLength(platform === 'web' ? JSON.stringify({ type: 'discovery.update', sessionId: 'mounted-canvas.0', state: { markers: discoveryMarkers(pins), selectedId: pins[0].id, center: null, userLocation: null, topInset: 0, bottomInset: 100 } }) : discoveryMapScript({ markers: pins, selectedId: pins[0].id, bottomInset: 100 }, 'mounted-canvas.0'));
  t.diagnostic(JSON.stringify({ platform, selectionUpdates: updates.length, fullMarkerMessages: full.length, baselineOneUpdateBytes: baselineBytes, largestTransientUpdateBytes: Math.max(...updates.map(call => call.bytes)), totalTransientBytes: updates.reduce((n, call) => n + call.bytes, 0), clusterSourceWrites: writes.filter(w => w.source === 'discovery').length }));
  assert.equal(updates.length, 10); assert.equal(full.length, 0, 'pin selection never resends full marker data');
  assert.ok(updates.every(call => call.bytes < 600)); assert.equal(writes.filter(w => w.source === 'discovery').length, 0);
  const writesBeforeGPS = writes.length;
  props.userLocation = { latitude: 49.29, longitude: -123.14, privateText: 'not-a-map-field' };
  props.center = { latitude: 49.29, longitude: -123.14, requestId: 1, privateText: 'not-a-map-field' };
  props.topInset = 50; app.render();
  assert.equal(writes.length, writesBeforeGPS, 'GPS, camera and padding remain separate from marker sources');
  assert.deepEqual(c.userMarkers[0].point, [-123.14, 49.29]); assert.deepEqual(Array.from(c.cameras.at(-1).center), [-123.14, 49.29]);
  assert.ok(!JSON.stringify(app.calls.at(-1)).includes('not-a-map-field'), 'both transports only project public map coordinates');
  props.markers = [{ ...pins[0], label: 'Updated', color: '#123456', discount: 20.8 }]; app.render();
  assert.equal(c.sources.discovery.data.features.length, 1); assert.equal(c.sources.discovery.data.features[0].properties.discount, 20.8);
  assert.equal(writes.filter(w => w.source === 'discovery').length, 1);
  props.markers = []; props.selectedId = null; rendered = app.render();
  assert.equal(c.sources.discovery.data.features.length, 0, 'hidden/filtered data is removed rather than kept from prior payload');
  app.notify(rendered, 'select', { id: pins[0].id });
  assert.deepEqual(selections, [], 'selection callbacks validate against current filters, never last-sent markers');
  const receive = c.window.glingDiscoveryUpdate; c.window.glingDiscoveryUpdate = () => {};
  props.markers = [pins[0]]; rendered = app.render(); c.window.glingDiscoveryUpdate = receive;
  assert.equal(c.sources.discovery.data.features.length, 0, 'simulate a send before embedded JavaScript is ready');
  app.ready(rendered); assert.equal(c.sources.discovery.data.features.length, 1, 'ready resends current markers after a lost pre-ready message');
  props.markers = []; rendered = app.render(); app.reload(); app.ready(rendered);
  assert.equal(app.embedded.sources.discovery.data.features.length, 0, 'same-session document reload cannot resurrect original seed data');
  app.notify(rendered, 'error'); rendered = app.render();
  rendered.tree.find(node => node.props?.analyticsId === 'discovery.map.retry').props.onPress();
  rendered = app.render(); app.ready(rendered);
  assert.equal(app.embedded.sources.discovery.data.features.length, 0, 'retry under a new session restores current data');
  app.notify(rendered, 'select', { id: pins[0].id, sessionId: 'mounted-canvas.0' });
  assert.deepEqual(selections, []);
});

test('M7: the map view follows the compass itself, at most 4 turns a second, and a turn sends only the cone (map lag 2026-11-11)', async () => {
  const pins = Array.from({ length: 500 }, (_, i) => ({ ...marker, id: `place:${i}`, longitude: marker.longitude + i / 10000 }));
  const props = { markers: pins, cityName: 'Vancouver', onSelect() {}, userLocation: { latitude: 49.29, longitude: -123.14 } };
  const app = mountedBridge(props, 'ios'); app.ready(app.render()); app.render();
  assert.equal(app.compass.watches.length, 0, 'no compass until the screen asks for it');
  props.compass = true; app.render(); await new Promise(setImmediate);
  assert.equal(app.compass.watches.length, 1);
  const c = app.embedded, dot = c.userMarkers[0], writes = trackSourceWrites(c), start = app.calls.length;
  const due = () => [...app.timers].map(([id, timer]) => { app.timers.delete(id); timer.fn(); return timer.delay; });
  const read = degrees => app.compass.watches[0]({ trueHeading: degrees, magHeading: degrees - 10, accuracy: 3 });
  read(181); assert.deepEqual(due(), [0]); app.render();
  assert.equal(dot.rotation, 180);
  read(91); read(271);
  const waits = due();
  assert.equal(waits.length, 1); assert.ok(waits[0] > 200, 'a burst inside a quarter second waits');
  app.render(); assert.equal(dot.rotation, 270, 'then only the newest reading shows');
  const updates = app.calls.slice(start);
  assert.equal(updates.length, 2);
  assert.ok(updates.every(call => !call.script.includes('"markers"') && call.bytes < 600), 'a turn never resends the pins');
  assert.equal(writes.length, 0, 'a turn writes no map source');
  props.compass = false; app.render(); app.render(); // the stop clears the reading, and that state change renders once more
  assert.equal(app.compass.removed, 1);
  assert.equal(dot.element['data-facing'], '0', 'the cone drops when the screen stops the compass');
  read(90); due(); app.render();
  assert.equal(dot.element['data-facing'], '0', 'a late reading after stopping is ignored');
});

test('three zoom stages: close-up names with a second line, mid dots with featured names only, far city pills', () => {
  const pins = [{ ...marker, sublabel: '디저트', icon: 'cafe' }, { ...marker, id: 'place:2', label: 'TOP place', featured: true, top25: true }];
  const cities = [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', open: true }, { id: 'toronto', name: '토론토', englishName: 'Toronto', open: true },
    { id: 'calgary', name: '캘거리', englishName: 'Calgary', open: false }];
  const c = canvas(pins, undefined, { cities });
  const layer = id => c.layers.find(value => value.id === id);
  for (const value of c.layers) assert.equal(value.minzoom >= 8, true, `${value.id} hides at the far stage`);
  assert.deepEqual(JSON.parse(JSON.stringify(layer('discovery-pins').paint['circle-radius'])), ['step', ['zoom'], 4, 13, 11], 'mid dots, close-up pins');
  assert.equal(layer('discovery-labels').minzoom, 13);
  assert.ok(JSON.stringify(layer('discovery-labels').layout['text-field']).includes('sublabel'));
  assert.equal(layer('discovery-featured-labels').maxzoom, 13);
  assert.ok(JSON.stringify(layer('discovery-featured-labels').filter).includes('featured'));
  const features = c.sources.discovery.data.features.map(feature => feature.properties);
  assert.deepEqual(JSON.parse(JSON.stringify(features.map(value => [value.sublabel, value.featured, value.icon]))), [['디저트', false, 'cafe'], ['', true, '']]);
  assert.deepEqual(c.cityMarkers.map(pill => pill.element.textContent), ['밴쿠버', '토론토', '캘거리 · 준비 중']);
  assert.deepEqual(c.cityMarkers.map(pill => pill.point), [[-123.12, 49.28], [-79.38, 43.65], [-114.07, 51.05]]);
  assert.equal(c.cityMarkers[2].element.disabled, true, 'a coming-soon city cannot be opened');
  assert.equal(c.cityMarkers[1].element['aria-label'], '토론토 지도로 가기');
  assert.ok(c.cityMarkers.every(pill => pill.element.hidden), 'city view starts at the mid stage');
  c.map.zoom = 5; c.listeners.zoom();
  assert.ok(c.cityMarkers.every(pill => !pill.element.hidden));
  assert.equal(c.userMarkers.length, 0, 'city pills are not the GPS marker');
  const tap = id => c.listeners['document:click']({ target: { closest: selector => selector === '.city-pill' ? { getAttribute: () => id } : null } });
  tap('vancouver');
  assert.deepEqual([Array.from(c.cameras.at(-1).center), c.cameras.at(-1).zoom], [[-123.12, 49.28], 11], 'the current city zooms back in');
  tap('toronto');
  assert.deepEqual(c.messages.at(-1), { type: 'city', id: 'toronto', sessionId });
  const sent = c.messages.length; tap('calgary'); tap('nowhere');
  assert.equal(c.messages.length, sent);
  c.map.zoom = 12; c.listeners.zoom();
  assert.ok(c.cityMarkers.every(pill => pill.element.hidden));
});

test('city taps, zoom and new marker fields are validated at the bridge', () => {
  const parse = (message, ids) => discoveryMapMessage(JSON.stringify({ sessionId, ...message }), sessionId, [marker], ids);
  assert.deepEqual(parse({ type: 'city', id: 'toronto' }, ['toronto']), { type: 'city', id: 'toronto' });
  for (const [message, ids] of [[{ type: 'city', id: 'calgary' }, ['toronto']], [{ type: 'city', id: 'toronto' }, undefined], [{ type: 'city', id: 7 }, ['toronto']]]) assert.equal(parse(message, ids), null);
  assert.deepEqual(parse({ type: 'moved', bounds: [-124, 49, -122, 50], zoom: 9.5 }), { type: 'moved', bounds: { west: -124, south: 49, east: -122, north: 50 }, zoom: 9.5 });
  assert.equal(parse({ type: 'moved', bounds: [-124, 49, -122, 50], zoom: 'far' }).zoom, undefined);
  assert.deepEqual(discoveryMarkers([{ ...marker, sublabel: ' 혼밥\n', featured: false, icon: 'dining' }]), [{ ...marker, sublabel: '혼밥', icon: 'dining' }]);
  for (const bad of [{ sublabel: 'x'.repeat(41) }, { sublabel: 3 }, { featured: 'true' }, { icon: 'Bad Icon' }, { icon: '../x' }]) assert.throws(() => discoveryMarkers([{ ...marker, ...bad }]), /INVALID_DISCOVERY_MARKER/);
  for (const cities of [[{ id: 'Toronto', name: '토론토', englishName: 'Toronto', open: true }], [{ id: 'toronto', name: '', englishName: 'Toronto', open: true }], [{ id: 'toronto', name: '토론토', englishName: 'Toronto', open: 'yes' }], 'toronto'])
    assert.throws(() => discoveryMapHtml({ ...options, cities }), /INVALID_DISCOVERY_CIT/);
  const html = discoveryMapHtml({ ...options, language: 'en', cities: [{ id: 'calgary', name: 'Calgary', englishName: 'Calgary', open: false }, { id: 'x', name: '</script><b>', englishName: 'Halifax', open: true }] });
  assert.ok(!html.includes('</script><b>'));
  assert.ok(html.includes("'Open the '+c.name+' map'") && html.includes('Coming soon'));
});

test('up close a place with 3D art is drawn as a white picture pin once the art loads, otherwise it keeps its dot', async () => {
  const sources = [];
  class Image { set src(value) { sources.push(value); if (value === MAP_PIN_ART.dining) this.onerror(); else this.onload(); } }
  const art = { ...marker, id: 'art', icon: 'cafe' }, broken = { ...marker, id: 'broken', icon: 'dining', latitude: marker.latitude + 0.01 };
  const c = canvas([art, broken], undefined, {}, { Image });
  const features = () => Object.fromEntries(c.sources.discovery.data.features.map(f => [f.properties.id, f.properties.art]));
  assert.equal(JSON.stringify(features()), JSON.stringify({ art: false, broken: false }), 'dots until the pictures load');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(sources.every(src => src.startsWith('data:image/png;base64,')) && sources.length >= 10);
  assert.ok(c.images['pin-cafe'] && !c.images['pin-dining'], 'a picture that fails to load adds no pin image');
  assert.equal(c.images['pin-cafe'].options.pixelRatio, 3);
  assert.equal(JSON.stringify(features()), JSON.stringify({ art: true, broken: false }), 'the failed picture keeps its coloured dot');
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-selected-art').layout['icon-image']), JSON.stringify(['concat', 'pin-', ['get', 'icon']]));
  // A TOP 50 picture pin draws its own ring, so the ring arrives with the picture; the separate ring circle only shows around a dot.
  assert.ok(c.images['pin-cafe-top'] && !c.images['pin-dining-top']);
  const topPin = JSON.stringify(['concat', 'pin-', ['get', 'icon'], ['case', ['==', ['get', 'top25'], true], '-top', '']]);
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-art').layout['icon-image']), topPin);
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-art-featured').layout['icon-image']), JSON.stringify(['concat', 'pin-', ['get', 'icon']]), 'mid-zoom pins keep the 36px image so collisions do not grow');
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-top25').paint['circle-stroke-opacity']), JSON.stringify(['step', ['zoom'], 1, 13, ['case', ['==', ['get', 'art'], true], 0, 1]]));
  assert.equal(JSON.stringify(c.layers.find(layer => layer.id === 'discovery-pins').paint['circle-opacity'].at(-1)), JSON.stringify(['case', ['==', ['get', 'art'], true], 0, 1]));
});
