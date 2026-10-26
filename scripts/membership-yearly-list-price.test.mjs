import assert from 'node:assert/strict';
import test from 'node:test';
import { yearlyListPrice } from '../src/lib/membership.ts';

test('yearly list price is twelve months in the store price format', () => {
  assert.equal(yearlyListPrice('CA$9.99'), 'CA$119.88');
  assert.equal(yearlyListPrice('CA$149.99'), 'CA$1,799.88');
  assert.equal(yearlyListPrice('₩11,000'), '₩132,000');
  assert.equal(yearlyListPrice('149.000 ₩'), '1.788.000 ₩');
  assert.equal(yearlyListPrice('9,99 €'), '119,88 €');
  assert.equal(yearlyListPrice('준비 중'), null);
});
