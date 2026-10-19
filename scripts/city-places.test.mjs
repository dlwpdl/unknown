import { withLanguageImports } from './test-language-imports.mjs';
import { placeMapRoute } from '../src/lib/discovery.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as product from '../src/lib/product-analytics.ts';

const root = new URL('../', import.meta.url);
const citySource = readFileSync(new URL('src/lib/mock.ts', root), 'utf8').split('export const TAGS')[0];
const cities = [...citySource.matchAll(/id: '([^']+)', name: '([^']+)', englishName: '([^']+)'[^\n]*?province: '([^']+)'/g)]
  .map(([, id, name, englishName, province]) => ({ id, name, englishName, province }));
const nodes = v => !v || typeof v !== 'object' ? [] : [v, ...Object.values(v).flatMap(nodes)];
const catalog = () => JSON.parse(readFileSync(new URL('src/lib/city-places.catalog.json', root), 'utf8'));
const fixtureTime = Math.max(Date.parse(catalog().collectedAt), ...Object.values(catalog().cities)
  .flatMap(city => (city.recommendations ?? []).map(pick => Date.parse(pick.verifiedAt)))) + 86_400_000;
const fixtureNow = fixtureTime + 86_400_000;
const photos = () => {
  const path = new URL('src/lib/city-places.photos.json', root);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { cities: {} };
};
function module(file, imports = {}, dev = true) {
  const path = new URL(file, root), exports = {};
  if (!existsSync(path)) return exports;
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(source, { exports, URL, URLSearchParams, __DEV__: dev,
    require: withLanguageImports(name => name.endsWith('city-places.catalog.json') ? imports['./city-places.catalog.json'] ?? catalog()
      : name.endsWith('city-places.photos.json') ? photos()
      : imports[name] ?? new Proxy({}, { get: (_value, key) => key })),
  });
  return exports;
}
const data = (snapshot) => module('src/lib/city-places.ts', { '@/lib/mock': { CITIES: cities }, './city-places.catalog.json': snapshot });

test('an unreviewed catalog never fills city recommendations with ordinary businesses', () => {
  const snapshot = catalog();
  for (const city of Object.values(snapshot.cities)) delete city.recommendations;
  const api = data(snapshot);
  assert.equal(api.getCityRecommendations('toronto').length, 0);
  assert.ok(api.getCityPlaces('toronto').some(place => /McDonald/i.test(place.name)), 'old detail/review identities must remain available');
});

test('a legacy broad recommendation response cannot replace the photo-spot selection', () => {
  const api = data(), next = dailyCatalog();
  delete next.recommendationTheme;
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), false);
});

test('a newer daily payload cannot restore selections from an older editorial revision', () => {
  const seed = catalog(); seed.selectionRevision = 2;
  const api = data(seed), before = api.getCityRecommendations('vancouver').map(place => place.id);
  for (const oldRevision of [undefined, 1]) {
    const old = dailyCatalog();
    if (oldRevision === undefined) delete old.selectionRevision; else old.selectionRevision = oldRevision;
    assert.equal(api.replaceCityPlacesCatalog(old, fixtureNow), false);
    assert.deepEqual(Array.from(api.getCityRecommendations('vancouver'), place => place.id), Array.from(before));
  }
});

test('a reviewed replacement revision changes order while old detail and review identities stay reachable', () => {
  const seed = catalog(); seed.selectionRevision = 1;
  const next = dailyCatalog(); next.selectionRevision = 2;
  const removed = seed.cities.vancouver.recommendations[0].placeId;
  next.cities.vancouver.recommendations = next.cities.vancouver.recommendations.filter(pick => pick.placeId !== removed);
  const api = data(seed);
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.deepEqual(Array.from(api.getCityRecommendations('vancouver'), place => place.id), next.cities.vancouver.recommendations.map(pick => pick.placeId));
  assert.ok(api.getCityPlaces('vancouver').some(place => place.id === removed));
  const invalid = structuredClone(next); invalid.selectionRevision = 2.5;
  invalid.collectedAt = new Date(fixtureTime + 3_600_000).toISOString();
  assert.throws(() => api.replaceCityPlacesCatalog(invalid, fixtureNow), /INVALID_PLACE_CATALOG/);
});

