import assert from 'node:assert/strict';
import test from 'node:test';
import { filterReportRows } from '../src/components/admin/admin-report-filter.ts';

test('report filters combine OR within each facet and AND across text/status/target', () => {
  const rows = [
    { id: 'a', status: 'dismissed', target_type: 'post', searchText: 'Alice 스팸' },
    { id: 'b', status: 'open', target_type: 'comment', searchText: 'Alice 괴롭힘' },
    { id: 'c', status: 'actioned', target_type: 'user', searchText: 'Bob 스팸' },
    { id: 'd', status: 'open', target_type: 'post', searchText: 'Bob 스팸' },
  ];
  assert.deepEqual(filterReportRows(rows, ' ALICE ', ['open', 'dismissed'], ['post', 'comment']).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(filterReportRows(rows, '', ['open'], ['post']).map((r) => r.id), ['d']);
  assert.equal(filterReportRows(rows, '없는 검색어', [], []).length, 0);
  assert.equal(filterReportRows(rows, '', [], []).length, 4);
  assert.equal(rows[0].id, 'a');
});
