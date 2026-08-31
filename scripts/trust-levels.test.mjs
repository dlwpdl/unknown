import assert from 'node:assert/strict';
import test from 'node:test';

import { trustLevelOf } from '../src/lib/trust.ts';

test('maps existing profile verification fields to L1, L2, and L3', () => {
  assert.equal(trustLevelOf({ verified: false }), 1);
  assert.equal(trustLevelOf({ verified: true }), 2);
  assert.equal(trustLevelOf({ verified: true, trustLevel: 2 }), 2);
  assert.equal(trustLevelOf({ verified: true, trustLevel: 3 }), 3);
});
