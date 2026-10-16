import assert from 'node:assert/strict';
import test from 'node:test';
import { chatMessageTime, chatDateLabel, chatListTime, showChatMessageTime, loadChatMembers, firstUnreadMessageIndex, meetupChatIcon } from '../src/lib/chat-details.ts';
import * as details from '../src/lib/chat-details.ts';

test('message action menus follow the bubble and remain inside the visible conversation', () => {
  assert.equal(typeof details.messageMenuPosition, 'function');
  const bounds = { x: 0, y: 110, width: 390, height: 530 }, menu = { width: 216, height: 48 };
  assert.deepEqual(details.messageMenuPosition({ x: 210, y: 300, width: 164, height: 40 }, menu, bounds, true), { left: 158, top: 244 });
  assert.deepEqual(details.messageMenuPosition({ x: 48, y: 300, width: 160, height: 40 }, menu, bounds, false), { left: 48, top: 244 });
  assert.deepEqual(details.messageMenuPosition({ x: 42, y: 114, width: 150, height: 28 }, menu, bounds, false), { left: 42, top: 150 }, 'first visible message opens below rather than covering the header');
  for (const width of [320, 390, 768, 1440]) for (const mine of [false, true]) for (const height of [250, 530]) {
    const area = { x: 160, y: 110, width, height }, large = { width: 292, height: 60 };
    for (const y of [112, 230, 110 + height - 10]) {
      const result = details.messageMenuPosition({ x: 160 + width - 60, y, width: 52, height: 42 }, large, area, mine);
      assert.ok(result.left >= area.x + 8 && result.left + large.width <= area.x + area.width - 8);
      assert.ok(result.top >= area.y + 8 && result.top + large.height <= area.y + area.height - 8);
    }
  }
});

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


test('chat dates and times follow an explicit selected locale and keep local-day boundaries', () => {
  const now = new Date(2026, 8, 17, 12, 5);
  assert.equal(chatDateLabel('2026-09-17T00:01:00', undefined, now, 'en-CA'), 'Today');
  assert.equal(chatDateLabel('2026-09-16T23:59:00', undefined, now, 'en-CA'), 'Yesterday');
  assert.equal(chatListTime('2026-09-15T09:05:00', now, 'en-CA'), new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date('2026-09-15T09:05:00')));
  assert.equal(chatMessageTime('2026-09-17T15:42:00', 'en-CA'), new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date('2026-09-17T15:42:00')));
  assert.equal(chatDateLabel('2025-09-15T23:59:00', undefined, now, 'en-CA'), new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date('2025-09-15T23:59:00')));
  assert.equal(chatDateLabel('2026-09-15T23:59:00', '2026-09-15T01:00:00', now, 'en-CA'), null);
  assert.equal(chatListTime('2026-09-15T09:05:00', now, 'ko-KR'), '9월 15일');
  assert.equal(chatListTime('not-a-date', now, 'en-CA'), '');
});
