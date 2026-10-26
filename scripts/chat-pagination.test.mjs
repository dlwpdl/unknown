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

test('group previews use the saved meetup category and keep showing when metadata is unavailable', async () => {
  const group = { ...row, id: 'group-1', kind: 'group', group_post_id: 'post-1', title: '주말 모임' };
  const client = { rpc: async () => ({ error: null, data: { items: [group], selected: group, pending_count: 0, cursor: null } }),
    from(table) { assert.equal(table, 'posts'); return { select() { return this; }, async in(key, ids) {
      assert.equal(key, 'id'); assert.deepEqual(ids, ['post-1']);
      return { data: [{ id: 'post-1', room_preview: { category: 'sports' } }], error: null };
    } }; } };
  const page = await loadConversations(client, 'person-1');
  assert.equal(page.conversations[0].meetupCategory, 'sports');
  assert.equal(page.selectedConversation.meetupCategory, 'sports');
  const offline = await loadConversations({ ...client, from() { throw new Error('offline'); } }, 'person-1');
  assert.equal(offline.conversations[0].meetupCategory, null);
});

test('a host-ended meetup room reads as ended, and an ended member deep link opens it read-only', async () => {
  const group = { ...row, id: 'group-1', kind: 'group', group_post_id: 'post-1', title: '주말 모임', is_group_host: true };
  const posts = { 'post-1': { title: '주말 모임', author_id: 'host', room_preview: { closed: true, category: 'sports' } }, 'post-2': { title: '열린 모임', author_id: 'host', room_preview: {} } };
  const rooms = { 'ended-room': { id: 'ended-room', group_post_id: 'post-1', created_at: '2026-10-01T00:00:00Z' }, 'open-room': { id: 'open-room', group_post_id: 'post-2', created_at: '2026-10-01T00:00:00Z' } };
  const client = { rpc: async (_name, args) => ({ error: null, data: { items: [group], selected: args.p_conversation_id === 'group-1' ? group : null, pending_count: 0, cursor: null } }),
    from(table) {
      const filters = {};
      return { select() { return this; }, eq(key, value) { filters[key] = value; return this; },
        async in() { return { data: [{ id: 'post-1', room_preview: posts['post-1'].room_preview }], error: null }; },
        async maybeSingle() { return { error: null, data: table === 'conversations' ? (filters.kind === 'group' ? rooms[filters.id] ?? null : null) : posts[filters.id] ?? null }; } };
    } };
  const host = await loadConversations(client, 'host', 'all', null, 'group-1');
  assert.equal(host.conversations[0].status, 'ended');
  assert.equal(host.selectedConversation.status, 'ended');
  const member = await loadConversations(client, 'member', 'all', null, 'ended-room', null);
  assert.deepEqual({ ...member.selectedConversation, latestAt: undefined }, { id: 'ended-room', kind: 'group', status: 'ended', requesterId: null, groupPostId: 'post-1', meetupCategory: 'sports',
    title: '주말 모임', isGroupHost: false, otherUser: { id: 'host', nickname: '', verificationLevel: 0 }, latestBody: null, latestAt: undefined });
  assert.equal((await loadConversations(client, 'member', 'all', null, 'open-room')).selectedConversation, null, 'an open meetup the inbox omits is not forced open');
  assert.equal((await loadConversations({ ...client, from() { throw new Error('offline'); } }, 'member', 'all', null, 'ended-room')).selectedConversation, null);
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

test('private signing covers every album image in order and preserves unavailable slots and legacy photos', async () => {
  const signed = [];
  const rows = [
    { id: 'album', kind: 'image', image_path: 'one', image_paths: ['one', 'two', 'three'], sender: null },
    { id: 'old', kind: 'image', image_path: 'legacy', sender: null },
    { id: 'deleted', kind: 'text', deleted_at: 'now', image_path: null, image_paths: [], sender: null },
  ];
  const client = { from: () => ({ select() { return this; }, eq() { return this; }, in: async () => ({ data: rows }) }),
    storage: { from: () => ({ createSignedUrls: async paths => {
      signed.push(...paths); return { data: paths.filter(path => path !== 'two').map(path => ({ path, signedUrl: `signed:${path}` })) };
    } }) } };
  const messages = await loadConversationMessagesByIds(client, 'room-1', rows.map(row => row.id));
  assert.deepEqual(signed, ['one', 'two', 'three', 'legacy']);
  assert.deepEqual(messages[0].imageUrls, ['signed:one', undefined, 'signed:three']);
  assert.equal(messages[1].imageUrl, 'signed:legacy');
  assert.deepEqual(messages[1].imageUrls, ['signed:legacy']);
  assert.deepEqual(messages[2].imageUrls, []);
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
