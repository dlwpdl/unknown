import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCelebrateVerificationUpgrade, trustLevelOf } from '../src/lib/trust.ts';

test('maps existing profile verification fields to L1, L2, and L3', () => {
  assert.equal(trustLevelOf({ verified: false }), 1);
  assert.equal(trustLevelOf({ verified: true }), 2);
  assert.equal(trustLevelOf({ verified: true, trustLevel: 2 }), 2);
  assert.equal(trustLevelOf({ verified: true, trustLevel: 3 }), 3);
});

test('celebrates only a previously observed verification level increase', () => {
  assert.equal(shouldCelebrateVerificationUpgrade(null, 2), false);
  assert.equal(shouldCelebrateVerificationUpgrade('1', 2), true);
  assert.equal(shouldCelebrateVerificationUpgrade('2', 3), true);
  assert.equal(shouldCelebrateVerificationUpgrade('2', 2), false);
  assert.equal(shouldCelebrateVerificationUpgrade('3', 2), false);
  assert.equal(shouldCelebrateVerificationUpgrade('invalid', 3), false);
});
