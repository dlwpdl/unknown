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
    if (name === '@/lib/community-data') return { POST_QUOTA_CHANGED_EVENT: 'quota' };
    if (name === '@/lib/membership') return { membershipOffer: item => ({ id: item.identifier }) };
    if (name === '@/lib/purchases') return { purchaseUnavailableReason: () => null, withPurchases: async (_, fn) => fn({
      getOfferings: async () => {
        if (catalogFails) throw new Error('STORE_PRODUCTS_UNAVAILABLE');
        return { current: { availablePackages: catalogEmpty ? [] : [{ identifier: 'premium' }] } };
      },
    }) };
    if (name === '@/lib/supabase') return { supabase: {
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
