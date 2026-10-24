import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  const file = new URL('../src/lib/notification-refresh.ts', import.meta.url);
  assert.ok(existsSync(file), 'shared notification refresh is implemented');
  const requests = [], channels = [], app = new Set(), settings = new Set(); let removed = 0;
  const client = { channel(name) {
    const channel = { name, events: [], active: true, on(_type, _filter, callback) { this.events.push(callback); return this; }, subscribe(callback) { this.status = callback; callback?.('SUBSCRIBED'); return this; } };
    channels.push(channel); return channel;
  }, removeChannel: async channel => { channel.active = false; removed++; } };
  const modules = {
    'react-native': { AppState: { addEventListener: (_name, callback) => { app.add(callback); return { remove: () => app.delete(callback) }; } }, DeviceEventEmitter: { addListener: (_name, callback) => { settings.add(callback); return { remove: () => settings.delete(callback) }; } } },
    '@/lib/community-data': { loadUnreadNotificationCount: (_client, userId, scope) => new Promise(resolve => requests.push({ userId, scope, resolve })) },
    '@/lib/notification-preferences': { NOTIFICATION_PREFERENCES_CHANGED: 'preferences' },
  };
  const exports = {}; vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return { api: exports, client, requests, channels, get removed() { return removed; },
    notification(eventType = 'INSERT') { for (const channel of channels) if (channel.active) channel.events.forEach(callback => callback({ eventType })); },
    foreground() { app.forEach(callback => callback('active')); }, preferences() { settings.forEach(callback => callback()); },
    get listeners() { return app.size + settings.size; },
  };
}
const other = { userId: 'member', cityId: 'vancouver', scope: 'other' };
test('three badges share one user subscription and two scope reads, with only one trailing read per event burst', async () => {
  const f = fixture(), values = [[], [], []];
  const stops = [f.api.subscribeUnreadCount(f.client, other, count => values[0].push(count)),
    f.api.subscribeUnreadCount(f.client, { ...other, scope: 'chat', cityId: null }, count => values[1].push(count)),
    f.api.subscribeUnreadCount(f.client, other, count => values[2].push(count))];
  await settle(); assert.equal(f.channels.length, 1); assert.equal(f.requests.length, 2);
  for (let i = 0; i < 10; i++) f.notification();
  assert.equal(f.requests.length, 2, 'do not dispatch another read while the first is unresolved');
  f.requests[0].resolve(8); f.requests[1].resolve(2); await settle();
  assert.equal(f.requests.length, 4, 'one trailing read for each distinct scope');
  f.requests[2].resolve(9); f.requests[3].resolve(3); await settle();
  assert.deepEqual(values, [[8, 9], [2, 3], [8, 9]]);
  stops[0](); assert.equal(f.removed, 0); stops[1](); assert.equal(f.removed, 0); stops[2]();
  assert.equal(f.removed, 1); assert.equal(f.listeners, 0);
});
test('city/user scopes cannot reuse an old count and disposed pending refreshes never launch their trailing work', async () => {
  const f = fixture(), old = [], current = [];
  const stop = f.api.subscribeUnreadCount(f.client, other, count => old.push(count)); await settle();
  f.notification(); stop();
  const stopCurrent = f.api.subscribeUnreadCount(f.client, { ...other, cityId: 'toronto' }, count => current.push(count)); await settle();
  f.requests[0].resolve(99); await settle(); assert.deepEqual(old, []); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(2); await settle(); assert.deepEqual(current, [2]);
  stopCurrent();
  const stopOther = f.api.subscribeUnreadCount(f.client, { ...other, userId: 'other' }, count => current.push(count)); await settle();
  assert.equal(f.requests[2].userId, 'other'); assert.equal(f.requests.length, 3); stopOther();
});
test('foreground, settings and reconnect reuse a live subscription; same-city navigation refreshes are single-flight', async () => {
  const f = fixture(); const stop = f.api.subscribeUnreadCount(f.client, other, () => {}); await settle();
  f.requests[0].resolve(1); await settle();
  f.foreground(); f.preferences(); f.channels[0].status('SUBSCRIBED'); await settle();
  assert.equal(f.channels.length, 1); assert.equal(f.requests.length, 2);
  f.requests[1].resolve(2); await settle(); assert.equal(f.requests.length, 3);
  f.requests[2].resolve(3); await settle();
  f.api.refreshUnreadCount(f.client, other); f.api.refreshUnreadCount(f.client, other); await settle(); assert.equal(f.requests.length, 4);
  stop(); f.requests[3].resolve(4); await settle(); assert.equal(f.requests.length, 4);
});
