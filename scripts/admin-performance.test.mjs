import assert from 'node:assert/strict';
import test from 'node:test';
import * as performance from '../src/lib/admin-performance.ts';
import * as product from '../src/lib/product-analytics.ts';

// A missing or miswired collector loses real taps; a rejected RPC must not be claimed as recorded.
test('product recording sends only the fixed action, target, city and platform', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: true, error: null }; } };
  await product.recordProductEvent?.(client, { kind: 'notification_push_open', targetId: '11111111-1111-1111-1111-111111111111', platform: 'ios', privateText: 'must never leave' });
  assert.deepEqual(calls, [['record_product_event', { p_kind: 'notification_push_open', p_target_id: '11111111-1111-1111-1111-111111111111', p_city_id: null, p_platform: 'ios' }]]);
});

test('analytics failures remain visible to callers without fabricating success', async () => {
  assert.equal(typeof product.recordProductEvent, 'function');
  const failure = new Error('offline');
  await assert.rejects(() => product.recordProductEvent({ rpc: async () => ({ error: failure }) }, { kind: 'place_view', cityId: 'vancouver', targetId: 'node/1', platform: 'ios' }), failure);
});

test('source extraction returns only recognized channels from Gling entry links', () => {
  assert.equal(product.getAcquisitionSource?.('https://gling.ej-entertainment.com/?utm_source=Instagram&utm_term=private-input'), 'instagram');
  assert.equal(product.getAcquisitionSource?.('gling://events?utm_source=threads'), 'threads');
  for (const url of [null, 'bad-url', 'https://evil.example/?utm_source=instagram', 'https://gling.ej-entertainment.com/?utm_source=private-user-name']) {
    assert.equal(product.getAcquisitionSource?.(url), 'unknown');
  }
});

test('performance loading preserves filters and reports unavailable backend separately from zero', async () => {
  const calls = [], data = { activity: { dau: 0 }, discovery: { startedAt: null } };
  const client = { rpc: async (...args) => { calls.push(args); return { data, error: null }; } };
  const result = await performance.loadAdminPerformance?.(client, { days: 7, city: 'vancouver', tier: 'all', includeInternal: false, offset: 0 }, 'ios');
  assert.deepEqual(calls, [['get_admin_performance', { p_days: 7, p_city: 'vancouver', p_tier: 'all', p_include_internal: false, p_platform: 'ios' }]]);
  assert.strictEqual(result, data);
  await assert.rejects(() => performance.loadAdminPerformance({ rpc: async () => ({ data: null, error: new Error('ADMIN_REQUIRED') }) }, { days: 7, city: null, tier: 'all', includeInternal: false, offset: 0 }), /ADMIN_REQUIRED/);
});
