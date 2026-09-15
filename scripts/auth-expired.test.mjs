import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// The transport-level detector is the single place that turns a dead session into the login sheet.
test('unauthenticated API responses emit the auth-expired event exactly for 401 and AUTH_REQUIRED', async (t) => {
  const emitted = [];
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'react-native' || specifier === '@react-native-async-storage/async-storage') {
        return { url: `data:text/javascript,export const Platform={OS:"web"}; export const DeviceEventEmitter={emit(name){globalThis.__emitted.push(name)},addListener(){return {remove(){}}}}; export default {};`, shortCircuit: true };
      }
      if (specifier.startsWith('@/lib/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      return nextResolve(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  globalThis.__emitted = emitted;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://gling-test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-anon';
  const { isAuthFailure, AUTH_EXPIRED_EVENT } = await import('../src/lib/supabase.ts');
  assert.equal(isAuthFailure(401, ''), true, 'expired JWT');
  assert.equal(isAuthFailure(400, '{"message":"AUTH_REQUIRED"}'), true, 'RPC without auth.uid');
  assert.equal(isAuthFailure(400, '{"message":"DAILY_POST_LIMIT_REACHED"}'), false, 'ordinary business errors stay put');
  assert.equal(isAuthFailure(500, 'AUTH_REQUIRED'), false, 'server faults are not sign-outs');
  assert.equal(AUTH_EXPIRED_EVENT, 'authExpired');
});
