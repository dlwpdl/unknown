import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferences from '../src/lib/notification-preferences.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

function invite({ denied = false, failure = null } = {}) {
  const state = [], writes = [], alerts = [], events = [], listeners = new Map();
  let cursor = 0, started = false, fail = failure, handler, observerCleanup;
  const subscription = () => ({ remove() {} });
  const native = {
    StyleSheet: { create: value => value }, View: 'View', Modal: 'Modal',
    Alert: { alert: (...args) => alerts.push(args) },
    AppState: { addEventListener: subscription },
    DeviceEventEmitter: {
      addListener: (name, listener) => { listeners.set(name, listener); return subscription(); },
      emit: (name, value) => { events.push(value); listeners.get(name)?.(value); },
    },
  };
  const push = { pushSupported: true, pushConfigured: true, pushPermissionGranted: async () => false,
    pushPermissionUndetermined: async () => true,
    registerPushDevice: async () => { if (fail === 'registration') throw new Error('offline'); return !denied; },
  };
  const supabase = { rpc: async (name, args) => {
    if (name === 'update_notification_preferences' && fail === 'save') return { error: new Error('offline') };
    return { data: { push_enabled: name === 'update_notification_preferences', replies: true }, error: null };
  } };
  function load(path, react) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: false },
    }).outputText;
    const imports = {
      react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      'react-native': native, '@/components/analytics-controls': { Pressable: 'Pressable' },
      '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async (...args) => writes.push(args) } },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
      'react-native-reanimated': { useReducedMotion: () => false }, 'expo-symbols': { SymbolView: 'SymbolView' },
      '@/components/themed-text': { ThemedText: 'ThemedText' }, '@/constants/theme': { Spacing: {} },
      '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
      '@/lib/auth': { useAuth: () => ({ isAuthed: true, isAdmin: false, me: { id: 'member' } }) },
      '@/lib/notification-preferences': preferences, '@/lib/push-notifications': push, '@/lib/supabase': { supabase },
      '@/lib/community-data': {}, 'expo-router': { useRootNavigationState: () => ({ key: 'root' }), useRouter: () => ({}) },
      'expo-notifications': { setNotificationHandler: value => { handler = value; }, getLastNotificationResponse: () => null,
        addNotificationResponseReceivedListener: subscription, addPushTokenListener: subscription },
    };
    vm.runInNewContext(source, { exports, require(name) { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; } });
    return exports;
  }
  load('../src/components/notification-observer.tsx', { useEffect: callback => { observerCleanup = callback(); } }).NotificationObserver();
  const { PushInvite } = load('../src/components/push-invite.tsx', {
    useEffect: callback => { if (!started) { started = true; callback(); } },
    useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = value; }]; },
  });
  const render = () => { cursor = 0; return PushInvite(); };
  render();
  return { render, writes, alerts, events, cleanup: () => observerCleanup(), setFailure: value => { fail = value; },
    allow: async () => { nodes(render()).find(node => node.props?.analyticsId === 'components_push-invite.pressable.2').props.onPress(); await flush(); },
    foreground: () => handler.handleNotification({ request: { content: { data: { userId: 'member', category: 'replies' } } } }),
  };
}

test('allowing push updates foreground delivery without reopening the app', async t => {
  const ui = invite(); t.after(ui.cleanup); await flush();
  assert.equal((await ui.foreground()).shouldShowBanner, false);
  await ui.allow();
  assert.equal((await ui.foreground()).shouldShowBanner, true, 'the invite must update the running observer');
  assert.equal(ui.render(), null);
});

test('connection failures keep the permission invite available for a successful retry', async t => {
  for (const failure of ['registration', 'save']) {
    const ui = invite({ failure }); await flush();
    await ui.allow();
    assert.ok(ui.render(), 'a failed opt-in must retain the existing retry button');
    assert.equal(ui.alerts.length, 1, 'the user must know push was not enabled');
    assert.equal(ui.writes.length, 0, 'failed opt-in must not consume the seven-day reminder');
    assert.equal(ui.events.length, 0);
    ui.setFailure(null); await ui.allow();
    assert.equal((await ui.foreground()).shouldShowBanner, true);
    assert.equal(ui.render(), null); ui.cleanup();
  }
});

test('declining the system permission keeps push off and closes the invite', async t => {
  const ui = invite({ denied: true }); t.after(ui.cleanup); await flush();
  await ui.allow();
  assert.equal(ui.render(), null);
  assert.equal((await ui.foreground()).shouldShowBanner, false);
  assert.equal(ui.events.length, 0); assert.equal(ui.alerts.length, 0);
});
