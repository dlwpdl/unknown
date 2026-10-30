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

test('trusted host checklist follows the server rule and hides switched-off checks', async () => {
  const { trustedHostSteps } = await import('../src/lib/trust.ts');
  const progress = {
    enabled: true, level: 2, eligible: false,
    confirmedMeetups: { required: 3, count: 3 }, hostedMeetups: { required: 3, count: 1 },
    noRecentNoShow: { days: 90, met: true }, goodConduct: { days: 365, met: false },
  };
  assert.deepEqual(trustedHostSteps(progress).map(({ key, met }) => [key, met]),
    [['level', true], ['confirmed', true], ['hosted', false], ['noShow', true], ['conduct', false]]);
  const relaxed = { ...progress, level: 1, hostedMeetups: { required: 0, count: 0 }, noRecentNoShow: { days: 0, met: true }, goodConduct: { days: 0, met: true } };
  assert.deepEqual(trustedHostSteps(relaxed).map(({ key, met }) => [key, met]), [['level', false], ['confirmed', true]]);
});
