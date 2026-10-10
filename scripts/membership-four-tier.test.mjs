import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMBERSHIP_LIMITS, BUSINESS_LIMITS, membershipOffer } from '../src/lib/membership.ts';
import { parseRevenueCatMembership } from '../supabase/functions/_shared/membership.ts';

const now = Date.parse('2026-10-09T00:00:00Z');
const expires = '2026-11-09T00:00:00Z';
const data = entries => ({ request_date_ms: now, subscriber: {
  entitlements: Object.fromEntries(entries.map(([key, product]) => [key, { product_identifier: product, expires_date: expires }])),
  subscriptions: Object.fromEntries(entries.map(([, product]) => [product, { store: 'app_store', is_sandbox: false }])),
} });

test('four general tiers keep chat unlimited and apply reviewed group limits', () => {
  assert.deepEqual(MEMBERSHIP_LIMITS, {
    free: { meetups: 3, conversations: null }, plus: { meetups: 5, conversations: null },
    pro: { meetups: 10, conversations: null }, premium: { meetups: 20, conversations: null },
  });
});

test('higher business tiers shorten the same-post wait without adding monthly bumps', () => {
  assert.deepEqual(['plus','pro','premium'].map(tier => [BUSINESS_LIMITS[tier].bumpCooldownHours, BUSINESS_LIMITS[tier].bumps]), [[72,8],[60,16],[48,24]]);
});

test('general and business subscriptions coexist and keep separate receipt scope', () => {
  const result = parseRevenueCatMembership(data([
    ['gling_general_pro', 'com.dlwpdl.gling.general.pro.monthly.v2'],
    ['gling_business_premium', 'com.dlwpdl.gling.business.premium.monthly.v2'],
  ]), { now });
  assert.deepEqual(result.entitlements.map(e => [e.kind, e.tier, e.plan_version]), [['general','pro',2], ['business','premium',2]]);
});

test('misattached product or legacy entitlement cannot convert business payments into personal benefits', () => {
  for (const key of ['gling_general_premium','gling_premium']) {
    assert.deepEqual(parseRevenueCatMembership(data([[key,'com.dlwpdl.gling.business.premium.monthly.v2']]), { now }).entitlements, []);
  }
  assert.deepEqual(parseRevenueCatMembership(data([['gling_business_premium','com.dlwpdl.gling.general.premium.monthly.v2']]), { now }).entitlements, []);
});

test('new offers require their exact family SKU and an actual monthly store price', () => {
  const item = { identifier: 'business_pro_monthly', product: { identifier: 'com.dlwpdl.gling.business.pro.monthly.v2', priceString: 'CA$49.00', subscriptionPeriod: 'P1M' } };
  assert.deepEqual(membershipOffer(item), { id:'business_pro_monthly', kind:'business', planVersion:2, tier:'pro', period:'month', price:'CA$49.00', productId:item.product.identifier });
  assert.equal(membershipOffer({ ...item, product:{ ...item.product, identifier:'com.dlwpdl.gling.general.pro.monthly.v2' } }), null);
  assert.equal(membershipOffer({ ...item, product:{ ...item.product, subscriptionPeriod:'P1Y' } }), null);
  assert.equal(membershipOffer({ ...item, product:{ ...item.product, priceString:'' } }), null);
});

test('Google base plans map to the same family without accepting arbitrary product aliases', () => {
  const item = { identifier:'general_plus_monthly', product:{ identifier:'gling_general_plus_v2:monthly', priceString:'CA$4.99', subscriptionPeriod:'P1M' } };
  assert.equal(membershipOffer(item)?.kind, 'general');
  assert.equal(membershipOffer({ ...item, product:{ ...item.product, identifier:'gling_business_plus_v2:monthly' } }), null);
});
