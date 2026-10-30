import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { meetupLabels, newcomerDaysLeft, newcomerLocked } from '../src/lib/newcomer.ts';
import { meetupBarAction } from '../src/lib/chilling.ts';
import { englishNotificationBody } from '../src/lib/notification-copy.ts';

const now = Date.parse('2026-10-29T12:00:00Z');
const hoursAgo = hours => new Date(now - hours * 3600000).toISOString();

test('"새 모임" lasts 48 hours; newcomer-only replaces the first-timer label', () => {
  const room = { id: 'r', title: 't', memberCount: 1, verifiedOnly: false };
  assert.deepEqual(meetupLabels({ createdAt: hoursAgo(47.9), room }, now), ['new']);
  assert.deepEqual(meetupLabels({ createdAt: hoursAgo(48), room }, now), []);
  assert.deepEqual(meetupLabels({ createdAt: hoursAgo(1), room: { ...room, newcomerWelcome: true } }, now), ['new', 'welcome']);
  assert.deepEqual(meetupLabels({ createdAt: hoursAgo(100), room: { ...room, newcomerWelcome: true, newcomerOnly: true } }, now), ['newcomersOnly']);
  assert.deepEqual(meetupLabels({ createdAt: undefined, room }, now), [], 'a missing date never claims "new"');
  assert.deepEqual(meetupLabels({ createdAt: hoursAgo(1) }, now), [], 'non-meetups have no labels');
});

test('newcomer days left count today and stop at zero', () => {
  assert.equal(newcomerDaysLeft({ newcomer: true, endsAt: new Date(now + 52 * 86400000 - 1000).toISOString() }, now), 52);
  assert.equal(newcomerDaysLeft({ newcomer: true, endsAt: new Date(now + 3600000).toISOString() }, now), 1);
  assert.equal(newcomerDaysLeft({ newcomer: false, endsAt: null }, now), 0);
});

test('newcomer-only meetups swap the apply button for a note unless I am a newcomer', () => {
  assert.equal(newcomerLocked({ newcomerOnly: true }, { newcomer: false }), true);
  assert.equal(newcomerLocked({ newcomerOnly: true }, { newcomer: true }), false);
  assert.equal(newcomerLocked({ newcomerOnly: false }, { newcomer: false }), false);
  const bar = state => meetupBarAction({ own: false, participating: false, loading: false, availability: 'open', ...state });
  assert.deepEqual(bar({ newcomerLocked: true }), { action: 'locked', label: '새 멤버만 신청할 수 있는 모임이에요', disabled: true, busy: false });
  assert.equal(bar({ newcomerLocked: true, participating: true }).action, 'status', 'an existing request stays reachable');
  assert.equal(bar({ newcomerLocked: true, own: true }).action, 'review');
  assert.equal(bar({ newcomerLocked: true, availability: 'full' }).label, '정원 마감');
});

test('first-week nudge copy has natural English and old trending meetups still fall back', () => {
  const en = body => englishNotificationBody({ kind: 'trending_meetup', body });
  assert.equal(en('가입 축하해요. 처음 가기 편한 모임부터 모아 뒀어요.'), 'You’re in. We saved the easiest meetups to start with.');
  assert.equal(en('이번 주 모임이 올라왔어요. 토요일 아침 걷기, 아직 자리 있어요.'), 'This week’s meetups are up. “토요일 아침 걷기” still has room.');
  assert.equal(en('이번 주말엔 처음 오는 분 반기는 모임이 한 곳 있어요.'), 'One meetup this weekend welcomes first-timers.');
  assert.equal(en('이번 주말엔 처음 오는 분 반기는 모임이 두 곳 있어요.'), 'Two meetups this weekend welcome first-timers.');
  assert.equal(en('이번 주말엔 처음 오는 분 반기는 모임이 7곳 있어요.'), '7 meetups this weekend welcome first-timers.');
  assert.equal(en('벌써 일주일이네요. 다음 주 모임도 열렸어요.'), 'One week in already. Next week’s meetups are open.');
  assert.equal(en('첫 모임 어땠어요? 다음 주에도 같은 호스트 모임이 있어요.'), 'How was your first meetup? The same host has one next week too.');
  assert.equal(en('요즘 뜨는 모임 · 보드게임'), '요즘 뜨는 모임 · 보드게임');
});

test('the server copy and the English patterns stay in step', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261029090000_newcomer_welcome.sql', import.meta.url), 'utf8');
  for (const body of ['가입 축하해요. 처음 가기 편한 모임부터 모아 뒀어요.', '이번 주 모임이 올라왔어요. ', ', 아직 자리 있어요.', '이번 주말엔 처음 오는 분 반기는 모임이 ',
    '벌써 일주일이네요. 다음 주 모임도 열렸어요.', '첫 모임 어땠어요? 다음 주에도 같은 호스트 모임이 있어요.']) assert.ok(sql.includes(body), body);
  // The newcomer-only gate is a trigger on meetup_requests, so every request RPC (old apps included) is covered.
  assert.match(sql, /create trigger meetup_requests_newcomers_only before insert or update of status on public\.meetup_requests/);
  assert.doesNotMatch(sql, /alter table public\.posts|drop function|create or replace function public\.(create_chilling_event|request_chilling_join)/, 'additive only');
});
