import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConversations, loadConversationMessages, loadConversationMessagesByIds, mergeChatMessages } from '../src/lib/community-data.ts';

const row = { id: 'room-1', other_user_id: 'person-2', other_nickname: '이웃', other_verification_level: 2,
  latest_body: '안녕하세요', latest_at: '2026-09-12T10:00:00Z', kind: 'direct', status: 'active',
  requester_id: 'person-2', group_post_id: null, title: '이웃', is_group_host: false };

test('inbox loads one bounded page and preserves server count and off-page deep link', async () => {
  let calls = 0;
  const client = { async rpc(name, args) {
    calls++;
    assert.equal(name, 'get_conversation_inbox');
    assert.equal(args.p_filter, 'direct');
    assert.equal(args.p_limit, 30);
    assert.equal(args.p_conversation_id, 'old-room');
    return { error: null, data: { items: [row], pending_count: 503,
      cursor: { status: 'ended', createdAt: '2026-01-01T00:00:00Z', id: 'cursor-room' },
      selected: { ...row, id: 'old-room', status: 'ended' } } };
  }};
  const page = await loadConversations(client, 'person-1', 'direct', null, 'old-room');
  assert.equal(calls, 1);
  assert.equal(page.conversations[0].otherUser.nickname, '이웃');
  assert.equal(page.pendingCount, 503);
  assert.equal(page.selectedConversation.id, 'old-room');
  assert.equal(page.cursor.id, 'cursor-room');
});

test('inbox cursor carries status and equal-time ID; errors do not become an empty inbox', async () => {
  const cursor = { status: 'ended', createdAt: '2026-01-01T00:00:00Z', id: 'cursor-room' };
  const client = { async rpc(name, args) {
    assert.equal(args.p_before_status, 'ended');
    assert.equal(args.p_before_created, cursor.createdAt);
    assert.equal(args.p_before_id, cursor.id);
    return { error: new Error('offline'), data: null };
  }};
  await assert.rejects(loadConversations(client, 'person-1', 'all', cursor), /offline/);
});

test('live message lookup fetches only unique requested IDs and skips empty batches', async () => {
  let reads = 0;
  const client = { from(table) {
    assert.equal(table, 'messages'); reads++;
    return { select() { return this; }, eq(key, value) { assert.equal(key, 'conversation_id'); assert.equal(value, 'room-1'); return this; },
      async in(key, ids) { assert.equal(key, 'id'); assert.deepEqual(ids, ['m1', 'm2']);
        return { error: null, data: [{ id: 'm1', conversation_id: 'room-1', sender_id: 'person-2', body: 'hi', created_at: '2026-09-12T10:00:00Z', sender: { nickname: '이웃' } }] }; } };
  }};
  assert.deepEqual(await loadConversationMessagesByIds(client, 'room-1', []), []);
  const result = await loadConversationMessagesByIds(client, 'room-1', ['m1', 'm2', 'm1']);
  assert.equal(reads, 1);
  assert.equal(result[0].sender_nickname, '이웃');
});

test('message merge keeps older history, replaces overlaps and excludes blocked senders', () => {
  const old = { id: 'a', created_at: '2026-09-12T10:00:00Z', sender_id: 'one', body: 'old' };
  const next = { id: 'b', created_at: old.created_at, sender_id: 'two', body: 'next' };
  const merged = mergeChatMessages([old, next], [{ ...old, body: 'updated' }, { id: 'c', created_at: old.created_at, sender_id: 'blocked' }], new Set(['blocked']));
  assert.deepEqual(merged.map(({ id, body }) => [id, body]), [['a', 'updated'], ['b', 'next']]);
  assert.equal(old.body, 'old');
});

test('older message pages include the ID tie-breaker so same-time messages are not skipped', async () => {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; }, order(key, options) { calls.push(['order', key, options]); return this; },
    limit() { return this; }, or(value) { calls.push(['or', value]); return this; }, then(resolve) { resolve({data:[],error:null}); } };
  await loadConversationMessages({ from: () => query }, 'room-1', { createdAt: '2026-09-12T10:00:00Z', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  assert.deepEqual(calls.filter(([kind]) => kind === 'order').map(([, key]) => key), ['created_at', 'id']);
  assert.equal(calls.find(([kind]) => kind === 'or')[1], 'created_at.lt.2026-09-12T10:00:00Z,and(created_at.eq.2026-09-12T10:00:00Z,id.lt.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)');
});
