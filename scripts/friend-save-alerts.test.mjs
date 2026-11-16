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
