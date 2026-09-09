import assert from 'node:assert/strict';
import test from 'node:test';

import { isReviewUser } from '../src/lib/review-access.ts';

test('review access requires a trusted email review marker and ordinary member role', () => {
  assert.equal(isReviewUser(null), false);
  assert.equal(isReviewUser({ app_metadata: { provider: 'email', review_access: true } }), true);
  for (const app_metadata of [
    { provider: 'email' },
    { provider: 'email', review_access: 'true' },
    { provider: 'kakao', review_access: true },
    { provider: 'email', review_access: true, role: 'admin' },
  ]) assert.equal(isReviewUser({ app_metadata }), false);
  assert.equal(isReviewUser({ app_metadata: { provider: 'email' }, user_metadata: { review_access: true } }), false);
});
