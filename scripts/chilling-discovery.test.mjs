import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryCursor, matchesChilling } from '../src/lib/chilling-discovery.ts';
test('advance from raw rows even when kind hides the entire page', () => {
  const page = Array.from({ length: 30 }, (_, i) => ({ id: String(i), createdAt: '2026-09-17', sortAt: '2026-09-18', room: { eventKind: 'group' } }));
  assert.equal(page.filter(p => matchesChilling(p, 'once', 'all')).length, 0);
  assert.deepEqual(discoveryCursor(page), { id: '29', createdAt: '2026-09-17', sortAt: '2026-09-18' });
  assert.equal(matchesChilling({ room: { eventKind: 'group' } }, 'group', 'hobby'), false);
  assert.equal(matchesChilling({ room: { eventKind: 'once', category: 'hobby', closed: true } }, 'once', 'hobby'), false);
  assert.equal(matchesChilling({ room: { eventKind: 'once', endsAt: '2026-09-17T12:00:00Z' } }, 'once', 'all', Date.parse('2026-09-17T12:00:00Z')), false);
});
