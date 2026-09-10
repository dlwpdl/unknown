import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('관리자·심사 로그인은 서버 역할을 확인한 뒤에만 앱 세션을 바꾼다', async (t) => {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'react-native' || specifier === '@react-native-async-storage/async-storage') {
        return { url: 'data:text/javascript,export const Platform={OS:"web"}; export default {};', shortCircuit: true };
      }
      if (specifier.startsWith('@/lib/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      return nextResolve(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  const oldUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://gling-test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-anon';
  t.after(() => {
    if (oldUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  });
  let metadata = {};
  let invalidPassword = false;
  let mainSessionWrites = 0;
  const user = () => ({ id: '11111111-1111-4111-8111-111111111111', app_metadata: metadata });
  const token = () => ['{"alg":"HS256"}', JSON.stringify({ sub: user().id, exp: Math.floor(Date.now() / 1000) + 3600 }), 'test-signature']
    .map((part) => Buffer.from(part).toString('base64url')).join('.');
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/auth/v1/token') {
      assert.equal((await request.json()).email, 'admin@example.test', 'email is trimmed');
      return invalidPassword
        ? Response.json({ msg: 'Invalid credentials', code: 'invalid_credentials' }, { status: 400 })
        : Response.json({ access_token: token(), refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user: user() });
    }
    if (path === '/auth/v1/user') return Response.json(user());
    if (path === '/auth/v1/logout') return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  });
  const { signInAdminAccount, signInReviewAccount, supabase } = await import('../src/lib/supabase.ts');
  const originalSetSession = supabase.auth.setSession.bind(supabase.auth);
  t.mock.method(supabase.auth, 'setSession', async (...args) => { mainSessionWrites++; return originalSetSession(...args); });
  const args = [' admin@example.test ', 'test-password'];
  for (metadata of [{}, { provider: 'email', review_access: true }, { role: 'Admin' }]) {
    await assert.rejects(signInAdminAccount(...args), /ADMIN_ACCESS_DENIED/);
    assert.equal(mainSessionWrites, 0);
  }
  metadata = { provider: 'email', role: 'admin' };
  invalidPassword = true;
  await assert.rejects(signInAdminAccount(...args), /Invalid credentials/);
  assert.equal(mainSessionWrites, 0);
  invalidPassword = false;
  await signInAdminAccount(...args);
  assert.equal(mainSessionWrites, 1);
  metadata = { provider: 'email', role: 'admin', review_access: true };
  await assert.rejects(signInReviewAccount(...args), /REVIEW_ACCESS_DENIED/);
  assert.equal(mainSessionWrites, 1, 'rejected credentials preserve the existing app session');
  metadata = { provider: 'email', review_access: true };
  await signInReviewAccount(...args);
  assert.equal(mainSessionWrites, 2);
  await supabase.auth.stopAutoRefresh();
});
