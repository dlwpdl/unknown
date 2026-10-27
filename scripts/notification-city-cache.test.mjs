import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const displayedRows = tree => (nodes(tree).find(node => node.type === 'FlatList')?.props.data ?? []).filter(entry => entry.type === 'item').map(entry => entry.item.lead);
const firstItem = list => list.props.data.find(entry => entry.type === 'item');
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function cityCache(file, { holdList = false, holdActors = false } = {}) {
  const slots = [], pending = [], channels = [], appListeners = new Set(), settingListeners = new Set();
  let cursor = 0, offline = false, focused = true, everFocused = false, isAuthed = true, isAdmin = false, authLoading = false, pathname = '/feed', foreground = 'active', legacyFocus, legacyCleanup;
  const me = { id: 'member', cityId: 'vancouver' };
  let rows = [{ id: 'vancouver-notice', kind: 'comment', category: 'replies', body: 'Vancouver discovery', actor_id: null, read_at: '2026-10-13', created_at: '2026-10-13' }];
  const requests = [], actorReads = [], listReads = [], actorRequests = [], marked = [], routes = [], events = [];
  const effect = (fn, deps, layout = false) => {
    const i = cursor++, previous = slots[i];
    if (previous && deps.every((value, n) => Object.is(value, previous.deps[n]))) return;
    const value = slots[i] = { deps, cleanup: previous?.cleanup };
    const run = () => { if (slots[i] !== value) return; value.cleanup?.(); value.cleanup = fn(); };
    if (layout) run(); else pending.push(run);
  };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, n) => !Object.is(value, slots[i].deps[n]))) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); }, useId: () => 'city-counter',
    useEffect: (fn, deps) => effect(fn, deps), useLayoutEffect: (fn, deps) => effect(fn, deps, true),
  };
  const client = { channel(name) {
    const channel = { name, active: true, events: [], on(_kind, filter, callback) { this.events.push({ filter, callback }); return this; }, subscribe(callback) { this.status = callback; callback?.('SUBSCRIBED'); return this; } }; channels.push(channel); return channel;
  }, removeChannel: async channel => { channel.active = false; } };
  const native = { View: 'View', Platform: { OS: 'web' }, StyleSheet: { create: value => value },
    AppState: { get currentState() { return foreground; }, addEventListener: (_name, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
    DeviceEventEmitter: { addListener: (_name, callback) => { settingListeners.add(callback); return { remove: () => settingListeners.delete(callback) }; } } };
  const data = {
    loadNotifications: () => { const snapshot = [...rows]; if (holdList) return new Promise(resolve => listReads.push(() => resolve(snapshot))); listReads.push(null); return offline ? Promise.reject(Error('OFFLINE')) : Promise.resolve(snapshot); },
    loadNotificationSnippets: async () => new Map(),
    loadNotificationActors: async (_client, ids) => { actorReads.push([...ids]); return holdActors ? new Promise(resolve => actorRequests.push(resolve)) : new Map(); },
    markNotificationsRead: async (_client, ids) => { marked.push([...ids]); },
    loadUnreadNotificationCount: () => new Promise(resolve => requests.push(resolve)),
  };
  const cache = new Map();
  const resolve = withLanguageImports(name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'expo-router') return { useRouter: () => ({ push: value => routes.push(value), navigate: value => routes.push(value) }), usePathname: () => pathname, useIsFocused: () => focused, useFocusEffect: fn => { legacyFocus = fn; } };
    if (name === 'react-native') return native;
    if (name === 'react-native-reanimated') return { useReducedMotion: () => true };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed, isAuthLoading: authLoading, isAdmin, me }) };
    if (name === '@/lib/community-data') return data;
    if (name === '@/lib/supabase') return { supabase: client };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Depth: {}, MaxContentWidth: {}, Spacing: {}, TabBarHeight: 60 };
    if (name === '@/lib/notification-preferences') return { NOTIFICATION_CATEGORIES: [], NOTIFICATION_PREFERENCES_CHANGED: 'preferences', englishNotificationBody: item => item.body, loadAdminDashboardOrigin: async () => null,
      openNotificationTarget: ({ route, navigate }) => { if (route) navigate(route); return !!route; } };
    if (name === '@/lib/notification-inbox') return load('lib/notification-inbox.ts');
    if (name === '@/lib/mock') return { CITIES: [] };
    if (name === '@/lib/product-analytics') return { recordProductEvent: async (_client, event) => { events.push(event); } };
    if (name === '@/lib/feed-data') return { relativeTime: () => '' };
    if (name === '@/lib/notification-refresh') return load('lib/notification-refresh.ts');
    return new Proxy({}, { get: (_target, key) => String(key) });
  });
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: resolve }); return exports;
  }
  const exports = load(file);
  const ui = {
    me, requests, actorReads, listReads, actorRequests, marked, routes, channels, events,
    render(scope) { cursor = 0; return file.startsWith('hooks/') ? exports.useUnreadCount(scope) : exports.default(); },
    commit() { while (pending.length) pending.splice(0).forEach(run => run()); },
    async focus() { if (legacyFocus) { legacyCleanup?.(); legacyCleanup = legacyFocus(); } else { if (everFocused) { focused = false; ui.render(); ui.commit(); } focused = true; ui.render(); ui.commit(); everFocused = true; } await settle(); },
    blur() { focused = false; ui.render(); },
    insert() { for (const channel of channels) if (channel.active) for (const { filter, callback } of channel.events) if (filter.event === '*' || filter.event === 'INSERT') callback({ eventType: 'INSERT' }); },
    navigate(value) { pathname = value; }, account(value) { isAuthed = value !== null; me.id = value ?? 'guest'; }, admin(value) { isAdmin = value; }, restoring(value) { authLoading = value; },
    background(value) { foreground = value; appListeners.forEach(callback => callback(value)); },
    offline(value) { offline = value; }, rows(value) { rows = value; },
    dispose() { legacyCleanup?.(); for (const value of slots) value?.cleanup?.(); },
  };
  return ui;
}

