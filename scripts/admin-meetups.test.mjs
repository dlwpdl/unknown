import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { chillingAvailability } from '../src/lib/chilling.ts';

function api() {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/admin-meetups.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { exports, Date, require: name => name.endsWith('chilling') ? { chillingAvailability } : {
    ADMIN_PAGE_SIZE: 50,
    async logAdminAccess(client, scope, subject_user_id = null, resource_id = null) {
      const result = await client.rpc('log_admin_access', { scope, subject_user_id, resource_id });
      if (result.error) throw new Error(result.error.message);
    },
    async loadAdminProfilesByIds(client, ids) { client.calls.push(['profiles', ...new Set(ids)]); return ids.map(id => ({ id, nickname: id })); },
  } });
  return exports;
}
function client(results, denied = false) {
  const calls = [];
  return { calls, async rpc(name, args) { calls.push([name, args]); return { error: denied ? { message: 'ADMIN_REQUIRED' } : null }; },
    from(table) {
      calls.push(['from', table]);
      const chain = { then(resolve, reject) { return Promise.resolve(results[table]).then(resolve, reject); } };
      for (const method of ['select', 'not', 'eq', 'or', 'in', 'ilike', 'order', 'range']) chain[method] = (...args) => { calls.push([table, method, ...args]); return chain; };
      return chain;
    } };
}

test('all meetup pages query the server with the same filters and exact count after audited authorization', async () => {
  const { loadAdminMeetups } = api();
  const c = client({ posts: { data: [{ id: 'post', author_id: 'host' }], count: 84, error: null } });
  for (const offset of [0, 50]) {
    const result = await loadAdminMeetups(c, { query: '  50%_ \\ ', cities: ['vancouver'], kind: 'group' }, offset);
    assert.equal(result.total, 84);
    assert.deepEqual(c.calls.find(call => call[0] === 'posts' && call[1] === 'not'), ['posts', 'not', 'room_preview', 'is', null]);
    assert.ok(c.calls.some(call => call[1] === 'range' && call[2] === offset && call[3] === offset + 49));
    assert.ok(c.calls.some(call => call[1] === 'ilike' && call[3] === '%50\\%\\_ \\\\%'));
    assert.ok(c.calls.some(call => call[1] === 'or' && call[2].includes('eventKind.is.null')), 'legacy groups are included');
    assert.equal(c.calls[0][0], 'log_admin_access');
  }
  const denied = client({}, true);
  await assert.rejects(loadAdminMeetups(denied), /ADMIN_REQUIRED/);
  assert.equal(denied.calls.some(call => call[0] === 'from'), false);
  await assert.rejects(loadAdminMeetups(c, undefined, -1), /INVALID_PAGE/);
});

test('meetup status includes ended/full groups and preserves deleted or removed records', () => {
  const { adminMeetupState } = api();
  const post = { status: 'published', deleted_at: null, room_preview: { eventKind: 'once', endsAt: '2026-10-14T00:00:00Z', memberCount: 3, capacity: 3 } };
  assert.equal(adminMeetupState(post, Date.parse('2026-10-13T00:00:00Z')), 'full');
  assert.equal(adminMeetupState(post, Date.parse('2026-10-15T00:00:00Z')), 'ended');
  assert.equal(adminMeetupState({ ...post, status: 'removed' }), 'removed');
  assert.equal(adminMeetupState({ ...post, deleted_at: '2026-10-12T00:00:00Z' }), 'deleted');
});

test('selected meetup applicant history is bounded and retains pending/rejected/cancelled states', async () => {
  const { loadAdminMeetupActivity } = api();
  const c = client({ meetup_requests: { data: [{ id: 'request', requester_id: 'person', message: '신청 사유', status: 'rejected', created_at: '2026-10-13' }], count: 73, error: null } });
  const result = await loadAdminMeetupActivity(c, 'meetup', 'requests', 'rejected', 50);
  assert.equal(result.rows[0].status, 'rejected');
  assert.equal(result.rows[0].user_id, 'person');
  assert.equal(result.total, 73);
  assert.ok(c.calls.some(call => call[1] === 'eq' && call[2] === 'post_id' && call[3] === 'meetup'));
  assert.ok(c.calls.some(call => call[1] === 'eq' && call[2] === 'status' && call[3] === 'rejected'));
  assert.equal(c.calls[0][1].resource_id, 'meetup');
});

test('chat inspection reads only conversation IDs linked to the selected meetup and never falls back to all messages', async () => {
  const { loadAdminMeetupActivity } = api();
  const c = client({ conversations: { data: [{ id: 'room' }], error: null }, messages: { data: [{ id: 'msg', sender_id: 'person', body: 'hello', created_at: '2026-10-13' }], count: 100, error: null } });
  const result = await loadAdminMeetupActivity(c, 'meetup', 'messages');
  assert.equal(result.rows[0].body, 'hello');
  assert.ok(c.calls.some(call => call[0] === 'messages' && call[1] === 'in' && JSON.stringify(call[3]) === '["room"]'));
  const empty = client({ conversations: { data: [], error: null } });
  assert.equal((await loadAdminMeetupActivity(empty, 'meetup', 'messages')).total, 0);
  assert.equal(empty.calls.some(call => call[0] === 'from' && call[1] === 'messages'), false);
  const denied = client({}, true);
  await assert.rejects(loadAdminMeetupActivity(denied, 'meetup', 'messages'), /ADMIN_REQUIRED/);
  assert.equal(denied.calls.some(call => call[0] === 'from'), false);
});
