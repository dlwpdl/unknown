import assert from 'node:assert/strict';
import test from 'node:test';
import { friendErrorMessage, loadCityPlaceSaves, loadFriendSavedPlaces, loadMapScope, loadMerchantSaves, loadPlaceSaves, parseFriendSavedPlaces, parseProfileOverview, savedPlaceCities, setFriendship } from '../src/lib/profile-friends.ts';
import { saveMerchantIntro } from '../src/lib/merchant-conveniences.ts';
import { mapMerchantProfile } from '../src/lib/merchant-profile.ts';
import { notificationRoute } from '../src/lib/notification-preferences.ts';
import { englishNotificationBody } from '../src/lib/notification-copy.ts';

const user = 'e5100000-0000-4000-8000-000000000002';
const merchant = 'e5110000-0000-4000-8000-000000000001';
const overview = { userId: user, own: false, savedCount: 2, savedWeekStreak: 3, meetupCount: 1, friendCount: 4, friendship: 'friends',
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
  assert.deepEqual(await setFriendship(client({ friendship: 'outgoing', friendCount: 0 }), user, 'request'), { friendship: 'outgoing', friendCount: 0 });
  assert.deepEqual(calls, [['set_friendship', { p_user_id: user, p_action: 'request' }]]);
  await assert.rejects(setFriendship(client(new Error('FRIEND_UNAVAILABLE')), user, 'request'), /FRIEND_UNAVAILABLE/);
  assert.equal(friendErrorMessage(new Error('FRIEND_UNAVAILABLE')), '지금은 친구를 맺을 수 없어요.', 'operated, blocked and reported pairs all read the same');
  assert.equal(await loadMerchantSaves({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }, merchant), null);
});

test('city place saves: totals by place key; an older server is null, other failures throw and bad data is refused', async () => {
  const calls = [];
  const client = (data, error = null) => ({ rpc: async (name, args) => { calls.push([name, args]); return { data, error }; } });
  const saves = await loadCityPlaceSaves(client([{ placeKey: 'osm:node:1', saverCount: 7, status: null }, { placeKey: 'partner:cafe-1', saverCount: 1, status: null }]), 'vancouver');
  assert.deepEqual(calls, [['get_city_place_saves', { p_city_id: 'vancouver' }]]);
  assert.equal(saves.get('osm:node:1').saverCount, 7);
  assert.equal(saves.get('partner:cafe-1').saverCount, 1);
  assert.equal(saves.size, 2);
  const states = await loadCityPlaceSaves(client([{ placeKey: 'osm:node:1', saverCount: 3, status: 'trending' }, { placeKey: 'osm:node:2', saverCount: 10, status: 'popular' }, { placeKey: 'osm:node:3', saverCount: 1, status: 'someday' }, { placeKey: 'osm:node:4', saverCount: 1 }]), 'vancouver');
  assert.deepEqual(['osm:node:1', 'osm:node:2', 'osm:node:3', 'osm:node:4'].map(key => states.get(key).status), ['trending', 'popular', null, null], 'a status this app does not know shows nothing');
  assert.equal((await loadCityPlaceSaves(client([]), 'vancouver')).size, 0);
  assert.equal(await loadCityPlaceSaves(client(null, { code: 'PGRST202' }), 'vancouver'), null, 'an older server shows nothing');
  await assert.rejects(loadCityPlaceSaves(client(null, { code: '57014', message: 'timeout' }), 'vancouver'));
  for (const bad of [null, {}, [{ placeKey: 'nope', saverCount: 1 }], [{ placeKey: 'osm:node:1', saverCount: -1 }], [{ placeKey: 'osm:node:1', saverCount: '3' }], [null], Array(2001).fill({ placeKey: 'osm:node:1', saverCount: 1 })])
    await assert.rejects(loadCityPlaceSaves(client(bad), 'vancouver'), /INVALID_PROFILE_RESPONSE/);
});

