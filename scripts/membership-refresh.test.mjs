import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('store catalog failure preserves synchronized membership and clears stale purchase offers', async () => {
  const hooks = []; let cursor = 0, catalogFails = false, catalogEmpty = false, rpcFails = false, synced = 0;
  const current = { tier: 'premium', productId: 'premium', postLimit: 5, postsUsed: 1 };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/membership-provider.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, Map, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      createContext: () => ({ Provider: 'Provider' }), useCallback: fn => fn, useEffect() {}, useLayoutEffect: fn => fn(),
      useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
      useState(initial) {
        const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
      },
    };
    if (name === 'react-native') return { Platform: { OS: 'ios' }, DeviceEventEmitter: { emit() {} } };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, me: { id: 'member' } }) };
    if (name === '@/lib/membership') return { membershipOffer: item => ({ id: item.identifier }) };
    if (name === '@/lib/purchases') return { purchaseUnavailableReason: () => null, withPurchases: async (_, fn) => fn({
      getOfferings: async () => {
        if (catalogFails) throw new Error('STORE_PRODUCTS_UNAVAILABLE');
        return { current: { availablePackages: catalogEmpty ? [] : [{ identifier: 'premium' }] } };
      },
    }) };
    if (name === '@/lib/supabase') return { supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'member' } } } }) },
      rpc: async () => ({ data: { tier: 'free' }, error: rpcFails ? new Error('OFFLINE') : null }),
      functions: { invoke: async () => { synced++; return { data: { membership: current } }; } },
    } };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const render = () => { cursor = 0; return exports.MembershipProvider({}).props.value; };
  await render().refresh();
  assert.equal(render().offers.length, 1);
  catalogFails = true;
  await render().refresh();
  const value = render();
  assert.equal(synced, 2, 'membership sync must not depend on the store catalog');
  assert.equal(value.membership, current);
  assert.equal(value.offers.length, 0, 'stale packages cannot remain purchasable');
  assert.match(value.error, /구독 상품/);
  assert.equal(value.loading, false);
  assert.equal(value.offersLoading, false);
  catalogFails = false; catalogEmpty = true;
  await value.refresh();
  assert.match(render().error, /스토어.*상품/, 'an empty store catalog must not silently look ready');
  rpcFails = true;
  await value.refresh();
  assert.match(render().error, /멤버십 정보/);
});

