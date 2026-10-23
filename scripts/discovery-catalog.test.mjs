import { DELIVERY_PARTNERS, deliveryPartnerPlace } from '../src/lib/delivery-partners.ts';
import { sortDiscoveryItems } from '../src/lib/discovery-sort.ts';
import { bindBusinessPlaces } from '../src/lib/webshops.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { safeMerchantSourceUrl } from '../src/lib/merchant-source.ts';
import { safeTicketUrl } from '../supabase/functions/_shared/ticketmaster.ts';
import vm from 'node:vm';
import ts from 'typescript';
import * as discovery from '../src/lib/discovery.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url)));
const place = catalog.cities.toronto.places[0];
const mapSource = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

test('a source-reviewed photo place carries its selection reason and badge to the map', () => {
  const recommendation = { placeId: place.id, reason: 'A source-reviewed photo viewpoint.', reasonEn: 'A source-reviewed photo viewpoint.', sourceUrl: 'https://example.org/photo-guide', verifiedAt: '2026-10-18T00:00:00Z' };
  const item = discovery.discoveryPlace({ ...place, recommendation });
  assert.equal(item.top25?.id, place.id);
  assert.equal(item.top25?.reason, recommendation.reason);
  assert.equal(item.top25?.sourceUrl, recommendation.sourceUrl);
  assert.equal(item.top25?.reasonEn, recommendation.reasonEn);
  assert.equal(discovery.discoveryMatches(item, 'top25', ''), true);
  assert.equal(discovery.discoveryPlace({ ...place, recommendation: { ...recommendation, placeId: 'other-place' } }).top25, undefined);
});

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
    assert.equal(discovery.discoveryMatches(item, 'places', ''), stored.category === 'places');
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
    exports, bindBusinessPlaces, sortDiscoveryItems, deliveryOnly: false, registry: { links: {}, shops: [] }, sortBy: 'near', userLocation: null, current: null, catalogItems: [discovery.discoveryPlace(place)], city: { id: place.cityId }, now: Date.now(), selectedFilters: [], query: '', days: [],
    hidden: () => false, discoveryEvent: () => null, discoveryEventOnDays: discovery.discoveryEventOnDays, mergeCityTop25: discovery.mergeCityTop25, discoveryMatches: discovery.discoveryMatches,
  });
  assert.equal(exports.run().length, 1);
  assert.equal(exports.run()[0].sourceId, place.id);
});

