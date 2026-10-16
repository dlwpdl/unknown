import assert from 'node:assert/strict';
import test from 'node:test';
import * as discovery from '../src/lib/discovery.ts';

const pick = { id: 'sample-cafe', cityId: 'vancouver', title: 'Sample café', label: 'Sample branch', category: 'cafe', latitude: 49.28, longitude: -123.12, reason: '선정 이유 예시', sourceUrl: 'https://example.org/city-picks', postIds: ['p1', 'p2'] };
const post = (id, extra = {}) => discovery.discoveryPost({ id, cityId: 'vancouver', author: { id: 'u1' }, tag: { slug: 'food' }, kind: 'story', title: '추천 카페', hashtags: ['카페'], body: 'Google 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12\n위치: Sample branch', ...extra });
const merge = (...args) => { assert.equal(typeof discovery.mergeCityTop25, 'function'); return discovery.mergeCityTop25(...args); };

test('verified Top 25 and matching recommendations share one canonical place', () => {
  const [item] = merge([post('p1'), post('p2')], 'vancouver', [pick]);
  assert.equal(item.id, 'place:vancouver:sample-cafe');
  assert.equal(item.title, pick.title);
  assert.equal(item.top25.reason, pick.reason);
  assert.equal(item.post.id, 'p1');
  assert.equal(merge([post('p1'), post('p2')], 'vancouver', [pick]).length, 1);
});
test('same name and coordinates alone do not merge different places or branches', () => {
  const items = merge([post('unverified')], 'vancouver', [pick]);
  assert.equal(items.length, 2);
  assert.equal(items.find(i => i.sourceId === 'unverified').top25, undefined);
});
test('curated public place survives without exposing a hidden recommendation or private coordinates', () => {
  const [item] = merge([], 'vancouver', [pick]);
  assert.equal(item.source, 'place');
  assert.equal(item.post, undefined);
  assert.equal(item.imageUri, undefined);
  assert.equal(item.latitude, pick.latitude);
  assert.equal(item.top25.sourceUrl, pick.sourceUrl);
});
test('city scoping and listing/event separation prevent false merges', () => {
  const housing = post('p1', { kind: 'listing', tag: { slug: 'housing' }, listingStatus: 'open', expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(merge([housing], 'vancouver', [pick]).length, 2);
  assert.equal(merge([post('p1', { cityId: 'toronto' })], 'vancouver', [pick]).length, 1);
  assert.equal(merge([post('p1')], 'toronto', [pick]).length, 0);
});
test('legacy Top25-only calls retain query restrictions and hashtags cannot award membership', () => {
  const [item] = merge([], 'vancouver', [pick]);
  assert.equal(discovery.discoveryMatches(item, 'cafe', 'café', true), true);
  assert.equal(discovery.discoveryMatches(item, 'housing', '', true), false);
  assert.equal(discovery.discoveryMatches(post('unverified', { hashtags: ['카페', 'TOP25'] }), 'cafe', '', true), false);
  assert.equal(discovery.discoveryMatches(post('unverified'), 'cafe', '', false), true);
  assert.equal(discovery.discoveryMatches({ ...item, category: 'exhibition' }, 'places', '', true), true);
  assert.equal(discovery.discoveryMatches({ ...item, category: 'exhibition' }, 'events', '', true), false);
});
test('invalid public source, coordinates, duplicate bindings and over-25 collections fail closed', () => {
  for (const patch of [{ id: 'x'.repeat(81) }, { cityId: 'x'.repeat(65) }, { id: 'bad\u0000id' }, { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'http://example.org' }, { sourceUrl: 'https://user:password@example.org' }, { latitude: NaN }, { longitude: 181 }, { reason: '' }, { category: 'housing' }]) assert.throws(() => merge([], 'vancouver', [{ ...pick, ...patch }]));
  assert.throws(() => merge([], 'vancouver', [pick, pick]));
  assert.throws(() => merge([], 'vancouver', [pick, { ...pick, id: 'another-place' }]));
  assert.throws(() => merge([], 'vancouver', Array.from({ length: 26 }, (_, i) => ({ ...pick, id: `p${i}`, postIds: [] }))));
  assert.equal(merge([], 'vancouver', Array.from({ length: 25 }, (_, i) => ({ ...pick, id: `p${i}`, postIds: [] }))).length, 25);
});
