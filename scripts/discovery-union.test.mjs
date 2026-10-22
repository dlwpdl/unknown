import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { discoveryEvent, discoveryMatches, discoveryPost, mergeCityTop25 } from '../src/lib/discovery.ts';

// Fixture-only contract for the owner's union requirement; no production selections.
const cityId = 'vancouver';
const picks = Array.from({ length: 25 }, (_, index) => ({
  id: `fixture-pick-${index}`, cityId, title: `Fixture pick ${index}`, label: `Fixture address ${index}`,
  category: index === 0 ? 'cafe' : 'dining', latitude: 49.28, longitude: -123.12,
  reason: 'Unit-test selection', sourceUrl: 'https://example.org/fixture', postIds: [],
}));
const cafe = id => ({ id: `place:${cityId}:${id}`, source: 'place', sourceId: id, cityId,
  title: id === 'ordinary' ? 'Ordinary cafe' : 'Fixture pick 0', category: 'cafe', label: 'Fixture address',
  latitude: 49.28, longitude: -123.12, price: null,
  place: { id, cityId, name: id, category: 'cafe', latitude: 49.28, longitude: -123.12, address: 'Fixture address' },
});
const items = mergeCityTop25([cafe('fixture-pick-0'), cafe('ordinary'), cafe('other-branch')], cityId, picks);
const results = (selected, query = '') => items.filter(item => discoveryMatches(item, selected, query));

test('TOP25 plus Cafés includes every pick and ordinary cafés, with overlap shown once', () => {
  const shown = results(['top25', 'cafe']);
  assert.equal(shown.length, 27);
  assert.equal(shown.filter(item => item.top25).length, 25);
  assert.equal(shown.filter(item => item.sourceId === 'fixture-pick-0').length, 1);
  assert.ok(shown.some(item => item.sourceId === 'ordinary'));
  assert.ok(shown.some(item => item.sourceId === 'other-branch'));
});

test('deselecting either option retains only the remaining selection', () => {
  assert.equal(results(['top25']).length, 25);
  assert.equal(results(['cafe']).length, 3);
  assert.ok(results(['cafe']).every(item => item.category === 'cafe'));
});

test('query remains an AND constraint around the union, and cities stay scoped', () => {
  assert.deepEqual(results(['top25', 'cafe'], 'ordinary').map(item => item.sourceId), ['ordinary']);
  assert.equal(mergeCityTop25([cafe('ordinary')], 'toronto', picks).length, 0);
});

test('an empty real Top25 collection never hides ordinary cafés in a mixed selection', () => {
  const ordinary = mergeCityTop25([cafe('ordinary')], cityId, []);
  assert.equal(ordinary.filter(item => discoveryMatches(item, ['top25', 'cafe'], '')).length, 1);
  assert.equal(ordinary.filter(item => discoveryMatches(item, ['top25'], '')).length, 0);
});

const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(tree);
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const declaration = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name);

test('flat map chips retain the approved order and defaults preserve legacy deep links', () => {
  const exports = {};
  vm.runInNewContext(compile(`export const filters = ${declaration('filters').initializer.getText(tree)};`), { exports });
  const filters = exports.filters;
  assert.deepEqual(Array.from(filters.slice(0, 8), value => value.id), ['top25', 'nightlife', 'festival', 'cafe', 'dining', 'places', 'housing', 'used']);
  const state = declaration('[selectedFilters, setSelectedFilters]');
  assert.ok(state, 'the map needs independent selections');
  const initializer = state.initializer.arguments[0].getText(tree);
  for (const [initialCategory, expected] of [[undefined, []], ['all', []], ['unknown', []], ['used', ['used']], ['places', ['places']], ['events', ['events']], ['cafe', ['cafe']]]) {
    const result = vm.runInNewContext(compile(`exports.value = ${initializer};`), { exports, filters, initialCategory });
    assert.deepEqual(Array.from(result), expected);
  }
});

