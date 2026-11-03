import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { linkedAccountIds, switchDenial } from '../supabase/functions/_shared/linked-account.ts';

const OWNER = '11111111-1111-4111-8111-111111111111', ALT = '22222222-2222-4222-8222-222222222222';
const owner = (app_metadata = { provider: 'kakao', role: 'admin', linked_accounts: [ALT] }) => ({ id: OWNER, app_metadata });
const alt = (patch = {}) => ({ id: ALT, email: 'alt@alt.gling.invalid', app_metadata: { provider: 'email', linked_to: OWNER }, ...patch });

test('a sign-in is issued only along a two-way link, to an ordinary email account, for an active caller', () => {
  assert.deepEqual(linkedAccountIds(owner({ linked_accounts: [ALT, 'not-a-uuid', 7] })), [ALT]);
  assert.equal(switchDenial(owner(), 'active', alt(), null), null, 'first use has no profile yet');
  assert.equal(switchDenial(owner(), 'active', alt(), 'active'), null);
  assert.equal(switchDenial(alt(), 'active', owner(), 'active'), 'LINKED_ACCOUNT', 'the linked account has no way into its admin owner');
  assert.equal(switchDenial(owner({ provider: 'kakao', linked_accounts: [ALT], linked_to: null }), 'active', alt(), null), 'LINKED_ACCOUNT', 'key presence counts, like the token hook');
  assert.deepEqual(linkedAccountIds(alt({ app_metadata: { provider: 'email', linked_to: OWNER, linked_accounts: [OWNER] } })), []);
  for (const status of [null, 'suspended']) assert.equal(switchDenial(owner(), status, alt(), null), 'ACCOUNT_NOT_ACTIVE');
  assert.equal(switchDenial(owner({ provider: 'kakao' }), 'active', alt(), null), 'NOT_LINKED');
  assert.equal(switchDenial(owner(), 'active', alt({ app_metadata: { provider: 'email' } }), null), 'NOT_LINKED');
  assert.equal(switchDenial(owner(), 'active', alt({ app_metadata: { provider: 'email', linked_to: ALT } }), null), 'NOT_LINKED');
  assert.equal(switchDenial(owner(), 'active', null, null), 'NOT_LINKED');
  assert.equal(switchDenial(owner(), 'active', alt({ app_metadata: { provider: 'email', linked_to: OWNER, role: 'admin' } }), null), 'TARGET_NOT_ALLOWED');
  assert.equal(switchDenial(owner(), 'active', alt({ app_metadata: { provider: 'kakao', linked_to: OWNER } }), null), 'TARGET_NOT_ALLOWED');
  assert.equal(switchDenial(owner(), 'active', alt({ email: undefined }), null), 'TARGET_NOT_ALLOWED');
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(switchDenial(owner(), 'active', alt({ banned_until: '2026-11-04T00:00:00Z' }), null, now), 'TARGET_BANNED');
  assert.equal(switchDenial(owner(), 'active', alt({ banned_until: 'unreadable' }), null, now), 'TARGET_BANNED');
  assert.equal(switchDenial(owner(), 'active', alt({ banned_until: '2026-11-01T00:00:00Z' }), null, now), null, 'an ended ban no longer blocks');
  for (const status of ['suspended', 'deleted', 'reactivation_pending']) assert.equal(switchDenial(owner(), 'active', alt(), status), 'TARGET_NOT_ACTIVE');
});