test('meetup notifications do not look up the linked community name or avatar', async () => {
  const ui = cityCache('app/(tabs)/notifications.tsx');
  ui.rows([{ id: 'meetup-notice', kind: 'meetup_request', category: 'meetups', body: '모임 신청', actor_id: 'private-account', read_at: '2026-10-13', created_at: '2026-10-13' }]);
  ui.render(); await ui.focus();
  assert.ok(ui.actorReads.length > 0);
  assert.equal(ui.actorReads.flat().includes('private-account'), false);
  ui.dispose();
});

test('city changes hide a cached discovery immediately and an offline refresh cannot restore it', async () => {
  const ui = cityCache('app/(tabs)/notifications.tsx');
  ui.render(); await ui.focus();
  assert.equal(displayedRows(ui.render())[0].id, 'vancouver-notice');
  ui.me.cityId = 'toronto'; ui.offline(true);
  assert.equal(displayedRows(ui.render()).length, 0);
  await ui.focus();
  assert.equal(displayedRows(ui.render()).length, 0);
  ui.offline(false); ui.rows([{ id: 'toronto-notice', kind: 'comment', category: 'replies', body: 'Toronto discovery', actor_id: null, read_at: '2026-10-13', created_at: '2026-10-13' }]);
  await ui.focus();
  assert.equal(displayedRows(ui.render())[0].id, 'toronto-notice');
  ui.dispose();
});

test('discovery badges refresh for the saved city and ignore a previous city response', async () => {
  const ui = cityCache('hooks/use-unread-count.ts');
  ui.render('other'); ui.commit(); await settle(); ui.requests[0](8); await settle();
  assert.equal(ui.render('other'), 8);
  ui.me.cityId = 'toronto';
  assert.equal(ui.render('other'), 0);
  ui.commit(); await settle(); ui.requests[1](2); await settle();
  assert.equal(ui.render('other'), 2);
  ui.me.cityId = 'montreal'; ui.render('other'); ui.commit(); await settle();
  ui.me.cityId = 'calgary'; ui.render('other'); ui.commit(); await settle();
  ui.requests[2](9); await settle(); assert.equal(ui.render('other'), 0);
  ui.requests[3](1); await settle(); assert.equal(ui.render('other'), 1);
  ui.dispose();
});

test('a city change preserves cached personal chat counts', async () => {
  const ui = cityCache('hooks/use-unread-count.ts');
  ui.render('chat'); ui.commit(); await settle(); ui.requests[0](5); await settle();
  assert.equal(ui.render('chat'), 5);
  ui.me.cityId = 'toronto'; assert.equal(ui.render('chat'), 5); ui.commit();
  assert.equal(ui.requests.length, 1);
  ui.dispose();
});

test('a burst during the initial inbox read queues one trailing refresh without duplicate actor or mark reads', async () => {
  const ui = cityCache('app/(tabs)/notifications.tsx', { holdList: true });
  ui.rows([{ id: 'new', kind: 'comment', category: 'comments', body: 'Synthetic notification', actor_id: 'actor', read_at: null, created_at: '2026-10-23' }]);
  ui.render(); await ui.focus();
  for (let i = 0; i < 10; i++) ui.insert();
  assert.equal(ui.listReads.length, 1);
  ui.listReads[0](); await settle(); assert.equal(ui.listReads.length, 2);
  ui.listReads[1](); await settle(); assert.equal(ui.listReads.length, 2);
  assert.equal(ui.actorReads.length, 2); assert.equal(ui.marked.length, 2);
  ui.dispose();
});

