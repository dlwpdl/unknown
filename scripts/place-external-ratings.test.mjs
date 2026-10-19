import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { tr, setActiveLanguage } from '../src/i18n/index.ts';

const root = new URL('../', import.meta.url);
const snapshot = () => JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8'));
function load(rows = snapshot()) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('src/lib/place-external-ratings.ts', root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, URL, require: () => rows });
  return exports;
}

test('external ratings stay scoped to the exact city and OSM identity, separate by provider', () => {
  const api = load();
  const ratings = api.getPlaceExternalRatings('vancouver', 'osm:node:703754423');
  assert.equal(ratings.length, 2);
  assert.equal(ratings.find(r => r.provider === 'Google').score, 4.5);
  assert.equal(ratings.find(r => r.provider === 'Google').count, 28661);
  assert.equal(ratings.find(r => r.provider === 'Tripadvisor').score, 4.1);
  assert.equal(api.getPlaceExternalRatings('toronto', 'osm:node:703754423').length, 0);
  assert.equal(api.getPlaceExternalRatings('vancouver', 'osm:node:1').length, 0);
});

test('missing, invalid and unsafe source metadata never becomes a visible score', () => {
  const row = snapshot()[0];
  for (const bad of [{ score: null }, { score: 0 }, { score: 6 }, { count: -1 }, { count: 1.5 }, { scale: 10 },
    { provider: 'Gling' }, { checkedAt: 'unknown' }, { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'https://wanderlog.com.evil.test/place/details/98400' }, { sourceUrl: 'https://user:pass@wanderlog.com/place/details/98400' }]) {
    assert.equal(load([{ ...row, ...bad }]).getPlaceExternalRatings(row.cityId, row.placeId).length, 0, JSON.stringify(bad));
  }
});

test('every bundled rating matches an existing place and keeps its observed source/date/count', () => {
  const catalog = JSON.parse(readFileSync(new URL('src/lib/city-places.catalog.json', root), 'utf8'));
  const rows = snapshot(), seen = new Set();
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    const place = catalog.cities[row.cityId]?.places.find(p => p.id === row.placeId);
    assert.ok(place, `${row.cityId}/${row.placeId}`);
    assert.equal(row.placeName, place.name);
    assert.ok(!seen.has(`${row.cityId}/${row.placeId}/${row.provider}`));
    seen.add(`${row.cityId}/${row.placeId}/${row.provider}`);
    assert.ok(load().getPlaceExternalRatings(row.cityId, row.placeId).some(r => r.provider === row.provider));
    assert.ok(Date.parse(row.checkedAt) <= Date.now());
    assert.ok(row.count > 0);
    assert.ok(row.via === 'Wanderlog' || row.via === 'Resy');
    assert.equal(Object.hasOwn(row, 'reviews'), false, 'external data must not masquerade as member reviews');
  }
});

function view({ language = 'ko', failOpen = false } = {}) {
  setActiveLanguage(language);
  const exports = {}, calls = { links: [], feedback: [], alerts: [] };
  const imports = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 },
      Linking: { openURL: async url => { calls.links.push(url); if (failOpen) throw Error('offline'); } },
      Alert: { alert: (...args) => calls.alerts.push(args) } },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/merchant-rating-bar': { GlingRatingIcon: 'GlingRatingIcon' },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16 } },
    '@/hooks/use-language': { useLanguage: () => ({ tr, locale: language }) },
    '@/hooks/use-theme': { useTheme: () => ({ card: '#fff', line: '#ddd', textSecondary: '#666' }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.feedback.push(kind) }) },
    '@/lib/place-external-ratings': load(),
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('src/components/place-external-ratings.tsx', root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => imports[name], Date });
  return { ...exports, calls };
}
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(v => Array.isArray(v) ? v.flatMap(nodes) : nodes(v))];
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value)
  ? value.map(text).join(' ') : value?.props ? text(value.props.children) : '';
const scope = { cityId: 'vancouver', placeId: 'osm:node:703754423' };

test('rating cards disclose the intermediary and date; source taps provide feedback and handle failure', async () => {
  const ui = view({ failOpen: true }), tree = ui.PlaceExternalRatings(scope);
  assert.match(text(tree), /Google/); assert.match(text(tree), /Tripadvisor/);
  assert.match(text(tree), /Wanderlog/); assert.match(text(tree), /2026/); assert.match(text(tree), /28,661/);
  const links = nodes(tree).filter(node => node.props?.analyticsId === 'places.detail.source');
  assert.equal(links.length, 2);
  assert.equal(links[0].props.accessibilityRole, 'link');
  links[0].props.onPress(); await new Promise(setImmediate);
  assert.deepEqual(ui.calls.links, ['https://wanderlog.com/place/details/98400']);
  assert.deepEqual(ui.calls.feedback, ['selection', 'warning']);
  assert.equal(ui.calls.alerts.length, 1);
});

test('unmatched places stay empty and English displays ratings without claiming Gling reviews', () => {
  const ui = view({ language: 'en' });
  assert.equal(ui.PlaceExternalRatings({ ...scope, cityId: 'toronto' }), null);
  assert.equal(ui.PlaceRatingSummary({ ...scope, placeId: 'missing' }), null);
  assert.match(text(ui.PlaceExternalRatings(scope)), /Ratings from other sites/);
  assert.match(text(ui.PlaceRatingSummary(scope)), /Google\s+4.5\s*\/5.*28,661 ratings/);
  assert.doesNotMatch(text(ui.PlaceExternalRatings(scope)), /Gling member reviews/);
  setActiveLanguage('ko');
});

test('compact city cards keep the provider and score readable in three columns', () => {
  const ui = view({ language: 'en' }), summary = ui.PlaceRatingSummary({ ...scope, compact: true });
  assert.match(text(summary), /Google\s+4.5\s*\/5/);
  assert.doesNotMatch(text(summary), /28,661|ratings/);
  assert.equal(summary.props.numberOfLines, 1);
  assert.equal(nodes(summary).find(node => node.type === 'GlingRatingIcon').props.score, 9,
    'only the icon color uses the existing ten-point palette; the source score stays 4.5/5');
  setActiveLanguage('ko');
});
