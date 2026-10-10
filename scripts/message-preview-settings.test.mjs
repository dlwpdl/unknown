import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferencesModule from '../src/lib/notification-preferences.ts';

const defaults = { ...Object.fromEntries(preferencesModule.NOTIFICATION_CATEGORIES.map(item => [item.key, true])),
  push_enabled: true, message_preview: false, interest_tag_ids: [], interest_hashtags: [] };
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
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, JSON });
  return { calls, render() { index = 0; return exports.NotificationSettings({ userId, cityName: '밴쿠버' }); },
    unmount() { cleanups.forEach(fn => fn()); } };
}
function preview(tree) {
  const row = nodes(tree).find(node => node.props?.label === '메시지 미리보기');
  assert.ok(row, 'Message preview control is missing');
  return row;
}

test('message preview starts off, explains its lock-screen effect and saves only that choice with feedback', async () => {
  const screen = settings(); screen.render(); await settle();
  let tree = screen.render();
  let row = preview(tree);
  assert.equal(row.props.value, false);
  assert.ok(nodes(tree).some(node => typeof node.props?.children === 'string' && node.props.children.includes('메시지가 도착했습니다')));
  const control = nodes(row.type(row.props)).find(node => node.type === 'Switch');
  assert.equal(control.props.accessibilityLabel, '메시지 미리보기');
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

test('city food and place controls save independently with feedback and preserve chat and other city settings', async () => {
  for (const [key, label] of [['city_food', '내 도시의 맛집·레스토랑'], ['city_places', '내 도시의 가볼 만한 곳·행사']]) {
    const screen = settings(); screen.render(); await settle();
    const row = nodes(screen.render()).find(node => node.props?.label === label);
    assert.ok(row, `${label} control is missing`);
    assert.equal(row.props.value, true);
    const control = nodes(row.type(row.props)).find(node => node.type === 'Switch');
    assert.equal(control.props.accessibilityLabel, label);
    control.props.onValueChange(false); await settle();
    assert.equal(nodes(screen.render()).find(node => node.props?.label === label).props.value, false);
    const saved = screen.calls.find(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences');
    assert.deepEqual(JSON.parse(JSON.stringify(saved[2])), { p_preferences: { [key]: false } });
    const readback = screen.calls.find(call => call[0] === 'emit')[2].preferences;
    assert.equal(readback[key === 'city_food' ? 'city_places' : 'city_food'], true);
    assert.equal(readback.messages, true);
    assert.equal(readback.message_preview, false);
    assert.ok(screen.calls.some(call => call[0] === 'feedback' && call[1] === 'selection'));
  }
});

test('failed city alert saves preserve the previous choice and allow a retry', async () => {
  const screen = settings({ update: async () => ({ error: new Error('offline') }) }); screen.render(); await settle();
  const row = nodes(screen.render()).find(node => node.props?.label === '내 도시의 맛집·레스토랑');
  assert.ok(row, 'City food preference is missing');
  row.props.onChange(false); await settle();
  const tree = screen.render();
  assert.equal(nodes(tree).find(node => node.props?.label === row.props.label).props.value, true);
  assert.equal(nodes(tree).find(node => node.props?.label === row.props.label).props.disabled, false);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(!screen.calls.some(call => call[0] === 'emit'));
});

 test('new business/account switches save independently without discarding hashtag drafts or city preferences', async () => {
  for (const [key, label] of [['merchant_updates', '저장한 비즈니스 새 소식'], ['merchant_operations', '비즈니스 게시·연결 문제'], ['account_security', '계정 보안']]) {
    const view = settings(); view.render(); await settle();
    nodes(view.render()).find(node => node.type === 'TextInput').props.onChangeText('#남긴초안');
    const row = nodes(view.render()).find(node => node.props?.label === label);
    assert.ok(row); row.props.onChange(false); await settle();
    const tree = view.render();
    assert.equal(nodes(tree).find(node => node.props?.label === label).props.value, false);
    assert.equal(nodes(tree).find(node => node.type === 'TextInput').props.value, '#남긴초안');
    const save = view.calls.find(call => call[0] === 'rpc' && call[1] === 'update_notification_preferences');
    assert.deepEqual(JSON.parse(JSON.stringify(save[2])), { p_preferences: { [key]: false } });
    assert.equal(view.calls.find(call => call[0] === 'emit')[2].preferences.city_food, true);
  }
 });
 test('an account switch unmounts pending settings writes and keeps the new account preferences', async () => {
  let finish;
  const previous = settings({ update: () => new Promise(resolve => { finish = resolve; }) });
  previous.render(); await settle();
  nodes(previous.render()).find(node => node.props?.label === '계정 보안').props.onChange(false);
  previous.unmount();
  const current = settings({ userId: 'new-user', load: async () => ({ data: { ...defaults, account_security: false } }) });
  current.render(); await settle(); finish({ data: defaults }); await settle();
  assert.equal(nodes(current.render()).find(node => node.props?.label === '계정 보안').props.value, false);
  assert.ok(!previous.calls.some(call => call[0] === 'emit'));
 });
 test('native switches keep platform height plus hit padding while their rows stay at least 56px', async () => {
  const view = settings({ platform: 'ios' }); view.render(); await settle();
  const row = nodes(view.render()).find(node => node.props?.label === '계정 보안');
  const rendered = row.type(row.props), control = nodes(rendered).find(node => node.type === 'Switch');
  assert.equal(control.props.style.minHeight, undefined);
  assert.equal(control.props.hitSlop.top, 8); assert.equal(control.props.hitSlop.bottom, 8);
  assert.equal(rendered.props.style.minHeight, 56);
 });