test('every supported city has source-checked photo selections rather than a padded business directory', () => {
  const snapshot = catalog();
  assert.equal(snapshot.recommendationTheme, 'photo-spots');
  for (const city of cities) {
    const places = data().getCityRecommendations(city.id);
    assert.ok(places.length >= 3 && places.length <= 50, city.id);
    for (const place of places) {
      assert.doesNotMatch(place.name, /McDonald|Tim Hortons|Starbucks|Subway|Burger King|Wendy/i);
      assert.ok(place.recommendation.reason.trim());
      assert.ok(place.recommendation.reasonEn.trim());
      assert.ok(new URL(place.recommendation.sourceUrl).protocol === 'https:');
    }
  }
});

test('popular featured places have photographs and real provider counts where three subjects are verified', () => {
  const ratings = JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8'));
  for (const city of ['toronto', 'vancouver', 'montreal', 'calgary', 'edmonton', 'winnipeg', 'ottawa', 'regina']) {
    const featured = data().getCityRecommendations(city).slice(0, 3);
    assert.equal(featured.length, 3);
    for (const place of featured) {
      assert.ok(place.photo?.imageSha256, `${city}/${place.name}: photograph`);
      assert.ok(ratings.some(row => row.cityId === city && row.placeId === place.id && row.count > 0), `${city}/${place.name}: actual provider count`);
    }
  }
});
function dailyCatalog() {
  const next = catalog(); next.collectedAt = new Date(fixtureTime).toISOString();
  for (const city of cities) next.cities[city.id].recommendations = next.cities[city.id].places.slice(-3).map(p => ({ placeId: p.id, reason: 'Test-reviewed selection', sourceUrl: 'https://example.org/reviewed', verifiedAt: next.collectedAt }));
  return next;
}
test('a fifty-place source-reviewed list preserves every identity and rejects a fifty-first pick', () => {
  const next = dailyCatalog();
  next.cities.toronto.recommendations = next.cities.toronto.places.slice(0, 50).map(place => ({
    placeId: place.id, reason: 'Test-reviewed selection', reasonEn: 'Test-reviewed selection',
    sourceUrl: 'https://example.org/reviewed', verifiedAt: next.collectedAt,
  }));
  const api = data();
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.equal(api.getCityRecommendations('toronto').length, 50);
  assert.deepEqual(Array.from(api.getCityRecommendations('toronto'), p => p.id), next.cities.toronto.recommendations.map(p => p.placeId));
  const tooMany = structuredClone(next);
  tooMany.collectedAt = new Date(fixtureTime + 3_600_000).toISOString();
  tooMany.cities.toronto.recommendations.push({ ...tooMany.cities.toronto.recommendations[0], placeId: tooMany.cities.toronto.places[50].id });
  assert.throws(() => api.replaceCityPlacesCatalog(tooMany, fixtureNow), /INVALID_PLACE_CATALOG/);
});
test('daily recommendations use reviewed order while archived place identities remain readable', () => {
  const api = data(), next = dailyCatalog();
  assert.equal(typeof api.replaceCityPlacesCatalog, 'function');
  api.replaceCityPlacesCatalog(next, fixtureNow);
  assert.equal(api.getCityRecommendations('toronto')[0].id, next.cities.toronto.recommendations[0].placeId);
  assert.equal(api.getCityPlaces('toronto').length, catalog().cities.toronto.places.length);
});
test('opening a selected place retains its photo reason without losing other review identities', () => {
  const api = data(), next = dailyCatalog();
  next.recommendationTheme = 'photo-spots';
  api.replaceCityPlacesCatalog(next, fixtureNow);
  const pick = next.cities.toronto.recommendations[0];
  assert.equal(api.getCityPlaces('toronto').find(place => place.id === pick.placeId).recommendation?.reason, pick.reason);
  assert.ok(api.getCityPlaces('toronto').some(place => /McDonald/i.test(place.name)));
});

