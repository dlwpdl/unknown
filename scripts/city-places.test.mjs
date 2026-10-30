import { withLanguageImports } from './test-language-imports.mjs';
import { discoveryPlace, placeMapRoute } from '../src/lib/discovery.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as product from '../src/lib/product-analytics.ts';
import * as distance from '../src/lib/discovery-sort.ts';

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
const photoRows = (bank, cityId) => [
  ...(bank.cities[cityId] ?? []), ...(bank.additionalCatalog?.cities[cityId] ?? []), ...(bank.flickrCatalog?.cities[cityId] ?? []),
];
function module(file, imports = {}, dev = true) {
  const path = new URL(file, root), exports = {};
  if (!existsSync(path)) return exports;
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(source, { exports, URL, URLSearchParams, __DEV__: dev,
    require: withLanguageImports(name => name.endsWith('city-places.catalog.json') ? imports['./city-places.catalog.json'] ?? catalog()
      : name.endsWith('city-places.photos.json') ? photos()
      : name.endsWith('gling-visited.json') ? imports['./gling-visited.json'] ?? []
      : imports[name] ?? new Proxy({}, { get: (_value, key) => key })),
  });
  return exports;
}
const externalRatings = () => module('src/lib/place-external-ratings.ts', { './place-external-ratings.json': JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8')) });
const data = (snapshot) => module('src/lib/city-places.ts', { '@/lib/mock': { CITIES: cities }, './city-places.catalog.json': snapshot, './place-external-ratings': externalRatings() });

function regionalFixture() {
  const seed = catalog(), city = seed.cities.vancouver;
  const place = { ...city.places[0], id: 'osm:node:999999999999', name: 'Regional fixture park', address: 'Coquitlam, BC', sourceUrl: 'https://www.openstreetmap.org/node/999999999999' };
  city.regionalPlaces = [place, { ...city.places[0], name: 'Ignored regional duplicate' }];
  city.regionalPhotos = [{ ...photos().cities.vancouver[0], placeId: place.id }, { ...photos().cities.vancouver[0], artist: 'Ignored replacement' }];
  return { seed, city, place };
}

test('optional regional facts join discovery once without changing legacy base arrays or visited status', () => {
  const { seed, city, place } = regionalFixture(), original = JSON.stringify(city.places), api = data(seed);
  const found = api.getCityPlaces('vancouver').filter(row => row.id === place.id);
  assert.equal(found.length, 1);
  assert.equal(found[0].address, 'Coquitlam, BC');
  assert.equal(found[0].photo.imageSha256, city.regionalPhotos[0].imageSha256);
  assert.equal(found[0].glingVisited, undefined);
  assert.equal(found[0].recommendation, undefined);
  assert.equal(api.getCityPlaces('vancouver').filter(row => row.id === city.places[0].id).length, 1);
  assert.equal(api.getCityPlaces('vancouver').find(row => row.id === city.places[0].id).name, city.places[0].name);
  const basePhoto = photos().cities.vancouver[0];
  assert.equal(api.getCityPlaces('vancouver').find(row => row.id === basePhoto.placeId).photo.artist, basePhoto.artist);
  assert.ok(api.getCityDiscoveryPlaces('vancouver').some(row => row.id === place.id));
  assert.equal(JSON.stringify(city.places), original);
  assert.match(api.getCityPlacesCoverage('vancouver'), /인근/);
});

test('older server omission preserves bundled regional additions while explicit empty arrays remove them', () => {
  const { seed, place } = regionalFixture(), api = data(seed), next = structuredClone(seed);
  delete next.cities.vancouver.regionalPlaces; delete next.cities.vancouver.regionalPhotos;
  next.collectedAt = new Date(fixtureTime).toISOString();
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.ok(api.getCityDiscoveryPlaces('vancouver').some(row => row.id === place.id));
  const removed = structuredClone(next);
  removed.cities.vancouver.regionalPlaces = []; removed.cities.vancouver.regionalPhotos = [];
  removed.collectedAt = new Date(fixtureTime + 1000).toISOString();
  assert.equal(api.replaceCityPlacesCatalog(removed, fixtureNow), true);
  assert.ok(!api.getCityPlaces('vancouver').some(row => row.id === place.id));
  assert.ok(!api.getCityPlacesCoverage('vancouver').includes('인근'));
});

test('invalid regional facts and photos cannot change the last valid catalog', () => {
  for (const mutate of [
    city => { city.regionalPlaces = null; },
    city => { city.regionalPhotos = null; },
    city => { city.regionalPlaces[0].cityId = 'toronto'; },
    city => { city.regionalPlaces[0].sourceUrl = 'https://example.org/forged'; },
    city => { city.regionalPlaces[0].latitude = NaN; },
    city => { city.regionalPlaces.push({ ...city.regionalPlaces[0] }); },
    city => { city.regionalPlaces = Array.from({ length: 201 }, (_, index) => ({ ...city.regionalPlaces[0], id: `osm:node:${999990000000 + index}`, sourceUrl: `https://www.openstreetmap.org/node/${999990000000 + index}` })); },
    city => { city.regionalPhotos[0].placeId = 'osm:node:987654321111'; },
    city => { city.regionalPhotos[0].license = 'Unknown'; },
    city => { city.regionalPhotos[0].uri = 'https://example.org/unsigned.jpg'; },
  ]) {
    const { seed, city } = regionalFixture(), api = data(), before = api.cityPlacesRevision();
    seed.collectedAt = new Date(fixtureTime).toISOString(); mutate(city);
    assert.throws(() => api.replaceCityPlacesCatalog(seed, fixtureNow), /INVALID_PLACE_CATALOG/);
    assert.equal(api.cityPlacesRevision(), before);
  }
});

function extraFixture() {
  const seed = catalog(), city = seed.cities.vancouver, base = city.places.find(place => ['food', 'cafe'].includes(place.category));
  const bar = { ...base, id: 'osm:node:999999999998', name: 'Extra fixture bar', category: 'food', nightlife: true, sourceUrl: 'https://www.openstreetmap.org/node/999999999998' };
  city.extraPlaces = [bar];
  city.extraRecommendations = [{ placeId: bar.id, reason: '네온 바', sourceUrl: 'https://example.org/bar', verifiedAt: new Date(fixtureTime - 86_400_000).toISOString() }];
  city.extraPhotos = [{ cityId: 'vancouver', placeId: bar.id, artist: 'Extra fixture bar', imageSha256: 'b'.repeat(64), license: 'Business-provided photo', discoveredVia: 'Business site', uri: 'https://example.org/bar.jpg', sourceUrl: 'https://example.org/bar', licenseUrl: 'https://example.org/bar' }];
  seed.collectedAt = new Date(fixtureTime).toISOString();
  return { seed, city, bar };
}

test('extra places past the legacy 200 join the map with their pick and photo', () => {
  const { seed, city, bar } = extraFixture(), api = data(), base = JSON.stringify(city.places);
  assert.equal(api.replaceCityPlacesCatalog(seed, fixtureNow), true);
  const found = api.getCityPlaces('vancouver').find(row => row.id === bar.id);
  assert.equal(found.diningRecommendation.reason, '네온 바');
  assert.equal(found.photo.imageSha256, 'b'.repeat(64));
  assert.ok(api.getCityDiscoveryPlaces('vancouver').some(row => row.id === bar.id));
  assert.equal(JSON.stringify(city.places), base);
});

test('invalid extra places cannot change the last valid catalog', () => {
  for (const mutate of [
    city => { city.extraPlaces = null; },
    city => { city.extraPlaces.push({ ...city.places[0] }); },
    city => { city.extraPlaces = Array.from({ length: 301 }, (_, index) => ({ ...city.extraPlaces[0], id: `osm:node:${999980000000 + index}`, sourceUrl: `https://www.openstreetmap.org/node/${999980000000 + index}` })); },
    city => { city.extraRecommendations[0].placeId = city.places[0].id; },
    city => { city.extraPhotos[0].placeId = city.places[0].id; },
    city => { city.extraPhotos[0].license = 'Unknown'; },
  ]) {
    const { seed, city } = extraFixture(), api = data(), before = api.cityPlacesRevision();
    mutate(city);
    assert.throws(() => api.replaceCityPlacesCatalog(seed, fixtureNow), /INVALID_PLACE_CATALOG/);
    assert.equal(api.cityPlacesRevision(), before);
  }
});

test('regional Openverse photos reuse the existing exact Flickr identity and licence rules', () => {
  const seed = catalog(), city = seed.cities.vancouver;
  const place = { ...city.places[0], id: 'osm:node:9381204484', name: 'Port Coquitlam Cenotaph', address: '2580 Shaughnessy Street, Port Coquitlam, BC', sourceUrl: 'https://www.openstreetmap.org/node/9381204484' };
  city.regionalPlaces = [place]; city.regionalPhotos = [{ cityId: 'vancouver', placeId: place.id, title: 'Port Coquitlam Cenotaph', artist: 'Niall Williams', discoveredVia: 'Openverse', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/', uri: 'https://live.staticflickr.com/5488/9577330885_201ecb9d5a_b.jpg', sourceUrl: 'https://www.flickr.com/photos/38601566@N00/9577330885', imageSha256: '00490722e63200677042197971b2a2773c5390c1451003eb59366326faf7efb6' }];
  seed.collectedAt = new Date(fixtureTime).toISOString();
  const api = data(); assert.equal(api.replaceCityPlacesCatalog(seed, fixtureNow), true);
  assert.equal(api.getCityPlaces('vancouver').find(row => row.id === place.id).photo.sourceUrl, city.regionalPhotos[0].sourceUrl);
  for (const [field, value] of [['uri','https://live.staticflickr.com/5488/9577330886_201ecb9d5a_b.jpg'], ['licenseUrl','https://creativecommons.org/licenses/by/2.0/'], ['sourceUrl','https://example.org/photos/38601566@N00/9577330885'], ['uri',city.regionalPhotos[0].uri+'?token=untrusted']]) {
    const bad = structuredClone(seed); bad.collectedAt = new Date(fixtureTime + 1000).toISOString(); bad.cities.vancouver.regionalPhotos[0][field] = value;
    assert.throws(() => api.replaceCityPlacesCatalog(bad, fixtureNow), /INVALID_PLACE_CATALOG/);
  }
});

test('reviewed Coquitlam-area records use the existing exact map and scoped search contracts', async () => {
  const seed = catalog(), api = data(), city = seed.cities.vancouver;
  assert.equal(Object.keys(seed.cities).length, 11);
  assert.equal(city.places.length, 200);
  assert.equal(photos().cities.vancouver.length, 147, 'shipped photo bank remains intact; the staged operations payload separately retains its 68 base photos');
  const reviewed = JSON.parse(readFileSync(new URL('docs/research/coquitlam-regional-catalog-20261024.json', root), 'utf8'));
  assert.deepEqual(city.regionalPlaces.map(place => place.id).sort(), [...reviewed.placeIds].sort());
  assert.deepEqual(city.regionalPhotos.map(photo => photo.placeId).sort(), [...reviewed.photoPlaceIds].sort());
  assert.ok(reviewed.excludedPriorPlaceIds.every(id => !city.regionalPlaces.some(place => place.id === id)));
  for (const place of city.regionalPlaces) {
    assert.match(place.address, /(?:Coquitlam|New Westminster), BC/, 'new additions retain an allowed actual municipality');
    assert.doesNotMatch(place.address, /(?:Surrey|Port Moody|Anmore|Belcarra), BC/, 'scope revision applies to additions without deleting legacy base identities');
  }
  const townCentre = api.getCityDiscoveryPlaces('vancouver').find(place => place.id === 'osm:way:41745659');
  assert.match(townCentre.address, /Coquitlam/);
  const route = placeMapRoute(townCentre);
  assert.equal(route.pathname, '/map'); assert.equal(route.params.cityId, 'vancouver'); assert.equal(route.params.placeId, townCentre.id);
  assert.ok(route.params.placeRequest, 'existing map reselection request remains present');
  const search = module('src/lib/unified-search.ts', { './city-places.ts': api, './delivery-partners.ts': { DELIVERY_PARTNERS: [] }, './mock.ts': { CITIES: cities.map(city => ({ ...city, state: 'open' })) } });
  const calls = [], client = { rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: { query: args.p_query, cityId: args.p_city_id, kind: args.p_kind, offset: args.p_offset, items: [], links: [], hasMore: false, nextOffset: args.p_offset }, error: null }); } };
  const page = await search.loadUnifiedSearch(client, { query: 'Town Centre Park', cityId: 'vancouver', kind: 'place' });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, townCentre.id); assert.equal(page.items[0].cityId, 'vancouver');
  assert.match(page.items[0].subtitle, /Coquitlam/);
  assert.equal(calls[0].name, 'search_public_directory');
  assert.deepEqual(Object.keys(calls[0].args.p_places[0]).sort(), ['cityId', 'placeId', 'rank']);
  for (const id of reviewed.missingPhotoPlaceIds) {
    assert.equal(api.getCityDiscoveryPlaces('vancouver').find(place => place.id === id).photo, null, 'unverified place photo stays an honest fallback');
  }
  assert.match(city.regionalPhotos.find(photo => photo.placeId === 'osm:way:170530924').title, /June 2020.*archival/);
  assert.ok(city.regionalPlaces.every(place => !api.getCityPlaces('vancouver').find(row => row.id === place.id).glingVisited));
});

