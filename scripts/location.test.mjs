import assert from 'node:assert/strict';
import test from 'node:test';
import { nearbyCommunity, isFreshLocation } from '../src/lib/location.ts';

test('only fresh, usable fixes recommend an open nearby community', () => {
  const now = Date.now();
  const fix = { latitude: 49.28, longitude: -122.8, accuracy: 100, measuredAt: now, mocked: false };
  assert.equal(nearbyCommunity(fix, now), 'vancouver');
  assert.equal(nearbyCommunity({ ...fix, latitude: 43.65, longitude: -79.38 }, now), 'toronto');
  for (const changed of [
    { latitude: 37.5, longitude: 127 }, { latitude: 45.5, longitude: -73.56 },
    { accuracy: 10001 }, { accuracy: null }, { accuracy: -1 }, { mocked: true },
    { latitude: NaN }, { longitude: Infinity }, { latitude: 91 },
    { measuredAt: now - 300001 }, { measuredAt: now + 30001 },
  ]) assert.equal(nearbyCommunity({ ...fix, ...changed }, now), null);
  assert.equal(isFreshLocation({ ...fix, measuredAt: now - 300000 }, now), true);
});