test('an older daily catalog retains a newly checked restaurant; a later refresh can remove its recommendation', () => {
  const seed = catalog(), id = 'osm:node:6339016833';
  // Model the historical ordering explicitly, independent of the live catalog's dates.
  seed.collectedAt = '2026-10-14T03:11:22Z';
  for (const city of Object.values(seed.cities)) for (const pick of city.recommendations) pick.verifiedAt = seed.collectedAt;
  const restaurant = seed.cities.vancouver.recommendations.find(pick => pick.placeId === id)
    ?? { placeId: id, reason: 'Test-reviewed restaurant', sourceUrl: 'https://example.org/reviewed' };
  restaurant.verifiedAt = '2026-10-18T20:00:00Z';
  seed.cities.vancouver.recommendations = [...seed.cities.vancouver.recommendations.filter(pick => pick.placeId !== id).slice(0, 49), restaurant];
  const api = data(seed);
  const next = structuredClone(seed);
  next.collectedAt = '2026-10-18T08:54:42Z';
  next.cities.vancouver.places = next.cities.vancouver.places.filter(place => place.id !== id);
  next.cities.vancouver.recommendations = next.cities.vancouver.recommendations.filter(pick => pick.placeId !== id);
  assert.equal(api.replaceCityPlacesCatalog(next, Date.parse('2026-10-19T00:00:00Z')), true);
  assert.ok(api.getCityRecommendations('vancouver', 'food').some(place => place.id === id));
  assert.ok(api.getCityPlaces('vancouver').find(place => place.id === id).recommendation);
  const later = structuredClone(next); later.collectedAt = '2026-10-19T08:00:00Z';
  assert.equal(api.replaceCityPlacesCatalog(later, Date.parse('2026-10-20T00:00:00Z')), true);
  assert.equal(api.getCityRecommendations('vancouver').some(place => place.id === id), false);
  assert.ok(api.getCityPlaces('vancouver').some(place => place.id === id), 'existing detail/review links remain valid');
});

