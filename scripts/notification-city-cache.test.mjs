import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function cityCache(file) {
  const state = [], refs = [], effects = [];
  let cursor = 0, refCursor = 0, pendingEffect, focus, cleanup, previousDeps, offline = false;
  const me = { id: 'member', cityId: 'vancouver' };
  let rows = [{ id: 'vancouver-notice', kind: 'trending_post', category: 'trending', body: 'Vancouver discovery', actor_id: null, read_at: '2026-10-13', created_at: '2026-10-13' }];
  const requests = [];
  const channel = { on: () => channel, subscribe: () => channel };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name === 'react') return {
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
      useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
      useCallback: fn => fn, useId: () => 'city-counter', useEffect(fn, deps) { pendingEffect = { fn, deps }; },
    };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'expo-router') return { useRouter: () => ({}), usePathname: () => '/feed', useFocusEffect: fn => { focus = fn; } };
    if (name === 'react-native') return { View: 'View', Platform: { OS: 'web' }, StyleSheet: { create: value => value },
      AppState: { addEventListener: () => ({ remove() {} }) }, DeviceEventEmitter: { addListener: () => ({ remove() {} }) } };
    if (name === 'react-native-reanimated') return { useReducedMotion: () => true };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, isAuthLoading: false, isAdmin: false, me }) };
    if (name === '@/lib/community-data') return {
      loadNotifications: async () => { if (offline) throw new Error('OFFLINE'); return [...rows]; },
      loadNotificationActors: async () => new Map(), markNotificationsRead: async () => {},
      loadUnreadNotificationCount: () => new Promise(resolve => requests.push(resolve)),
    };
    if (name === '@/lib/supabase') return { supabase: { channel: () => channel, removeChannel: async () => {} } };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Depth: {}, MaxContentWidth: {}, Spacing: {}, TabBarHeight: 60 };
    if (name === '@/i18n/ko') return { t: new Proxy({}, { get: () => new Proxy({}, { get: (_target, key) => String(key) }) }) };
    if (name === '@/lib/notification-preferences') return { NOTIFICATION_CATEGORIES: [], isAdminNotificationKind: () => false };
    if (name === '@/lib/feed-data') return { relativeTime: () => '' };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }) });
  return {
    me, requests,
    render(scope) { cursor = refCursor = 0; return file.startsWith('hooks/') ? exports.useUnreadCount(scope) : exports.default(); },
    async focus() { cleanup?.(); cleanup = focus(); await settle(); },
    commit() {
      const next = pendingEffect;
      if (previousDeps && next.deps.every((value, i) => value === previousDeps[i])) return;
      effects.pop()?.(); effects.push(next.fn()); previousDeps = [...next.deps];
    },
    offline(value) { offline = value; }, rows(value) { rows = value; },
    dispose() { cleanup?.(); effects.pop()?.(); },
  };
}

test('city changes hide a cached discovery immediately and an offline refresh cannot restore it', async () => {
  const ui = cityCache('app/(tabs)/notifications.tsx');
  ui.render(); await ui.focus();
  assert.equal(nodes(ui.render()).find(node => node.type === 'FlatList').props.data[0].id, 'vancouver-notice');
  ui.me.cityId = 'toronto'; ui.offline(true);
  assert.equal(nodes(ui.render()).find(node => node.type === 'FlatList').props.data.length, 0);
  await ui.focus();
  assert.equal(nodes(ui.render()).find(node => node.type === 'FlatList').props.data.length, 0);
  ui.offline(false); ui.rows([{ id: 'toronto-notice', kind: 'trending_post', category: 'trending', body: 'Toronto discovery', actor_id: null, read_at: '2026-10-13', created_at: '2026-10-13' }]);
  await ui.focus();
  assert.equal(nodes(ui.render()).find(node => node.type === 'FlatList').props.data[0].id, 'toronto-notice');
  ui.dispose();
});

test('discovery badges refresh for the saved city and ignore a previous city response', async () => {
  const ui = cityCache('hooks/use-unread-count.ts');
  ui.render('other'); ui.commit(); ui.requests[0](8); await settle();
  assert.equal(ui.render('other'), 8);
  ui.me.cityId = 'toronto';
  assert.equal(ui.render('other'), 0);
  ui.commit(); ui.requests[1](2); await settle();
  assert.equal(ui.render('other'), 2);
  ui.me.cityId = 'montreal'; ui.render('other'); ui.commit();
  ui.me.cityId = 'calgary'; ui.render('other'); ui.commit();
  ui.requests[2](9); await settle(); assert.equal(ui.render('other'), 0);
  ui.requests[3](1); await settle(); assert.equal(ui.render('other'), 1);
  ui.dispose();
});

test('a city change preserves cached personal chat counts', async () => {
  const ui = cityCache('hooks/use-unread-count.ts');
  ui.render('chat'); ui.commit(); ui.requests[0](5); await settle();
  assert.equal(ui.render('chat'), 5);
  ui.me.cityId = 'toronto'; assert.equal(ui.render('chat'), 5); ui.commit();
  assert.equal(ui.requests.length, 1);
  ui.dispose();
});
