import assert from 'node:assert/strict';
import test from 'node:test';
import { activityParams, mergeActivityRows } from '../src/lib/admin-user-data.ts';

test('activity filters validate real dates and preserve the database cursor precision', () => {
  const base = { kind: 'all', from: '', until: '', query: '', conversationId: null };
  assert.throws(() => activityParams('user', { ...base, from: '2026-02-30' }), /날짜/);
  assert.throws(() => activityParams('user', { ...base, from: '2026-09-12', until: '2026-09-11' }), /기간/);
  const cursor = { at: '2026-09-01T12:00:00.123456+00:00', key: 'comment:one' };
  const params = activityParams('user', base, cursor);
  assert.equal(params.p_before, cursor.at);
  assert.equal(params.p_before_key, cursor.key);
  assert.equal(params.p_from, null);
});

test('repeated page delivery cannot duplicate visible activity records', () => {
  const one = { event_key: 'post:one' }, two = { event_key: 'post:two' };
  assert.deepEqual(mergeActivityRows([one], [one, two]), [one, two]);
});
