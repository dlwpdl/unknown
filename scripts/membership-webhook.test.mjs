import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('only authenticated provider webhooks record purchases, and persistence failures request a retry', async (t) => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier === 'npm:@supabase/supabase-js@2' ? '@supabase/supabase-js' : specifier, context);
  } });
  t.after(() => hooks.deregister());
  const env = { SUPABASE_URL: 'https://gling-test.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'server', REVENUECAT_WEBHOOK_SECRET: 'webhook', REVENUECAT_SECRET_API_KEY: 'revenuecat' };
  let handler;
  globalThis.Deno = { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } };
  t.after(() => { delete globalThis.Deno; });
  await import('../supabase/functions/membership/index.ts');
  const userId = '11111111-1111-4111-8111-111111111111';
  let event = { id: 'purchase', type: 'INITIAL_PURCHASE', app_user_id: userId };
  let recorded = 0;
  let creditsRecorded = 0;
  let failCredits = false;
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: userId });
    if (path === '/rest/v1/rpc/record_payment_event') {
      assert.equal(request.headers.get('authorization'), 'Bearer server');
      assert.deepEqual((await request.json()).p_event, event);
      recorded++;
      return fail ? Response.json({ message: 'offline' }, { status: 500 }) : new Response(null, { status: 204 });
    }
    if (path === '/rest/v1/rpc/record_promotion_purchase') {
      assert.equal(request.headers.get('authorization'), 'Bearer server');
      const purchase = (await request.json()).p_event;
      assert.equal(purchase.credits, 900);
      assert.equal(purchase.user_id, userId);
      creditsRecorded++;
      return failCredits ? Response.json({ message: 'offline' }, { status: 500 }) : new Response(null, { status: 204 });
    }
    if (path === '/rest/v1/profiles') return Response.json({ account_status: 'active' });
    if (path === `/v1/subscribers/${userId}`) return Response.json({ request_date_ms: Date.now(), subscriber: { entitlements: {}, subscriptions: {} } });
    if (path === '/rest/v1/rpc/get_membership') return Response.json({ tier: 'free' });
    if (['/rest/v1/rpc/begin_membership_sync','/rest/v1/rpc/apply_membership_snapshot'].includes(path)) return Response.json(true);
    throw new Error(`Unexpected request ${path}`);
  });
  const run = (token) => handler(new Request('https://gling-test.supabase.co/functions/v1/membership', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ event }),
  }));
  assert.equal((await run('user-session')).status, 200);
  assert.equal(recorded, 0, 'a user-provided purchase body is ignored');
  assert.equal((await run('webhook')).status, 200);
  assert.equal(recorded, 1);
  fail = true;
  assert.equal((await run('webhook')).status, 502, 'RevenueCat must retry a failed log write');
  fail = false;
  event = { ...event, id: 'credits-purchase', type: 'NON_RENEWING_PURCHASE', app_id: 'appfaedf65971',
    product_id: 'com.dlwpdl.gling.credits.900', transaction_id: 'verified-transaction',
    store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp_ms: Date.now() };
  assert.equal((await run('webhook')).status, 200);
  assert.equal(creditsRecorded, 0, 'unfinished credits stay disabled on the server by default');
  env.PROMOTION_CREDITS_ENABLED = '1';
  assert.equal((await run('user-session')).status, 200);
  assert.equal(creditsRecorded, 0, 'client purchase body cannot grant credits even when enabled');
  assert.equal((await run('webhook')).status, 200);
  assert.equal(creditsRecorded, 1, 'authenticated store event can be persisted when explicitly enabled');
  failCredits = true;
  assert.equal((await run('webhook')).status, 502, 'credit persistence failures are retried, not acknowledged');
});