test('opening a catalog map card uses the existing place detail route and leaves editorial-only source links intact', () => {
  assert.equal(typeof discovery.discoveryPlace, 'function');
  const start = mapSource.indexOf('  const open = (item: DiscoveryItem) => {'), end = mapSource.indexOf('  const selectPin = ', start);
  const exports = {}, routes = [], links = [], feedback = [];
  vm.runInNewContext(compile(mapSource.slice(start, end) + '\nexports.open = open;'), {
    exports, onClose: undefined, city: { id: place.cityId }, router: { push: value => routes.push(value) }, play: value => feedback.push(value),
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

test('embedded discovery permits public HTTPS information and rejects invalid post and event targets', async () => {
  const start = mapSource.indexOf('  const open = (item: DiscoveryItem) => {'), end = mapSource.indexOf('  const selectPin = ', start);
  const exports = {}, opened = [], routes = [];
  vm.runInNewContext(compile(mapSource.slice(start, end) + '\nexports.open = open;'), {
    exports, onClose() {}, safeMerchantSourceUrl, safeTicketUrl, PUBLIC_SITE: 'https://gling.ej-entertainment.com',
    openBrowserAsync: async url => opened.push(url), router: { push: value => routes.push(value) },
    play() {}, tr: value => value, Alert: { alert() {} }, encodeURIComponent,
  });
  for (const item of [{ source: 'post', post: { id: 'private-conversation-id' } }, { source: 'event', event: { ticketUrl: 'https://attacker.example/login' } }, { source: 'place', place: { sourceUrl: 'javascript:alert(1)' } }]) exports.open(item);
  assert.deepEqual(opened, []);
  const id = '00000000-0000-0000-0000-000000000001';
  exports.open({ source: 'post', post: { id }, conversationId: 'never-pass-this' });
  exports.open({ source: 'event', event: { ticketUrl: 'https://www.ticketmaster.ca/event/example' } });
  await new Promise(setImmediate);
  assert.deepEqual(opened, [`https://gling.ej-entertainment.com/post?id=${id}`, 'https://www.ticketmaster.ca/event/example']);
  assert.deepEqual(routes, []);
});

test('every overlapping map filter opens the same explicitly linked business; embedded maps keep the public browser handoff', async () => {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const item = discovery.discoveryPlace({ ...place, category: 'food', glingVisited: { sourceUrl: 'https://www.instagram.com/reel/fixture/' } });
  const shop = { merchantId, cityId: place.cityId, comparisons: [{ id: 'fixture', name: 'Fixture menu', uberCents: 2000, webCents: 1600 }] };
  const linked = bindBusinessPlaces([item], { [place.id]: merchantId }, [shop])[0];
  const start = mapSource.indexOf('  const open = (item: DiscoveryItem) => {'), end = mapSource.indexOf('  const selectPin = ', start);
  const exports = {}, routes = [], opened = [], context = {
    exports, onClose: undefined, city: { id: place.cityId }, router: { push: route => routes.push(route) }, play() {},
    PUBLIC_SITE: 'https://gling.ej-entertainment.com', safeMerchantSourceUrl, safeTicketUrl,
    openBrowserAsync: async url => opened.push(url), Linking: { openURL: async url => opened.push(url) }, tr: value => value, Alert: { alert() {} },
  };
  vm.runInNewContext(compile(mapSource.slice(start, end) + '\nexports.open = open;'), context);
  for (const filters of [['delivery'], ['visited'], ['dining'], ['visited', 'delivery', 'dining'], ['dining', 'delivery', 'visited']]) {
    assert.equal(discovery.discoveryMatches(linked, filters, ''), true);
    exports.open(linked);
    assert.equal(routes.at(-1).pathname, '/company/[id]');
    assert.equal(routes.at(-1).params.id, merchantId);
  }
  assert.equal(opened.length, 0);
  context.onClose = () => {};
  exports.open(linked); await new Promise(setImmediate);
  assert.equal(routes.length, 5, 'embedded discovery cannot navigate the underlying chat route');
  assert.deepEqual(opened, [`https://gling.ej-entertainment.com/company?id=${merchantId}`]);
});

test('a partner detail map target and its curated marker use the same normalized discovery identity once', () => {
  const partner = deliveryPartnerPlace('vancouver', 'partner:jimoco-coquitlam');
  const expected = discovery.discoveryPlace(partner);
  const route = discovery.placeMapRoute(partner);
  const start = mapSource.indexOf('  const catalogPlaces = '), end = mapSource.indexOf('  useEffect(() => {', start);
  assert.ok(start > 0 && end > start);
  const exports = {}, context = { exports, city: { id: route.params.cityId }, placeId: route.params.placeId,
    getCityDiscoveryPlaces: () => [], getCityPlaces: () => [], discoveryPlace: discovery.discoveryPlace, DELIVERY_PARTNERS, deliveryPartnerPlace };
  vm.runInNewContext(compile(`exports.run = () => { ${mapSource.slice(start, end)} return { targetId, targetItem, catalogItems }; };`), context);
  const result = exports.run();
  assert.equal(result.targetId, expected.id);
  assert.equal(result.targetItem.place.id, partner.id);
  assert.equal(result.catalogItems.filter(item => item.id === result.targetId).length, 1);
  assert.equal(result.catalogItems.filter(item => item.place?.id === partner.id).length, 1, 'one physical partner cannot acquire two marker IDs');
  assert.equal(result.catalogItems.find(item => item.id === result.targetId).place.id, partner.id);
  context.city = { id: 'toronto' };
  assert.equal(exports.run().targetId, undefined);
  context.city = { id: partner.cityId }; context.placeId = 'partner:unknown';
  assert.equal(exports.run().targetId, undefined);
});