test('place saves: keys only for similar places, friends checked like a business', async () => {
  const calls = [];
  const data = { placeKey: 'osm:node:1', saverCount: 7, weekCount: 2, firstIsMe: false, friends: [{ id: user.toUpperCase(), nickname: '민지', savedAt: '2026-11-04T03:00:00Z', first: true }],
    similar: [{ placeKey: 'osm:way:9', saverCount: 5, weekCount: 1 }] };
  const client = value => ({ rpc: async (name, args) => { calls.push([name, args]); return { data: value, error: null }; } });
  const saves = await loadPlaceSaves(client(data), 'vancouver', 'osm:node:1');
  assert.deepEqual(calls, [['get_place_saves', { p_city_id: 'vancouver', p_place_key: 'osm:node:1' }]]);
  assert.deepEqual(JSON.parse(JSON.stringify(saves)), { saverCount: 7, weekCount: 2, firstIsMe: false, friends: [{ id: user, nickname: '민지', savedAt: '2026-11-04T03:00:00Z', first: true }], similar: [{ placeKey: 'osm:way:9', saverCount: 5, weekCount: 1 }] });
  assert.equal(await loadPlaceSaves(client(null), 'vancouver', 'osm:node:1'), null);
  assert.equal(await loadPlaceSaves({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) }, 'vancouver', 'osm:node:1'), null, 'an older server shows nothing');
  for (const bad of [{ ...data, weekCount: -1 }, { ...data, similar: [{ placeKey: 'javascript:1', saverCount: 1, weekCount: 0 }] }, { ...data, similar: Array(6).fill(data.similar[0]) }, { ...data, friends: [{ id: 'x', nickname: 'a', savedAt: 'now' }] }, { ...data, firstIsMe: null }, { ...data, friends: [{ ...data.friends[0], first: 'yes' }] }])
    await assert.rejects(loadPlaceSaves(client(bad), 'vancouver', 'osm:node:1'), /INVALID_PROFILE_RESPONSE/);
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

test('friends\' saved places keep only well-formed places and photos from the friend\'s own folder', async () => {
  const friend = 'e5150000-0000-4000-8000-000000000002';
  const data = { friendCount: 2, places: [{ placeKey: 'osm:node:1', friendCount: 3, friends: [{ id: friend, nickname: '하늘', avatarPath: `${friend}/a.jpg` }] }] };
  const signed = [];
  const client = { rpc: async (name, args) => { assert.deepEqual([name, args], ['get_friend_saved_places', { p_city_id: 'vancouver' }]); return { data, error: null }; },
    storage: { from: bucket => ({ createSignedUrls: async paths => { signed.push([bucket, paths]); return { data: paths.map(path => ({ path, signedUrl: `https://x/${path}` })) }; } }) } };
  const result = await loadFriendSavedPlaces(client, 'vancouver');
  assert.equal(result.friendCount, 2);
  assert.equal(result.places[0].friends[0].avatarUrl, `https://x/${friend}/a.jpg`);
  assert.deepEqual(signed, [['avatars', [`${friend}/a.jpg`]]]);
  for (const bad of [{ ...data, places: [{ ...data.places[0], placeKey: '123 Main St' }] },
    { ...data, places: [{ ...data.places[0], friends: [{ id: friend, nickname: '하늘', avatarPath: 'someone-else/a.jpg' }] }] },
    { ...data, places: [{ ...data.places[0], friendCount: 0 }] }, { ...data, places: [{ ...data.places[0], friends: [] }] }, { places: [] }])
    assert.throws(() => parseFriendSavedPlaces(bad), /INVALID_PROFILE_RESPONSE/);
  const offline = { ...client, storage: { from: () => ({ createSignedUrls: async () => { throw new Error('offline'); } }) } };
  assert.equal((await loadFriendSavedPlaces(offline, 'vancouver')).places[0].friends[0].avatarUrl, undefined, 'a photo that cannot load falls back to the initial');
  await assert.rejects(loadFriendSavedPlaces({ rpc: async () => assert.fail('a bad city reached the server') }, 'Not a city'), /INVALID_PROFILE_RESPONSE/);
});

test('the map scope uses my own profile pins in this city, or friends\' places with the friend count', async () => {
  const mine = await loadMapScope({ rpc: async name => { assert.equal(name, 'get_profile_overview'); return { data: { ...overview, own: true }, error: null }; } }, 'mine', 'vancouver', user);
  assert.deepEqual([...mine.places], [['osm:node:1', null]], 'the Toronto pin stays in Toronto');
  assert.equal(mine.friendCount, null);
  const friends = await loadMapScope({ rpc: async () => ({ data: { friendCount: 0, places: [] }, error: null }) }, 'friends', 'vancouver', user);
  assert.equal(friends.friendCount, 0);
  assert.equal(friends.places.size, 0);
});

// The one-time sheet before a first friend request or accept (owner 2026-11-04), run through the real hook.
async function shareNotice({ shares = true, failHide = false } = {}) {
  const { readFileSync } = await import('node:fs'), vm = (await import('node:vm')).default, ts = (await import('typescript')).default;
  const { tr } = await import('../src/i18n/index.ts');
  const state = [], storage = new Map(), hidden = [], feedback = [], overviewReads = [];
  let index = 0;
  const slot = initial => { const at = index++; if (!(at in state)) state[at] = typeof initial === 'function' ? initial() : initial; return at; };
  const imports = {
    react: { useState: initial => { const at = slot(initial); return [state[at], next => { state[at] = typeof next === 'function' ? next(state[at]) : next; }]; }, useRef: value => state[slot(() => ({ current: value }))], useMemo: fn => fn(), useEffect() {} },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } } },
    '@/hooks/use-language': { useLanguage: () => ({ tr }) }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/auth': { useAuth: () => ({ me: { id: 'member' } }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/profile-friends': { loadProfileOverview: async (_client, id) => { overviewReads.push(id); return { sharesSavedPlaces: shares }; },
      setProfileSharing: async (_client, value) => { if (failHide) throw new Error('offline'); hidden.push(value); return value; } },
    '@/constants/design-system': { ControlStyles: {}, controlPresentation: () => ({ container: {}, text: {} }) },
    'react-native': { StyleSheet: { create: value => value }, View: 'View', Alert: {} }, '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/drag-sheet': { DragSheet: 'DragSheet' }, '@/components/themed-text': { ThemedText: 'Text' },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/profile-overview.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name] ?? new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : String(key) }) });
  const render = () => { index = 0; return exports.useFriendShareNotice(); };
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
  const press = async id => { walk(render().sheet).find(node => node.props?.analyticsId === `friend.notice.${id}`).props.onPress(); await new Promise(setImmediate); };
  return { render, press, storage, hidden, feedback, overviewReads, walk };
}

