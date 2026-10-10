import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { appendUniquePosts } from '../src/lib/feed-data.ts';
import { loadMerchantProfile } from '../src/lib/merchant-profile.ts';

const api = await import('../src/lib/merchant-conveniences.ts').catch(() => ({}));
const merchant = '14510000-0000-4000-8000-000000000001';
const conversation = '14520000-0000-4000-8000-000000000001';
const profile = { id: merchant, name: '등록된 비즈니스', city_id: 'vancouver', city_name: '밴쿠버', industry: '카페', services: '커피', address: '123 Main St, Vancouver, BC', avatar_path: null, banner_path: null, review_post_id: null,
  public_phone: '+1 (604) 555-0100', business_hours: '월–금 9:00–18:00', can_message: true, saved: true };
const client = data => ({ calls: [], async rpc(name, args) { this.calls.push([name, args]); return { data, error: null }; } });

test('merchant inquiry resolves a real server conversation UUID and rejects unusable navigation results', async () => {
  assert.equal(typeof api.startMerchantConversation, 'function');
  const db = client(conversation);
  assert.equal(await api.startMerchantConversation(db, merchant), conversation);
  assert.deepEqual(db.calls, [['start_merchant_conversation', { p_merchant_id: merchant }]]);
  for (const data of [null, '../author', { id: conversation }]) await assert.rejects(api.startMerchantConversation(client(data), merchant), /MERCHANT_CONVERSATION_READ_FAILED/);
  await assert.rejects(api.startMerchantConversation(db, '../author'), /INVALID_MERCHANT/);
  assert.equal(db.calls.length, 1);
  await assert.rejects(api.startMerchantConversation({ rpc: async () => ({ error: { message: 'MERCHANT_CONTACT_UNAVAILABLE' } }) }, merchant), /MERCHANT_CONTACT_UNAVAILABLE/);
});

test('save changes accept only the requested server boolean and do not invent a successful save', async () => {
  assert.equal(typeof api.setSavedMerchant, 'function');
  const db = client(true);
  assert.equal(await api.setSavedMerchant(db, merchant, true), true);
  assert.deepEqual(db.calls, [['set_saved_merchant', { p_merchant_id: merchant, p_saved: true }]]);
  assert.equal(await api.setSavedMerchant(client(false), merchant, false), false);
  for (const data of [null, false, 'true']) await assert.rejects(api.setSavedMerchant(client(data), merchant, true), /MERCHANT_SAVE_NOT_VERIFIED/);
  await assert.rejects(api.setSavedMerchant(db, merchant, 'true'), /INVALID_MERCHANT_SAVE/);
  await assert.rejects(api.setSavedMerchant({ rpc: async () => ({ error: { message: 'offline' } }) }, merchant, false), /offline/);
});

test('public phone links emit a fixed tel scheme while rejecting other actions, extensions and malformed numbers', () => {
  assert.equal(typeof api.merchantPhoneUrl, 'function');
  for (const [value, expected] of [['+1 (604) 555-0100', 'tel:+16045550100'], ['604.555.0100', 'tel:6045550100'], ['02-123-4567', 'tel:021234567']]) assert.equal(api.merchantPhoneUrl(value), expected);
  for (const value of ['', '  ', 'tel:6045550100', 'https://shop.test', '+16045550100?x=1', '6045550100#1', '6045550100;ext=4', '6045550100\n', '12', '+1234567890123456', '604＋5550100']) assert.equal(api.merchantPhoneUrl(value), null);
});

test('public profile DTO defaults new fields safely and never includes private owner/contact fields', async () => {
  const loaded = await loadMerchantProfile(client({ ...profile, owner_id: 'PRIVATE_OWNER', contact: 'PRIVATE_CONTACT', public_phone: null, business_hours: null, can_message: 'yes', saved: 'yes' }), merchant);
  assert.equal(loaded.public_phone, ''); assert.equal(loaded.business_hours, '');
  assert.equal(loaded.can_message, false); assert.equal(loaded.saved, false);
  assert.ok(!JSON.stringify(loaded).includes('PRIVATE_'));
});