test('a higher editorial revision never reattaches removed picks from the bundled revision', () => {
  const seed = catalog(); seed.selectionRevision = 2; seed.collectedAt = '2026-10-14T03:11:22Z';
  const removed = seed.cities.vancouver.recommendations[0]; removed.verifiedAt = '2026-10-18T20:00:00Z';
  const next = structuredClone(seed); next.selectionRevision = 3; next.collectedAt = '2026-10-18T08:54:42Z';
  next.cities.vancouver.recommendations = next.cities.vancouver.recommendations.filter(pick => pick.placeId !== removed.placeId);
  const api = data(seed);
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.deepEqual(Array.from(api.getCityRecommendations('vancouver'), place => place.id), next.cities.vancouver.recommendations.map(pick => pick.placeId));
  assert.ok(api.getCityPlaces('vancouver').some(place => place.id === removed.placeId));
});
test('reviewed recommendation metadata preserves the English reason without inventing a ranking', () => {
  const api = data(), next = dailyCatalog();
  next.cities.toronto.recommendations[0].reasonEn = 'A source-checked place to explore.';
  api.replaceCityPlacesCatalog(next, fixtureNow);
  assert.equal(api.getCityRecommendations('toronto')[0].recommendation.reasonEn, 'A source-checked place to explore.');
});
test('foreign-city IDs, unsafe sources and malformed daily payloads cannot replace the last valid catalog', () => {
  const api = data(); assert.equal(typeof api.replaceCityPlacesCatalog, 'function');
  const original = JSON.stringify(api.getCityPlaces('toronto'));
  for (const mutate of [next => { next.cities.toronto.places[0].cityId = 'vancouver'; }, next => { next.cities.toronto.places[0].sourceUrl = 'https://evil.example/'; }, next => { next.cities.toronto.places[0].latitude = NaN; }, next => { delete next.cities.vancouver; }]) {
    const next = dailyCatalog(); mutate(next);
    assert.throws(() => api.replaceCityPlacesCatalog(next, fixtureNow), /INVALID_PLACE_CATALOG/);
    assert.equal(JSON.stringify(api.getCityPlaces('toronto')), original);
  }
});
function screen(file, params = { cityId: 'toronto' }, dev = true, placeData = data()) {
  const states = [], routes = [], feedback = [], opened = [], ratingScopes = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = module(file, {
    react: { useRef: current => ({ current }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
      useState(v) { const i = cursor++; if (!(i in states)) states[i] = v; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useIsFocused: () => true, useRouter: () => ({ push: p => routes.push(p), navigate: p => routes.push(p), canGoBack: () => true, back: () => routes.push('back') }), useLocalSearchParams: () => params },
    'react-native': { StyleSheet: { create: v => v }, View: 'View', TextInput: 'TextInput', Linking: { openURL: async value => { opened.push(value); } }, Alert: { alert() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/lib/mock': { CITIES: cities },
    '@/lib/community-city': { useCommunityCity: () => ({ city: cities[0] }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false, me: { id: 'anonymous' } }) },
    '@/lib/product-analytics': product,
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-city-places': { useCityPlacesRevision: () => 0 },
    '@/hooks/use-place-review-summaries': { usePlaceReviewSummaries: (cityId, ids) => { ratingScopes.push({ cityId, ids }); return {}; } },
    '@/components/place-review-summary': { PlaceReviewSummary: 'PlaceReviewSummary',
      getPlaceReviewRating: (cityId, placeId) => ({ cityId, placeId, score: null, source: null, count: null, externalScore: null }) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16, four: 24 }, MaxContentWidth: 920 },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: v => feedback.push(v) }) },
    '@/lib/city-places': placeData, '@/lib/discovery': { placeMapRoute }, '@/lib/post-maps': module('src/lib/post-maps.ts'),
    '@/lib/merchant-source': module('src/lib/merchant-source.ts', {
      '../../supabase/functions/_shared/post-links.ts': { safePostLink: value => value },
    }),
  }, dev);
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return Array.isArray(node) ? node.map(expand) : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expand(v)]));
  }
  return { routes, feedback, opened, ratingScopes, render(props) { cursor = 0; return expand(exports.default ? exports.default() : exports.CityPopularPlaces?.(props)); } };
}
test('the city places entry gives each preview card its own compact rating scope', () => {
  const ui = screen('src/components/city-popular-places.tsx'), tree = ui.render({ cityId: 'vancouver' });
  const cards = nodes(tree).filter(node => node.props?.analyticsId === 'today.places.place-open');
  const expected = data().getCityRecommendations('vancouver').slice(0, 3);
  assert.equal(cards.length, expected.length);
  cards.forEach((card, index) => {
    const summary = nodes(card).find(node => node.type === 'PlaceReviewSummary');
    assert.ok(summary, 'entry card rating is missing');
    assert.equal(summary.props.rating.cityId, 'vancouver');
    assert.equal(summary.props.rating.placeId, expected[index].id);
    assert.equal(summary.props.compact, true);
  });
  assert.equal(ui.ratingScopes.length, 1, 'home loads one batch, not one request per card');
  assert.equal(ui.ratingScopes[0].ids.length, cards.length);
  cards[0].props.onPress();
  assert.equal(ui.routes.at(-1).pathname, '/map');
  assert.equal(ui.opened.length, 0, 'review entry stays inside Gling');
});
test('real OSM data covers every city with canonical IDs, coordinates and extraction provenance', () => {
  assert.equal(typeof data().getCityPlaces, 'function', 'actual data loader is missing');
  const source = catalog();
  assert.ok(Number.isFinite(Date.parse(source.collectedAt)));
  assert.equal(source.license, 'ODbL-1.0');
  assert.equal(source.attributionUrl, 'https://www.openstreetmap.org/copyright');
  assert.deepEqual(Object.keys(source.cities).sort(), cities.map(c => c.id).sort());
  for (const city of cities) {
    const stored = source.cities[city.id], places = data().getCityPlaces(city.id);
    assert.ok(places.length > 0 && places.length <= 200, city.id);
    assert.match(stored.responseSha256, /^[a-f0-9]{64}$/);
    assert.ok(stored.query.includes('area(' + (3600000000 + Number(stored.boundaryId.split(':').at(-1))) + ')'));
    assert.equal(new Set(places.map(p => p.id)).size, places.length);
    for (const p of places) {
      assert.equal(p.cityId, city.id);
      assert.match(p.id, /^osm:(node|way|relation):[1-9]\d*$/);
      assert.equal(p.sourceUrl, 'https://www.openstreetmap.org/' + p.id.split(':').slice(1).join('/'));
      assert.ok(p.name.length > 0 && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
      assert.ok(p.latitude >= 40 && p.latitude <= 85 && p.longitude >= -142 && p.longitude <= -52);
      assert.ok(['food', 'cafe', 'places'].includes(p.category));
      assert.equal('rank' in p || 'rating' in p || 'visitorCount' in p, false);
    }
  }
});
test('category filtering never pads records or falls back to another city', () => {
  const { getCityPlaces } = data(); assert.equal(typeof getCityPlaces, 'function');
  assert.throws(() => getCityPlaces('unknown'), /INVALID_PLACE_CITY/);
  assert.throws(() => getCityPlaces('toronto', 'unknown'), /INVALID_PLACE_CATEGORY/);
  for (const c of cities) for (const category of ['food', 'cafe', 'places']) {
    const rows = getCityPlaces(c.id, category);
    assert.ok(rows.length <= 200 && rows.every(p => p.cityId === c.id && p.category === category));
  }
});
test('real home entry works in release and debug, preserves every city and gives feedback without stale preview copy', () => {
  assert.equal(typeof data().getCityPlaces, 'function');
  for (const dev of [true, false]) {
    const ui = screen('src/components/city-popular-places.tsx', {}, dev);
    for (const city of cities) {
      const tree = ui.render({ cityId: city.id });
      const button = nodes(tree).find(n => n.props?.analyticsId === 'today.places.open');
      assert.ok(button);
      button.props.onPress();
      assert.equal(ui.routes.at(-1).pathname, '/places');
      assert.equal(ui.routes.at(-1).params.cityId, city.id);
      assert.equal(ui.feedback.at(-1), 'selection');
      assert.equal(nodes(tree).some(n => n.props?.children === '화면 미리보기'), false);
    }
    assert.equal(ui.render({ cityId: 'unknown' }), null);
  }
});
test('native list renders real data, expands, filters search and category, then opens the same place/city', () => {
  assert.equal(typeof data().getCityPlaces, 'function');
  const ui = screen('src/app/places/index.tsx'), choices = data().getCityRecommendations('toronto'), first = choices[0];
  let tree = ui.render();
  const rows = () => nodes(tree).filter(n => n.props?.analyticsId === 'places.open');
  assert.equal(rows().length, Math.min(10, choices.length));
  assert.ok(nodes(tree).some(n => n.props?.children === first.name));
  assert.equal(nodes(tree).some(n => n.props?.title === '장소 데이터 연결 전이에요'), false);
  rows()[0].props.onPress();
  assert.equal(ui.routes.at(-1).pathname, '/map');
  assert.equal(ui.routes.at(-1).params.cityId, 'toronto');
  assert.equal(ui.routes.at(-1).params.placeId, first.id);
  assert.equal(ui.feedback.at(-1), 'selection');
  const expand = nodes(tree).find(n => n.props?.analyticsId === 'places.view-more');
  assert.equal(!!expand, choices.length > 10);
  expand?.props.onPress();
  tree = ui.render(); assert.equal(rows().length, Math.min(50, choices.length));
  nodes(tree).find(n => n.props?.accessibilityLabel === '장소 검색').props.onChangeText('__no_actual_place_match__');
  tree = ui.render(); assert.equal(rows().length, 0);
  nodes(tree).find(n => n.props?.accessibilityLabel === '장소 검색').props.onChangeText('');
  tree = ui.render();
  nodes(tree).find(n => n.props?.analyticsId === 'places.category.food').props.onPress();
  tree = ui.render();
  assert.equal(rows().length, choices.filter(place => place.category === 'food').length);
  assert.equal(nodes(tree).find(n => n.props?.analyticsId === 'places.category.food').props.accessibilityState.selected, true);
  nodes(tree).find(n => n.props?.analyticsId === 'places.category.places').props.onPress();
  tree = ui.render();
  assert.ok(rows().length > 0 && rows().length <= 50);
});
test('the full city list promises the available count and includes the last place rating and map link', () => {
  for (const count of [17, 50]) {
    const next = dailyCatalog();
    next.cities.toronto.recommendations = next.cities.toronto.places.slice(0, count).map(place => ({
      placeId: place.id, reason: 'Test-reviewed selection', sourceUrl: 'https://example.org/reviewed', verifiedAt: next.collectedAt,
    }));
    const api = data(); api.replaceCityPlacesCatalog(next, fixtureNow);
    const ui = screen('src/app/places/index.tsx', { cityId: 'toronto' }, true, api);
    let tree = ui.render();
    assert.equal(ui.ratingScopes.at(-1).ids.length, count);
    assert.equal(nodes(tree).filter(n => n.props?.analyticsId === 'places.open').length, 10);
    const more = nodes(tree).find(n => n.props?.analyticsId === 'places.view-more');
    assert.equal(more.props.accessibilityLabel, count + '곳 모두 보기');
    more.props.onPress(); tree = ui.render();
    const rows = nodes(tree).filter(n => n.props?.analyticsId === 'places.open');
    assert.equal(rows.length, count);
    rows[count - 1].props.onPress();
    assert.equal(ui.routes.at(-1).params.placeId, next.cities.toronto.recommendations[count - 1].placeId);
    assert.equal(ui.feedback.at(-1), 'selection');
  }
});
test('native detail searches Google maps by name, available address and Canadian city instead of a coordinate pin', () => {
  assert.equal(typeof data().getCityPlaces, 'function');
  const p = data().getCityPlaces('toronto')[0];
  const ui = screen('src/app/places/[id].tsx', { cityId: 'toronto', id: p.id }), tree = ui.render();
  assert.ok(nodes(tree).some(n => n.props?.children === p.name));
  const map = nodes(tree).find(n => n.props?.url?.startsWith('https://www.google.com/maps/search/'));
  assert.ok(map);
  const url = new URL(map.props.url);
  const query = url.searchParams.get('query');
  assert.ok(query.startsWith(p.name + ', '));
  assert.ok(query.includes(p.address));
  assert.ok(query.includes('Toronto, ON, Canada'));
  assert.notEqual(query, p.latitude + ',' + p.longitude);
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.has('query_place_id'), false);
  nodes(tree).find(n => n.props?.analyticsId === 'places.detail.back').props.onPress();
  assert.equal(ui.routes.at(-1), 'back'); assert.equal(ui.feedback.at(-1), 'selection');
});
test('places without street addresses still search their names in the correct city, including French and Saint John NB', () => {
  for (const cityId of ['toronto', 'montreal', 'saint-john']) {
    const city = cities.find(c => c.id === cityId), place = data().getCityPlaces(cityId).find(p => !p.address);
    assert.ok(place, cityId);
    const tree = screen('src/app/places/[id].tsx', { cityId, id: place.id }).render();
    const map = nodes(tree).find(n => n.props?.url?.startsWith('https://www.google.com/maps/search/'));
    assert.ok(map);
    const url = new URL(map.props.url), query = url.searchParams.get('query');
    assert.ok(query.startsWith(place.name + ', '));
    assert.ok(query.endsWith(city.englishName + ', ' + city.province + ', Canada'));
    assert.notEqual(query, place.latitude + ',' + place.longitude);
    assert.equal(url.searchParams.has('query_place_id'), false);
  }
});
test('unknown city and a place belonging to another city are explicit errors', () => {
  assert.ok(nodes(screen('src/app/places/index.tsx', { cityId: 'unknown' }).render()).some(n => n.props?.title === '도시를 확인해 주세요'));
  assert.equal(typeof data().getCityPlaces, 'function');
  const p = data().getCityPlaces('toronto')[0];
  const tree = screen('src/app/places/[id].tsx', { cityId: 'vancouver', id: p.id }).render();
  assert.ok(nodes(tree).some(n => n.props?.title === '장소를 찾지 못했어요'));
});

