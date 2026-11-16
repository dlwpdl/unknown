import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { englishNotificationBody } from '../src/lib/notification-copy.ts';
import { inboxTab } from '../src/lib/notification-inbox.ts';
import { loadNotificationPreferences, NOTIFICATION_SETTING_GROUPS, notificationRoute, settingRowShown } from '../src/lib/notification-preferences.ts';

const sql = readFileSync(new URL('../supabase/migrations/20261114030000_friend_save_and_weekend_alerts.sql', import.meta.url), 'utf8');
const en = (kind, body) => englishNotificationBody({ kind, body });
const row = id => NOTIFICATION_SETTING_GROUPS.flatMap(group => group.rows).find(item => item.id === id);

test('server copy and its English stay in step', () => {
  assert.match(sql, /nickname\|\|'님이 ‘'\|\|place\|\|'’ 저장했어요\.'/);
  assert.match(sql, /nickname\|\|'님이 장소 '\|\|total\|\|'곳을 저장했어요\.'/);
  assert.match(sql, /'이번 주말 갈 만한 곳 골라 뒀어요\. '\|\|array_to_string\(names,', '\)/);
  assert.equal(en('friend_saved_place', '하늘님이 ‘Old Library’ 저장했어요.'), '하늘 saved “Old Library”.');
  assert.equal(en('friend_saved_place', 'Sam님이 장소 3곳을 저장했어요.'), 'Sam saved 3 places.');
  assert.equal(en('weekend_picks', '이번 주말 갈 만한 곳 골라 뒀어요. Harbour Lights Festival, Sunset Beach'), 'A few picks for this weekend: Harbour Lights Festival, Sunset Beach');
  // The first-week meetup nudge is a different alert with its own copy.
  assert.equal(en('trending_meetup', '이번 주말엔 처음 오는 분 반기는 모임이 두 곳 있어요.'), 'Two meetups this weekend welcome first-timers.');
  assert.equal(en('weekend_picks', '이번 주말엔 처음 오는 분 반기는 모임이 두 곳 있어요.'), '이번 주말엔 처음 오는 분 반기는 모임이 두 곳 있어요.');
});

test('both alerts open screens every app version already knows', () => {
  for (const route of ['/places/osm:node:830003?cityId=vancouver', '/user/e5200000-0000-4000-8000-000000000001', '/events/wsa-fest?cityId=vancouver'])
    assert.equal(notificationRoute(route), route);
});

test('the two settings rows stay hidden until the server says the switch is on', async () => {
  const friends = row('friend_saves'), weekend = row('weekend_picks');
  assert.deepEqual([friends.keys, weekend.keys], [['friend_saves'], ['weekend_picks']]);
  assert.equal(settingRowShown({ switched_on: [] }, friends), false);
  assert.equal(settingRowShown({ switched_on: ['friend_saves'] }, friends), true);
  assert.equal(settingRowShown({ switched_on: ['friend_saves'] }, weekend), false);
  assert.equal(settingRowShown({ switched_on: [] }, row('replies')), true, 'ordinary rows always show');
  const older = await loadNotificationPreferences({ rpc: async () => ({ data: { replies: true } }) });
  assert.deepEqual(older.switched_on, [], 'a server without the switches hides both');
  const odd = await loadNotificationPreferences({ rpc: async () => ({ data: { switched_on: ['weekend_picks', 3, null] } }) });
  assert.deepEqual(odd.switched_on, ['weekend_picks']);
});

test('Friday picks sit with the city news; friend saves with my own alerts', () => {
  assert.equal(inboxTab({ kind: 'weekend_picks', category: 'weekend_picks' }), 'city');
  assert.equal(inboxTab({ kind: 'friend_saved_place', category: 'friend_saves' }), 'mine');
});

