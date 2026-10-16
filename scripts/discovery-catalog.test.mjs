import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as discovery from '../src/lib/discovery.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url)));
const place = catalog.cities.toronto.places[0];
const mapSource = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

test('existing catalog places retain their public coordinates, category and exact detail identity in discovery', () => {
  assert.equal(typeof discovery.discoveryPlace, 'function');
  for (const { places } of Object.values(catalog.cities)) for (const stored of places) {
    const item = discovery.discoveryPlace(stored);
    assert.equal(item.sourceId, stored.id);
    assert.equal(item.cityId, stored.cityId);
    assert.equal(item.latitude, stored.latitude);
    assert.equal(item.longitude, stored.longitude);
    assert.equal(item.title, stored.name);
    assert.equal(item.category, stored.category === 'food' ? 'dining' : stored.category === 'cafe' ? 'cafe' : 'place');
    assert.equal(item.place, stored);
    assert.equal(item.top25, undefined);
    assert.equal(discovery.discoveryMatches(item, 'places', ''), true);
    assert.equal(discovery.discoveryMatches(item, 'housing', ''), false);
    assert.equal(discovery.discoveryMatches(item, 'events', ''), false);
    assert.equal(discovery.discoveryMatches(item, 'all', stored.name), true);
  }
  for (const patch of [{ latitude: NaN }, { longitude: 181 }]) assert.equal(discovery.discoveryPlace({ ...place, ...patch }), null);
});

test('a Top 25 pick merges the same canonical catalog ID without awarding other branches a badge', () => {
  assert.equal(typeof discovery.discoveryPlace, 'function');
  const item = discovery.discoveryPlace(place);
  const pick = { id: place.id, cityId: place.cityId, title: place.name, label: place.address, category: 'place', latitude: place.latitude, longitude: place.longitude,
    reason: 'Fixture selection', sourceUrl: 'https://example.org/selected-places', postIds: [] };
  const other = discovery.discoveryPlace({ ...place, id: 'osm:node:9999999999' });
  const merged = discovery.mergeCityTop25([item, other], place.cityId, [pick]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(row => row.sourceId === place.id).place.id, place.id);
  assert.equal(merged.find(row => row.sourceId === place.id).top25.reason, pick.reason);
  assert.equal(merged.find(row => row.sourceId === other.sourceId).top25, undefined);
  assert.equal(discovery.mergeCityTop25([item], 'vancouver', [pick]).length, 0);
});

test('the combined screen includes its current-city catalog while backend rows are still loading', () => {
  assert.equal(typeof discovery.discoveryPlace, 'function');
  const start = mapSource.indexOf('  const publicItems = '), end = mapSource.indexOf('  const pins = ', start);
  const exports = {};
  vm.runInNewContext(compile(`exports.run = () => { ${mapSource.slice(start, end)} return items; };`), {
    exports, current: null, catalogItems: [discovery.discoveryPlace(place)], city: { id: place.cityId }, now: Date.now(), filter: 'places', query: '', top25Only: false, days: [],
    hidden: () => false, discoveryEvent: () => null, mergeCityTop25: discovery.mergeCityTop25, discoveryMatches: discovery.discoveryMatches,
  });
  assert.equal(exports.run().length, 1);
  assert.equal(exports.run()[0].sourceId, place.id);
});

test('opening a catalog map card uses the existing place detail route and leaves editorial-only source links intact', () => {
  assert.equal(typeof discovery.discoveryPlace, 'function');
  const start = mapSource.indexOf('  const open = (item: DiscoveryItem) => {'), end = mapSource.indexOf('  const selectPin = ', start);
  const exports = {}, routes = [], links = [], feedback = [];
  vm.runInNewContext(compile(mapSource.slice(start, end) + '\nexports.open = open;'), {
    exports, city: { id: place.cityId }, router: { push: value => routes.push(value) }, play: value => feedback.push(value),
    Linking: { openURL: async url => links.push(url) }, tr: value => value, Alert: { alert() {} },
  });
  exports.open(discovery.discoveryPlace(place));
  assert.equal(routes.at(-1).pathname, '/places/[id]');
  assert.equal(routes.at(-1).params.id, place.id);
  assert.equal(routes.at(-1).params.cityId, place.cityId);
  assert.equal(feedback.at(-1), 'selection');
  assert.equal(links.length, 0);
  exports.open({ source: 'place', top25: { sourceUrl: 'https://example.org/pick' } });
  assert.equal(links.at(-1), 'https://example.org/pick');
});
