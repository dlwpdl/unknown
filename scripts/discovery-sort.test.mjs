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
