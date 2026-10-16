import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { discoveryMapHtml, discoveryMapMessage, discoveryMapScript, discoveryMarkers } from '../src/lib/discovery-map-html.ts';

const marker = { id: 'place:1', latitude: 49.28, longitude: -123.12, color: '#d86632', label: '카페' };
const sessionId = 'canvas-1';
const options = { markers: [marker], cityName: 'Vancouver', sessionId, parentOrigin: 'https://gling.app' };

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

function canvas(markers = [marker]) {
  const messages = [], listeners = {}, cameras = [], sources = {}, layers = [], images = {}, paddingCalls = [];
  let map;
  class Map {
    constructor(config) { this.config = config; this.zoom = 11; map = this; }
    on(type, callback) { listeners[type] = callback; }
    addControl() {}
    addSource(id, source) { sources[id] = { ...source, setData(data) { this.data = data; }, getClusterExpansionZoom: async () => 14 }; }
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
    getContainer() { return { clientHeight: 400 }; }
    setPadding(padding) { this.padding = padding; paddingCalls.push(padding); }
  }
  const window = { parent: { postMessage: message => messages.push(JSON.parse(message)) }, addEventListener: (type, callback) => { listeners['window:' + type] = callback; }, matchMedia: () => ({ matches: true }) };
  const drawing = { scale() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillText() {}, getImageData: (_x, _y, width, height) => ({ width, height, data: new Uint8Array(width * height * 4) }) };
  const context = { window, document: { createElement: () => ({ getContext: () => drawing }), addEventListener: (type, callback) => { listeners['document:' + type] = callback; } }, maplibregl: { Map, NavigationControl: class {} }, setTimeout: () => 1, clearTimeout() {}, console };
  const html = discoveryMapHtml({ ...options, markers });
  const script = [...html.matchAll(/<script nonce="gling-map">([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInNewContext(script, context);
  listeners.load();
  return { window, listeners, cameras, sources, layers, images, paddingCalls, messages, map, html };
}

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

test('Top 25 uses A flags on individual pins, selected pins and clusters without changing category color or counts', () => {
  const c = canvas([{ ...marker, top25: true }]);
  assert.equal(c.sources.discovery.data.features[0].properties.top25, true);
  assert.equal(c.sources.discovery.data.features[0].properties.color, marker.color);
  assert.ok(c.sources.discovery.clusterProperties.top25Count);
  assert.ok(c.images['top25-small']);
  assert.ok(c.images['top25-full']);
  assert.equal(c.images['top25-full'].options.pixelRatio, 2);
  assert.ok(c.layers.some(layer => layer.id === 'discovery-top25'));
  assert.ok(c.layers.some(layer => layer.id === 'discovery-selected-top25' && layer.source === 'discovery-selection'));
  c.window.glingDiscoveryUpdate(sessionId, { markers: [{ ...marker, top25: 'true' }], selectedId: null });
  assert.equal(c.sources.discovery.data.features[0].properties.top25, true);
});

test('clusters GeoJSON with counts and 44px targets; preserves camera for result updates', async () => {
  const c = canvas();
  assert.equal(c.map.config.zoom, 11);
  assert.deepEqual(Array.from(c.map.config.center), [-123.12, 49.28]);
  assert.equal(c.sources.discovery.cluster, true);
  assert.ok(c.layers.some(layer => layer.type === 'symbol' && layer.layout['text-field'].includes('point_count')));
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
  c.map.hits = [{ properties: { cluster_id: 4, point_count: 2 }, geometry: { type: 'Point', coordinates: [-123.1, 49.3] } }];
  await c.listeners.click({ point: { x: 10, y: 10 } });
  assert.equal(c.cameras.at(-1).zoom, 14);
  c.map.hits = [{ properties: { id: marker.id }, geometry: { type: 'Point', coordinates: [-123.12, 49.28] } }];
  await c.listeners.click({ point: { x: 10, y: 10 } });
  assert.ok(c.messages.some(message => message.type === 'select' && message.id === marker.id));
  assert.ok(c.messages.filter(message => message.type === 'feedback').length >= 2);
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

test('unclustered and selected pins show tappable labels with the live style glyph font', async () => {
  const c = canvas();
  const labels = c.layers.find(layer => layer.id === 'discovery-labels');
  assert.equal(labels.type, 'symbol');
  assert.deepEqual(Array.from(labels.layout['text-field']), ['get', 'label']);
  assert.deepEqual(Array.from(labels.layout['text-font']), ['Noto Sans Regular']);
  assert.ok(labels.filter);
  const selectedLabel = c.layers.find(layer => layer.id === 'discovery-selected-label');
  assert.equal(selectedLabel.source, 'discovery-selection');
  assert.deepEqual(Array.from(selectedLabel.layout['text-field']), ['get', 'label']);
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
