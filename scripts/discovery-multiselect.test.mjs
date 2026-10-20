import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { IconSize } from '../src/constants/design-system.ts';
import { discoveryMatches, mergeCityTop25, discoveryEvent, discoveryEventOnDays } from '../src/lib/discovery.ts';

// Legacy programmatic union compatibility; the map UI now selects one category.
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


test('specific discovery categories stay separate while legacy All Events remains valid', () => {
  const base = cafe('ordinary');
  for (const category of ['nightlife', 'festival', 'cafe', 'dining', 'housing', 'used']) {
    assert.equal(discoveryMatches({ ...base, category }, [category], ''), true);
    assert.equal(discoveryMatches({ ...base, category }, ['places'], ''), false);
  }
  assert.equal(discoveryMatches({ ...base, category: 'nature' }, ['places'], ''), true);
  assert.equal(discoveryMatches({ ...base, category: 'event', source: 'event' }, ['festival'], ''), false);
  assert.equal(discoveryMatches({ ...base, category: 'event', source: 'event' }, ['events'], ''), true);
  assert.equal(discoveryMatches(base, [], ''), true);
  assert.equal(discoveryMatches(base, 'all', ''), true);
});

test('real map chips select one category and All clears category and date state', () => {
  const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const toggleFilter = '), end = source.indexOf('  const chooseDate = ', start);
  assert.ok(start > 0 && end > start, 'map needs an independent filter-toggle handler');
  const filterStart = source.indexOf('const filters:'), filterEnd = source.indexOf('type Result = ', filterStart);
  const jsxStart = source.indexOf('<ScrollView horizontal analyticsId="discovery.filter"');
  const jsxEnd = source.indexOf('</ScrollView>', jsxStart) + '</ScrollView>'.length;
  let selected = [];
  const feedback = [], exports = {};
  const element = (type, props, key) => ({ type, props, key });
  const context = {
    exports, TOP25_GOLD: '#F4CA78', top25Ink: '#68543A',
    styles: {}, theme: { accent: '#CBB9FF', line: '#ccc', backgroundSelected: '#ddd', backgroundElement: '#eee', text: '#222' },
    ScrollView: 'scroll', Pressable: 'button', View: 'view', ThemedText: 'text', GlingVisitedBadge: 'visited-badge', SymbolView: 'symbol', IconSize, tr: value => value,
    play: value => feedback.push(value), setSelectedFilters: update => { selected = Array.from(typeof update === 'function' ? update(selected) : update); },
    setDateFilter() {}, setDate() {}, setDateOpen() {}, setDateError() {},
    get selectedFilters() { return selected; },
    require: () => ({ jsx: element, jsxs: element }),
  };
  const chipStart = source.indexOf('  const filterChip = '), chipEnd = source.indexOf('  return <SafeAreaView', chipStart);
  const code = `${source.slice(filterStart, filterEnd)}\n${source.slice(start, end)}\n${source.slice(chipStart, chipEnd)}\nexports.render = () => (${source.slice(jsxStart, jsxEnd)});`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const buttons = () => [exports.render().props.children].flat(Infinity);
  const button = id => buttons().find(node => node.key === id);
  assert.deepEqual(buttons().map(node => node.key), ['all', 'top25', 'visited', 'dining', 'cafe', 'festival', 'nightlife', 'places', 'housing', 'used']);
  button('top25').props.onPress();
  button('cafe').props.onPress();
  assert.deepEqual(selected, ['cafe']);
  assert.equal(button('top25').props.accessibilityRole, 'button');
  assert.equal(button('top25').props.accessibilityState.selected, false);
  assert.equal(button('cafe').props.accessibilityState.selected, true);
  assert.equal(button('cafe').props.accessibilityLabel, '카페');
  button('top25').props.onPress();
  assert.deepEqual(selected, ['top25']);
  assert.equal(button('top25').props.accessibilityState.selected, true);
  assert.equal(button('cafe').props.accessibilityState.selected, false);
  button('visited').props.onPress();
  assert.deepEqual(selected, ['visited']);
  assert.equal(button('visited').props.accessibilityLabel, 'gling Visited');
  assert.equal(button('top25').props.accessibilityState.selected, false);
  button('all').props.onPress();
  assert.deepEqual(selected, []);
  assert.equal(button('all').props.accessibilityState.selected, true);
  assert.deepEqual(feedback, ['selection', 'selection', 'selection', 'selection', 'selection']);
});

test('the real result pipeline applies city, hidden author, listing expiry and event dates around the union', () => {
  const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const publicItems = '), end = source.indexOf('  const pins = ', start);
  const event = day => ({ id: day, source: 'event', sourceId: day, cityId, title: 'Fixture festival', label: 'Fixture venue',
    category: 'festival', latitude: 49.28, longitude: -123.12, price: null, localDate: day,
    event: { id: day, name: 'Fixture festival', venue: 'Fixture venue', city: 'Vancouver', localDate: day, status: 'onsale', country: 'CA', endsAt: '2026-10-20T23:00:00Z' },
  });
  const blocked = { ...cafe('blocked'), source: 'post', post: { id: 'blocked', kind: 'story', author: { id: 'blocked-author' } } };
  const expired = { ...cafe('expired'), source: 'post', category: 'used', post: { id: 'expired', kind: 'listing', listingStatus: 'closed', expiresAt: '2027-01-01', author: { id: 'visible' } } };
  const exports = {}, context = {
    exports, catalogItems: [], current: { items: [cafe('ordinary'), blocked, expired, { ...cafe('foreign'), cityId: 'toronto' }, event('2026-10-17'), event('2026-10-18')] },
    city: { id: cityId }, now: Date.parse('2026-10-15T12:00:00Z'), selectedFilters: ['top25', 'cafe', 'used', 'festival'], query: '', days: ['2026-10-17'],
    hidden: (_type, _id, author) => author === 'blocked-author', discoveryEvent, discoveryEventOnDays, discoveryMatches,
    mergeCityTop25: (items, city) => mergeCityTop25(items, city, picks.slice(0, 1)),
  };
  vm.runInNewContext(ts.transpileModule(`exports.run = () => { ${source.slice(start, end)} return items; };`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  assert.deepEqual(Array.from(exports.run(), item => item.sourceId), ['fixture-pick-0', 'ordinary', '2026-10-17']);
  context.query = 'ordinary';
  assert.deepEqual(Array.from(exports.run(), item => item.sourceId), ['ordinary']);
});