test('an unreviewed catalog never fills city recommendations with ordinary businesses', () => {
  const snapshot = catalog();
  for (const city of Object.values(snapshot.cities)) { delete city.recommendations; delete city.diningRecommendations; }
  const api = data(snapshot);
  for (const city of cities) assert.equal(api.getCityRecommendations(city.id).length, 0, city.id);
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

test('a catalog that would not replace the current one skips per-city validation; a newer one is still fully validated', () => {
  const api = data(), current = catalog();
  // The same saved/server snapshot again: not newer, so its places are never walked.
  const same = structuredClone(current); same.cities.vancouver.places[0].sourceUrl = 'http://not-checked.example';
  assert.equal(api.replaceCityPlacesCatalog(same, fixtureNow), false);
  const newer = dailyCatalog(); newer.selectionRevision = current.selectionRevision; newer.cities.vancouver.places[0].sourceUrl = 'http://invalid.example';
  assert.throws(() => api.replaceCityPlacesCatalog(newer, fixtureNow), /INVALID_PLACE_CATALOG/);
});

test('a newer revision-4 server or cached catalog cannot shrink the shipped Vancouver 50 back to 17', () => {
  const snapshot = catalog(), api = data(snapshot);
  assert.ok(snapshot.selectionRevision >= 5);
  const before = Array.from(api.getCityRecommendations('vancouver'), place => place.id);
  assert.equal(before.length, 50);
  const stale = structuredClone(snapshot);
  stale.selectionRevision = 4;
  stale.collectedAt = new Date(fixtureTime).toISOString();
  stale.cities.vancouver.recommendations = stale.cities.vancouver.recommendations.slice(0, 17);
  assert.equal(api.replaceCityPlacesCatalog(stale, fixtureNow), false);
  assert.deepEqual(Array.from(api.getCityRecommendations('vancouver'), place => place.id), before);
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

test('every supported city has source-checked selections rather than a padded business directory', () => {
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

test('featured places show exact scoped provider counts or an honest unrated state', () => {
  const ratings = JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8'));
  const ratingsApi = externalRatings(), jsx = (type, props) => ({ type, props });
  const ui = module('src/components/place-review-summary.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { useWindowDimensions: () => ({ width: 390, fontScale: 1 }), StyleSheet: { create: value => value }, View: 'View' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/merchant-rating-bar': { GlingRatingIcon: 'GlingRatingIcon' },
    '@/lib/place-external-ratings': ratingsApi,
  });
  const text = tree => nodes(tree).flatMap(node => [node.props?.children].flat().filter(value => typeof value === 'string')).join('');
  let rated = 0;
  for (const { id: city } of cities) {
    const featured = data().getCityRecommendations(city).slice(0, 3);
    assert.equal(featured.length, 3);
    for (const place of featured) {
      if (place.photo) assert.deepEqual(place.photo, photoRows(photos(), city).find(photo => photo.placeId === place.id));
      else assert.equal(place.photo, null);
      const expected = ratings.find(row => row.cityId === city && row.placeId === place.id);
      const rating = ui.getPlaceReviewRating(city, place.id);
      assert.equal(rating.count, null, 'unknown Gling review counts remain unknown');
      assert.equal(rating.externalCount, expected?.count ?? null, `${city}/${place.name}: exact provider count`);
      assert.equal(rating.externalScore, expected ? expected.score * 2 : null);
      assert.equal(rating.score, rating.externalScore);
      assert.equal(rating.source, expected ? 'external' : null);
      const tree = ui.PlaceReviewSummary({ rating, compact: true });
      if (expected) {
        rated++;
        assert.ok(expected.count > 0);
        assert.ok(text(tree).includes(`${expected.count.toLocaleString('ko-KR')}개 평가`));
        assert.ok(nodes(tree).some(node => node.type === 'GlingRatingIcon' && node.props.score === expected.score * 2));
      } else {
        assert.equal(text(tree), '글링 리뷰 보기');
        assert.equal(nodes(tree).some(node => node.type === 'GlingRatingIcon'), false);
      }
    }
  }
  assert.ok(rated > 0, 'actual rated places are exercised');
  assert.equal(ratingsApi.replaceExternalPlaceRatings([]), true);
  const place = data().getCityRecommendations('toronto')[0], unrated = ui.getPlaceReviewRating('toronto', place.id);
  assert.deepEqual([unrated.score, unrated.source, unrated.count, unrated.externalScore, unrated.externalCount], [null, null, null, null, null]);
  assert.equal(text(ui.PlaceReviewSummary({ rating: unrated, compact: true })), '글링 리뷰 보기');
});
function dailyCatalog() {
  const next = catalog(); next.collectedAt = new Date(fixtureTime).toISOString();
  for (const city of cities) {
    next.cities[city.id].recommendations = next.cities[city.id].places.filter(p => p.category === 'places').slice(-3).map(p => ({ placeId: p.id, reason: 'Test-reviewed selection', sourceUrl: 'https://example.org/reviewed', verifiedAt: next.collectedAt }));
    next.cities[city.id].diningRecommendations = [];
  }
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
  assert.deepEqual(new Set(Array.from(api.getCityRecommendations('toronto'), p => p.id)), new Set(next.cities.toronto.recommendations.map(p => p.placeId)));
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
  for (const city of Object.values(seed.cities)) for (const pick of [...city.recommendations, ...(city.diningRecommendations ?? [])]) pick.verifiedAt = seed.collectedAt;
  const restaurant = seed.cities.vancouver.recommendations.find(pick => pick.placeId === id)
    ?? { placeId: id, reason: 'Test-reviewed restaurant', sourceUrl: 'https://example.org/reviewed' };
  restaurant.verifiedAt = '2026-10-18T20:00:00Z';
  seed.cities.vancouver.recommendations = [...seed.cities.vancouver.recommendations.filter(pick => pick.placeId !== id).slice(0, 49), restaurant];
  const api = data(seed);
  const next = structuredClone(seed);
  next.collectedAt = '2026-10-18T08:54:42Z';
  next.cities.vancouver.places = next.cities.vancouver.places.filter(place => place.id !== id);
  next.cities.vancouver.recommendations = next.cities.vancouver.recommendations.filter(pick => pick.placeId !== id);
  next.cities.vancouver.diningRecommendations = (next.cities.vancouver.diningRecommendations ?? []).filter(pick => pick.placeId !== id);
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
  seed.cities.vancouver.diningRecommendations = [];
  const removed = seed.cities.vancouver.recommendations[0]; removed.verifiedAt = '2026-10-18T20:00:00Z';
  const next = structuredClone(seed); next.selectionRevision = 3; next.collectedAt = '2026-10-18T08:54:42Z';
  next.cities.vancouver.recommendations = next.cities.vancouver.recommendations.filter(pick => pick.placeId !== removed.placeId);
  const api = data(seed);
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.deepEqual(new Set(Array.from(api.getCityRecommendations('vancouver'), place => place.id)), new Set(next.cities.vancouver.recommendations.map(pick => pick.placeId)));
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
function screen(file, params = { cityId: 'toronto' }, dev = true, placeData = data(), currentLocation = { fix: null, status: 'permission', busy: false, canAskAgain: true, request: async () => {} }) {
  const states = [], routes = [], feedback = [], opened = [], ratingScopes = [];
  const hidden = () => false;
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = module(file, {
    react: { useRef: current => ({ current }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
      useState(v) { const i = cursor++; if (!(i in states)) states[i] = v; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useIsFocused: () => true, useRouter: () => ({ push: p => routes.push(p), navigate: p => routes.push(p), canGoBack: () => true, back: () => routes.push('back') }), useLocalSearchParams: () => params },
    'react-native': { useWindowDimensions: () => ({ width: 390, fontScale: 1 }), StyleSheet: { create: v => v }, View: 'View', TextInput: 'TextInput', Linking: { openURL: async value => { opened.push(value); } }, Alert: { alert() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/lib/mock': { CITIES: cities },
    '@/lib/community-city': { useCommunityCity: () => ({ city: cities[0] }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false, me: { id: 'anonymous' } }) },
    '@/lib/product-analytics': product,
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => hidden },
    '@/components/saved-entry': { SavedEntryButton: 'SavedEntryButton', useSavedEntry: () => ({ error: '' }) },
    '@/hooks/use-current-location': { useCurrentLocation: () => currentLocation }, '@/lib/discovery-sort': distance, '@/constants/design-system': { ControlStyles: { pill: {} } }, '@/components/city-popular-places': { NearbyPlacesLocation: 'NearbyPlacesLocation' },
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
  const expected = data().getCityDiscoveryPlaces('vancouver').slice(0, 3);
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
    assert.ok(stored.places.length > 0 && stored.places.length <= 200, `${city.id}: legacy base remains bounded`);
    assert.ok((stored.regionalPlaces ?? []).length <= 200, `${city.id}: optional extension remains bounded`);
    assert.equal(places.length, new Set([...stored.places, ...(stored.regionalPlaces ?? [])].map(place => place.id)).size);
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
  const food = data().getCityBrowsePlaces('toronto', 'food').slice(0, 50);
  assert.deepEqual(rows().map(row => nodes(row).find(node => node.type === 'CityPlacePhoto').props.place.id), Array.from(food, place => place.id));
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
    assert.equal(ui.routes.at(-1).params.placeId, api.getCityRecommendations('toronto')[count - 1].id);
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
  const bank = photos();
  for (const city of cities) {
    const accepted = [...photoRows(bank, city.id), ...(catalog().cities[city.id].regionalPhotos ?? [])];
    const rows = data().getCityPlaces(city.id), pictured = rows.filter(p => p.photo);
    assert.ok(pictured.length >= 3, city.id + ' needs three verified place photos');
    for (const p of pictured) {
      assert.equal(p.photo.cityId, city.id);
      assert.equal(p.photo.placeId, p.id);
      const bound = accepted.find(photo => photo.placeId === p.id);
      assert.ok(bound);
      for (const key of ['uri', 'sourceUrl', 'artist', 'license', 'licenseUrl', 'imageSha256']) assert.equal(p.photo[key], bound[key]);
      const image = new URL(p.photo.uri), source = new URL(p.photo.sourceUrl), license = new URL(p.photo.licenseUrl);
      assert.equal(image.protocol, 'https:');
      if (['Openverse', 'Flickr'].includes(bound.discoveredVia)) {
        assert.equal(image.hostname, 'live.staticflickr.com');
        assert.equal(source.hostname, 'www.flickr.com');
        const imageId = /^\/\d+\/([1-9]\d*)_/.exec(image.pathname)?.[1];
        assert.ok(imageId);
        assert.equal(/^\/photos\/[^/]+\/([1-9]\d*)\/?$/.exec(source.pathname)?.[1], imageId);
      } else if (bound.discoveredVia === 'Business site') {
        assert.equal(bound.license, 'Business-provided photo');
        assert.equal(bound.licenseUrl, bound.sourceUrl);
        assert.equal(image.protocol, 'https:');
      } else {
        assert.ok(['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(image.hostname));
        assert.equal(source.hostname, 'commons.wikimedia.org');
        assert.ok(source.pathname.startsWith('/wiki/File:'));
      }
      if (bound.discoveredVia !== 'Business site') assert.equal(license.hostname, 'creativecommons.org');
      assert.ok(p.photo.artist.trim().length > 0 && p.photo.license.trim().length > 0);
      assert.match(p.photo.imageSha256, /^[a-f0-9]{64}$/);
    }
    const unpictured = rows.find(p => !accepted.some(photo => photo.placeId === p.id));
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
    react: { useState: initial => { failed ??= initial; return [failed, value => { failed = typeof value === 'function' ? value(failed) : value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { useWindowDimensions: () => ({ width: 390, fontScale: 1 }), StyleSheet: { create: v => v, absoluteFill: {} }, View: 'View' },
    'expo-image': { Image: 'Image' },
    'expo-symbols': { SymbolView: 'SymbolView' },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    ...imports,
  });
}

test('bundled display derivatives load offline only for their exact verified original hash', () => {
  const manifest = JSON.parse(readFileSync(new URL('assets/images/city-places-display/manifest.json', root), 'utf8'));
  const assets = manifest.images.map((row, index) => ({
    path: '../../' + row.display.path, source: index + 1, hash: row.original.sha256,
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


test('reviewed photo-less dining mixes with sights in all eleven cities without inventing photographs', () => {
  for (const { id: cityId } of cities) {
    const snapshot = dailyCatalog(), city = snapshot.cities[cityId];
    const photographed = new Set(photoRows(photos(), cityId).map(photo => photo.placeId));
    const food = city.places.find(place => place.category === 'food' && !photographed.has(place.id));
    const cafe = city.places.find(place => place.category === 'cafe' && !photographed.has(place.id));
    city.diningRecommendations = [food, cafe].map(place => ({ placeId: place.id, reason: 'Reviewed dining fixture', sourceUrl: 'https://example.org/dining', verifiedAt: snapshot.collectedAt }));
    const api = data();
    assert.equal(api.replaceCityPlacesCatalog(snapshot, fixtureNow), true);
    const selected = Array.from(api.getCityRecommendations(cityId));
    assert.deepEqual(selected.slice(0, 3).map(place => place.category), ['places', 'food', 'cafe'], cityId);
    for (const place of [food, cafe]) {
      const chosen = selected.find(row => row.id === place.id);
      assert.ok(chosen, `${cityId}: reviewed dining is included`);
      assert.equal(chosen.photo, null);
      assert.equal(chosen.recommendation.placeId, place.id);
      assert.ok(api.getCityBrowsePlaces(cityId, place.category).some(row => row.id === place.id));
      assert.ok(api.getCityDiscoveryPlaces(cityId).find(row => row.id === place.id).recommendation);
    }
    const ui = screen('src/components/city-popular-places.tsx', {}, false, api);
    const cards = nodes(ui.render({ cityId })).filter(node => node.props?.analyticsId === 'today.places.place-open');
    assert.deepEqual(cards.map(card => nodes(card).find(node => node.type === 'CityPlacePhoto').props.place.id), Array.from(api.getCityDiscoveryPlaces(cityId)).slice(0, 3).map(place => place.id));
  }
});

test('Top recommendations mix reviewed categories in editorial order and share one badge selection', () => {
  const snapshot = catalog(), city = snapshot.cities.vancouver;
  const photographed = new Set(photoRows(photos(), 'vancouver').map(photo => photo.placeId));
  const byId = new Map(city.places.map(place => [place.id, place]));
  const landmarks = city.recommendations.filter(pick => byId.get(pick.placeId).category === 'places').slice(0, 2);
  const dining = city.diningRecommendations.filter(pick => photographed.has(pick.placeId));
  const food = dining.filter(pick => byId.get(pick.placeId).category === 'food').slice(0, 2);
  const cafes = dining.filter(pick => byId.get(pick.placeId).category === 'cafe').slice(0, 2);
  const withoutPhotos = ['food', 'cafe'].map(category => city.places.find(place => place.category === category && !photographed.has(place.id)))
    .map(place => ({ placeId: place.id, reason: 'Reviewed photo-less fixture', sourceUrl: 'https://example.org/dining', verifiedAt: snapshot.collectedAt }));
  city.recommendations = [landmarks[0], withoutPhotos[0], landmarks[1]];
  city.diningRecommendations = [withoutPhotos[0], withoutPhotos[1], ...food, ...cafes];
  const expected = [landmarks[0], food[0], cafes[0], landmarks[1], food[1], cafes[1], ...withoutPhotos];
  const api = data(snapshot), selected = api.getCityRecommendations('vancouver');
  assert.deepEqual(Array.from(selected, place => place.id), expected.map(pick => pick.placeId));
  assert.deepEqual(Array.from(api.getCityBrowsePlaces('vancouver'), place => place.id), expected.map(pick => pick.placeId));
  selected.forEach((place, index) => assert.deepEqual(place.recommendation, expected[index]));
  assert.equal(selected.filter(place => place.id === food[0].placeId).length, 1, 'canonical identity is selected once across both banks');
  assert.deepEqual(new Set(api.getCityPlaces('vancouver').filter(place => place.recommendation).map(place => place.id)), new Set(expected.map(pick => pick.placeId)));
  const mapped = Array.from(api.getCityDiscoveryPlaces('vancouver'), discoveryPlace);
  assert.deepEqual(new Set(mapped.filter(place => place.top25).map(place => place.sourceId)), new Set(expected.map(pick => pick.placeId)));
  const ui = screen('src/components/city-popular-places.tsx', {}, false, api);
  const cards = nodes(ui.render({ cityId: 'vancouver' })).filter(node => node.props?.analyticsId === 'today.places.place-open');
  assert.deepEqual(cards.map(card => nodes(card).find(node => node.type === 'CityPlacePhoto').props.place.id), Array.from(api.getCityDiscoveryPlaces('vancouver')).slice(0, 3).map(place => place.id));
});

test('fifty photo-less main picks cannot crowd reviewed restaurants and cafes out of the preview', () => {
  const snapshot = dailyCatalog(), city = snapshot.cities.toronto, original = city.places[0];
  city.places = Array.from({ length: 52 }, (_, index) => ({ ...original, id: `osm:node:${90_000_000_000 + index}`,
    sourceUrl: `https://www.openstreetmap.org/node/${90_000_000_000 + index}`, category: index === 50 ? 'food' : index === 51 ? 'cafe' : 'places' }));
  const picks = city.places.map(place => ({ placeId: place.id, reason: 'Reviewed fixture', sourceUrl: 'https://example.org/dining', verifiedAt: snapshot.collectedAt }));
  city.recommendations = picks.slice(0, 50); city.diningRecommendations = picks.slice(50);
  const api = data(); assert.equal(api.replaceCityPlacesCatalog(snapshot, fixtureNow), true);
  const selected = Array.from(api.getCityRecommendations('toronto'));
  assert.equal(selected.length, 50);
  assert.deepEqual(selected.slice(0, 3).map(place => place.category), ['places', 'food', 'cafe']);
  assert.equal(api.getCityDiscoveryPlaces('toronto').length, 52);
  assert.ok(api.getCityPlaces('toronto').some(place => place.id === original.id), 'archived detail identity remains available');
});

function diningCatalog(count) {
  const next = dailyCatalog(), city = next.cities.toronto, original = city.places[0];
  city.places = Array.from({ length: count }, (_, index) => ({ ...original, id: `osm:node:${91_000_000_000 + index}`,
    sourceUrl: `https://www.openstreetmap.org/node/${91_000_000_000 + index}`, name: `Reviewed dining fixture ${index}`, category: index % 2 ? 'food' : 'cafe' }));
  city.recommendations = [];
  city.diningRecommendations = city.places.map(place => ({ placeId: place.id, reason: 'Reviewed dining fixture', sourceUrl: 'https://example.org/dining', verifiedAt: next.collectedAt }));
  return next;
}

for (const count of [51, 61, 200]) test(`${count} distinct reviewed dining picks survive refresh while the displayed Top list stays at fifty`, () => {
  const api = data(), next = diningCatalog(count);
  assert.equal(new Set(next.cities.toronto.diningRecommendations.map(pick => pick.placeId)).size, count);
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.equal(api.getCityDiscoveryPlaces('toronto').length, count);
  const selected = Array.from(api.getCityRecommendations('toronto'));
  assert.equal(selected.length, 50);
  assert.equal(new Set(selected.map(place => place.id)).size, 50);
  assert.ok(selected.every(place => place.photo === null && place.recommendation));
});

test('a 201st distinct dining pick or fact cannot replace the last valid catalog', () => {
  const api = data(), next = diningCatalog(200);
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  const before = JSON.stringify(api.getCityPlaces('toronto'));
  const tooMany = diningCatalog(201);
  tooMany.collectedAt = new Date(fixtureTime + 3_600_000).toISOString();
  const picksOnly = structuredClone(tooMany); picksOnly.cities.toronto.places.pop();
  for (const invalid of [picksOnly, tooMany]) {
    assert.throws(() => api.replaceCityPlacesCatalog(invalid, fixtureNow), /INVALID_PLACE_CATALOG/);
    assert.equal(JSON.stringify(api.getCityPlaces('toronto')), before);
  }
});

test('mixed shipped Top lists stay capped and preserve every admitted discovery identity', () => {
  const snapshot = catalog(), api = data(), bank = photos();
  for (const [cityId, city] of Object.entries(snapshot.cities)) {
    const selected = Array.from(api.getCityRecommendations(cityId));
    assert.ok(selected.length >= city.recommendations.length && selected.length <= 50, cityId);
    assert.equal(new Set(selected.map(place => place.id)).size, selected.length, cityId);
    const discovery = Array.from(api.getCityDiscoveryPlaces(cityId));
    const admitted = new Set([...city.recommendations, ...(city.diningRecommendations ?? [])].map(pick => pick.placeId).concat((city.regionalPlaces ?? []).map(place => place.id)));
    assert.deepEqual(new Set(discovery.map(place => place.id)), admitted, `${cityId}: all prior map identities remain`);
    assert.deepEqual(new Set(discovery.filter(place => place.recommendation).map(place => place.id)), new Set(selected.map(place => place.id)), `${cityId}: Top badges agree`);
    const photographed = new Set(photoRows(bank, cityId).map(photo => photo.placeId));
    const reviewed = [...city.recommendations, ...(city.diningRecommendations ?? [])];
    const byId = new Map(city.places.map(place => [place.id, place]));
    const available = ['places', 'food', 'cafe'].filter(category => reviewed.some(pick => byId.get(pick.placeId).category === category));
    assert.deepEqual(available, ['places', 'food', 'cafe'], `${cityId}: bundled admission includes every category`);
    assert.deepEqual(selected.slice(0, available.length).map(place => place.category), available, `${cityId}: available categories lead the list`);
    for (const category of available) {
      const ids = [...new Set(reviewed.filter(pick => byId.get(pick.placeId).category === category).map(pick => pick.placeId))];
      const ordered = [...ids.filter(id => photographed.has(id)), ...ids.filter(id => !photographed.has(id))];
      const actual = selected.filter(place => place.category === category).map(place => place.id);
      assert.deepEqual(actual, ordered.slice(0, actual.length), `${cityId}/${category}: editorial order`);
    }
  }
  const top = Array.from(api.getCityRecommendations('vancouver'));
  assert.equal(top.length, 50);
  assert.deepEqual(top.slice(0, 3).map(place => place.category), ['places', 'food', 'cafe']);
  const selected = new Set(top.map(place => place.id));
  assert.ok(snapshot.cities.vancouver.recommendations.some(pick => !selected.has(pick.placeId)), 'displaced landmarks still remain on the map');
});

test('dining validation rejects non-dining, duplicate and invalid curated picks', () => {
  for (const kind of ['places', 'duplicate', 'invalid']) {
    const next = dailyCatalog(), city = next.cities.vancouver;
    const place = city.places.find(p => p.category === (kind === 'places' ? 'places' : 'cafe'));
    const pick = { placeId: place.id, reason: 'Reviewed dining fixture', sourceUrl: 'https://example.org/dining', verifiedAt: next.collectedAt };
    city.diningRecommendations = kind === 'duplicate' ? [pick, pick] : [{ ...pick, ...(kind === 'invalid' ? { sourceUrl: 'javascript:alert(1)' } : {}) }];
    assert.throws(() => data().replaceCityPlacesCatalog(next, fixtureNow), /INVALID_PLACE_CATALOG/, kind);
  }
});

test('discovery merges a dining pick once when it also belongs to the Top list', () => {
  const snapshot = catalog(), city = snapshot.cities.vancouver;
  const food = city.places.find(p => p.category === 'food');
  const pick = { placeId: food.id, reason: 'Reviewed dining fixture', sourceUrl: 'https://example.org/dining', verifiedAt: snapshot.collectedAt };
  if (!city.recommendations.some(p => p.placeId === food.id)) city.recommendations = [...city.recommendations.slice(0, 49), pick];
  city.diningRecommendations = [pick];
  const api = data(snapshot);
  assert.equal(typeof api.getCityDiscoveryPlaces, 'function');
  assert.equal(api.getCityDiscoveryPlaces('vancouver').filter(p => p.id === food.id).length, 1);
});

test('only a trusted exact-city place attestation marks a team visit, never remote fields', () => {
  const snapshot = catalog(), place = snapshot.cities.toronto.places[0];
  const publicUrl = 'https://www.instagram.com/reel/DeoQKPNgYLe/';
  const api = module('src/lib/city-places.ts', { '@/lib/mock': { CITIES: cities }, './city-places.catalog.json': snapshot,
    './gling-visited.json': [{ cityId: 'toronto', placeId: place.id, sourceUrl: publicUrl }] });
  assert.equal(typeof api.getCityDiscoveryPlaces, 'function');
  assert.equal(api.getCityDiscoveryPlaces('toronto').find(p => p.id === place.id).glingVisited.sourceUrl, publicUrl);
  const next = dailyCatalog();
  next.cities.toronto.places[1].glingVisited = { sourceUrl: 'https://example.org/untrusted' };
  next.cities.vancouver.places[0].glingVisited = { sourceUrl: publicUrl };
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.equal(api.getCityPlaces('toronto').find(p => p.id === next.cities.toronto.places[1].id).glingVisited, undefined);
  assert.equal(api.getCityPlaces('vancouver')[0].glingVisited, undefined);
});


test('saved DB photo and rating metadata is applied together on the next catalog load', () => {
  const next = dailyCatalog(), oldPhotos = photos(), row = oldPhotos.cities.toronto[0];
  next.photoCatalog = structuredClone(oldPhotos);
  next.photoCatalog.cities.toronto = next.photoCatalog.cities.toronto.map(photo => photo.placeId === row.placeId ? { ...photo, imageSha256: 'd'.repeat(64) } : photo);
  const rating = JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8')).find(r => r.cityId === 'toronto');
  next.externalRatings = [{ ...rating, count: rating.count + 12 }];
  const ratingsApi = externalRatings(), api = module('src/lib/city-places.ts', { '@/lib/mock': { CITIES: cities }, './place-external-ratings': ratingsApi });
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.equal(api.getCityPlaces('toronto').find(p => p.id === row.placeId).photo.imageSha256, 'd'.repeat(64));
  assert.equal(ratingsApi.getPlaceExternalRatings(rating.cityId, rating.placeId)[0].count, rating.count + 12);
});

test('unsafe DB photo paths, wrong identities and invalid ratings leave the whole catalog unchanged', () => {
  for (const bad of ['imageHost', 'artistControl', 'photoIdentity', 'duplicatePhoto', 'ratingCount', 'ratingIdentity']) {
    const next = dailyCatalog(), oldPhotos = photos(); next.photoCatalog = structuredClone(oldPhotos);
    const row = next.photoCatalog.cities.toronto[0];
    const rating = JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8')).find(r => r.cityId === 'toronto');
    next.externalRatings = [rating];
    if (bad === 'artistControl') row.artist = 'Unsafe\u0000credit';
    if (bad === 'imageHost') row.uri = 'https://evil.example/photo.jpg';
    if (bad === 'photoIdentity') row.placeId = 'osm:node:1';
    if (bad === 'duplicatePhoto') next.photoCatalog.cities.toronto.push(row);
    if (bad === 'ratingCount') next.externalRatings = [{ ...rating, count: -1 }];
    if (bad === 'ratingIdentity') next.externalRatings = [{ ...rating, placeId: 'osm:node:1' }];
    const ratingsApi = externalRatings(), api = module('src/lib/city-places.ts', { '@/lib/mock': { CITIES: cities }, './place-external-ratings': ratingsApi });
    const before = api.CITY_PLACES_COLLECTED_AT, count = ratingsApi.getPlaceExternalRatings(rating.cityId, rating.placeId)[0].count;
    assert.throws(() => api.replaceCityPlacesCatalog(next, fixtureNow), /INVALID_PLACE_CATALOG/, bad);
    assert.equal(api.CITY_PLACES_COLLECTED_AT, before);
    assert.equal(ratingsApi.getPlaceExternalRatings(rating.cityId, rating.placeId)[0].count, count);
  }
});


test('a verified optional Flickr catalog fills only missing photos and preserves Commons priority', () => {
  const next = dailyCatalog();
  next.photoCatalog = structuredClone(photos());
  const supplementary = { cityId: 'toronto', placeId: 'osm:node:249295975',
    uri: 'https://live.staticflickr.com/65535/12345678901_0123456789_b.jpg',
    sourceUrl: 'https://www.flickr.com/photos/fixture/12345678901',
    artist: 'Fixture creator', title: 'Fixture venue detail', discoveredVia: 'Openverse', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    imageSha256: 'a'.repeat(64) };
  next.photoCatalog.cities.toronto = next.photoCatalog.cities.toronto.filter(photo => photo.placeId !== supplementary.placeId);
  const original = next.photoCatalog.cities.toronto[0];
  next.photoCatalog.additionalCatalog = { cities: { toronto: [supplementary, { ...supplementary, placeId: original.placeId }] } };
  const api = data();
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  assert.equal(api.getCityPlaces('toronto').find(p => p.id === supplementary.placeId).photo?.uri, supplementary.uri);
  assert.equal(api.getCityPlaces('toronto').find(p => p.id === original.placeId).photo.uri, original.uri);
  const detail = nodes(screen('src/app/places/[id].tsx', { cityId: 'toronto', id: supplementary.placeId }, false, api).render());
  assert.ok(detail.find(node => node.type === 'PostPhotoCredits').props.credits.includes(supplementary.title));
  assert.ok(detail.some(node => node.type === 'ThemedText' && typeof node.props.children === 'string'
    && node.props.children.includes('Openverse로 찾은 사진') && node.props.children.includes('인증하거나 보증하지 않아요')));
});


test('direct Flickr photos keep their provenance and preserve both legacy photo sources', () => {
  const next = dailyCatalog(); next.photoCatalog = structuredClone(photos());
  const direct = { cityId: 'toronto', placeId: 'osm:node:249295975',
    uri: 'https://live.staticflickr.com/65535/12345678901_0123456789_b.jpg',
    sourceUrl: 'https://www.flickr.com/photos/fixture/12345678901',
    artist: 'Fixture creator', title: 'Direct Flickr fixture', discoveredVia: 'Flickr',
    license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', imageSha256: 'a'.repeat(64) };
  const original = next.photoCatalog.cities.toronto.find(photo => photo.placeId !== direct.placeId);
  const other = next.cities.toronto.places.find(place => ![direct.placeId, original.placeId].includes(place.id));
  const openverse = { ...direct, placeId: other.id, discoveredVia: 'Openverse', title: 'Openverse fixture',
    uri: 'https://live.staticflickr.com/65535/23456789012_0123456789_b.jpg',
    sourceUrl: 'https://www.flickr.com/photos/fixture/23456789012' };
  next.photoCatalog.cities.toronto = next.photoCatalog.cities.toronto.filter(photo => ![direct.placeId, other.id].includes(photo.placeId));
  next.photoCatalog.additionalCatalog = { cities: { ...next.photoCatalog.additionalCatalog?.cities, toronto: [openverse] } };
  next.photoCatalog.flickrCatalog = { cities: { toronto: [direct, { ...direct, placeId: other.id }, { ...direct, placeId: original.placeId }] } };
  const api = data();
  assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
  const places = api.getCityPlaces('toronto');
  assert.equal(places.find(place => place.id === direct.placeId).photo?.uri, direct.uri);
  assert.equal(places.find(place => place.id === other.id).photo?.uri, openverse.uri);
  assert.equal(places.find(place => place.id === original.placeId).photo?.uri, original.uri);
  const detail = nodes(screen('src/app/places/[id].tsx', { cityId: 'toronto', id: direct.placeId }, false, api).render());
  const credits = detail.find(node => node.type === 'PostPhotoCredits').props.credits;
  for (const value of [direct.title, direct.artist, direct.sourceUrl, direct.licenseUrl, '사진은 촬영 시점의 모습']) assert.ok(credits.includes(value));
  assert.equal(detail.some(node => node.type === 'ThemedText' && typeof node.props.children === 'string'
    && node.props.children.includes('Openverse로 찾은 사진')), false);
});

test('an invalid direct Flickr group cannot discard a valid Openverse photo', () => {
  for (const change of [photo => { photo.discoveredVia = 'Openverse'; }, photo => { photo.uri = 'https://evil.example/photo.jpg'; }]) {
    const next = dailyCatalog(); next.photoCatalog = structuredClone(photos());
    const openverse = { cityId: 'toronto', placeId: 'osm:node:249295975',
      uri: 'https://live.staticflickr.com/65535/12345678901_0123456789_b.jpg',
      sourceUrl: 'https://www.flickr.com/photos/fixture/12345678901',
      artist: 'Fixture creator', title: 'Openverse fixture', discoveredVia: 'Openverse',
      license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', imageSha256: 'a'.repeat(64) };
    const invalid = { ...openverse, discoveredVia: 'Flickr' }; change(invalid);
    next.photoCatalog.cities.toronto = next.photoCatalog.cities.toronto.filter(photo => photo.placeId !== openverse.placeId);
    next.photoCatalog.additionalCatalog = { cities: { toronto: [openverse] } };
    next.photoCatalog.flickrCatalog = { cities: { toronto: [invalid] } };
    const api = data();
    assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
    assert.equal(api.getCityPlaces('toronto').find(place => place.id === openverse.placeId).photo?.discoveredVia, 'Openverse');
  }
});

test('invalid optional photos cannot discard valid Commons or replace missing photos', () => {
  const valid = { cityId: 'toronto', placeId: 'osm:node:249295975',
    uri: 'https://live.staticflickr.com/65535/12345678901_0123456789_b.jpg',
    sourceUrl: 'https://www.flickr.com/photos/fixture/12345678901',
    artist: 'Fixture creator', title: 'Fixture venue detail', discoveredVia: 'Openverse',
    license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', imageSha256: 'a'.repeat(64) };
  for (const change of [
    p => { p.uri = 'https://evil.example/65535/12345678901_0123456789_b.jpg'; },
    p => { p.sourceUrl = 'https://www.flickr.com.evil.example/photos/fixture/12345678901'; },
    p => { p.uri = 'https://live.staticflickr.com/65535/99999999999_0123456789_b.jpg'; },
    p => { p.sourceUrl = 'https://user@www.flickr.com/photos/fixture/12345678901'; },
    p => { p.sourceUrl = 'https://www.flickr.com:444/photos/fixture/12345678901'; },
    p => { p.uri += '?proxy=1'; },
    p => { p.placeId = 'osm:node:1'; },
    p => { p.cityId = 'vancouver'; },
    p => { p.licenseUrl = 'https://creativecommons.org/licenses/by/2.0/'; },
    p => { p.artist += '\u0000'; },
    p => { delete p.title; },
    p => { p.discoveredVia = 'Unverified'; },
    p => { p.imageSha256 = 'not-a-hash'; },
  ]) {
    const next = dailyCatalog(), row = { ...valid }; change(row);
    next.photoCatalog = structuredClone(photos());
    next.photoCatalog.cities.toronto = next.photoCatalog.cities.toronto.filter(photo => photo.placeId !== valid.placeId);
    next.photoCatalog.additionalCatalog = { cities: { toronto: [row] } };
    const api = data(), original = next.photoCatalog.cities.toronto[0];
    assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
    assert.equal(api.getCityPlaces('toronto').find(p => p.id === valid.placeId).photo, null);
    assert.equal(api.getCityPlaces('toronto').find(p => p.id === original.placeId).photo.uri, original.uri);
  }
});

test('duplicate or unknown-city optional groups are ignored without losing the core snapshot', () => {
  const row = { cityId: 'toronto', placeId: 'osm:node:249295975',
    uri: 'https://live.staticflickr.com/65535/12345678901_0123456789_b.jpg', sourceUrl: 'https://www.flickr.com/photos/fixture/12345678901',
    artist: 'Fixture creator', title: 'Fixture venue detail', discoveredVia: 'Openverse', license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', imageSha256: 'a'.repeat(64) };
  for (const cities of [{ toronto: [row, row] }, { toronto: [row], unknown: [] }, []]) {
    const api = data(), next = dailyCatalog(); next.photoCatalog = structuredClone(photos());
    next.photoCatalog.cities.toronto = next.photoCatalog.cities.toronto.filter(photo => photo.placeId !== row.placeId);
    next.photoCatalog.additionalCatalog = { cities };
    assert.equal(api.replaceCityPlacesCatalog(next, fixtureNow), true);
    assert.equal(api.getCityPlaces('toronto').find(p => p.id === row.placeId).photo, null);
  }
});


test('home nearest three come from the complete selected-city catalog and load ratings only for those cards',()=>{
  const api=data(),base=api.getCityDiscoveryPlaces('vancouver')[0],fix={latitude:49.25,longitude:-122.86,accuracy:20,measuredAt:Date.now(),mocked:false};
  const far={...base,id:'far',name:'Old first place',latitude:49.5,longitude:-122.86};
  const candidates=[far,...[1,2,3].map((n)=>({...base,id:`near-${n}`,name:`Near ${n}`,latitude:49.25+n*.001,longitude:-122.86})),{...base,id:'invalid',latitude:NaN}];
  const custom={...api,getCityRecommendations:()=>[far],getCityDiscoveryPlaces:()=>candidates};
  const ui=screen('src/components/city-popular-places.tsx',{},true,custom,{fix,status:'ready',busy:false,canAskAgain:true,request:async()=>{}}),tree=ui.render({cityId:'vancouver'});
  const cards=nodes(tree).filter(node=>node.props?.analyticsId==='today.places.place-open');assert.deepEqual(cards.map(card=>nodes(card).find(node=>node.type==='CityPlacePhoto').props.place.id),['near-1','near-2','near-3']);
  assert.deepEqual(ui.ratingScopes[0].ids,['near-1','near-2','near-3']);assert.ok(JSON.stringify(tree).includes('km'));
  nodes(tree).find(node=>node.props?.analyticsId==='today.places.open').props.onPress();assert.deepEqual(JSON.parse(JSON.stringify(ui.routes.at(-1).params)),{cityId:'vancouver',nearby:'1'});
});

test('nearby All preserves selected city, uses the full catalog and leaves default TOP50 browsing intact',()=>{
  const api=data(),base=api.getCityDiscoveryPlaces('vancouver')[0],fix={latitude:49.25,longitude:-122.86,accuracy:20,measuredAt:Date.now(),mocked:false};
  const far={...base,id:'far',name:'Far',latitude:49.5,longitude:-122.86};
  const near={...base,id:'near',name:'Near outside old curated picks',latitude:49.251,longitude:-122.86};
  const custom={...api,getCityBrowsePlaces:()=>[far],getCityDiscoveryPlaces:()=>[far,near]};
  const local=screen('src/app/places/index.tsx',{cityId:'vancouver',nearby:'1'},true,custom,{fix,status:'ready',busy:false,canAskAgain:true,request:async()=>{}}),tree=local.render();
  const rows=nodes(tree).filter(node=>node.props?.analyticsId==='places.open');assert.equal(rows.length,2);assert.ok(JSON.stringify(rows[0]).includes('Near outside old curated picks'));
  const old=screen('src/app/places/index.tsx',{cityId:'vancouver'},true,custom);assert.equal(nodes(old.render()).filter(node=>node.props?.analyticsId==='places.open').length,1);
});


test('nearby permission fallback shows no invented distance and its CTA keeps the city unchanged',()=>{
  let requests=0;const ui=screen('src/components/city-popular-places.tsx',{},true,data(),{fix:null,status:'unavailable',busy:false,canAskAgain:true,request:async()=>{requests++;}}),tree=ui.render({cityId:'vancouver'});
  const cards=nodes(tree).filter(node=>node.props?.analyticsId==='today.places.place-open');assert.equal(cards.length,3);assert.ok(cards.every(card=>!card.props.accessibilityLabel.includes('km')));
  nodes(tree).find(node=>node.props?.analyticsId==='today.places.locate').props.onPress();assert.equal(requests,1);assert.ok(ui.feedback.includes('selection'));assert.equal(ui.routes.length,0);
});

test('nearby All exposes the full catalog through bounded More without changing the TOP50 route',()=>{
  const api=data(),base=api.getCityDiscoveryPlaces('vancouver')[0];
  const candidates=Array.from({length:62},(_,index)=>({...base,id:`osm:node:${90000000000+index}`,name:`Fixture ${index}`,latitude:49.25+index*.001,longitude:-122.86}));
  const custom={...api,getCityDiscoveryPlaces:()=>candidates};const ui=screen('src/app/places/index.tsx',{cityId:'vancouver',nearby:'1'},true,custom);let tree=ui.render();
  const rows=()=>nodes(tree).filter(node=>node.props?.analyticsId==='places.open');assert.equal(rows().length,10);
  nodes(tree).find(node=>node.props?.analyticsId==='places.view-more').props.onPress();tree=ui.render();assert.equal(rows().length,60);
  nodes(tree).find(node=>node.props?.analyticsId==='places.view-more').props.onPress();tree=ui.render();assert.equal(rows().length,62);assert.equal(nodes(tree).some(node=>node.props?.analyticsId==='places.view-more'),false);
});

test('actual Expo production compiled PlacesList updates on a catalog-only revision',()=>{
 const require=createRequire(new URL('../package.json',import.meta.url)),babel=require('@babel/core');
 const filename=new URL('../src/app/places/index.tsx',import.meta.url).pathname;
 const {code}=babel.transformSync(readFileSync(filename,'utf8'),{filename,configFile:false,babelrc:false,caller:{name:'metro',bundler:'metro',platform:'ios',engine:'hermes',isDev:false,supportsReactCompiler:true,supportsStaticESM:false,isServer:false},presets:[[require.resolve('babel-preset-expo'),{}]]});
 const city={id:'vancouver',name:'Vancouver'},params={cityId:'vancouver',nearby:'1'},router={},theme={},ratings={};
 const place=id=>({id,cityId:city.id,name:id,category:'cafe',address:'',latitude:49.25,longitude:-123});
 let catalog=[place('initial')],revision=0,current,cursor=0,childElement,tree;
 const memo=new Map(),states=new Map(),subscribers=new Set();
 const jsx=(type,props,key)=>({type,props,key});
 const modules={
  'react/compiler-runtime':{c(size){if(!memo.has(current))memo.set(current,Array(size).fill(Symbol.for('react.memo_cache_sentinel')));return memo.get(current);}},
  react:{useState(initial){let values=states.get(current);if(!values)states.set(current,values=[]);const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];}},
  'react/jsx-runtime':{jsx,jsxs:jsx},
  'expo-router':{useLocalSearchParams:()=>params,useRouter:()=>router},
  'react-native':{View:'View',TextInput:'TextInput',StyleSheet:{create:v=>v}},
  '@/hooks/use-language':{useLanguage:()=>({tr:(s,...v)=>s.replace(/\{(\d+)\}/g,(_,i)=>v[i]),language:'en',locale:'en-CA'})},
  '@/hooks/use-theme':{useTheme:()=>theme},
  '@/hooks/use-city-places':{useCityPlacesRevision(){subscribers.add(current);return revision;}},
  '@/lib/community-city':{useCommunityCity:()=>({city})},'@/lib/mock':{CITIES:[city]},
  '@/hooks/use-current-location':{useCurrentLocation:()=>({fix:null,status:'permission',busy:false,canAskAgain:true,request:async()=>{}})},
  '@/lib/discovery-sort':distance,
  '@/lib/city-places':{getCityDiscoveryPlaces:()=>catalog,getCityBrowsePlaces:()=>catalog,getCityPlacesCoverage:()=>'',CITY_PLACES_COLLECTED_AT:'2026-10-23'},
  '@/hooks/use-place-review-summaries':{usePlaceReviewSummaries:()=>ratings},
  '@/components/place-review-summary':{getPlaceReviewRating:()=>({score:null}),PlaceReviewSummary:'PlaceReviewSummary'},
  '@/lib/interaction-feedback':{useInteractionFeedback:()=>({play(){}})},
  '@/constants/theme':{Spacing:{one:4,two:8,three:16},MaxContentWidth:920},
 };
 const exports={};vm.runInNewContext(code,{exports,require:name=>modules[name]??(name.startsWith('@babel/')?require(name):new Proxy({},{get:(_,key)=>key}))});
 const render=(fn,props)=>{current=fn;cursor=0;return fn(props);};
 const rootRender=()=>{const next=render(exports.default,{});if(next!==childElement){childElement=next;tree=render(next.type,next.props);}};
 const nodes=v=>!v||typeof v!=='object'?[]:[...(v.type?[v]:[]),...Object.values(v).flatMap(nodes)];
 const ids=()=>nodes(tree).filter(n=>n.type==='CityPlacePhoto').map(n=>n.props.place.id);
 rootRender();assert.deepEqual(ids(),['initial']);
 catalog=[place('replacement-first'),place('newly-added')];revision++;
 // Match React's cached-element bailout, while external-store subscribers update independently.
 for(const fn of [...subscribers]){if(fn===exports.default)rootRender();else if(fn===childElement.type)tree=render(fn,childElement.props);}
 assert.deepEqual(ids(),['replacement-first','newly-added'],'catalog-only refresh must reach rows without city, fix, query or category changes');
});
