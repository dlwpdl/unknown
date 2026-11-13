import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryDistanceKm, preferVisitedPlaces, sortDiscoveryItems, sortEventList } from '../src/lib/discovery-sort.ts';

const origin = { latitude: 49.25, longitude: -122.86 };
const place = (id, latitude, discount) => ({ id, source: 'place', sourceId: id, cityId: 'vancouver', title: id, category: 'dining', label: id, latitude, longitude: origin.longitude, price: null, webshopDiscount: discount });

test('distance uses coordinates and handles unknown or invalid positions without inventing a value', () => {
  assert.equal(discoveryDistanceKm(place('same', origin.latitude), origin), 0);
  assert.ok(Math.abs(discoveryDistanceKm(place('north', origin.latitude + 1), origin) - 111.195) < .01);
  assert.equal(discoveryDistanceKm(place('unknown', null), origin), null);
  assert.equal(discoveryDistanceKm(place('bad', NaN), origin), null);
  assert.equal(discoveryDistanceKm(place('bad', 91), origin), null);
  assert.equal(discoveryDistanceKm(place('valid', 49), null), null);
});

test('nearest order is stable and keeps unknown distances last without mutating input', () => {
  const items = [place('far', 49.5), place('unknown', null), place('near', 49.26), place('near-tie', 49.26)];
  assert.deepEqual(sortDiscoveryItems(items, origin, 'near').map(x => x.id), ['near', 'near-tie', 'far', 'unknown']);
  assert.deepEqual(items.map(x => x.id), ['far', 'unknown', 'near', 'near-tie']);
  assert.deepEqual(sortDiscoveryItems(items, null, 'near'), items);
});

test('discount order uses the verified numeric field, then distance, and keeps unknown discounts distinct', () => {
  const items = [place('unknown', 49.251), place('small', 49.252, 6.3), place('max-far', 49.5, 20.8), place('max-near', 49.26, 20.8), place('invalid', 49.251, NaN)];
  assert.deepEqual(sortDiscoveryItems(items, origin, 'discount').map(x => x.id), ['max-near', 'max-far', 'small', 'unknown', 'invalid']);
  assert.equal(items[0].webshopDiscount, undefined);
});

test('saves order uses the given total, then distance, and leaves input and other orders alone', () => {
  const items = [place('none', 49.251), place('some-far', 49.5), place('some-near', 49.26), place('most', 49.9)];
  const totals = { 'some-far': 3, 'some-near': 3, most: 9 }, count = item => totals[item.id] ?? 0;
  assert.deepEqual(sortDiscoveryItems(items, origin, 'saves', count).map(x => x.id), ['most', 'some-near', 'some-far', 'none']);
  assert.deepEqual(sortDiscoveryItems(items, null, 'saves', count).map(x => x.id), ['most', 'some-far', 'some-near', 'none'], 'no location keeps the given order among ties');
  assert.deepEqual(sortDiscoveryItems(items, origin, 'near', count).map(x => x.id), ['none', 'some-near', 'some-far', 'most'], 'nearest ignores totals');
  assert.deepEqual(sortDiscoveryItems(items, origin, 'saves').map(x => x.id), ['none', 'some-near', 'some-far', 'most'], 'no totals is nearest');
  assert.deepEqual(items.map(x => x.id), ['none', 'some-far', 'some-near', 'most']);
});

test('nearby place ordering uses the full input, stable ties and real user coordinates without mutating catalog order',async()=>{
  const {rankPlacesByDistance,formatNearbyDistance}=await import('../src/lib/discovery-sort.ts');assert.equal(typeof rankPlacesByDistance,'function');
  const now=Date.now(),fix={...origin,accuracy:20,measuredAt:now,mocked:false};
  const places=[place('far',49.5),place('invalid',NaN),place('near',49.251),place('tie',49.251)];
  const ranked=rankPlacesByDistance(places,fix,now);assert.deepEqual(ranked.map(row=>row.place.id),['near','tie','far','invalid']);assert.equal(ranked.at(-1).distance,null);
  assert.deepEqual(places.map(row=>row.id),['far','invalid','near','tie']);
  for(const bad of [null,{...fix,accuracy:1000},{...fix,measuredAt:now-120001},{...fix,latitude:91}]){const fallback=rankPlacesByDistance(places,bad,now);assert.deepEqual(fallback.map(row=>row.place.id),places.map(row=>row.id));assert.ok(fallback.every(row=>row.distance===null));}
  const tr=(message,...values)=>message.replace(/\{(\d+)\}/g,(_,index)=>values[index]);
  assert.equal(formatNearbyDistance(1.234,tr),'약 1.2km');assert.equal(formatNearbyDistance(.02,tr),'100m 이내');assert.equal(formatNearbyDistance(null,tr),null);assert.equal(formatNearbyDistance(Infinity,tr),null);
});

