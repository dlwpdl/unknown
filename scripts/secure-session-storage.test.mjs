import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// In-memory Keychain that enforces SecureStore's key alphabet and the ~2KB value limit of older iOS keychains.
const secure = new Map(), legacy = new Map(), local = new Map();
globalThis.__secure = {
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock', options: [],
  async getItemAsync(key, options) { this.options.push(options); return secure.get(key) ?? null; },
  async setItemAsync(key, value, options) {
    assert.match(key, /^[A-Za-z0-9._-]+$/, `valid SecureStore key: ${key}`);
    assert.ok(Buffer.byteLength(value) <= 2048, `value under 2KB for ${key}`);
    this.options.push(options); secure.set(key, value);
  },
  async deleteItemAsync(key, options) { this.options.push(options); secure.delete(key); },
};
globalThis.__legacy = { getItem: async key => legacy.get(key) ?? null, setItem: async (key, value) => { legacy.set(key, value); }, removeItem: async key => { legacy.delete(key); } };
globalThis.window = { localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) } };

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = {
      'react-native': 'export const Platform={get OS(){return globalThis.__os}}; export const DeviceEventEmitter={emit(){},addListener(){return {remove(){}}}};',
      '@react-native-async-storage/async-storage': 'export default globalThis.__legacy;',
      'expo-secure-store': 'const s=globalThis.__secure; export const AFTER_FIRST_UNLOCK=s.AFTER_FIRST_UNLOCK; export const getItemAsync=(...a)=>s.getItemAsync(...a); export const setItemAsync=(...a)=>s.setItemAsync(...a); export const deleteItemAsync=(...a)=>s.deleteItemAsync(...a);',
    }[specifier];
    if (stub) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    if (specifier.startsWith('@/lib/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
test.after(() => hooks.deregister());
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://gling-test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-anon';
const load = async os => { globalThis.__os = os; return import(`../src/lib/supabase.ts?${os}`); };
const KEY = 'sb-gling-test-auth-token';
const reset = () => { secure.clear(); legacy.clear(); local.clear(); globalThis.__secure.options = []; };

test('native client stores its session through the Keychain adapter with AFTER_FIRST_UNLOCK', async () => {
  reset();
  const { supabase, nativeSessionStorage } = await load('ios');
  assert.equal(supabase.auth.storage, nativeSessionStorage);
  await nativeSessionStorage.setItem(KEY, '{"access_token":"a"}');
  assert.deepEqual([...secure.keys()].sort(), [`${KEY}.0`, `${KEY}.n`]);
  assert.ok(globalThis.__secure.options.every(options => options?.keychainAccessible === 'afterFirstUnlock'));
  assert.equal(legacy.size, 0, 'nothing is written to AsyncStorage');
});

test('a legacy AsyncStorage session migrates once and the AsyncStorage copy is removed', async () => {
  reset();
  const { nativeSessionStorage } = await load('ios');
  const session = JSON.stringify({ access_token: 'legacy', refresh_token: 'r', user: { user_metadata: { name: '이웃' } } });
  legacy.set(KEY, session);
  assert.equal(await nativeSessionStorage.getItem(KEY), session);
  assert.equal(legacy.has(KEY), false);
  assert.equal(secure.get(`${KEY}.n`), '1');
  legacy.set(KEY, 'stale-should-not-be-read');
  assert.equal(await nativeSessionStorage.getItem(KEY), session, 'the Keychain copy wins after migration');
});

test('a failed Keychain write keeps the legacy copy so nobody is signed out', async t => {
  reset();
  const { nativeSessionStorage } = await load('ios');
  legacy.set(KEY, '{"access_token":"legacy"}');
  t.mock.method(globalThis.__secure, 'setItemAsync', async () => { throw new Error('keychain unavailable'); });
  assert.equal(await nativeSessionStorage.getItem(KEY), '{"access_token":"legacy"}');
  assert.equal(legacy.has(KEY), true);
});

test('values over 2KB are chunked, reassemble exactly, and shrink/remove clean every chunk', async () => {
  reset();
  const { nativeSessionStorage } = await load('android');
  const big = JSON.stringify({ access_token: 'x'.repeat(3000), user: { user_metadata: { name: '글링 이웃 😀'.repeat(200) } } });
  await nativeSessionStorage.setItem(KEY, big);
  const count = Number(secure.get(`${KEY}.n`));
  assert.ok(count > 2);
  assert.equal(await nativeSessionStorage.getItem(KEY), big);
  await nativeSessionStorage.setItem(KEY, '{"small":true}');
  assert.deepEqual([...secure.keys()].sort(), [`${KEY}.0`, `${KEY}.n`], 'stale chunks are deleted on shrink');
  assert.equal(await nativeSessionStorage.getItem(KEY), '{"small":true}');
  await nativeSessionStorage.setItem(KEY, big);
  legacy.set(KEY, 'leftover');
  await nativeSessionStorage.removeItem(KEY);
  assert.equal(secure.size, 0);
  assert.equal(legacy.size, 0, 'remove also clears any legacy AsyncStorage copy');
  assert.equal(await nativeSessionStorage.getItem(KEY), null);
});

test('unsafe characters in a storage key map to a valid SecureStore key', async () => {
  reset();
  const { nativeSessionStorage } = await load('ios');
  await nativeSessionStorage.setItem('sb:odd key/1', 'v');
  assert.equal(await nativeSessionStorage.getItem('sb:odd key/1'), 'v');
  assert.ok(secure.has('sb_odd_key_1.0'));
});

test('web keeps window.localStorage and never touches SecureStore or AsyncStorage', async () => {
  reset();
  const { supabase, nativeSessionStorage } = await load('web');
  assert.notEqual(supabase.auth.storage, nativeSessionStorage);
  await supabase.auth.storage.setItem(KEY, 'web-session');
  assert.equal(local.get(KEY), 'web-session');
  assert.equal(await supabase.auth.storage.getItem(KEY), 'web-session');
  await supabase.auth.storage.removeItem(KEY);
  assert.equal(local.size, 0);
  assert.equal(secure.size + legacy.size + globalThis.__secure.options.length, 0);
});
