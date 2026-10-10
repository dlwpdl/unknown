import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteRevenueCatCustomer, parseRevenueCatMembership, webhookUserIds } from '../supabase/functions/_shared/membership.ts';
import { MEMBERSHIP_LIMITS, membershipOffer } from '../src/lib/membership.ts';

const now = Date.parse('2026-09-10T00:00:00Z');
const future = '2026-10-10T00:00:00Z';
const user = '41111111-1111-1111-1111-111111111111';
const other = '42222222-2222-2222-2222-222222222222';
const response = (entitlements = {}, subscriptions = {}) => ({ request_date_ms: now, subscriber: { entitlements, subscriptions } });
const entitlement = (product = 'com.dlwpdl.gling.premium.monthly', expires = future) => ({ product_identifier: product, expires_date: expires });
const subscription = (extra = {}) => ({ store: 'app_store', is_sandbox: false, unsubscribe_detected_at: null, ...extra });

test('only verified, supported membership entitlements grant benefits', () => {
  const result = parseRevenueCatMembership(response({ gling_premium: entitlement(), unknown: entitlement() }, { 'com.dlwpdl.gling.premium.monthly': subscription() }), { now });
  assert.deepEqual(result.entitlements, [{ tier: 'premium', expires_at: future, product_id: 'com.dlwpdl.gling.premium.monthly', store: 'app_store', will_renew: true }]);
  assert.equal(result.observedAt, '2026-09-10T00:00:00.000Z');
  assert.deepEqual(parseRevenueCatMembership(response(), { now }).entitlements, []);
});

test('expiration, refunds, unsupported stores and missing receipts do not grant membership', () => {
  for (const [expires, receipt] of [
    ['2026-09-09T00:00:00Z', subscription()],
    [null, subscription()],
    [future, subscription({ refunded_at: '2026-09-09T00:00:00Z' })],
    [future, subscription({ store: 'promotional' })],
    [future, undefined],
  ]) {
    assert.deepEqual(parseRevenueCatMembership(response({ gling_premium: entitlement('com.dlwpdl.gling.premium.monthly', expires) }, receipt ? { 'com.dlwpdl.gling.premium.monthly': receipt } : {}), { now }).entitlements, []);
  }
});

test('sandbox membership is allowed only for designated test accounts', () => {
  const data = response({ gling_premium: entitlement() }, { 'com.dlwpdl.gling.premium.monthly': subscription({ is_sandbox: true }) });
  assert.deepEqual(parseRevenueCatMembership(data, { now }).entitlements, []);
  assert.equal(parseRevenueCatMembership(data, { now, allowSandbox: true }).entitlements[0].tier, 'premium');
});

test('cancellation retains paid time; grace and overlapping tiers are preserved', () => {
  const data = response({ gling_premium: entitlement(), gling_plus: entitlement('com.dlwpdl.gling.plus.monthly', '2026-09-09T00:00:00Z') }, {
    'com.dlwpdl.gling.premium.monthly': subscription({ unsubscribe_detected_at: '2026-09-09T00:00:00Z' }),
    'com.dlwpdl.gling.plus.monthly': subscription({ grace_period_expires_date: future }),
  });
  const result = parseRevenueCatMembership(data, { now }).entitlements;
  assert.equal(result.length, 2);
  assert.equal(result.find((e) => e.tier === 'premium').will_renew, false);
  assert.equal(result.find((e) => e.tier === 'plus').expires_at, future);
});

test('invalid provider responses fail without overwriting valid paid state with free', () => {
  for (const invalid of [null, {}, { subscriber: {} }, response(null), response([], {}), { ...response(), request_date_ms: 'invalid' }]) {
    assert.throws(() => parseRevenueCatMembership(invalid, { now }), /INVALID_REVENUECAT_RESPONSE/);
  }
  assert.throws(() => parseRevenueCatMembership(response({ gling_premium: entitlement('com.dlwpdl.gling.premium.monthly', 'invalid') }, { 'com.dlwpdl.gling.premium.monthly': subscription() }), { now }), /INVALID_REVENUECAT_RESPONSE/);
});

test('webhooks cover both sides of transfers and deduplicate authenticated UUID identities', () => {
  assert.deepEqual(webhookUserIds({ event: { id: 'event-1', type: 'TRANSFER', transferred_from: [user], transferred_to: [other], aliases: [other, '$RCAnonymousID:123'], app_user_id: user } }), [user, other]);
  assert.deepEqual(webhookUserIds({ event: { id: 'test-1', type: 'TEST', app_user_id: '$RCAnonymousID:123' } }), []);
  assert.throws(() => webhookUserIds({ tier: 'premium', user_id: user }), /INVALID_WEBHOOK/);
});

test('offers display store prices and reject an incorrectly configured subscription period', () => {
  const item = { identifier: 'premium_yearly', product: { identifier: 'com.dlwpdl.gling.premium.yearly', priceString: 'CA$149.99', subscriptionPeriod: 'P1Y' } };
  assert.deepEqual(membershipOffer(item), { id: 'premium_yearly', tier: 'premium', period: 'year', price: 'CA$149.99', productId: 'com.dlwpdl.gling.premium.yearly' });
  assert.equal(membershipOffer({ ...item, product: { ...item.product, subscriptionPeriod: 'P1W' } }), null);
  assert.equal(membershipOffer({ ...item, identifier: 'lifetime' }), null);
});

test('account deletion removes only the authenticated billing customer and preserves failures for retry', async () => {
  for (const status of [200, 404]) {
    await deleteRevenueCatCustomer(user, 'server-key', async (url, options) => {
      assert.equal(url, `https://api.revenuecat.com/v1/subscribers/${user}`);
      assert.equal(options.method, 'DELETE');
      assert.equal(options.headers.Authorization, 'Bearer server-key');
      return new Response(null, { status });
    });
  }
  await assert.rejects(deleteRevenueCatCustomer(user, 'server-key', async () => new Response(null, { status: 503 })), /BILLING_DELETE_FAILED/);
});

test('membership preserves meetup benefits and makes direct conversations unlimited in every tier', () => {
  assert.deepEqual(MEMBERSHIP_LIMITS, {
    free: { meetups: 3, conversations: null },
    plus: { meetups: 5, conversations: null },
    pro: { meetups: 10, conversations: null },
    premium: { meetups: 20, conversations: null },
  });
});
