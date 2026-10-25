import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMerchantWebAccess } from '../src/lib/merchant-web-access.ts';

const userId = '14000000-0000-4000-8000-000000000001';
const owner = {
  id: '14010000-0000-4000-8000-000000000001', name: 'Synthetic business', city_id: 'vancouver', city_name: 'Vancouver',
  contact: '', status: 'lead', owner_id: userId, owner_verified_at: '2026-10-25T00:00:00Z',
  trial_ends_at: null, workspace_until: null, today: '2026-10-25', plan: 'basic', role: 'owner',
};

function syntheticClient({ enabled = true, merchants = [], sessionUserId = userId, rpcErrors = {}, sessionError = null } = {}) {
  const calls = [];
  let authObserver;
  const client = {
    rpc: async name => {
      calls.push(name);
      assert.ok(['get_my_merchant_access', 'get_my_merchants'].includes(name), `Unexpected RPC: ${name}`);
      return { data: name === 'get_my_merchant_access' ? enabled : merchants, error: rpcErrors[name] ?? null };
    },
    auth: {
      getSession: async () => {
        calls.push('getSession');
        return { data: { session: sessionUserId ? { user: { id: sessionUserId } } : null }, error: sessionError };
      },
      onAuthStateChange: observer => {
        calls.push('onAuthStateChange');
        authObserver = observer;
        return { data: { subscription: { unsubscribe: () => { calls.push('unsubscribe'); authObserver = undefined; } } } };
      },
    },
  };
  return { client, calls, emitAuth: (event, session) => authObserver?.(event, session) };
}

test('verified assigned owner can use merchant web and connect business MCP', async () => {
  const { client, calls } = syntheticClient({ merchants: [owner] });
  assert.deepEqual(await loadMerchantWebAccess(client, userId), { kind: 'business', merchants: [owner], canConnectMcp: true });
  assert.deepEqual(calls.filter(name => name.startsWith('get_my_')), ['get_my_merchant_access', 'get_my_merchants']);
  assert.equal(calls.filter(name => name !== 'unsubscribe').at(-1), 'getSession', 'the current account is verified after reading access');
});

test('assigned operators retain web access without acquiring owner-only MCP access', async () => {
  for (const ownerId of [userId, '14000000-0000-4000-8000-000000000002']) {
    const operator = { ...owner, role: 'operator', owner_id: ownerId };
    const { client } = syntheticClient({ merchants: [operator] });
    assert.deepEqual(await loadMerchantWebAccess(client, userId), { kind: 'business', merchants: [operator], canConnectMcp: false });
  }
});

test('owner role alone cannot grant MCP without verified ownership of the current account', async () => {
  for (const row of [{ ...owner, owner_verified_at: null }, { ...owner, owner_id: '14000000-0000-4000-8000-000000000002' }]) {
    const { client } = syntheticClient({ merchants: [row] });
    assert.equal((await loadMerchantWebAccess(client, userId)).canConnectMcp, false);
  }
});

test('admin-wide rows do not expand merchant web membership or MCP eligibility', async () => {
  const admin = { ...owner, role: 'admin' };
  const { client } = syntheticClient({ merchants: [admin] });
  assert.deepEqual(await loadMerchantWebAccess(client, userId), { kind: 'unassigned', merchants: [], canConnectMcp: false });
  const mixed = syntheticClient({ merchants: [admin, owner] });
  assert.deepEqual(await loadMerchantWebAccess(mixed.client, userId), { kind: 'business', merchants: [owner], canConnectMcp: true });
});

test('approved accounts without assignments remain distinct from ordinary members', async () => {
  const { client, calls } = syntheticClient();
  assert.deepEqual(await loadMerchantWebAccess(client, userId), { kind: 'unassigned', merchants: [], canConnectMcp: false });
  assert.ok(calls.includes('get_my_merchants'));
  assert.equal(calls.filter(name => name !== 'unsubscribe').at(-1), 'getSession');
});

test('disabled capability returns member without loading any merchant list', async () => {
  const { client, calls } = syntheticClient({ enabled: false, merchants: [owner] });
  assert.deepEqual(await loadMerchantWebAccess(client, userId), { kind: 'member', merchants: [], canConnectMcp: false });
  assert.ok(!calls.includes('get_my_merchants'));
  assert.equal(calls.filter(name => name !== 'unsubscribe').at(-1), 'getSession');
});

test('account changes or signout fail closed even when capability is disabled', async () => {
  for (const enabled of [false, true]) {
    for (const sessionUserId of [null, '14000000-0000-4000-8000-000000000002']) {
      const { client } = syntheticClient({ enabled, merchants: [owner], sessionUserId });
      await assert.rejects(loadMerchantWebAccess(client, userId), /ACCOUNT_CHANGED/);
    }
  }
});

test('RPC and session failures cannot become an allowed or unassigned fallback', async () => {
  for (const name of ['get_my_merchant_access', 'get_my_merchants']) {
    const { client } = syntheticClient({ merchants: [owner], rpcErrors: { [name]: { message: 'ACCOUNT_LOCKED' } } });
    await assert.rejects(loadMerchantWebAccess(client, userId), /ACCOUNT_LOCKED/);
  }
  const { client } = syntheticClient({ merchants: [owner], sessionError: { message: 'Session unavailable' } });
  await assert.rejects(loadMerchantWebAccess(client, userId));
});

test('A -> B -> A during access reads rejects B rows even when session reads return A', async () => {
  const otherUser = '14000000-0000-4000-8000-000000000002';
  const { client, calls, emitAuth } = syntheticClient({ merchants: [{ ...owner, owner_id: otherUser }] });
  const rpc = client.rpc;
  client.rpc = async name => {
    const result = await rpc(name);
    emitAuth('SIGNED_IN', { user: { id: name === 'get_my_merchant_access' ? otherUser : userId } });
    return result;
  };
  await assert.rejects(loadMerchantWebAccess(client, userId), /ACCOUNT_CHANGED/);
  assert.equal(calls.filter(name => name === 'unsubscribe').length, 1, 'the rejected read removes its auth observer');
});

test('auth observer is removed once after successful and failed access reads', async () => {
  for (const enabled of [false, true]) {
    const { client, calls } = syntheticClient({ enabled, merchants: [owner] });
    await loadMerchantWebAccess(client, userId);
    assert.equal(calls.filter(name => name === 'onAuthStateChange').length, 1);
    assert.equal(calls.filter(name => name === 'unsubscribe').length, 1);
  }
  for (const name of ['get_my_merchant_access', 'get_my_merchants']) {
    const { client, calls } = syntheticClient({ rpcErrors: { [name]: { message: 'ACCOUNT_LOCKED' } } });
    await assert.rejects(loadMerchantWebAccess(client, userId), /ACCOUNT_LOCKED/);
    assert.equal(calls.filter(name => name === 'unsubscribe').length, 1, `${name} failure removes its auth observer`);
  }
  const { client, calls } = syntheticClient();
  const getSession = client.auth.getSession;
  let reads = 0;
  client.auth.getSession = async () => {
    const result = await getSession();
    return ++reads === 1 ? result : { data: { session: null }, error: { message: 'Session unavailable' } };
  };
  await assert.rejects(loadMerchantWebAccess(client, userId));
  assert.equal(calls.filter(name => name === 'unsubscribe').length, 1, 'a final session failure removes its auth observer');
});
