import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

import { parsePromotionPurchase } from '../supabase/functions/_shared/promotions.ts';
import { promotionOffer } from '../src/lib/promotions.ts';

const now = Date.now();
const event = { id: 'credit-event-1', type: 'NON_RENEWING_PURCHASE', app_id: 'appfaedf65971',
  app_user_id: '81111111-1111-4111-8111-111111111111', product_id: 'com.dlwpdl.gling.credits.900',
  store: 'APP_STORE', environment: 'PRODUCTION', transaction_id: 'store-transaction-1', event_timestamp_ms: now };

test('verified credit events use exact products and retain purchase identity for refunds', () => {
  const parsed = parsePromotionPurchase(event, { now });
  assert.equal(parsed.credits, 900);
  assert.equal(parsed.transaction_id, 'store-transaction-1');
  assert.equal(parsed.user_id, event.app_user_id);
  assert.equal(parsePromotionPurchase({ ...event, credits: 999999 }, { now }).credits, 900);
  for (const type of ['CANCELLATION', 'REFUND_REVERSED']) {
    assert.equal(parsePromotionPurchase({ ...event, type }, { now }).event_type, type);
  }
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'TEST', 'TEMPORARY_ENTITLEMENT_GRANT']) {
    assert.equal(parsePromotionPurchase({ ...event, type }, { now }), null);
  }
  assert.equal(parsePromotionPurchase({ ...event, product_id: 'com.dlwpdl.gling.plus.monthly' }, { now }), null);
});

test('test purchases and a different app cannot fund a production wallet', () => {
  assert.equal(parsePromotionPurchase({ ...event, environment: 'SANDBOX' }, { now }), null);
  assert.equal(parsePromotionPurchase({ ...event, environment: 'SANDBOX' }, { now, allowSandbox: true }).environment, 'SANDBOX');
  assert.throws(() => parsePromotionPurchase({ ...event, app_id: 'another-app' }, { now }));
  assert.throws(() => parsePromotionPurchase({ ...event, store: 'PLAY_STORE' }, { now }));
  const android = { ...event, app_id: 'app6090b6749b', store: 'PLAY_STORE', product_id: 'gling_credits_1700' };
  assert.equal(parsePromotionPurchase(android, { now }).credits, 1700);
  for (const bad of [{ transaction_id: '' }, { app_user_id: '$RCAnonymousID:someone' }, { event_timestamp_ms: now + 600_000 },
    { environment: 'UNKNOWN' }, { event_timestamp_ms: '123' }]) {
    assert.throws(() => parsePromotionPurchase({ ...event, ...bad }, { now }));
  }
});

test('credit offers require a matching consumable and actual localized store price', () => {
  const item = { identifier: 'credits_900', product: { identifier: 'com.dlwpdl.gling.credits.900', priceString: 'CA$1.99', subscriptionPeriod: null } };
  assert.deepEqual(promotionOffer(item), { id: 'credits_900', credits: 900, price: 'CA$1.99', productId: item.product.identifier });
  for (const bad of [{ ...item, identifier: 'plus_monthly' }, { ...item, product: { ...item.product, identifier: 'gling_credits_1700' } },
    { ...item, product: { ...item.product, priceString: '' } }, { ...item, product: { ...item.product, subscriptionPeriod: 'P1M' } }]) {
    assert.equal(promotionOffer(bad), null);
  }
});

test('release builds hide promotions even with the opt-in flag, and direct routes do no work', () => {
  const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const library = compile('../src/lib/promotions.ts');
  for (const [dev, flag, expected] of [[false,'1',false],[false,undefined,false],[true,undefined,false],[true,'0',false],[true,'1',true]]) {
    const context = { exports: {}, __DEV__: dev, process: { env: { EXPO_PUBLIC_PROMOTIONS_PREVIEW: flag } } };
    vm.runInNewContext(library, context);
    assert.equal(context.exports.PROMOTIONS_PREVIEW_ENABLED, expected);
  }
  const context = { exports: {}, require: (id) => {
    if (id === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (id === 'expo-router') return { Redirect: 'Redirect', useLocalSearchParams() { throw new Error('Hidden route mounted'); } };
    if (id === '@/lib/promotions') return { PROMOTIONS_PREVIEW_ENABLED: false };
    if (id === 'react-native') return { StyleSheet: { create: (styles) => styles } };
    if (id === '@/constants/theme') return { Spacing: {} };
    return {};
  } };
  vm.runInNewContext(compile('../src/app/profile/promotions.tsx'), context);
  const result = context.exports.default();
  assert.equal(result.type, 'Redirect');
  assert.equal(result.props.href, '/profile');
});
