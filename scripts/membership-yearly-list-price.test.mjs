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

test('yearly badge says two months free only when the yearly price is about ten months', async () => {
  const { yearlySavings } = await import('../src/lib/membership.ts');
  assert.deepEqual(yearlySavings('CA$19.99', 'CA$199.99'), { freeMonths: 2 });
  assert.deepEqual(yearlySavings('CA$49.99', 'CA$499.99'), { freeMonths: 2 });
  assert.deepEqual(yearlySavings('CA$149.99', 'CA$1,399.99'), { percent: 22 });
  assert.equal(yearlySavings('CA$9.99', 'CA$119.88'), null);
  assert.equal(yearlySavings('', 'CA$1.00'), null);
});
