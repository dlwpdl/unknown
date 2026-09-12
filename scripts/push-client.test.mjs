import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as preferences from '../src/lib/notification-preferences.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('unread badges refresh after settings and foreground changes without leaking old account counts', async () => {
  let state = null, effect, cleanup, settingsChanged, foreground;
  let userId = 'first';
  const reads = [];
  const subscription = { remove() {} };
  const channel = { on() { return this; }, subscribe() { return this; } };
  const { useUnreadCount } = load('../src/hooks/use-unread-count.ts', {
    react: { useState: () => [state, value => { state = value; }], useEffect: callback => { effect = callback; } },
    'expo-router': { usePathname: () => '/notifications' },
    'react-native': {
      DeviceEventEmitter: { addListener: (_, callback) => { settingsChanged = callback; return subscription; } },
      AppState: { addEventListener: (_, callback) => { foreground = callback; return subscription; } },
    },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: userId } }) },
    '@/lib/community-data': { loadUnreadNotificationCount: (_, owner) => new Promise(resolve => reads.push({ owner, resolve })) },
    '@/lib/notification-preferences': preferences,
    '@/lib/supabase': { supabase: { channel: () => channel, removeChannel() {} } },
  });
  assert.equal(useUnreadCount(), 0); cleanup = effect();
  settingsChanged();
  reads[1].resolve(2); await flush();
  reads[0].resolve(9); await flush();
  assert.equal(useUnreadCount(), 2, 'older requests cannot overwrite the current unread count');
  foreground('active'); reads[2].resolve(3); await flush();
  assert.equal(useUnreadCount(), 3);
  cleanup(); userId = 'second';
  assert.equal(useUnreadCount(), 0, 'account switching hides the previous count immediately');
  cleanup = effect(); reads[3].resolve(4); await flush();
  assert.equal(useUnreadCount(), 4); cleanup();
});

function load(path, imports) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false },
  }).outputText;
  vm.runInNewContext(source, { exports, process: { env: {} }, require(name) {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

test('an in-flight preference refresh cannot restore foreground push after opting out', async t => {
  let settingsChanged, handler, resolveRead, cleanup;
  let registrations = 0;
  const subscription = () => ({ remove() {} });
  const { NotificationObserver } = load('../src/components/notification-observer.tsx', {
    'react': { useEffect: effect => { cleanup = effect(); } },
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

function androidPush({ granted = true, rpcError = null } = {}) {
  const events = [];
  const token = 'ExpoPushToken[device_token_12345]';
  const projectId = '11111111-1111-4111-8111-111111111111';
  const client = { rpc: async (name, args) => {
    events.push(name);
    assert.equal(args.p_token, name === 'unregister_push_device' ? null : token);
    assert.equal(args.p_user_id, 'member');
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
  });
  return { ...api, client, events };
}

test('Android creates its channel before permission/token work and registers for the expected account', async () => {
  const push = androidPush();
  assert.equal(await push.registerPushDevice(push.client, 'member', true), true);
  assert.deepEqual(push.events, ['channel', 'permission', 'request', 'token', 'register_push_device']);
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
