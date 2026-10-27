import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferencesModule from '../src/lib/notification-preferences.ts';

const defaults = { ...Object.fromEntries(preferencesModule.NOTIFICATION_CATEGORIES.map(item => [item.key, true])),
  push_enabled: true, push_muted: [], message_preview: false, interest_tag_ids: [], interest_hashtags: [] };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const settle = () => new Promise(setImmediate);

function settings({ userId = 'recipient', platform = 'web', load = async () => ({ data: defaults }), update = async patch => ({ data: { ...defaults, ...patch } }) } = {}) {
  const state = [], cleanups = [], calls = [], exports = {};
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot]) { state[slot] = deps; const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', TextInput: 'TextInput', Platform: { OS: platform }, Alert: { alert() {} }, Linking: { openSettings() {} },
      DeviceEventEmitter: { emit: (...args) => calls.push(['emit', ...args]) }, AppState: { addEventListener: () => ({ remove() {} }) },
      StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ fontScale: 1 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-router': { Redirect: 'Redirect' },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch' },
    '@/components/gling-loader': { GlingLoader: 'Loader' }, '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Depth: {}, Spacing: {} }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/mock': { TAGS: [], CITIES: [] }, '@/lib/hashtags': { parseHashtags: () => [] },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'recipient' } }) },
    '@/lib/notification-preferences': preferencesModule,
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) },
    '@/lib/push-notifications': { pushPermissionGranted: async () => true, pushSupported: false, pushConfigured: true },
    '@/lib/supabase': { supabase: { rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return name === 'get_notification_preferences' ? load() : update(args.p_preferences);
    } } },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/app/profile/notifications.tsx', import.meta.url), 'utf8')
    + '\nexports.NotificationSettings = NotificationSettings;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => imports[name] ?? {}), JSON });
  return { calls, render() { index = 0; return exports.NotificationSettings({ userId, cityName: '밴쿠버' }); },
    unmount() { cleanups.forEach(fn => fn()); } };
}
function preview(tree) {
  const row = nodes(tree).find(node => node.props?.label === '잠금화면에 메시지 내용 보이기');
  assert.ok(row, 'Message preview control is missing');
  return row;
}