test('every city has at least three licensed same-place photos and missing photos stay empty', () => {
  for (const city of cities) {
    const rows = data().getCityPlaces(city.id), pictured = rows.filter(p => p.photo);
    assert.ok(pictured.length >= 3, city.id + ' needs three verified place photos');
    for (const p of pictured) {
      assert.equal(p.photo.cityId, city.id);
      assert.equal(p.photo.placeId, p.id);
      assert.ok(photos().cities[city.id].some(photo => photo.placeId === p.id && photo.uri === p.photo.uri));
      const image = new URL(p.photo.uri), source = new URL(p.photo.sourceUrl), license = new URL(p.photo.licenseUrl);
      assert.equal(image.protocol, 'https:');
      assert.ok(['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(image.hostname));
      assert.equal(source.hostname, 'commons.wikimedia.org');
      assert.ok(source.pathname.startsWith('/wiki/File:'));
      assert.equal(license.hostname, 'creativecommons.org');
      assert.ok(p.photo.artist.trim().length > 0 && p.photo.license.trim().length > 0);
      assert.match(p.photo.imageSha256, /^[a-f0-9]{64}$/);
    }
    const unpictured = rows.find(p => !photos().cities[city.id].some(photo => photo.placeId === p.id));
    assert.ok(unpictured);
    assert.equal(unpictured.photo, null);
  }
});

test('home shows three reviewed place cards and preserves same-place photos or honest empty photo slots', () => {
  for (const city of cities) {
    const ui = screen('src/components/city-popular-places.tsx'), tree = ui.render({ cityId: city.id });
    const cards = nodes(tree).filter(n => n.props?.analyticsId === 'today.places.place-open');
    assert.equal(cards.length, 3, city.id);
    for (const card of cards) {
      const picture = nodes(card).find(n => n.type === 'CityPlacePhoto');
      assert.ok(picture?.props.place);
      assert.ok(data().getCityRecommendations(city.id).some(p => p.id === picture.props.place.id));
      if (picture.props.place.photo) assert.equal(picture.props.place.photo.placeId, picture.props.place.id);
      assert.equal(picture.props.place.cityId, city.id);
      card.props.onPress();
      assert.equal(ui.routes.at(-1).pathname, '/map');
      assert.equal(ui.routes.at(-1).params.placeId, picture.props.place.id);
      assert.equal(ui.routes.at(-1).params.cityId, city.id);
      assert.equal(ui.feedback.at(-1), 'selection');
    }
  }
});

test('list uses each actual place photo and detail retains its credit and named map', () => {
  const ui = screen('src/app/places/index.tsx'), tree = ui.render();
  const rows = nodes(tree).filter(n => n.props?.analyticsId === 'places.open');
  assert.equal(rows.length, Math.min(10, data().getCityRecommendations('toronto').length));
  for (const row of rows) {
    const picture = nodes(row).find(n => n.type === 'CityPlacePhoto');
    assert.ok(picture, 'left photo slot missing');
    row.props.onPress();
    assert.equal(picture.props.place.id, ui.routes.at(-1).params.placeId);
  }
  const place = data().getCityPlaces('toronto').find(p => p.photo);
  assert.ok(place);
  const detail = nodes(screen('src/app/places/[id].tsx', { cityId: 'toronto', id: place.id }).render());
  assert.ok(detail.some(n => n.type === 'CityPlacePhoto' && n.props.place.id === place.id));
  const credit = detail.find(n => n.type === 'PostPhotoCredits');
  assert.ok(credit);
  for (const value of [place.photo.artist, place.photo.sourceUrl, place.photo.license, place.photo.licenseUrl]) {
    assert.ok(credit.props.credits.includes(value));
  }
  const map = detail.find(n => n.props?.url?.startsWith('https://www.google.com/maps/search/'));
  assert.ok(new URL(map.props.url).searchParams.get('query').startsWith(place.name + ', '));
});

test('the selection source opens its actual reviewed article with interaction feedback', async () => {
  const place = data().getCityRecommendations('toronto')[0];
  const ui = screen('src/app/places/[id].tsx', { cityId: 'toronto', id: place.id });
  const control = nodes(ui.render()).find(n => n.props?.accessibilityLabel === '사진 명소 선정 출처 보기');
  assert.ok(control);
  control.props.onPress();
  await Promise.resolve();
  assert.deepEqual(ui.opened, [place.recommendation.sourceUrl]);
  assert.deepEqual(ui.feedback, ['selection']);
});

function photoModule(imports = {}) {
  let failed;
  const jsx = (type, props) => ({ type, props });
  return module('src/components/city-place-photo.tsx', {
    react: { useState: () => [failed, value => { failed = value; }] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: v => v, absoluteFill: {} }, View: 'View' },
    'expo-image': { Image: 'Image' },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    ...imports,
  });
}

test('verified bundled photo bytes display offline only for their exact recorded image hash', () => {
  const directory = new URL('assets/images/city-places/', root);
  const assets = readdirSync(directory).filter(name => name.endsWith('.jpg')).map((name, index) => ({
    path: '../../assets/images/city-places/' + name, source: index + 1,
    hash: createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex'),
  }));
  assert.ok(assets.length > 0, 'verified offline photos must be included');
  const photo = photoModule(Object.fromEntries(assets.map(asset => [asset.path, asset.source])));
  for (const asset of assets) {
    const metadata = Object.values(photos().cities).flat().find(row => row.imageSha256 === asset.hash);
    assert.ok(metadata, asset.path + ' needs its actual source and license');
    const place = data().getCityPlaces(metadata.cityId).find(row => row.id === metadata.placeId);
    assert.ok(place);
    const image = nodes(photo.CityPlacePhoto({ place })).find(node => node.type === 'Image');
    assert.equal(image?.props.source, asset.source, metadata.cityId + '/' + metadata.placeId);
    assert.equal(place.photo.uri, metadata.uri, 'bundling must preserve the remote source and attribution');
    const changed = { ...place, photo: { ...place.photo, imageSha256: '0'.repeat(64) } };
    const replacement = nodes(photo.CityPlacePhoto({ place: changed })).find(node => node.type === 'Image');
    assert.equal(replacement?.props.source.uri, metadata.uri, 'a different image must not reuse stale bundled bytes');
  }
});

test('photo load failure shows the neutral fallback and a different image can load afterwards', () => {
  const photo = photoModule();
  assert.equal(typeof photo.CityPlacePhoto, 'function', 'native photo fallback is missing');
  const place = { id: 'one', name: 'One', photo: { uri: 'https://thumb.wikimedia.org/one.jpg' } };
  let tree = photo.CityPlacePhoto({ place });
  let image = nodes(tree).find(n => n.type === 'Image');
  assert.ok(image);
  assert.equal(image.props.cachePolicy, 'memory-disk');
  assert.equal(image.props.contentFit, 'cover');
  image.props.onError();
  tree = photo.CityPlacePhoto({ place });
  assert.equal(nodes(tree).some(n => n.type === 'Image'), false);
  assert.ok(nodes(tree).some(n => n.type === 'SymbolView'));
  tree = photo.CityPlacePhoto({ place: { ...place, photo: { uri: 'https://thumb.wikimedia.org/two.jpg' } } });
  image = nodes(tree).find(n => n.type === 'Image');
  assert.equal(image.props.source.uri, 'https://thumb.wikimedia.org/two.jpg');
  assert.equal(nodes(photo.CityPlacePhoto({ place: { ...place, photo: null } })).some(n => n.type === 'Image'), false);
});