test('the actual chip handler independently toggles each selection and All resets it', () => {
  const attribute = nodes.find(node => ts.isJsxAttribute(node) && node.name.text === 'onPress' && node.initializer?.getText(tree).includes('setSelectedFilters'));
  assert.ok(attribute, 'each category chip must toggle an independent selection');
  const exports = {}, value = { id: 'top25' }, feedback = [];
  let selected = [];
  vm.runInNewContext(compile(`export const press = ${attribute.initializer.expression.getText(tree)};`), {
    exports, value, play: kind => feedback.push(kind), setSelectedFilters: update => { selected = update(selected); },
  });
  for (const [id, expected] of [['top25', ['top25']], ['cafe', ['top25', 'cafe']], ['top25', ['cafe']], ['dining', ['cafe', 'dining']], ['cafe', ['dining']], ['all', []]]) {
    value.id = id; exports.press();
    assert.deepEqual(Array.from(selected), expected);
  }
  assert.deepEqual(feedback, Array(6).fill('selection'));
});

test('specific content chips use actual categories; Festivals does not include ordinary concerts', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const event = { id: 'festival', name: 'Fixture festival', venue: 'Park', startsAt: '2026-10-15T19:00:00Z', endsAt: '2026-10-16T04:00:00Z', localDate: '2026-10-15', status: 'onsale', country: 'CA', location: null };
  const festival = discoveryEvent(event, cityId, now);
  const concert = discoveryEvent({ ...event, id: 'concert', name: 'Fixture live concert' }, cityId, now);
  assert.equal(discoveryMatches(festival, ['festival'], ''), true);
  assert.equal(discoveryMatches(concert, ['festival'], ''), false);
  assert.equal(discoveryMatches(concert, 'events', ''), true, 'legacy event deep links keep their broader meaning');
  const nightlife = discoveryPost({ id: 'night', cityId, title: 'Fixture club', kind: 'story', tag: { slug: 'food' }, hashtags: ['nightlife'], body: 'Google 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12' }, now);
  assert.equal(discoveryMatches(nightlife, ['nightlife'], ''), true);
  assert.equal(discoveryMatches(nightlife, ['cafe', 'dining'], ''), false);
  assert.equal(discoveryMatches(cafe('ordinary'), [], ''), true, 'no selection shows all results');
});

test('the actual screen applies city, privacy, listing expiry, date and query around the union', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const pick = { ...picks[0], postIds: ['hidden'] };
  const post = (id, category = 'cafe', extra = {}) => ({ ...cafe(id), id: `post:${id}`, source: 'post', sourceId: id, category,
    post: { id, author: { id: 'author' }, kind: 'story', body: 'Fixture content', ...extra } });
  const event = { id: 'festival', name: 'Fixture festival', venue: 'Park', startsAt: '2026-10-15T19:00:00Z', endsAt: '2026-10-18T04:00:00Z', localDate: '2026-10-15', status: 'onsale', country: 'CA', location: null };
  const exports = {};
  const context = { exports, catalogItems: [cafe('ordinary')], current: { limited: false, items: [
    post('hidden'), post('private-body', 'cafe', { author: { id: 'blocked' } }),
    { ...post('other-city'), cityId: 'toronto' },
    post('expired', 'used', { kind: 'listing', listingStatus: 'open', expiresAt: '2020-01-01T00:00:00Z' }),
    post('closed', 'used', { kind: 'listing', listingStatus: 'closed', expiresAt: '2099-01-01T00:00:00Z' }),
    post('active', 'used', { kind: 'listing', listingStatus: 'open', expiresAt: '2099-01-01T00:00:00Z' }),
    discoveryEvent(event, cityId, now),
    discoveryEvent({ ...event, id: 'concert', name: 'Fixture live concert' }, cityId, now),
    discoveryEvent({ ...event, id: 'other-day', localDate: '2026-10-16' }, cityId, now),
  ] }, city: { id: cityId }, now, selectedFilters: ['top25', 'cafe', 'festival', 'used'], query: '', days: ['2026-10-15'],
  hidden: (_type, id, author) => id === 'hidden' || author === 'blocked', discoveryEvent, discoveryMatches,
  mergeCityTop25: (items, city) => mergeCityTop25(items, city, [pick]) };
  const start = source.indexOf('  const publicItems = '), end = source.indexOf('  const pins = ', start);
  vm.runInNewContext(compile(`export function run() { ${source.slice(start, end)} return items; }`), context);
  const shown = exports.run();
  assert.deepEqual(Array.from(shown, item => item.sourceId), [pick.id, 'active', 'festival', 'ordinary']);
  assert.equal(shown[0].post, undefined, 'a hidden matching recommendation cannot leak through its public pick');
  assert.equal(shown[0].imageUri, undefined);
  context.query = 'ordinary';
  assert.deepEqual(Array.from(exports.run(), item => item.sourceId), ['ordinary']);
});
