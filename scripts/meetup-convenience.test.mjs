import assert from 'node:assert/strict';
import test from 'node:test';
import { pickMeetupPlaces, functionErrorCode, MEETUP_TITLE_MAX } from '../src/lib/meetup-convenience.ts';
import { englishNotificationBody } from '../src/lib/notification-copy.ts';

const place = (id, category, extra = {}) => ({ id, cityId: 'vancouver', name: id, category, latitude: 0, longitude: 0, address: '', sourceUrl: '', ...extra });

test('venue suggestions prefer words from the title, then the meetup category, then operator picks', () => {
  const places = [place('food-a', 'food'), place('cafe-a', 'cafe'), place('cafe-pick', 'cafe', { recommendation: { placeId: 'cafe-pick', reason: '조용한 창가', sourceUrl: '', verifiedAt: '' } }),
    place('park', 'places'), place('보드게임 카페', 'places'), place('cafe-a', 'cafe')];
  assert.deepEqual(pickMeetupPlaces(places, 'casual', '').map(p => p.id), ['cafe-pick', 'cafe-a', 'food-a']);
  assert.equal(pickMeetupPlaces(places, 'casual', '퇴근 후 보드게임')[0].id, '보드게임 카페');
  assert.equal(pickMeetupPlaces(places, 'sports', '').length, 3);
  assert.equal(new Set(pickMeetupPlaces(places, 'casual', '', 10).map(p => p.id)).size, 5, 'duplicates removed');
  assert.equal(MEETUP_TITLE_MAX, 30);
});

test('edge function error codes are read without throwing', async () => {
  assert.equal(await functionErrorCode({ context: Response.json({ error: { code: 'PLUS_REQUIRED' } }) }), 'PLUS_REQUIRED');
  assert.equal(await functionErrorCode({ context: new Response('nope') }), null);
  assert.equal(await functionErrorCode(new Error('x')), null);
});

test('new server notification bodies have English copy', () => {
  for (const [kind, body] of [['meetup_request', '기다리던 모임에 자리가 났어요. 3시간 안에 신청하면 바로 함께할 수 있어요.'], ['meetup_request', '자동 승인 조건에 맞는 신청이라 바로 승인됐어요.'],
    ['meetup_request', '대기하던 분이 시간 안에 신청해서 바로 승인됐어요.'], ['meetup_request', '기다리던 모임에 자리가 났어요. 지금 신청하면 호스트가 확인해요.'],
    ['meetup_host_tip', "Board games 모임에 아직 신청이 없어요. 날짜를 바꾸거나 '처음 와도 돼요'를 켜 보세요."], ['meetup_host_tip', 'Walk 모임에 아직 신청이 없어요. 날짜를 바꿔 보는 건 어때요?']]) {
    assert.doesNotMatch(englishNotificationBody({ kind, body }), /[가-힣]{3}/, body);
  }
  assert.match(englishNotificationBody({ kind: 'meetup_request', body: '기다리던 모임에 자리가 났어요. 1시간 안에 신청하면 바로 함께할 수 있어요.' }), /within 1 hour /);
});
