import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWebshop, compareWebshopPrices, webshopRedirectUrl, parseBusinessPlaceLinks, bindBusinessPlaces } from '../src/lib/webshops.ts';

const merchantId = 'a3310000-0000-4000-8000-000000000001';
const fixture = () => ({ merchantId, cityId: 'vancouver', url: 'https://www.order.store/ca/store/jimoco-cafe-%26-pasta-austin/ZFgz2GjZSAuhlUYeO1fupA', provider: 'uber',
  placeKeys: ['partner:jimoco-coquitlam'], verifiedAt: '2026-10-23T11:02:46Z', promoCode: null, checkoutComparison: null,
  comparisons: [{ id: 'rose', name: 'Rose Forno', uberCents: 2400, webCents: 1900 }, { id: 'meat', name: 'Meat Lover', uberCents: 2400, webCents: 2000 }, { id: 'chicken', name: 'Chicken Alfredo', uberCents: 2300, webCents: 1900 }] });

test('verified menu prices produce the representative maximum and menu-only basket, never a checkout total', () => {
  const result = compareWebshopPrices(parseWebshop(fixture()));
  assert.equal(result.maximumPercent, 20.8);
  assert.deepEqual(result.summary, { kind: 'menu', uberCents: 7100, webCents: 5800, savingCents: 1300 });
  assert.equal(result.items[1].percent, 16.7);
});

test('full checkout comparison requires observed fees and consistent totals on both sides', () => {
  const value = fixture();
  const quote = { itemsCents: 7100, deliveryCents: 199, serviceCents: 300, discountCents: 0, taxCents: 380, tipCents: 0, totalCents: 7979 };
  value.checkoutComparison = { verifiedAt: '2026-10-23T11:02:46Z', fulfillment: 'delivery', basketLabel: 'Same three pasta dishes', sameConditionsConfirmed: true,
    uber: quote, webshop: { ...quote, itemsCents: 5800, serviceCents: 200, taxCents: 310, totalCents: 6509 } };
  assert.deepEqual(compareWebshopPrices(parseWebshop(value)).summary, { kind: 'checkout', uberCents: 7979, webCents: 6509, savingCents: 1470 });
  delete value.checkoutComparison.webshop.deliveryCents;
  assert.throws(() => parseWebshop(value), /INVALID_WEBSHOP/);
});

test('invalid prices, mismatched business IDs and non-webshop destinations cannot become order claims', () => {
  for (const patch of [{ url: 'https://www.order.store.evil.example/ca/store/slug/id' }, { url: 'https://user:pass@www.order.store/ca/store/slug/id' },
    { url: 'javascript:alert(1)' }, { url: 'https://www.ubereats.com/ca/store/slug/id' }, { merchantId: 'another-branch' },
    { comparisons: [{ id: 'x', name: 'Bad money', uberCents: 24.01, webCents: 19 }] }]) {
    assert.throws(() => parseWebshop({ ...fixture(), ...patch }), /INVALID_WEBSHOP/);
  }
  assert.equal(parseWebshop(null), null);
});

test('tracked links use only the registry merchant and opaque event/session, never a destination or credential', () => {
  const url = new URL(webshopRedirectUrl('https://example.supabase.co', merchantId, { eventId: merchantId, session: `webshop-${merchantId}`, platform: 'ios', source: 'comparison_sheet' }));
  assert.equal(url.pathname, '/functions/v1/webshop-redirect');
  assert.equal(url.searchParams.get('merchantId'), merchantId);
  assert.equal(url.searchParams.has('url'), false);
  assert.equal(url.searchParams.has('access_token'), false);
  assert.throws(() => webshopRedirectUrl('http://example.com', merchantId, { eventId: merchantId, session: 'x', platform: 'ios', source: 'comparison_sheet' }), /INVALID_WEBSHOP/);
});

test('business links preserve exact place/branch identity and reject conflicting bindings', () => {
  const links = [{ placeKey: 'osm:node:123', merchantId }, { placeKey: 'partner:jimoco-coquitlam', merchantId }];
  assert.deepEqual(parseBusinessPlaceLinks(links), Object.fromEntries(links.map(x => [x.placeKey, x.merchantId])));
  assert.throws(() => parseBusinessPlaceLinks([...links, { placeKey: 'osm:node:123', merchantId: 'a3310000-0000-4000-8000-000000000002' }]), /INVALID_BUSINESS_PLACE_LINKS/);
});

test('overlapping map categories share one explicit branch and never infer another business by name', () => {
  const shop = parseWebshop(fixture());
  const osm = { id: 'place:vancouver:osm:node:123', source: 'place', sourceId: 'osm:node:123', cityId: 'vancouver', title: 'Jimoco', category: 'dining' };
  const partner = { ...osm, id: 'partner:jimoco-coquitlam', sourceId: 'jimoco-coquitlam', glingVisited: { sourceUrl: '' } };
  const other = { ...osm, id: 'place:vancouver:osm:node:456', sourceId: 'osm:node:456' };
  const result = bindBusinessPlaces([osm, partner, other], { 'osm:node:123': merchantId, 'partner:jimoco-coquitlam': merchantId }, [shop]);
  assert.equal(result.length, 2);
  assert.equal(result[0].merchantId, merchantId);
  assert.equal(result[0].category, 'dining');
  assert.equal(result[0].webshopDiscount, 20.8);
  assert.equal(result[0].delivery, true);
  assert.ok(result[0].glingVisited);
  assert.equal(result[1].merchantId, undefined);
  assert.equal(result[1].delivery, false);
  assert.equal(bindBusinessPlaces([osm], { 'osm:node:123': merchantId }, [])[0].delivery, false);
});
