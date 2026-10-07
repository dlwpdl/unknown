import assert from 'node:assert/strict';
import test from 'node:test';
import { activityParams, EMPTY_DIRECTORY_FILTERS, mergeActivityRows, searchAdminUsers } from '../src/lib/admin-user-data.ts';

test('combined directory filters reach the server unchanged on every page', async () => {
  const filters = { ...EMPTY_DIRECTORY_FILTERS, account_types: ['example', 'member'], cities: ['vancouver', 'toronto'], statuses: ['active'], providers: ['google'], joined_days: '30', sort: 'oldest' };
  const calls = [];
  const client = { rpc: async (name, params) => { calls.push(params); return { data: { rows: [], total: 0 }, error: null }; } };
  for (const offset of [0, 50]) {
    await searchAdminUsers(client, ' name ', offset, filters);
    assert.deepEqual(calls.at(-1), { p_query: 'name', p_offset: offset, p_filters: filters });
  }
});

test('directory search sends the same account filter for initial and subsequent pages', async () => {
  const calls = [];
  const data = { rows: [], total: 0, viewer: { id: 'admin', email: null, role: 'admin' } };
  const client = { rpc: async (name, params) => { calls.push({ name, params }); return { data, error: null }; } };
  for (const accountType of ['all', 'example', 'member']) {
    for (const offset of [0, 50]) {
      assert.equal(await searchAdminUsers(client, ' name ', offset, accountType), data);
      assert.deepEqual(calls.at(-1), { name: 'search_admin_users', params: { p_query: 'name', p_offset: offset, p_account_type: accountType } });
    }
  }
  await searchAdminUsers(client);
  assert.equal(calls.at(-1).params.p_account_type, 'all');
  await assert.rejects(searchAdminUsers({ rpc: async () => ({ data: null, error: { message: 'ADMIN_REQUIRED' } }) }), /ADMIN_REQUIRED/);
});

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
