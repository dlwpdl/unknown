import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('탈퇴는 본인 공급자 연결 해제를 확인한 뒤에만 파일과 계정을 삭제한다', async (t) => {
  // Run the actual Deno entrypoint with the already-installed Supabase SDK.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === 'npm:@supabase/supabase-js@2' ? '@supabase/supabase-js' : specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  const env = {
    SUPABASE_URL: 'https://gling-test.supabase.co', SUPABASE_ANON_KEY: 'test-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service', KAKAO_ADMIN_KEY: 'test-kakao',
    APPLE_CLIENT_SECRET: 'test-apple',
    REVENUECAT_SECRET_API_KEY: 'test-revenuecat',
  };
  let handler;
  globalThis.Deno = { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } };
  t.after(() => { delete globalThis.Deno; });
  await import('../supabase/functions/delete-account/index.ts');
  let provider = 'kakao';
  let providerResult = 'ok';
  let storageFails = false;
  let billingStatus = 200;
  let keepCompanyFiles = false, referenceFails = false;
  const removedPaths = [], listOffsets = [];
  const calls = [];
  const listed = new Set();
  const user = () => ({
    id: '11111111-1111-4111-8111-111111111111', app_metadata: { providers: [provider] },
    identities: [{ provider, identity_data: { sub: provider === 'kakao' ? '123456' : 'apple-owner' } }],
  });
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    calls.push(`${request.method} ${path}`);
    if (path === '/auth/v1/user') return Response.json(user());
    if (path === '/v1/user/unlink') {
      assert.equal(request.headers.get('authorization'), 'KakaoAK test-kakao');
      assert.equal((await request.formData()).get('target_id'), '123456');
      if (providerResult === 'network') throw new Error('offline');
      if (providerResult === 'already') return Response.json({ code: -101 }, { status: 400 });
      if (providerResult === 'rejected') return Response.json({ code: -401 }, { status: 401 });
      return Response.json({ id: providerResult === 'other' ? 999999 : 123456 });
    }
    if (path === '/auth/token') {
      const sub = providerResult === 'other' ? 'different-apple-user' : 'apple-owner';
      return Response.json({ id_token: `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`, refresh_token: 'test-refresh' });
    }
    if (path === '/auth/revoke') return new Response(null, { status: 200 });
    if (path === `/v1/subscribers/${user().id}`) {
      assert.equal(request.method, 'DELETE');
      assert.equal(request.headers.get('authorization'), 'Bearer test-revenuecat');
      return new Response(null, { status: billingStatus });
    }
    if (path === '/rest/v1/rpc/account_image_cleanup_paths') {
      const input = await request.json();
      assert.equal(input.p_user_id, user().id);
      if (referenceFails) return Response.json({ message: 'lookup failed' }, { status: 500 });
      return Response.json(keepCompanyFiles ? input.p_paths.filter(path => !path.endsWith('/company.webp')) : input.p_paths);
    }
    if (path.startsWith('/storage/v1/object/list/')) {
      if (storageFails) return Response.json({ message: 'storage failed' }, { status: 500 });
      const input = await request.json();
      listOffsets.push(input.offset);
      const files = keepCompanyFiles ? (input.offset === 0 ? [{ name: 'company.webp', id: 'company' }, { name: 'photo.jpg', id: 'personal' }] : []) : listed.has(path) ? [] : [{ name: 'photo.jpg', id: 'photo' }];
      listed.add(path);
      return Response.json(files);
    }
    if (path.startsWith('/storage/v1/object/')) { removedPaths.push(...(await request.json()).prefixes); return Response.json([]); }
    if (path === '/rest/v1/rpc/delete_my_account') return new Response(null, { status: 204 });
    if (path === `/auth/v1/admin/users/${user().id}`) return Response.json({ user: user() });
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  });
  async function run() {
    calls.length = 0; removedPaths.length = listOffsets.length = 0;
    listed.clear();
    return handler(new Request('https://gling-test.supabase.co/functions/v1/delete-account', {
      method: 'POST', headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: '탈퇴합니다', appleAuthorizationCode: 'test-code', kakaoId: '999999' }),
    }));
  }
  for (providerResult of ['rejected', 'other', 'network']) {
    assert.equal((await run()).status, 502);
    assert.equal(calls.length, 2, 'provider failure must not touch files or account data');
  }
  delete env.KAKAO_ADMIN_KEY;
  assert.equal((await run()).status, 503);
  assert.equal(calls.length, 1);
  env.KAKAO_ADMIN_KEY = 'test-kakao';
  for (providerResult of ['ok', 'already']) {
    assert.equal((await run()).status, 200);
    assert.equal(calls[1], 'POST /v1/user/unlink');
    assert.equal(calls[2], `DELETE /v1/subscribers/${user().id}`);
    assert.equal(calls[3], 'POST /rest/v1/rpc/delete_my_account');
    assert.equal(calls[4], 'POST /storage/v1/object/list/avatars');
    assert.ok(calls.includes('POST /storage/v1/object/list/merchant-review-receipts'), 'account deletion removes private review receipts too');
    assert.ok(calls.includes('POST /storage/v1/object/list/merchant-profile-images'), 'account deletion removes company logos and banners too');
    assert.ok(calls.indexOf('POST /rest/v1/rpc/delete_my_account') < calls.indexOf('POST /rest/v1/rpc/account_image_cleanup_paths'), 'freeze account before classifying shared images');
    assert.equal(calls.at(-1), `DELETE /auth/v1/admin/users/${user().id}`);
  }
  keepCompanyFiles = true;
  assert.equal((await run()).status, 200, 'company photos survive account deletion');
  assert.ok(removedPaths.length > 0);
  assert.ok(removedPaths.every(path => path.endsWith('/photo.jpg')));
  assert.deepEqual(listOffsets, [0,1,0,1,0,1,0,1,0,1], 'retained objects cannot trap cleanup on the first page');
  keepCompanyFiles = false; referenceFails = true;
  assert.equal((await run()).status, 500, 'unknown company references fail closed before deleting files');
  assert.equal(removedPaths.length, 0);
  assert.ok(calls.includes('POST /rest/v1/rpc/delete_my_account'));
  assert.ok(!calls.some(call => call.includes('/auth/v1/admin/users/')));
  referenceFails = false;
  billingStatus = 503;
  assert.equal((await run()).status, 502);
  assert.equal(calls.some((call) => call.includes('/storage/') || call.includes('/rpc/') || call.includes('/admin/users/')), false);
  billingStatus = 404;
  assert.equal((await run()).status, 200, 'already deleted billing customers allow deletion retries');
  billingStatus = 200;
  storageFails = true;
  assert.equal((await run()).status, 500);
  assert.equal(calls.some((call) => call.includes('/admin/users/')), false);
  assert.ok(calls.includes('POST /rest/v1/rpc/delete_my_account'));
  storageFails = false;
  provider = 'apple';
  providerResult = 'other';
  assert.equal((await run()).status, 502);
  assert.deepEqual(calls, ['GET /auth/v1/user', 'POST /auth/token']);
  providerResult = 'ok';
  assert.equal((await run()).status, 200);
  assert.equal(calls[2], 'POST /auth/revoke');
  assert.equal(calls[3], `DELETE /v1/subscribers/${user().id}`);
  assert.equal(calls[4], 'POST /rest/v1/rpc/delete_my_account');
  assert.equal(calls[5], 'POST /storage/v1/object/list/avatars');
});