for (const change of ['account', 'city', 'blur', 'restoring']) {
  const transition = ui => {
    if (change === 'account') ui.account('next-account');
    if (change === 'city') ui.me.cityId = 'toronto';
    if (change === 'blur') ui.blur();
    if (change === 'restoring') ui.restoring(true);
    ui.render();
  };
  test(`an inbox response after ${change} cannot read actors or mark notifications before passive cleanup`, async () => {
    const ui = cityCache('app/(tabs)/notifications.tsx', { holdList: true });
    ui.rows([{ id: 'private', kind: 'comment', category: 'comments', body: 'Synthetic private notification', actor_id: 'private-actor', read_at: null, created_at: '2026-10-23' }]);
    ui.render(); await ui.focus();
    transition(ui); ui.listReads[0](); await settle();
    assert.equal(ui.actorReads.length, 0); assert.equal(ui.marked.length, 0);
    ui.dispose();
  });
  test(`a retained inbox action after ${change} cannot navigate or record an open`, async () => {
    const ui = cityCache('app/(tabs)/notifications.tsx');
    ui.render(); await ui.focus();
    const list = nodes(ui.render()).find(node => node.type === 'FlatList');
    const item = list.props.renderItem({ item: firstItem(list) });
    const retained = nodes(item).find(node => node.props?.analyticsId === 'app_tabs_notifications.pressable.2').props.onPress;
    transition(ui); retained(); await settle();
    assert.equal(ui.routes.length, 0); assert.equal(ui.events.length, 0);
    ui.dispose();
  });
}

test('inbox focus and city refreshes reuse one subscription and hidden events perform no reads', async () => {
  const ui = cityCache('app/(tabs)/notifications.tsx');
  ui.render(); await ui.focus();
  assert.equal(ui.listReads.length, 1); assert.equal(ui.channels.length, 1);
  await ui.focus(); assert.equal(ui.listReads.length, 2); assert.equal(ui.channels.length, 1);
  ui.me.cityId = 'toronto'; ui.render(); ui.commit(); await settle();
  assert.equal(ui.listReads.length, 3); assert.equal(ui.channels.length, 1);
  ui.blur(); ui.commit(); ui.insert(); ui.background('active'); await settle();
  assert.equal(ui.listReads.length, 3);
  await ui.focus(); assert.equal(ui.listReads.length, 4); assert.equal(ui.channels.length, 1);
  ui.dispose(); assert.equal(ui.channels[0].active, false);
});

test('navigation refreshes the badge without resubscribing and logout cancels queued work before passive cleanup', async () => {
  const ui = cityCache('hooks/use-unread-count.ts');
  ui.render('other'); ui.commit(); await settle(); ui.requests[0](125); await settle();
  assert.equal(ui.render('other'), 125, 'badge uses the full server count, not the capped inbox rows');
  ui.navigate('/profile'); ui.render('other'); ui.commit(); await settle();
  assert.equal(ui.requests.length, 2); assert.equal(ui.channels.length, 1);
  ui.insert(); ui.account(null); assert.equal(ui.render('other'), 0);
  ui.requests[1](99); await settle();
  assert.equal(ui.requests.length, 2); assert.equal(ui.channels[0].active, false);
  ui.dispose();
});

test('late actor photos cannot cross an account boundary and a current row still opens normally', async () => {
  const ui = cityCache('app/(tabs)/notifications.tsx', { holdActors: true });
  const notification = { id: 'old', kind: 'comment', category: 'comments', body: 'Synthetic comment', actor_id: 'actor', read_at: '2026-10-23', created_at: '2026-10-23', route: '/post?id=public' };
  ui.rows([notification]); ui.render(); await ui.focus();
  ui.account('next-account'); ui.rows([{ ...notification, id: 'current' }]); ui.render(); ui.commit(); await settle();
  ui.actorRequests[0](new Map([['actor', { nickname: 'Previous account actor', avatarUrl: 'private-old-avatar' }]])); await settle();
  const list = nodes(ui.render()).find(node => node.type === 'FlatList');
  const item = list.props.renderItem({ item: firstItem(list) });
  assert.equal(nodes(item).some(node => node.props?.source?.uri === 'private-old-avatar'), false);
  nodes(item).find(node => node.props?.analyticsId === 'app_tabs_notifications.pressable.2').props.onPress();
  await settle(); assert.deepEqual(ui.routes, ['/post?id=public']); assert.equal(ui.events.length, 1);
  ui.dispose();
});