test('message preview starts off, explains its lock-screen effect and saves only that choice with feedback', async () => {
  const screen = settings(); screen.render(); await settle();
  let tree = screen.render();
  let row = preview(tree);
  assert.equal(row.props.value, false);
  assert.ok(nodes(tree).some(node => typeof node.props?.children === 'string' && node.props.children.includes('메시지가 도착했어요.')));
  const control = nodes(row.type(row.props)).find(node => node.type === 'Switch');
  assert.equal(control.props.accessibilityLabel, '잠금화면에 메시지 내용 보이기');
  assert.ok(control.props.style?.minHeight >= 44 && control.props.style?.minWidth >= 44, 'Preview switch needs a 44px touch target');
  control.props.onValueChange(true); await settle();
  row = preview(screen.render());
  assert.equal(row.props.value, true);
  const saved = screen.calls.find(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences');
  assert.deepEqual(JSON.parse(JSON.stringify(saved[2])), { p_preferences: { message_preview: true } });
  assert.ok(screen.calls.some(call => call[0] === 'feedback' && call[1] === 'selection'));
  assert.equal(screen.calls.find(call => call[0] === 'emit')[2].preferences.messages, true);
});

test('a failed preview save preserves OFF and exposes a retryable error', async () => {
  const screen = settings({ update: async () => ({ error: new Error('offline') }) }); screen.render(); await settle();
  preview(screen.render()).props.onChange(true); await settle();
  const tree = screen.render();
  assert.equal(preview(tree).props.value, false);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(!screen.calls.some(call => call[0] === 'emit'));
});

test('pending preview saves disable controls and late results do not emit after unmount', async () => {
  let resolve;
  const screen = settings({ update: patch => new Promise(done => { resolve = () => done({ data: { ...defaults, ...patch } }); }) });
  screen.render(); await settle();
  preview(screen.render()).props.onChange(true);
  assert.equal(preview(screen.render()).props.disabled, true);
  preview(screen.render()).props.onChange(false);
  assert.equal(screen.calls.filter(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences').length, 1);
  screen.unmount(); resolve(); await settle();
  assert.ok(!screen.calls.some(call => call[0] === 'emit'));
});

const pills = row => nodes(row.type(row.props)).filter(node => node.type?.name === 'Pill');
const categoryRow = (tree, label) => nodes(tree).find(node => node.type?.name === 'CategoryRow' && node.props.label === label);

test('city food and place app pills save independently with feedback and preserve chat and other city settings', async () => {
  for (const [key, label] of [['city_food', '맛집'], ['city_places', '가볼 만한 곳·행사']]) {
    const screen = settings(); screen.render(); await settle();
    const row = categoryRow(screen.render(), label);
    assert.ok(row, `${label} control is missing`);
    assert.equal(row.props.app, true);
    const [app, push] = pills(row);
    assert.equal(app.props.label, `${label} 앱 알림`); assert.equal(push.props.label, `${label} 푸시 알림`);
    nodes(app.type(app.props)).find(node => node.type === 'Pressable').props.onPress(); await settle();
    assert.equal(categoryRow(screen.render(), label).props.app, false);
    assert.equal(categoryRow(screen.render(), label).props.pushDisabled, true, 'push follows the app switch off');
    const saved = screen.calls.find(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences');
    assert.deepEqual(JSON.parse(JSON.stringify(saved[2])), { p_preferences: { [key]: false } });
    const readback = screen.calls.find(call => call[0] === 'emit')[2].preferences;
    assert.equal(readback[key === 'city_food' ? 'city_places' : 'city_food'], true);
    assert.equal(readback.messages, true);
    assert.equal(readback.message_preview, false);
    assert.ok(screen.calls.some(call => call[0] === 'feedback' && call[1] === 'selection'));
  }
});

test('push pills write only push_muted and keep the in-app row', async () => {
  const screen = settings(); screen.render(); await settle();
  categoryRow(screen.render(), '지금 뜨는 글').props.onPush(false); await settle();
  const saved = screen.calls.find(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences');
  assert.deepEqual(JSON.parse(JSON.stringify(saved[2])), { p_preferences: { push_muted: ['trending'] } });
  const row = categoryRow(screen.render(), '지금 뜨는 글');
  assert.equal(row.props.app, true); assert.equal(row.props.push, false);
});

test('failed city alert saves preserve the previous choice and allow a retry', async () => {
  const screen = settings({ update: async () => ({ error: new Error('offline') }) }); screen.render(); await settle();
  const row = categoryRow(screen.render(), '맛집');
  assert.ok(row, 'City food preference is missing');
  row.props.onApp(false); await settle();
  const tree = screen.render();
  assert.equal(categoryRow(tree, '맛집').props.app, true);
  assert.equal(categoryRow(tree, '맛집').props.disabled, false);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(!screen.calls.some(call => call[0] === 'emit'));
});

test('business rows save their categories without discarding hashtag drafts, and account security is locked on', async () => {
  for (const [label, patch] of [['저장한 비즈니스 새 소식', { merchant_updates: false }], ['비즈니스', { merchant_reviews: false, merchant_operations: false }]]) {
    const view = settings(); view.render(); await settle();
    nodes(view.render()).find(node => node.type === 'TextInput').props.onChangeText('#남긴초안');
    categoryRow(view.render(), label).props.onApp(false); await settle();
    const tree = view.render();
    assert.equal(categoryRow(tree, label).props.app, false);
    assert.equal(nodes(tree).find(node => node.type === 'TextInput').props.value, '#남긴초안');
    const save = view.calls.find(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences');
    assert.deepEqual(JSON.parse(JSON.stringify(save[2])), { p_preferences: patch });
    assert.equal(view.calls.find(call => call[0] === 'emit')[2].preferences.city_food, true);
  }
  const view = settings({ load: async () => ({ data: { ...defaults, account_security: false } }) }); view.render(); await settle();
  const security = categoryRow(view.render(), '계정 보안');
  assert.deepEqual([security.props.app, security.props.push, security.props.locked], [true, true, true]);
  assert.ok(pills(security).every(pill => pill.props.disabled));
  assert.equal(nodes(view.render()).some(node => node.props?.label === '과거 1:1 요청 알림'), false, 'the retired toggle is hidden');
});

test('an account switch unmounts pending settings writes and keeps the new account preferences', async () => {
  let finish;
  const previous = settings({ update: () => new Promise(resolve => { finish = resolve; }) });
  previous.render(); await settle();
  categoryRow(previous.render(), '저장한 비즈니스 새 소식').props.onApp(false);
  previous.unmount();
  const current = settings({ userId: 'new-user', load: async () => ({ data: { ...defaults, merchant_updates: false } }) });
  current.render(); await settle(); finish({ data: defaults }); await settle();
  assert.equal(categoryRow(current.render(), '저장한 비즈니스 새 소식').props.app, false);
  assert.ok(!previous.calls.some(call => call[0] === 'emit'));
});

test('native switches keep platform height plus hit padding while their rows stay at least 56px', async () => {
  const view = settings({ platform: 'ios' }); view.render(); await settle();
  const row = nodes(view.render()).find(node => node.props?.label === '휴대폰 푸시 알림');
  const rendered = row.type(row.props), control = nodes(rendered).find(node => node.type === 'Switch');
  assert.equal(control.props.style.minHeight, undefined);
  assert.equal(control.props.hitSlop.top, 8); assert.equal(control.props.hitSlop.bottom, 8);
  assert.equal(rendered.props.style.minHeight, 56);
});
