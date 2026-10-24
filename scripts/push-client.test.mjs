import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferences from '../src/lib/notification-preferences.ts';
import * as product from '../src/lib/product-analytics.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('unread badges refresh after settings and foreground changes without leaking old account counts', async () => {
  let cursor = 0, settingsChanged, foreground;
  let userId = 'first';
  const reads = [], slots = [];
  const subscription = { remove() {} };
  const channel = { on() { return this; }, subscribe() { return this; } };
  const effect = (callback, deps) => {
    const i = cursor++, previous = slots[i];
    if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
    previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() };
  };
  const memo = (callback, deps) => {
    const i = cursor++, previous = slots[i];
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[i] = { deps, value: callback() };
    return slots[i].value;
  };
  const imports = {
    react: { useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { value: initial }; return [slots[i].value, value => { slots[i].value = value; }]; },
      useRef: current => slots[cursor++] ??= { current }, useEffect: effect, useLayoutEffect: effect, useMemo: memo },
    'expo-router': { usePathname: () => '/notifications' },
    'react-native': {
      DeviceEventEmitter: { addListener: (_, callback) => { settingsChanged = callback; return subscription; } },
      AppState: { addEventListener: (_, callback) => { foreground = callback; return subscription; } },
    },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: userId } }) },
    '@/lib/community-data': { loadUnreadNotificationCount: (_, owner) => new Promise(resolve => reads.push({ owner, resolve })) },
    '@/lib/notification-preferences': preferences,
    '@/lib/supabase': { supabase: { channel: () => channel, removeChannel() {} } },
  };
  imports['@/lib/notification-refresh'] = load('../src/lib/notification-refresh.ts', imports);
  const { useUnreadCount } = load('../src/hooks/use-unread-count.ts', imports);
  const render = () => { cursor = 0; return useUnreadCount(); };
  assert.equal(render(), 0); await flush(); settingsChanged();
  assert.equal(reads.length, 1, 'settings queue one refresh behind the unresolved read');
  reads[0].resolve(9); await flush(); reads[1].resolve(2); await flush();
  assert.equal(render(), 2);
  foreground('active'); await flush(); reads[2].resolve(3); await flush();
  assert.equal(render(), 3);
  foreground('active'); await flush(); userId = 'second';
  assert.equal(render(), 0, 'account switching hides the previous count immediately'); await flush();
  reads[3].resolve(99); await flush(); assert.equal(render(), 0, 'the previous account response is discarded');
  reads[4].resolve(4); await flush(); assert.equal(render(), 4);
  for (const slot of slots) slot?.cleanup?.();
});

function load(path, imports, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false },
  }).outputText;
  vm.runInNewContext(source, { exports, ...globals, process: { env: {} }, require: withLanguageImports((name) => {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return exports;
}

test('a legacy topic push opens today search once and ignores another account', () => {
  const routes = [];
  let receive, cleanup;
  const subscription = () => ({ remove() {} });
  const { NotificationObserver } = load('../src/components/notification-observer.tsx', {
    react: { useEffect: effect => { cleanup = effect(); } },
    'react-native': { AppState: { addEventListener: subscription }, DeviceEventEmitter: { addListener: subscription } },
    'expo-router': { useRootNavigationState: () => ({ key: 'root' }), useRouter: () => ({ navigate: value => routes.push(value) }) },
    'expo-notifications': { DEFAULT_ACTION_IDENTIFIER: 'open', setNotificationHandler() {}, getLastNotificationResponse: () => null,
      addNotificationResponseReceivedListener: callback => { receive = callback; return subscription(); }, addPushTokenListener: subscription, clearLastNotificationResponseAsync: async () => {} },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'member' } }) },
    '@/lib/community-data': {}, '@/lib/product-analytics': product, '@/lib/notification-preferences': preferences,
    '@/lib/push-notifications': { pushSupported: true, pushConfigured: false },
    '@/lib/supabase': { supabase: { rpc: async () => ({ data: { push_enabled: false } }) } },
  });
  NotificationObserver();
  const response = { actionIdentifier: 'open', notification: { request: { identifier: 'topic', content: {
    body: '요즘 관심이 모이는 주제예요. #밴쿠버', data: { userId: 'other', category: 'trending', route: '/notifications' },
  } } } };
  receive(response); assert.equal(routes.length, 0);
  response.notification.request.content.data.userId = 'member';
  receive(response); receive(response);
  assert.deepEqual(routes, ['/?hashtag=' + encodeURIComponent('밴쿠버')]);
  cleanup();
});

