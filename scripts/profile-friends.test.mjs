import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMerchantSaves, parseProfileOverview, savedPlaceCities, setFriendship } from '../src/lib/profile-friends.ts';
import { saveMerchantIntro } from '../src/lib/merchant-conveniences.ts';
import { mapMerchantProfile } from '../src/lib/merchant-profile.ts';
import { notificationRoute } from '../src/lib/notification-preferences.ts';
import { englishNotificationBody } from '../src/lib/notification-copy.ts';

const user = 'e5100000-0000-4000-8000-000000000002';
const merchant = 'e5110000-0000-4000-8000-000000000001';
const overview = { userId: user, own: false, savedCount: 2, savedWeekStreak: 3, meetupCount: 1, friendCount: 4, friendship: 'friends', canRequestFriend: false,
  savedPlaces: [{ cityId: 'vancouver', placeKey: 'osm:node:1', merchantId: null }, { cityId: 'toronto', placeKey: 'partner:shop', merchantId: merchant }],
  mapHiddenReason: null, sharesSavedPlaces: null };

test('profile overview keeps a hidden map hidden and rejects malformed rows', () => {
  assert.deepEqual(parseProfileOverview(overview).savedPlaces[1], { cityId: 'toronto', placeKey: 'partner:shop', merchantId: merchant });
  const hidden = parseProfileOverview({ ...overview, friendship: 'none', savedPlaces: null, mapHiddenReason: 'not_friends' });
  assert.equal(hidden.savedPlaces, null);
  assert.equal(hidden.mapHiddenReason, 'not_friends');
  assert.equal(parseProfileOverview(null), null);
  for (const bad of [{ ...overview, savedCount: -1 }, { ...overview, friendship: 'maybe' }, { ...overview, mapHiddenReason: 'secret' },
    { ...overview, savedPlaces: [{ cityId: 'vancouver', placeKey: '123 Main St', merchantId: null }] }]) assert.throws(() => parseProfileOverview(bad), /INVALID_PROFILE_RESPONSE/);
});

test('city chips put the most saved city first with a stable order', () => {
  const pins = ['toronto', 'vancouver', 'montreal', 'vancouver'].map((cityId, index) => ({ cityId, placeKey: `osm:node:${index + 1}`, merchantId: null }));
  assert.deepEqual(savedPlaceCities(pins), [{ cityId: 'vancouver', count: 2 }, { cityId: 'montreal', count: 1 }, { cityId: 'toronto', count: 1 }]);
  assert.deepEqual(savedPlaceCities([]), []);
});

test('friend actions call the server once and surface its refusal', async () => {
  const calls = [];
  const client = data => ({ rpc: async (name, args) => { calls.push([name, args]); return data instanceof Error ? { error: { message: data.message } } : { data, error: null }; } });
  assert.deepEqual(await setFriendship(client({ friendship: 'outgoing', canRequestFriend: false, friendCount: 0 }), user, 'request'),
    { friendship: 'outgoing', canRequestFriend: false, friendCount: 0 });
  assert.deepEqual(calls, [['set_friendship', { p_user_id: user, p_action: 'request' }]]);
  await assert.rejects(setFriendship(client(new Error('FRIEND_UNAVAILABLE')), user, 'request'), /FRIEND_UNAVAILABLE/);
  assert.equal(await loadMerchantSaves({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }, merchant), null);
});

test('the business intro is trimmed, checked before sending and verified after saving', async () => {
  const updated = '2026-11-04T03:00:00.000Z';
  const row = { id: merchant, name: 'Cafe', city_id: 'vancouver', city_name: 'Vancouver', industry: '', services: '', address: '', avatar_path: null, banner_path: null,
    review_post_id: null, updated_at: updated, can_edit: true, intro_vibe: '조용해요', intro_order: '라테', intro_tip: '' };
  const calls = [];
  const saved = await saveMerchantIntro({ rpc: async (name, args) => { calls.push([name, args]); return { data: row, error: null }; } }, merchant, { vibe: ' 조용해요 ', order: '라테', tip: '' }, updated);
  assert.equal(saved.intro_vibe, '조용해요');
  assert.deepEqual(calls[0][1], { p_merchant_id: merchant, p_vibe: '조용해요', p_order: '라테', p_tip: '', p_expected_updated_at: updated });
  const never = { rpc: async () => assert.fail('invalid intro reached the server') };
  for (const intro of [{ vibe: '가'.repeat(161), order: '', tip: '' }, { vibe: '', order: 'www.example.com', tip: '' }, { vibe: '', order: '', tip: '줄\n바꿈' }])
    await assert.rejects(saveMerchantIntro(never, merchant, intro, updated), /INVALID_MERCHANT_INTRO/);
  await assert.rejects(saveMerchantIntro({ rpc: async () => ({ data: { ...row, intro_vibe: 'other' }, error: null }) }, merchant, { vibe: '조용해요', order: '라테', tip: '' }, updated),
    /MERCHANT_INTRO_SAVE_NOT_VERIFIED/);
  assert.equal(mapMerchantProfile({ ...row, intro_tip: 7 }).intro_tip, '', 'a missing or odd intro line shows as empty');
});

test('friend alerts open the person and read naturally in English', () => {
  assert.equal(notificationRoute(`/user/${user}`), `/user/${user}`);
  assert.equal(notificationRoute(`/user/${user}?x=1`), null);
  assert.equal(englishNotificationBody({ kind: 'friend_request', body: '하늘님이 친구 요청을 보냈어요.' }), '하늘 sent you a friend request.');
  assert.equal(englishNotificationBody({ kind: 'friend_accepted', body: '하늘님과 친구가 됐어요.' }), 'You and 하늘 are now friends.');
});
