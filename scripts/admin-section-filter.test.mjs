import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matches, selected } from '../src/components/admin/admin-section-filter.ts';

test('loaded admin filters combine OR selections with AND dimensions and reset', () => {
  const rows = [
    { city: 'vancouver', status: 'published', title: 'Hello 밴쿠버' },
    { city: 'toronto', status: 'published', title: 'hello 토론토' },
    { city: 'vancouver', status: 'removed', title: 'Hello 삭제' },
    { city: 'seoul', status: 'published', title: 'Hello 서울' },
  ];
  const filter = (cities, statuses, query) => rows.filter((row) => selected(cities, row.city) && selected(statuses, row.status) && matches(query, row.title, null, undefined));
  assert.equal(filter(['vancouver', 'toronto'], ['published'], 'hello').length, 2);
  assert.equal(filter(['vancouver'], ['published', 'removed'], 'hello').length, 2);
  assert.equal(filter([], [], '').length, 4);
  assert.equal(filter(['toronto'], ['removed'], '').length, 0);
  assert.equal(filter([], [], '밴쿠버').length, 1);
});