test('the friend sharing notice shows once while sharing is on, and 숨기고 계속 turns sharing off before going on', async () => {
  const notice = await shareNotice();
  let runs = 0;
  await notice.render().confirm(() => { runs++; });
  assert.equal(runs, 0, 'the request waits for an answer');
  assert.equal(notice.render().sheet.props.visible, true);
  assert.match(notice.walk(notice.render().sheet).map(node => typeof node.props?.children === 'string' ? node.props.children : '').join(' '), /저장해 둔 구해요·팔아요 글과 프로필은 안 보이고/);
  await notice.press('hide');
  assert.deepEqual(notice.hidden, [false]);
  assert.equal(runs, 1);
  assert.equal(notice.render().sheet.props.visible, false);
  assert.equal(notice.storage.get('gling.friend-share-notice.v1:member'), '1');
  await notice.render().confirm(() => { runs++; });
  assert.equal(runs, 2, 'the second request goes straight through');
  assert.deepEqual(notice.overviewReads, ['member']);
  assert.deepEqual(notice.feedback, ['selection']);

  const kept = await shareNotice();
  await kept.render().confirm(() => { runs++; });
  await kept.press('continue');
  assert.deepEqual(kept.hidden, [], '그대로 계속 leaves sharing on');
  assert.equal(runs, 3);

  const off = await shareNotice({ shares: false });
  await off.render().confirm(() => { runs++; });
  assert.equal(runs, 4, 'a member who already hid saved places is not asked');
  assert.equal(off.render().sheet.props.visible, false);

  const failing = await shareNotice({ failHide: true });
  await failing.render().confirm(() => { runs++; });
  await failing.press('hide');
  assert.equal(runs, 4, 'a failed switch does not send the request');
  assert.equal(failing.render().sheet.props.visible, true);
  assert.deepEqual(failing.feedback, ['selection', 'warning']);
  assert.equal(failing.storage.size, 0);
});
