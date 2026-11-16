import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { englishNotificationBody, notificationRoute } from '../src/lib/notification-preferences.ts';
import { uiEnglish } from '../src/i18n/ui-en.ts';

// Server wording lives in 20261116150000_meetup_request_expiry.sql and 20261116150100_meetup_waiting.sql.
test('unanswered-request and waiting notifications have English copy and a valid destination', () => {
  for (const [kind, body] of [
    ['meetup_request', 'Mina님의 참여 신청이 이틀째 답을 기다려요. 한번 확인해 주세요.'],
    ['meetup_changed', '「Seawall walk」 신청이 답을 받지 못한 채 일주일이 지나 닫혔어요. 열려 있는 다른 모임을 둘러보세요.'],
    ['meetup_changed', '기다리던 모임이 열렸어요. Concert together'],
  ]) assert.doesNotMatch(englishNotificationBody({ kind, body }), /[가-힣]{2}/, body);
  assert.equal(notificationRoute('/meetups'), '/meetups');
  assert.equal(notificationRoute('/meetups?x=1'), null);
});

test('the new strings are translated and every request status has a label', () => {
  for (const key of ['열리면 알려 주세요', '알림 받는 중 · 취소하기', '아직 열린 모임이 없어요', '모임이 열리면 알림으로 알려 드려요.', '답 없이 닫힘',
    '지도에 뜬 모임이 아직 없어요. 장소를 붙여 모임을 열면 여기 보여요.']) assert.ok(uiEnglish[key], key);
  for (const file of ['src/app/meetup-application.tsx', 'src/components/chilling-host-profile.tsx', 'src/app/meetup-join.tsx']) assert.match(readFileSync(file, 'utf8'), /expired/, file);
});

test('waiting card sits on the event and place screens, and the empty map line only shows once meetups were read', () => {
  assert.match(readFileSync('src/app/events/[id].tsx', 'utf8'), /<MeetupWaiting kind="event"/);
  assert.match(readFileSync('src/app/places/[id].tsx', 'utf8'), /<MeetupWaiting kind="place"/);
  assert.match(readFileSync('src/app/map.tsx', 'utf8'), /meetupsOnly && !meetupMarkersPending\(meetupMarkers\) && meetupMarkers\.length === 0/);
});
