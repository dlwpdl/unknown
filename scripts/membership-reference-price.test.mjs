import assert from 'node:assert/strict';
import test from 'node:test';
import { referencePrice } from '../src/lib/membership.ts';

test('reference price scales the store price in its own currency and format', () => {
  assert.equal(referencePrice({ tier: 'plus', price: 'CA$9.99' }), 'CA$14.99');
  assert.equal(referencePrice({ tier: 'plus', price: 'CA$99.99' }), 'CA$149.99');
  assert.equal(referencePrice({ tier: 'premium', price: '$14.99' }), '$19.99');
  assert.equal(referencePrice({ tier: 'premium', price: 'CA$149.99' }), 'CA$199.99');
  assert.equal(referencePrice({ tier: 'plus', price: '$6.99' }), '$10.99');
  assert.equal(referencePrice({ tier: 'plus', price: '₩11,000' }), '₩16,500');
  assert.equal(referencePrice({ tier: 'premium', price: '149.000 ₩' }), '199.000 ₩');
  assert.equal(referencePrice({ tier: 'plus', price: '9,99 €' }), '14,99 €');
  assert.equal(referencePrice({ tier: 'plus', price: '준비 중' }), null);
});