test('saved businesses preserve the server offset, registered information and safe public source links', async () => {
  assert.equal(typeof api.loadSavedMerchants, 'function');
  const db = client({ merchants: [{ ...profile, owner_id: 'PRIVATE_OWNER', source_urls: ['https://shop.example.com/#about', 'javascript:alert(1)'] }], has_more: true });
  const loaded = await api.loadSavedMerchants(db, 20);
  assert.deepEqual(db.calls, [['get_saved_merchants', { p_offset: 20 }]]);
  assert.equal(loaded.nextOffset, 21); assert.equal(loaded.has_more, true);
  assert.equal(loaded.merchants[0].public_phone, profile.public_phone);
  assert.deepEqual(loaded.merchants[0].links, [{ url: 'https://shop.example.com/', label: 'shop.example.com' }]);
  assert.ok(!JSON.stringify(loaded).includes('PRIVATE_'));
  assert.equal((await api.loadSavedMerchants(client({ merchants: [], has_more: true }))).has_more, false);
  for (const offset of [-1, 0.5, 10001]) await assert.rejects(api.loadSavedMerchants(db, offset), /INVALID_MERCHANT_PAGE/);
  for (const data of [null, { merchants: null, has_more: false }, { merchants: [null], has_more: false }, { merchants: [{ ...profile, id: '../private' }], has_more: false }, { merchants: [profile], has_more: 'yes' }]) await assert.rejects(api.loadSavedMerchants(client(data)), /MERCHANT_SAVED_READ_FAILED/);
});

test('contact writes carry the revision, verify exact saved values and preserve rejected edits', async () => {
  assert.equal(typeof api.saveMerchantContact, 'function');
  const updated = '2026-10-09T18:00:00Z';
  const db = client({ ...profile, updated_at: '2026-10-09T18:01:00Z', can_edit: true, contact: 'PRIVATE_CONTACT' });
  const saved = await api.saveMerchantContact(db, merchant, ` ${profile.public_phone} `, profile.business_hours, updated);
  assert.deepEqual(db.calls, [['save_merchant_contact', { p_merchant_id: merchant, p_public_phone: profile.public_phone, p_business_hours: profile.business_hours, p_expected_updated_at: updated }]]);
  assert.equal(saved.public_phone, profile.public_phone); assert.equal(saved.can_edit, true);
  assert.ok(!JSON.stringify(saved).includes('PRIVATE_'));
  for (const data of [null, { ...profile, updated_at: updated, can_edit: true, public_phone: 'other' }, { ...profile, updated_at: updated }]) await assert.rejects(api.saveMerchantContact(client(data), merchant, profile.public_phone, profile.business_hours, updated), /MERCHANT_CONTACT_SAVE_NOT_VERIFIED/);
  for (const [phone, hours, revision] of [['javascript:alert(1)', '', updated], ['', 'x'.repeat(501), updated], ['', '', '']]) await assert.rejects(api.saveMerchantContact(db, merchant, phone, hours, revision), /INVALID_MERCHANT_CONTACT/);
  assert.equal(db.calls.length, 1);
  await assert.rejects(api.saveMerchantContact({ rpc: async () => ({ error: { message: 'MERCHANT_PROFILE_CHANGED' } }) }, merchant, '', '', updated), /MERCHANT_PROFILE_CHANGED/);
});

const settle = () => new Promise(setImmediate);
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const control = (root, id) => nodes(root).find(node => node.props?.analyticsId === id);
const list = root => nodes(root).find(node => node.type === 'FlatList');
const post = { id: '14530000-0000-4000-8000-000000000001', title: '원래 저장한 글', body: '글 본문', author: { id: 'writer', nickname: '이웃' }, tag: { label: '라이프' }, createdAtLabel: '1시간 전', createdAt: '2026-10-09T19:00:00Z' };

