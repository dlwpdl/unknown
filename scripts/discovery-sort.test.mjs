import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryDistanceKm, sortDiscoveryItems } from '../src/lib/discovery-sort.ts';

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
