import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageTime, chatDateLabel, showChatMessageTime, loadChatMembers } from '../src/lib/chat-details.ts';

test('only the last consecutive same-sender message in a minute shows its time', () => {
  const first = { sender_id: 'one', created_at: '2026-09-17T15:42:01' };
  assert.equal(showChatMessageTime(first, { ...first, created_at: '2026-09-17T15:42:59' }), false);
  assert.equal(showChatMessageTime(first, { ...first, sender_id: 'two' }), true);
  assert.equal(showChatMessageTime(first, { ...first, created_at: '2026-09-17T15:43:00' }), true);
  assert.equal(showChatMessageTime(first), true);
  assert.equal(chatMessageTime(first.created_at), '오후 3:42');
});

test('date separators use local calendar dates, including year and midnight boundaries', () => {
  const now = new Date(2026, 8, 17, 0, 5);
  assert.equal(chatDateLabel('2026-09-17T00:01:00', undefined, now), '오늘');
  assert.equal(chatDateLabel('2026-09-17T00:02:00', '2026-09-17T00:01:00', now), null);
  assert.equal(chatDateLabel('2026-09-16T23:59:00', undefined, now), '어제');
  assert.equal(chatDateLabel('2026-09-15T23:59:00', undefined, now), '9월 15일');
  assert.equal(chatDateLabel('2025-09-15T23:59:00', undefined, now), '2025년 9월 15일');
  assert.equal(chatDateLabel('invalid', undefined, now), null);
});

test('members keep identities when optional avatar signing fails, and RPC failures propagate', async () => {
  const client = { rpc: async () => ({ data: [{ id: 'one', nickname: '이웃', avatar_path: 'one/a.jpg', is_host: true }], error: null }),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: null, error: new Error('offline') }) }) } };
  const rows = await loadChatMembers(client, 'room');
  assert.equal(rows[0].nickname, '이웃');
  assert.equal(rows[0].avatarUrl, undefined);
  await assert.rejects(loadChatMembers({ rpc: async () => ({ error: new Error('FORBIDDEN') }) }, 'room'), /FORBIDDEN/);
});
