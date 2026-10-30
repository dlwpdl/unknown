import assert from 'node:assert/strict';
import test from 'node:test';
import { englishNotificationBody } from '../src/lib/notification-preferences.ts';
import { badgeLabels, loyaltyError, tierAtLeast } from '../src/lib/meetup-loyalty.ts';
import { uiEnglish } from '../src/i18n/ui-en.ts';

const en = body => englishNotificationBody({ kind: 'meetup_changed', body }, text => text);

test('host loyalty server bodies render English, encore before follower', () => {
  assert.equal(en('민수님이 새 모임을 열었어요. 토요일 아침 러닝'), '민수 just opened a new meetup: 토요일 아침 러닝');
  assert.equal(en('또 열어 달라고 했던 민수님이 새 모임을 열었어요. 토요일 아침 러닝'), 'You asked 민수 to host again, and they just did: 토요일 아침 러닝');
  assert.equal(en('「러닝」 공지: 내일은\n7시에 만나요'), 'Note from the host of “러닝”: 내일은\n7시에 만나요');
  assert.equal(en('「러닝」 다음 모임 날짜가 잡혔어요. 11/07 19:30 (모임 현지 시간)'), 'The next “러닝” is set for Nov 7 at 7:30 p.m. (local time).');
  assert.match(en('「러닝」 체크인을 맡게 됐어요. 모임 시간에 참석 확인 화면에서 체크인할 수 있어요.'), /^You’re on check-in for “러닝”/);
  assert.equal(en('Board games 모임의 시간이나 장소가 바뀌었어요. 바뀐 내용을 확인해 주세요.'), 'The time or place for “Board games” changed. Check the updated details.');
});

test('badges show the highest level of each kind, hosting first, all translated', () => {
  assert.deepEqual(badgeLabels(undefined), []);
  assert.deepEqual(badgeLabels({ attended: 0, hosted: 0 }), []);
  assert.deepEqual(badgeLabels({ attended: 10, hosted: 1 }), ['첫 모임 호스트', '모임 10번 참석']);
  for (const level of [1, 5, 10, 25]) for (const label of badgeLabels({ attended: level, hosted: level })) assert.ok(uiEnglish[label], label);
});

test('tiers and server error codes', () => {
  assert.equal(tierAtLeast(undefined, 'plus'), false);
  assert.equal(tierAtLeast('plus', 'pro'), false);
  assert.equal(tierAtLeast('premium', 'pro'), true);
  assert.equal(loyaltyError(new Error('ANNOUNCEMENT_DAILY_LIMIT')), '공지는 하루에 3번까지 보낼 수 있어요.');
  assert.equal(loyaltyError(new Error('boom'), '실패'), '실패');
});
