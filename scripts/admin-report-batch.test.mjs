import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReportBatch } from '../src/lib/admin-report-batch.ts';

test('batch runs once per report, retains partial successes and continues after a failure', async () => {
  const calls = [];
  const result = await resolveReportBatch(['a', 'b', 'a', 'c'], async (id) => {
    calls.push(id);
    if (id === 'b') throw new Error('permission or already processed');
  });
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(result, { succeeded: ['a', 'c'], failed: ['b'] });
  assert.deepEqual(await resolveReportBatch([], async () => assert.fail()), { succeeded: [], failed: [] });
});
