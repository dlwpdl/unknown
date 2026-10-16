import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const citySource = readFileSync(new URL('src/lib/mock.ts', root), 'utf8').split('export const TAGS')[0];
const cities = [...citySource.matchAll(/id: '([^']+)', name: '([^']+)', englishName: '([^']+)'[^\n]*?province: '([^']+)'/g)]
  .map(([, id, name, englishName, province]) => ({ id, name, englishName, province }));
const nodes = v => !v || typeof v !== 'object' ? [] : [v, ...Object.values(v).flatMap(nodes)];
const catalog = () => JSON.parse(readFileSync(new URL('src/lib/city-places.catalog.json', root), 'utf8'));
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
    require: name => name.endsWith('city-places.catalog.json') ? catalog()
      : name.endsWith('city-places.photos.json') ? photos()
      : imports[name] ?? new Proxy({}, { get: (_value, key) => key }),
  });
  return exports;
}
const data = () => module('src/lib/city-places.ts', { '@/lib/mock': { CITIES: cities } });
function screen(file, params = { cityId: 'toronto' }, dev = true) {
  const states = [], routes = [], feedback = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = module(file, {
    react: { useState(v) { const i = cursor++; if (!(i in states)) states[i] = v; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useRouter: () => ({ push: p => routes.push(p), canGoBack: () => true, back: () => routes.push('back') }), useLocalSearchParams: () => params },
    'react-native': { StyleSheet: { create: v => v }, View: 'View', TextInput: 'TextInput' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/lib/mock': { CITIES: cities },
    '@/lib/community-city': { useCommunityCity: () => ({ city: cities[0] }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16, four: 24 }, MaxContentWidth: 920 },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: v => feedback.push(v) }) },
    '@/lib/city-places': data(), '@/lib/post-maps': module('src/lib/post-maps.ts'),
    '@/lib/merchant-source': module('src/lib/merchant-source.ts', {
      '../../supabase/functions/_shared/post-links.ts': { safePostLink: value => value },
    }),
  }, dev);
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return Array.isArray(node) ? node.map(expand) : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expand(v)]));
  }
  return { routes, feedback, render(props) { cursor = 0; return expand(exports.default ? exports.default() : exports.CityPopularPlaces?.(props)); } };
}
test('real OSM data covers every city with canonical IDs, coordinates and extraction provenance', () => {
  assert.equal(typeof data().getCityPlaces, 'function', 'actual data loader is missing');
  const source = catalog();
  assert.ok(Number.isFinite(Date.parse(source.collectedAt)));
  assert.equal(source.license, 'ODbL-1.0');
  assert.equal(source.attributionUrl, 'https://www.openstreetmap.org/copyright');
  assert.deepEqual(Object.keys(source.cities).sort(), cities.map(c => c.id).sort());
  for (const city of cities) {
    const stored = source.cities[city.id], places = data().getCityPlaces(city.id);
    assert.ok(places.length > 0 && places.length <= 75, city.id);
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
    assert.ok(rows.length <= 25 && rows.every(p => p.cityId === c.id && p.category === category));
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
  const ui = screen('src/app/places/index.tsx'), first = data().getCityPlaces('toronto')[0];
  let tree = ui.render();
  const rows = () => nodes(tree).filter(n => n.props?.analyticsId === 'places.open');
  assert.equal(rows().length, 10);
  assert.ok(nodes(tree).some(n => n.props?.children === first.name));
  assert.equal(nodes(tree).some(n => n.props?.title === '장소 데이터 연결 전이에요'), false);
  rows()[0].props.onPress();
  assert.equal(ui.routes.at(-1).pathname, '/places/[id]');
  assert.equal(ui.routes.at(-1).params.cityId, 'toronto');
  assert.equal(ui.routes.at(-1).params.id, first.id);
  assert.equal(ui.feedback.at(-1), 'selection');
  nodes(tree).find(n => n.props?.analyticsId === 'places.view-more').props.onPress();
  tree = ui.render(); assert.equal(rows().length, 25);
  nodes(tree).find(n => n.props?.accessibilityLabel === '장소 검색').props.onChangeText('__no_actual_place_match__');
  tree = ui.render(); assert.equal(rows().length, 0);
  nodes(tree).find(n => n.props?.accessibilityLabel === '장소 검색').props.onChangeText('');
  tree = ui.render();
  nodes(tree).find(n => n.props?.analyticsId === 'places.category.food').props.onPress();
  tree = ui.render();
  assert.ok(rows().length > 0 && rows().length <= 25);
  assert.equal(nodes(tree).find(n => n.props?.analyticsId === 'places.category.food').props.accessibilityState.selected, true);
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

test('home shows exactly three photo cards in every city and opens each actual place with feedback', () => {
  for (const city of cities) {
    const ui = screen('src/components/city-popular-places.tsx'), tree = ui.render({ cityId: city.id });
    const cards = nodes(tree).filter(n => n.props?.analyticsId === 'today.places.place-open');
    assert.equal(cards.length, 3, city.id);
    for (const card of cards) {
      const picture = nodes(card).find(n => n.type === 'CityPlacePhoto');
      assert.ok(picture?.props.place.photo);
      assert.equal(picture.props.place.cityId, city.id);
      card.props.onPress();
      assert.equal(ui.routes.at(-1).pathname, '/places/[id]');
      assert.equal(ui.routes.at(-1).params.id, picture.props.place.id);
      assert.equal(ui.routes.at(-1).params.cityId, city.id);
      assert.equal(ui.feedback.at(-1), 'selection');
    }
  }
});

test('list uses each actual place photo and detail retains its credit and named map', () => {
  const ui = screen('src/app/places/index.tsx'), tree = ui.render();
  const rows = nodes(tree).filter(n => n.props?.analyticsId === 'places.open');
  assert.equal(rows.length, 10);
  for (const row of rows) {
    const picture = nodes(row).find(n => n.type === 'CityPlacePhoto');
    assert.ok(picture, 'left photo slot missing');
    row.props.onPress();
    assert.equal(picture.props.place.id, ui.routes.at(-1).params.id);
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

test('photo load failure shows the neutral fallback and a different image can load afterwards', () => {
  let failed;
  const jsx = (type, props) => ({ type, props });
  const photo = module('src/components/city-place-photo.tsx', {
    react: { useState: () => [failed, value => { failed = value; }] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: v => v, absoluteFill: {} }, View: 'View' },
    'expo-image': { Image: 'Image' },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/hooks/use-theme': { useTheme: () => ({}) },
  });
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