test('places members rated or saved lead in server order, then Gling visits, and everything else keeps its order', () => {
  const rows = ['tower', 'aquarium', 'kimchi', 'visited', 'cafe'].map(id => ({ place: { id, ...(id === 'visited' ? { glingVisited: { sourceUrl: 'x' } } : {}) } }));
  assert.deepEqual(preferVisitedPlaces(rows, ['cafe', 'kimchi']).map(row => row.place.id), ['cafe', 'kimchi', 'visited', 'tower', 'aquarium']);
  assert.deepEqual(preferVisitedPlaces(rows, []).map(row => row.place.id), ['visited', 'tower', 'aquarium', 'kimchi', 'cafe']);
  assert.deepEqual(preferVisitedPlaces(rows, ['not-in-catalog']).map(row => row.place.id), ['visited', 'tower', 'aquarium', 'kimchi', 'cafe']);
  assert.deepEqual(rows.map(row => row.place.id), ['tower', 'aquarium', 'kimchi', 'visited', 'cafe'], 'input order is untouched');
});

test('QA C22-3: two loaded event pages read as one list in city day and start order, each event id once', () => {
  // Vancouver, Nov 13 evening (UTC-8): the pages overlap on one event and each comes back out of start order.
  const event = (id, name, startsAt, localDate = '2026-11-13') => ({ id, name, startsAt, localDate });
  const first = [event('ubc-bb', 'UBC Basketball', '2026-11-14T01:30:00Z'), event('alley', 'ALLEYCVT', '2026-11-14T02:30:00Z'),
    event('boy', 'BOYNEXTDOOR', '2026-11-14T03:30:00Z'), event('canucks', 'Canucks', '2026-11-14T03:00:00Z')];
  const second = [event('canucks', 'Canucks', '2026-11-14T03:00:00Z'), event('luzia', 'Luzia', '2026-11-14T20:00:00Z', '2026-11-14'),
    event('alley-cyclops', 'ALLEYCVT w/ Cyclops', '2026-11-14T02:30:00Z'), event('tba', 'Time TBA', null), event('sassy', 'Sassy', '2026-11-14T02:00:00Z')];
  const loaded = [...first, ...second];
  const list = sortEventList(loaded);
  assert.deepEqual(list.map(item => item.id), ['ubc-bb', 'sassy', 'alley', 'alley-cyclops', 'canucks', 'boy', 'tba', 'luzia']);
  assert.equal(new Set(list.map(item => item.id)).size, list.length, 'no event id shows twice');
  assert.deepEqual(list.filter(item => item.name.startsWith('ALLEYCVT')).map(item => item.name), ['ALLEYCVT', 'ALLEYCVT w/ Cyclops'], 'different ids with a similar name both stay');
  assert.equal(loaded.length, 9, 'the loaded pages are left as they came');
});

test('final QA C22-3: rows follow the venue clock they show, even when the feed tags a Vancouver venue with Los Angeles time', () => {
  // Real feed rows, Nov 13: BOYNEXTDOOR 19:30 tagged Vancouver (UTC-7) and ALLEYCVT w/ Cyclops 18:30 tagged Los Angeles (UTC-8) share one startsAt.
  const event = (id, localTime, startsAt) => ({ id, localDate: '2026-11-13', localTime, startsAt });
  const list = sortEventList([event('boy', '19:30:00', '2026-11-14T02:30:00Z'), event('cyclops', '18:30:00', '2026-11-14T02:30:00Z'),
    event('sassy-la', '19:00:00', '2026-11-14T03:00:00Z'), event('wolf', '20:00:00', '2026-11-14T03:00:00Z'), event('luzia', '19:30:00', '2026-11-14T03:30:00Z'),
    event('tba', null, null), event('canucks', '19:00:00', '2026-11-14T02:00:00Z')]);
  assert.deepEqual(list.map(item => item.id), ['cyclops', 'canucks', 'sassy-la', 'boy', 'luzia', 'wolf', 'tba']);
});
