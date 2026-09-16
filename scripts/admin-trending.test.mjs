import assert from 'node:assert/strict';
import test from 'node:test';
import { trendingConfigPatch } from '../src/lib/admin-trending.ts';

const config = {
  enabled: true, view_weight: 1, anon_view_weight: 0.3, like_weight: 5, comment_weight: 8,
  half_life_hours: 12, min_score: 10, max_age_hours: 48, max_per_city_per_day: 3,
  quiet_start_hour: 22, quiet_end_hour: 8, timezone: 'America/Toronto',
  updated_at: '', updated_by: null,
};

test('only changed values are sent', () => {
  const result = trendingConfigPatch({ view_weight: '1', min_score: '25' }, config);
  assert.deepEqual(result, { patch: { min_score: 25 } });
});

test('zero is allowed for weights but not for durations', () => {
  assert.deepEqual(trendingConfigPatch({ anon_view_weight: '0' }, config), { patch: { anon_view_weight: 0 } });
  assert.deepEqual(trendingConfigPatch({ half_life_hours: '0' }, config), { invalid: 'half_life_hours' });
  assert.deepEqual(trendingConfigPatch({ max_age_hours: '0' }, config), { invalid: 'max_age_hours' });
});

test('blank, negative and non-numeric input is rejected by name', () => {
  assert.deepEqual(trendingConfigPatch({ min_score: '' }, config), { invalid: 'min_score' });
  assert.deepEqual(trendingConfigPatch({ min_score: '-1' }, config), { invalid: 'min_score' });
  assert.deepEqual(trendingConfigPatch({ like_weight: '다섯' }, config), { invalid: 'like_weight' });
});

test('an unchanged form produces no write', () => {
  assert.deepEqual(trendingConfigPatch({ view_weight: '1', half_life_hours: '12' }, config), { patch: {} });
});