test('an in-flight preference refresh cannot restore foreground push after opting out', async t => {
  let settingsChanged, handler, resolveRead, cleanup;
  let registrations = 0;
  const subscription = () => ({ remove() {} });
  const { NotificationObserver } = load('../src/components/notification-observer.tsx', {
    'react': { useId: () => 'test-id', useEffect: effect => { cleanup = effect(); } },
    'react-native': {
      AppState: { addEventListener: subscription },
      DeviceEventEmitter: { addListener: (_, callback) => { settingsChanged = callback; return subscription(); } },
    },
    'expo-router': { useRootNavigationState: () => ({ key: 'root' }), useRouter: () => ({ push() {} }) },
    'expo-notifications': {
      setNotificationHandler: value => { handler = value; }, getLastNotificationResponse: () => null,
      addNotificationResponseReceivedListener: subscription, addPushTokenListener: subscription,
    },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'member' } }) },
    '@/lib/community-data': {},
    '@/lib/product-analytics': product,
    '@/lib/notification-preferences': preferences,
    '@/lib/push-notifications': { pushSupported: true, pushConfigured: true, registerPushDevice: async () => { registrations++; } },
    '@/lib/supabase': { supabase: { rpc: () => new Promise(resolve => { resolveRead = resolve; }) } },
  });
  NotificationObserver();
  t.after(() => cleanup());
  const notification = { request: { content: { data: { userId: 'member', category: 'replies' } } } };
  settingsChanged({ userId: 'member', preferences: { push_enabled: true, replies: true } });
  assert.equal((await handler.handleNotification(notification)).shouldShowBanner, true);
  settingsChanged({ userId: 'member', preferences: { push_enabled: false, replies: false } });
  resolveRead({ data: { push_enabled: true, replies: true }, error: null });
  await flush();
  const behavior = await handler.handleNotification(notification);
  assert.equal(behavior.shouldShowBanner, false);
  assert.equal(behavior.shouldShowList, false);
  assert.equal(behavior.shouldPlaySound, false);
  assert.equal(registrations, 0, 'a stale read must not re-register the device after opt-out');
});

function androidPush({ granted = true, rpcError = null, zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const events = [];
  const token = 'ExpoPushToken[device_token_12345]';
  const projectId = '11111111-1111-4111-8111-111111111111';
  const client = { rpc: async (name, args) => {
    events.push(name);
    assert.equal(args.p_token, name === 'unregister_push_device' ? null : token);
    assert.equal(args.p_user_id, 'member');
    if (name === 'register_push_device') {
      let expected = null;
      try { expected = zone(); } catch {}
      assert.equal(args.p_timezone, expected);
    }
    return { error: rpcError };
  } };
  const api = load('../src/lib/push-notifications.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-constants': { default: { easConfig: { projectId } } },
    'expo-notifications': {
      AndroidImportance: { DEFAULT: 3 }, IosAuthorizationStatus: { PROVISIONAL: 3 },
      setNotificationChannelAsync: async channel => { assert.equal(channel, 'gling-activity'); events.push('channel'); },
      getPermissionsAsync: async () => { events.push('permission'); return { granted: false }; },
      requestPermissionsAsync: async () => { events.push('request'); return { granted }; },
      getExpoPushTokenAsync: async options => { assert.equal(options.projectId, projectId); events.push('token'); return { data: token }; },
      dismissAllNotificationsAsync: async () => { events.push('dismiss'); },
    },
  }, { Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: zone() }) }) } });
  return { ...api, client, events };
}

test('Android creates its channel before permission/token work and registers for the expected account', async () => {
  const push = androidPush();
  assert.equal(await push.registerPushDevice(push.client, 'member', true), true);
  assert.deepEqual(push.events, ['channel', 'permission', 'request', 'token', 'register_push_device']);
});

test('refresh reports a changed device zone and unknown zones still register for messages', async () => {
  let timezone = 'America/Vancouver';
  const push = androidPush({ zone: () => timezone });
  await push.registerPushDevice(push.client, 'member', true);
  timezone = 'Asia/Seoul';
  await push.registerPushDevice(push.client, 'member', true);
  const unknown = androidPush({ zone: () => { throw new Error('TIMEZONE_UNAVAILABLE'); } });
  assert.equal(await unknown.registerPushDevice(unknown.client, 'member', true), true);
});

test('denied permissions never request a token or register a device, and background refresh never prompts', async () => {
  for (const requestPermission of [true, false]) {
    const push = androidPush({ granted: false });
    assert.equal(await push.registerPushDevice(push.client, 'member', requestPermission), false);
    assert.deepEqual(push.events, requestPermission ? ['channel', 'permission', 'request'] : ['channel', 'permission']);
  }
});

test('unregistration clears the expected account session with a null token and propagates server failure', async () => {
  const push = androidPush({ rpcError: new Error('OFFLINE') });
  await assert.rejects(push.unregisterPushDevice(push.client, 'member'), /OFFLINE/);
  assert.deepEqual(push.events, ['unregister_push_device']);
});
