import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageTime, chatDateLabel, chatListTime, showChatMessageTime, loadChatMembers, firstUnreadMessageIndex, meetupChatIcon } from '../src/lib/chat-details.ts';

test('meetup chat art follows the topic, with specific titles ahead of broad categories', () => {
  assert.equal(meetupChatIcon('festival', '여름 페스티벌'), 'disco-ball');
  assert.equal(meetupChatIcon('party', '클럽 나이트'), 'disco-ball');
  assert.equal(meetupChatIcon('sports', '같이 운동해요'), 'sports-shoe');
  assert.equal(meetupChatIcon('casual', '퇴근하고 노을 보러 가요'), 'sunset');
  assert.equal(meetupChatIcon('hobby', '주말 영화 한 편'), 'popcorn');
  assert.equal(meetupChatIcon('casual', '맥주 한잔해요'), 'beer');
  assert.equal(meetupChatIcon('hobby', '작은 라이브 공연'), 'microphone');
  assert.equal(meetupChatIcon(null, '가볍게 만나요'), 'ticket');
});

test('unread start skips my messages and starts at the first newer peer message', () => {
  const rows = [
    { sender_id: 'friend', created_at: '2026-09-26T10:00:00Z' },
    { sender_id: 'me', created_at: '2026-09-26T10:01:00Z' },
    { sender_id: 'friend', created_at: '2026-09-26T10:02:00Z' },
    { sender_id: 'friend', created_at: '2026-09-26T10:03:00Z' },
  ];
  assert.equal(firstUnreadMessageIndex(rows, '2026-09-26T10:00:00Z', 'me'), 2);
  assert.equal(firstUnreadMessageIndex(rows, '2026-09-26T10:03:00Z', 'me'), -1);
  assert.equal(firstUnreadMessageIndex(rows, null, 'me'), 0);
});

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
  assert.equal(chatListTime('2026-09-17T15:42:00', now), '오후 3:42', 'today shows the clock time');
  assert.equal(chatListTime('2026-09-15T09:05:00', now), '9월 15일', 'older messages show the date');
  assert.equal(chatListTime('not-a-date', now), '', 'invalid timestamps render nothing');
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