test('pending approval recovery requires confirmation, unchanged account and successful server recheck without purchasing', async () => {
  for (const platform of ['ios', 'android']) {
    const hooks = []; let cursor = 0, authId = 'member', sessionId = authId, purchased = 0, restored = 0, synced = 0;
    let purchaseFailure = { code: '20' }, syncFails = false, unavailable = null, onSync = async () => {};
    let snapshot = { tier: 'free', productId: null };
    const item = { identifier: 'premium_monthly', product: { identifier: 'premium_monthly' } };
    const offer = { id: item.identifier, productId: item.product.identifier };
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/membership-provider.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(source, { exports, Map, require(name) {
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
      if (name === 'react') return {
        createContext: () => ({ Provider: 'Provider' }), useCallback: fn => fn, useEffect() {}, useLayoutEffect: fn => fn(),
        useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
        useState(initial) {
          const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
          return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
        },
      };
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, me: { id: authId } }) };
      if (name === '@/lib/membership') return { membershipOffer: () => offer };
      if (name === '@/lib/purchases') return { purchaseUnavailableReason: () => unavailable, withPurchases: async (id, fn) => {
        if (id !== sessionId) throw new Error('ACCOUNT_CHANGED');
        return fn({
          PRORATION_MODE: { DEFERRED: 6 },
          getOfferings: async () => ({ current: { availablePackages: [item] } }),
          restorePurchases: async () => { restored++; return { activeSubscriptions: [] }; },
          purchasePackage: async () => { purchased++; if (purchaseFailure) throw purchaseFailure; },
        });
      } };
      if (name === '@/lib/supabase') return { supabase: {
        auth: { getSession: async () => ({ data: { session: { user: { id: sessionId } } } }) },
        rpc: async () => ({ data: snapshot }),
        functions: { invoke: async () => { synced++; await onSync(); return { data: { membership: snapshot }, error: syncFails ? new Error('PROVIDER_UNAVAILABLE') : null }; } },
      } };
      throw new Error(`Unexpected import: ${name}`);
    } });
    const render = () => { cursor = 0; return exports.MembershipProvider({}).props.value; };
    await render().refresh();
    await render().purchase(offer);
    assert.equal(purchased, 1);
    assert.equal(render().pendingApproval, true, platform);
    await render().refresh();
    await render().restore();
    assert.equal(render().pendingApproval, true, 'free and empty restore cannot prove cancellation');
    assert.match(render().notice, /승인 대기.*스토어/);
    assert.ok(render().purchaseUnavailableReason);
    let release, started;
    const reachedSync = new Promise(resolve => { started = resolve; });
    const heldSync = new Promise(resolve => { release = resolve; });
    syncFails = true; onSync = async () => { started(); await heldSync; };
    const syncsBeforeBusy = synced;
    const recovery = render().confirmPendingCancellation();
    await reachedSync;
    assert.equal(render().busy, true);
    await render().confirmPendingCancellation();
    await render().purchase(offer);
    assert.equal(synced, syncsBeforeBusy + 1, 'repeated confirmation shares the existing operation guard');
    assert.equal(purchased, 1, 'checkout cannot overlap recovery');
    release(); await recovery;
    syncFails = false; onSync = async () => {};
    unavailable = '스토어 연결을 확인해 주세요.';
    const syncsBeforeUnavailable = synced;
    await render().confirmPendingCancellation();
    assert.equal(synced, syncsBeforeUnavailable);
    unavailable = null;
    assert.equal(render().pendingApproval, true, 'unavailable SDK must not clear pending');
    const syncsBeforeMismatch = synced;
    sessionId = 'other';
    await render().confirmPendingCancellation();
    assert.equal(synced, syncsBeforeMismatch, 'a changed actual session cannot recheck the previous account');
    sessionId = 'member';
    syncFails = true;
    await render().confirmPendingCancellation();
    assert.equal(render().pendingApproval, true, 'provider failure must preserve pending');
    syncFails = false;
    snapshot = {};
    await render().confirmPendingCancellation();
    assert.equal(render().pendingApproval, true, 'an incomplete server response cannot unlock checkout');
    snapshot = { tier: 'free', productId: null };
    onSync = async () => { sessionId = 'other'; };
    await render().confirmPendingCancellation();
    sessionId = 'member'; onSync = async () => {};
    assert.equal(render().pendingApproval, true, 'session changes during the recheck must preserve pending');
    onSync = async () => { authId = 'other'; render(); authId = 'member'; render(); };
    await render().confirmPendingCancellation();
    assert.equal(render().pendingApproval, true, 'a transient account switch also invalidates confirmation');
    onSync = async () => {};
    authId = sessionId = 'other';
    await render().confirmPendingCancellation();
    assert.equal(render().pendingApproval, false, 'another account must not see the pending request');
    authId = sessionId = 'member';
    assert.equal(render().pendingApproval, true, 'the original account still owns its pending request');
    await render().confirmPendingCancellation();
    assert.equal(render().pendingApproval, false);
    assert.equal(render().purchaseUnavailableReason, null);
    assert.equal(purchased, 1, 'confirmation must never purchase or restore');
    assert.equal(restored, 1, 'confirmation must not submit a new restore');
    syncFails = true;
    await render().purchase(offer);
    assert.equal(purchased, 1, 'the next checkout must repeat authoritative sync before purchasing');
    syncFails = false; purchaseFailure = null;
    await render().purchase(offer);
    assert.equal(purchased, 2);
    assert.equal(render().pendingApproval, false, 'a completed purchase is not a cancellation-confirmable approval request');
    assert.ok(render().purchaseUnavailableReason);
    await render().confirmPendingCancellation();
    assert.ok(render().purchaseUnavailableReason, 'a completed but unverified purchase must remain blocked');
    snapshot = { tier: 'plus', productId: 'plus_monthly', store: platform === 'ios' ? 'app_store' : 'play_store' };
    await render().refresh();
    purchaseFailure = { code: '20' };
    await render().purchase(offer);
    assert.equal(render().pendingApproval, true);
    await render().confirmPendingCancellation();
    assert.equal(render().pendingApproval, false);
    assert.equal(render().membership.tier, 'plus', 'a canceled upgrade must retain the existing subscription');
    assert.equal(purchased, 3, 'upgrade cancellation confirmation must never purchase');
  }
});
