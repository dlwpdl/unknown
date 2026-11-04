import assert from 'node:assert/strict';
import test from 'node:test';
import { PLACE_SUBCATEGORIES, discoveryRefines, priceLabel } from '../src/lib/discovery.ts';

test('price chip text shows a run as a range and a gap as separate levels', () => {
  assert.equal(priceLabel([]), '');
  assert.equal(priceLabel([2]), '$$');
  assert.equal(priceLabel([2, 1]), '$–$$');
  assert.equal(priceLabel([1, 2, 3, 4]), '$–$$$$');
  assert.equal(priceLabel([3, 1]), '$ · $$$');
  assert.equal(priceLabel([1, 1, 9, 0]), '$', 'unknown and repeated levels are dropped');
});

test('price and sub-filters leave out places without the value instead of assuming a match', () => {
  const item = place => ({ place });
  const cheap = item({ priceLevel: 1, subcategories: ['lunch', 'solo'] }), dear = item({ priceLevel: 4, subcategories: ['date'] }), blank = item({}), event = {};
  const keep = (levels, subs) => [cheap, dear, blank, event].filter(value => discoveryRefines(value, levels, subs));
  assert.deepEqual(keep([], []), [cheap, dear, blank, event]);
  assert.deepEqual(keep([1, 2], []), [cheap]);
  assert.deepEqual(keep([], ['date', 'solo']), [cheap, dear], 'several sub-filters are a union');
  assert.deepEqual(keep([4], ['solo']), []);
});

test('sub-filter ids are unique and belong to the three owner-chosen categories', () => {
  assert.equal(new Set(PLACE_SUBCATEGORIES.map(value => value.id)).size, PLACE_SUBCATEGORIES.length);
  assert.deepEqual([...new Set(PLACE_SUBCATEGORIES.map(value => value.filter))], ['dining', 'nightlife', 'cafe']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'dining').map(value => value.label), ['점심', '저녁', '늦은 밤', '혼밥', '데이트']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'nightlife').map(value => value.label), ['이자카야', '포차', '칵테일 바', '와인 바', '펍']);
  assert.deepEqual(PLACE_SUBCATEGORIES.filter(value => value.filter === 'cafe').map(value => value.label), ['디저트', '브런치', '작업하기 좋은 곳']);
});