// The app module runs on the real supabase-js client with web-style storage and a fake server.
const store = new Map();
globalThis.window = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) } };
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://gling-test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-anon';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native' || specifier === '@react-native-async-storage/async-storage') {
      return { url: 'data:text/javascript,export const Platform={OS:"web"}; export const DeviceEventEmitter={emit(){},addListener(){return {remove(){}}}}; export default {};', shortCircuit: true };
    }
    if (specifier.startsWith('@/lib/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const vault = await import('../src/lib/linked-accounts.ts');
const { supabase } = await import('../src/lib/supabase.ts');

test('kept sessions are added, removed and merged into rows without the signed-in account', () => {
  const tokens = { access_token: 'a', refresh_token: 'r' };
  const sessions = vault.withSession(vault.withSession({}, OWNER, { nickname: '포근한수달', ...tokens }), ALT, { nickname: '예전 이름', ...tokens });
  assert.deepEqual(Object.keys(vault.withoutSession(sessions, ALT)), [OWNER]);
  assert.deepEqual(vault.withoutSession(sessions, 'missing'), sessions);
  const ownerUser = { id: OWNER, app_metadata: { linked_accounts: [ALT] } };
  assert.deepEqual(vault.linkedAccountRows(ownerUser, [{ id: ALT, nickname: '토로노추웡' }], sessions), [{ id: ALT, nickname: '토로노추웡', forward: true }]);
  assert.deepEqual(vault.linkedAccountRows(ownerUser, [], sessions), [{ id: ALT, nickname: '예전 이름', forward: true }], 'a failed list keeps the linked label');
  assert.deepEqual(vault.linkedAccountRows({ id: ALT, app_metadata: { linked_to: OWNER } }, [], sessions), [{ id: OWNER, nickname: '포근한수달', forward: false }]);
  assert.deepEqual(vault.linkedAccountRows({ id: 'member', app_metadata: {} }, [], {}), [], 'ordinary members get no rows');
});

test('switching keeps a way back, and a failed switch leaves the current login as it was', async t => {
  t.after(() => supabase.auth.stopAutoRefresh());
  const accounts = { [OWNER]: { id: OWNER, app_metadata: { provider: 'kakao', linked_accounts: [ALT] } }, [ALT]: { id: ALT, app_metadata: { provider: 'email', linked_to: OWNER } } };
  const jwt = sub => ['{"alg":"HS256"}', JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }), 'sig'].map(part => Buffer.from(part).toString('base64url')).join('.');
  const subject = request => JSON.parse(Buffer.from(request.headers.get('Authorization').split('.')[1], 'base64url')).sub;
  const live = new Map([['r-owner-0', OWNER]]); // refresh tokens the server still accepts
  let issued = 0, userFails = false, linkFails = false;
  const calls = [];
  const sessionFor = id => { const refresh_token = `r-${id === OWNER ? 'owner' : 'alt'}-${++issued}`; live.set(refresh_token, id); return { access_token: jwt(id), token_type: 'bearer', expires_in: 3600, refresh_token, user: accounts[id] }; };
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/user') return userFails ? Response.json({ msg: 'unavailable' }, { status: 500 }) : Response.json(accounts[subject(request)]);
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const { refresh_token } = await request.json(), id = live.get(refresh_token);
      if (!live.delete(refresh_token)) return Response.json({ code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' }, { status: 400 });
      return Response.json(sessionFor(id));
    }
    if (url.pathname === '/functions/v1/linked-account') {
      assert.equal(subject(request), OWNER, 'only the signed-in owner asks the server');
      const body = await request.json();
      if (body.action === 'list') return Response.json({ accounts: [{ id: ALT, nickname: '토로노추웡' }] });
      assert.deepEqual(body, { action: 'switch', target: ALT });
      return linkFails ? Response.json({ error: 'NOT_LINKED' }, { status: 403 }) : Response.json({ token_hash: 'hash-alt' });
    }
    if (url.pathname === '/auth/v1/verify') {
      const body = await request.json();
      assert.deepEqual([body.token_hash, body.type], ['hash-alt', 'magiclink']);
      return Response.json(sessionFor(ALT));
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });
  const current = async () => (await supabase.auth.getSession()).data.session;
  const kept = () => JSON.parse(store.get('gling-linked-sessions') ?? '{}');
  assert.equal((await supabase.auth.setSession({ access_token: jwt(OWNER), refresh_token: 'r-owner-0' })).error, null);
  assert.deepEqual(await vault.loadLinkedAccounts(), [{ id: ALT, nickname: '토로노추웡', forward: true }]);

  await vault.switchToAccount(ALT, '포근한수달');
  assert.equal((await current()).user.id, ALT);
  assert.deepEqual(Object.keys(kept()), [OWNER]);
  assert.equal(kept()[OWNER].refresh_token, 'r-owner-0');
  assert.deepEqual(await vault.loadLinkedAccounts(), [{ id: OWNER, nickname: '포근한수달', forward: false }]);

  calls.length = 0;
  await vault.switchToAccount(OWNER, '토로노추웡');
  const back = await current();
  assert.equal(back.user.id, OWNER);
  assert.ok(!calls.includes('/functions/v1/linked-account'), 'the way back uses the kept session, not the server');
  assert.ok(!live.has('r-owner-0') && live.get(back.refresh_token) === OWNER, 'the kept owner token was rotated once');
  assert.deepEqual(Object.keys(kept()), [ALT], 'the spent owner token is gone; the alt login is kept for next time');

  userFails = true;
  await assert.rejects(vault.switchToAccount(ALT, '포근한수달'));
  userFails = false;
  assert.equal((await current()).refresh_token, back.refresh_token, 'a failed hand-over keeps the current login');
  assert.deepEqual(Object.keys(kept()), [ALT]);
  assert.equal(live.get(kept()[ALT].refresh_token), ALT, 'the newly rotated alt token replaced the spent one');

  live.delete(kept()[ALT].refresh_token);
  linkFails = true;
  await assert.rejects(vault.switchToAccount(ALT, '포근한수달'));
  assert.equal((await current()).refresh_token, back.refresh_token, 'a refused switch keeps the current login');
  assert.deepEqual(kept(), {}, 'a rejected token is dropped and the current account is not left behind');

  await vault.clearLinkedSessions();
  assert.equal(store.has('gling-linked-sessions'), false);
});
