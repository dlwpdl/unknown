import assert from 'node:assert/strict';
import test from 'node:test';
import { ratingValue } from './app-store-rating.mjs';

test('App Store rating is passed through only when Apple returns a real score and count', () => {
  assert.equal(ratingValue({ resultCount: 1, results: [{ averageUserRating: 5, userRatingCount: 3 }] }), '5.0:3');
  assert.equal(ratingValue({ results: [{ averageUserRating: 4.66, userRatingCount: 12 }] }), '4.7:12');
  for (const lookup of [null, {}, { results: [] }, { results: [{ averageUserRating: 5 }] }, { results: [{ averageUserRating: 0, userRatingCount: 0 }] },
    { results: [{ averageUserRating: '5', userRatingCount: 3 }] }, { results: [{ averageUserRating: 7, userRatingCount: 3 }] }]) assert.equal(ratingValue(lookup), '');
});
