import assert from 'node:assert/strict';
import test from 'node:test';
import * as chilling from '../src/lib/chilling.ts';

const draft = { kind: 'group', startsAt: '', endsAt: '', timezone: '', cadence: 'weekly', capacity: 50 };
const now = Date.parse('2026-10-25T12:00:00Z');

test('an unexpired personal membership sets the seat limit by tier, matching the server', () => {
  for (const [tier, seats] of [['plus', 30], ['pro', 100], ['premium', 500], ['admin', 5000]]) {
    assert.equal(chilling.chillingCapacityLimit({ tier, expiresAt: '2026-10-26T12:00:00Z' }, now), seats);
  }
  for (const membership of [undefined, null, { tier: 'free', expiresAt: null },
    { tier: 'premium', expiresAt: null }, { tier: 'plus', expiresAt: 'invalid' },
    { tier: 'pro', expiresAt: '2026-10-25T12:00:00Z' }, { tier: 'premium', expiresAt: '2026-10-24T12:00:00Z' },
    { tier: 'unknown', expiresAt: '2026-10-26T12:00:00Z' },
    { tier: 'free', expiresAt: null, businessSubscription: { tier: 'premium', expiresAt: '2026-10-26T12:00:00Z' } }]) {
    assert.equal(chilling.chillingCapacityLimit(membership, now), 10);
  }
});

test('normalization keeps free50 and paid5000 inclusive and rejects the next seat', () => {
  assert.equal(chilling.normalizeChillingEvent(draft, 50).capacity, 50);
  assert.throws(() => chilling.normalizeChillingEvent({ ...draft, capacity: 51 }, 50), /INVALID_CAPACITY/);
  assert.equal(chilling.normalizeChillingEvent({ ...draft, capacity: 5000 }, 5000).capacity, 5000);
  assert.throws(() => chilling.normalizeChillingEvent({ ...draft, capacity: 5001 }, 5000), /INVALID_CAPACITY/);
  for (const capacity of [1, 2.5, NaN, Infinity, '5000']) {
    assert.throws(() => chilling.normalizeChillingEvent({ ...draft, capacity }), /INVALID_CAPACITY/);
  }
});

test('the shared normalizer permits large requests while the server remains membership authority', async () => {
  assert.equal(chilling.normalizeChillingEvent({ ...draft, capacity: 5000 }).capacity, 5000);
  let sent;
  const client = { rpc: async (name, args) => { sent = { name, args }; return { error: new Error('INVALID_EVENT_CAPACITY') }; } };
  await assert.rejects(chilling.configureChillingEvent(client, 'existing-event', { ...draft, capacity: 5000 }), /INVALID_EVENT_CAPACITY/);
  assert.equal(sent.name, 'configure_chilling_event');
  assert.equal(sent.args.p_capacity, 5000);
});