function savedScreen({ posts = async () => [post], rpc = async () => ({ data: { merchants: [profile], has_more: false } }) } = {}) {
  const state = [], cleanup = new Map(), routes = [], calls = [], feedback = [];
  let index = 0, account = 'reader', hidden = () => false, focused = true;
  const react = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot].deps[i])) state[slot] = { fn, deps }; return state[slot].fn; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanup.get(slot)?.(); state[slot] = deps; const end = fn(); if (end) cleanup.set(slot, end); else cleanup.delete(slot); } },
  };
  const imports = {
    react, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { FlatList: 'FlatList', Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useRouter: () => ({ push: value => routes.push(JSON.parse(JSON.stringify(value))) }), useFocusEffect: fn => react.useEffect(() => focused ? fn() : undefined, [fn, focused]) },
    'expo-symbols': { SymbolView: 'Symbol' }, '@/components/analytics-controls': { Pressable: 'Pressable' },
    '@/components/gling-loader': { GlingLoader: 'Loader' }, '@/components/login-panel': { LoginPanel: 'Login' }, '@/components/state-card': { StateCard: 'StateCard' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' },
    '@/constants/theme': { Depth: {}, Spacing: { one: 4, two: 8, three: 12, four: 16, five: 20 } },
    '@/hooks/use-content-visibility': { useContentVisibility: () => hidden }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/i18n/ko': { t: { profile: { savedLoading: '글 읽는 중', savedError: '읽기 실패', savedEmpty: '글 없음' } } },
    '@/lib/auth': { useAuth: () => ({ isAuthed: !!account, isAuthLoading: false, me: { id: account ?? 'guest' } }) },
    '@/lib/community-data': { loadSavedPosts: (...args) => { calls.push(['posts', ...args.slice(1)]); return posts(...args); } },
    '@/lib/merchant-conveniences': api, '@/lib/feed-data': { appendUniquePosts },
    '@/lib/meetup-ai': { visibleMeetupBody: value => value }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
    '@/lib/supabase': { supabase: { rpc: async (name, args) => { calls.push([name, args]); return rpc(name, args); } } },
  };
  const exports = {}, source = ts.transpileModule(readFileSync(new URL('../src/app/profile/saved.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, Error, require: name => imports[name] ?? {} });
  return { routes, calls, feedback, setAccount(value) { account = value; }, hidePost(id) { hidden = (type, target) => type === 'post' && target === id; }, setFocus(value) { focused = value; }, render() { index = 0; return exports.default(); } };
}

test('saved keeps posts as default and opens the actual company profile from its independent selector', async () => {
  const view = savedScreen(); view.render(); await settle(); let root = view.render();
  assert.deepEqual(list(root).props.data.map(row => row.id), [post.id]);
  list(root).props.renderItem({ item: post }).props.onPress(); assert.deepEqual(view.routes, [`/post/${post.id}`]);
  assert.ok(control(root, 'saved.tab.merchants'), 'saved has a businesses selector');
  control(root, 'saved.tab.merchants').props.onPress(); view.render(); await settle(); root = view.render();
  assert.deepEqual(list(root).props.data.map(row => row.id), [merchant]);
  list(root).props.renderItem({ item: list(root).props.data[0] }).props.onPress();
  assert.deepEqual(view.routes.at(-1), { pathname: '/company/[id]', params: { id: merchant } });
  assert.ok(view.feedback.includes('selection'));
});

test('saved company pagination suppresses duplicate reads, preserves failed-page rows and retries the raw offset', async () => {
  let finish, fail, attempts = 0;
  const second = { ...profile, id: '14510000-0000-4000-8000-000000000002', name: '다음 비즈니스' };
  const view = savedScreen({ rpc: async (_, args) => !args.p_offset ? { data: { merchants: [profile], has_more: true } } : (++attempts, new Promise((resolve, reject) => { finish = resolve; fail = reject; })) });
  view.render(); await settle(); let root = view.render();
  assert.ok(control(root, 'saved.tab.merchants'));
  control(root, 'saved.tab.merchants').props.onPress(); view.render(); await settle(); root = view.render();
  const more = control(root, 'saved.more'); assert.ok(more);
  more.props.onPress(); more.props.onPress(); assert.equal(attempts, 1);
  fail(new Error('offline')); await settle(); root = view.render();
  assert.deepEqual(list(root).props.data.map(row => row.id), [merchant]);
  control(root, 'saved.retry').props.onPress(); assert.equal(view.calls.at(-1)[1].p_offset, 1);
  finish({ data: { merchants: [profile, second], has_more: false } }); await settle(); root = view.render();
  assert.deepEqual(Array.from(list(root).props.data, row => row.id), [merchant, second.id]);
  assert.equal(control(root, 'saved.more'), undefined);
});

test('account changes and lost focus prevent old saved reads from overwriting the current list or its loading state', async () => {
  const pending = [];
  const view = savedScreen({ posts: () => new Promise(resolve => pending.push(resolve)) });
  view.render(); view.setAccount('other'); view.render();
  pending[0]([post]); await settle(); let root = view.render();
  assert.equal(list(root).props.data.length, 0); assert.equal(list(root).props.refreshing, true);
  pending[1]([]); await settle(); root = view.render();
  assert.equal(list(root).props.refreshing, false); assert.equal(list(root).props.data.length, 0);
  view.setFocus(false); view.render(); view.setFocus(true); view.render(); view.setFocus(false); view.render();
  pending[2]([post]); await settle(); assert.equal(list(view.render()).props.data.length, 0);
});

test('saved rechecks business visibility and server saved state on focus while hidden posts disappear immediately', async () => {
  let available = true;
  const view = savedScreen({ rpc: async () => ({ data: { merchants: available ? [profile] : [], has_more: false } }) });
  view.render(); await settle(); let root = view.render();
  view.hidePost(post.id); root = view.render(); assert.equal(list(root).props.data.length, 0);
  assert.ok(control(root, 'saved.tab.merchants'));
  control(root, 'saved.tab.merchants').props.onPress(); view.render(); await settle(); root = view.render();
  assert.equal(list(root).props.data.length, 1);
  view.setFocus(false); view.render(); available = false; view.setFocus(true); view.render(); await settle(); root = view.render();
  assert.equal(list(root).props.data.length, 0);
  assert.equal(list(root).props.ListEmptyComponent.props.children.props.kind, 'empty');
});

test('guest saved uses the existing login panel and makes no authenticated reads', async () => {
  const view = savedScreen(); view.setAccount(null); const root = view.render(); await settle();
  assert.equal(root.type, 'Login'); assert.equal(view.calls.length, 0);
});

test('saved post pagination uses the last raw post cursor and preserves existing post detail navigation', async () => {
  const first = Array.from({ length: 30 }, (_, index) => ({ ...post, id: `post-${index}`, createdAt: `2026-10-09T18:00:${String(index).padStart(2, '0')}Z` }));
  const next = { ...post, id: 'older-post', createdAt: '2026-10-08T12:00:00Z' };
  const view = savedScreen({ posts: async (_, cursor) => cursor ? [first[0], next] : first });
  view.render(); await settle(); let root = view.render();
  assert.ok(control(root, 'saved.more'));
  control(root, 'saved.more').props.onPress(); await settle(); root = view.render();
  assert.deepEqual(JSON.parse(JSON.stringify(view.calls.at(-1))), ['posts', { createdAt: '2026-10-09T18:00:29Z', id: 'post-29' }]);
  assert.equal(list(root).props.data.length, 31);
  list(root).props.renderItem({ item: next }).props.onPress(); assert.deepEqual(view.routes, ['/post/older-post']);
  assert.equal(control(root, 'saved.more'), undefined);
});

test('a failed saved-list refresh retains its loaded posts and gives a retry instead of an empty success state', async () => {
  let available = true;
  const view = savedScreen({ posts: async () => { if (!available) throw new Error('offline'); return [post]; } });
  view.render(); await settle(); let root = view.render();
  available = false; list(root).props.onRefresh(); view.render(); await settle(); root = view.render();
  assert.equal(list(root).props.data.length, 1); assert.ok(control(root, 'saved.retry'));
  available = true; control(root, 'saved.retry').props.onPress(); view.render(); await settle(); root = view.render();
  assert.equal(control(root, 'saved.retry'), undefined); assert.equal(list(root).props.data.length, 1);
});

 test('saved-business opt-in requires a valid boolean and exact server readback', async () => {
  assert.equal(typeof api.setSavedMerchantNotifications, 'function');
  const db = client(true);
  assert.equal(await api.setSavedMerchantNotifications(db, merchant, true), true);
  assert.deepEqual(db.calls, [['set_saved_merchant_notifications', { p_merchant_id: merchant, p_enabled: true }]]);
  assert.equal(await api.setSavedMerchantNotifications(client(false), merchant, false), false);
  for (const data of [false, null, 'true']) await assert.rejects(api.setSavedMerchantNotifications(client(data), merchant, true), /MERCHANT_NOTIFICATIONS_NOT_VERIFIED/);
  await assert.rejects(api.setSavedMerchantNotifications(db, '../private', true), /INVALID_MERCHANT_NOTIFICATIONS/);
  await assert.rejects(api.setSavedMerchantNotifications(db, merchant, 'true'), /INVALID_MERCHANT_NOTIFICATIONS/);
  await assert.rejects(api.setSavedMerchantNotifications({ rpc: async () => ({ error: { message: 'NOT_SAVED' } }) }, merchant, true), /NOT_SAVED/);
  assert.equal((await loadMerchantProfile(client(profile), merchant)).notifications_enabled, false);
  assert.equal((await loadMerchantProfile(client({ ...profile, notifications_enabled: true }), merchant)).notifications_enabled, true);
 });