test('notification tune: the two new rows are server-gated, the requests row is not, and the new kinds sit in the city tab', () => {
  assert.deepEqual([row('new_posts').keys, row('bubble_alerts').keys, row('direct_requests').keys], [['new_posts'], ['bubble_alerts'], ['direct_requests']]);
  assert.equal(settingRowShown({ switched_on: [] }, row('new_posts')), false);
  assert.equal(settingRowShown({ switched_on: ['bubble_alerts'] }, row('bubble_alerts')), true);
  assert.equal(settingRowShown({ switched_on: [] }, row('direct_requests')), true);
  assert.equal(inboxTab({ kind: 'city_new_posts', category: 'new_posts' }), 'city');
  assert.equal(inboxTab({ kind: 'live_bubble_nearby', category: 'bubble_alerts' }), 'city');
  assert.equal(notificationRoute('/'), '/');
  assert.equal(notificationRoute('/discover'), '/discover');
});

test('notification tune: new Korean bodies read as the contract English, old bodies keep theirs', () => {
  const cases = [
    ['message', '민지님이 메시지를 보냈어요.', '민지 sent you a message.'],
    ['meetup_request', 'Sam님이 주말 등산 모임에 같이 가고 싶대요.', 'Sam wants to join “주말 등산”.'],
    ['interest_post', '#러닝에 새 글이 올라왔어요. ‘아침 러닝 같이 해요’', 'New post in #러닝: “아침 러닝 같이 해요”'],
    ['nearby_meetup', '밴쿠버에 새 모임이 생겼어요. ‘보드게임 밤’', 'New meetup in 밴쿠버: “보드게임 밤”'],
    ['saved_merchant_post', '카페 모모에 새 소식이 올라왔어요.', '카페 모모 posted an update.'],
    ['trending_hashtag', '요즘 #밴쿠버맛집 글이 많이 올라와요.', '#밴쿠버맛집 is getting a lot of posts lately.'],
    ['meetup_review_request', '보드게임 밤 모임 잘 다녀왔어요? 같이 간 분들 후기 남겨 주세요.', 'How was “보드게임 밤”? Leave a review for the people you went with.'],
    ['meetup_cancelled', '보드게임 밤 모임이 취소됐어요.', '“보드게임 밤” was cancelled.'],
    ['meetup_cancelled', '보드게임 밤 모임 모집이 끝났어요.', 'Sign-ups for “보드게임 밤” are closed.'],
    ['weekly_ranking', '이번 주 밴쿠버에서 제일 많이 읽은 글이에요. ‘겨울 맛집’', 'This week’s most-read post in 밴쿠버: “겨울 맛집”'],
    ['meetup_approved', '보드게임 밤 모임에 같이 가게 됐어요. 채팅방에 인사 한마디 남겨 보세요.', 'You’re going to “보드게임 밤”. Say hello in the group chat.'],
    ['merchant_review_received', '카페 모모에 새 후기가 올라왔어요.', '카페 모모 got a new review.'],
    ['live_bubble_accepted', '민지님이 대화 신청을 수락했어요. 지금 말 걸어 보세요.', '민지 accepted your chat request. You can chat now.'],
    ['city_new_posts', '‘겨울 맛집’ 말고도 5개 더 올라왔어요.', '“겨울 맛집” and 5 more.'],
    ['live_bubble_nearby', '지금 키츠에 말풍선이 떴어요. ‘누구 산책해요’', 'A bubble just popped up in 키츠: “누구 산책해요”'],
    ['city_places', '11월 15일, 토론토에서 무용 공연이 열려요.', 'There’s a dance performance at 토론토 on Nov 15.'],
    // Rows stored before the tune keep their old English.
    ['meetup_cancelled', 'Board games 모임이 마감되거나 취소됐어요. 모임 글에서 확인해 주세요.', '“Board games” was closed or cancelled. Check the meetup post for details.'],
    ['live_bubble_accepted', '민지님이 대화 신청을 받았어요. 지금 이야기해 보세요.', '민지 accepted your chat request. Say hi now.'],
  ];
  for (const [kind, body, want] of cases) assert.equal(en(kind, body), want, `${kind}: ${body}`);
  assert.equal(notificationRoute('/notifications', { kind: 'trending_hashtag', body: '요즘 #밴쿠버 글이 많이 올라와요.' }), '/?hashtag=' + encodeURIComponent('밴쿠버'));
});
