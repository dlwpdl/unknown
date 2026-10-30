import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipEndDate, parseAdminMembership } from '../src/lib/admin-membership.ts';

const personal = { tier: 'plus', source: 'admin', expires_at: '2026-11-30T07:59:59Z', will_renew: false,
  grant: { tier: 'plus', expires_at: '2026-11-30T07:59:59Z', active: true, note: null, created_at: '2026-10-30T00:00:00Z', created_by: '관리' } };

test('admin membership responses are checked before the screen uses them', () => {
  const value = { user_id: 'u1', personal, businesses: [{ ...personal, grant: null, source: 'free', merchant_id: 'm1', name: '가게', city_name: '밴쿠버', owner_verified: true, bound_elsewhere: false }], history: [] };
  assert.equal(parseAdminMembership(value, 'u1').businesses[0].name, '가게');
  assert.throws(() => parseAdminMembership(value, 'u2'), /MEMBERSHIP_READ_FAILED/);
  assert.throws(() => parseAdminMembership({ ...value, personal: { ...personal, source: 'gift' } }, 'u1'), /MEMBERSHIP_READ_FAILED/);
  assert.throws(() => parseAdminMembership({ ...value, personal: { ...personal, grant: { ...personal.grant, tier: 'free' } } }, 'u1'), /MEMBERSHIP_READ_FAILED/);
});

test('end dates are the member city day, not UTC', () => {
  const lateEvening = new Date('2026-10-31T05:30:00Z'); // 22:30 on Oct 30 in Vancouver
  assert.equal(membershipEndDate(0, lateEvening), '2026-10-30');
  assert.equal(membershipEndDate(30, lateEvening), '2026-11-29');
  // Late on the chosen day reads back as that day under either Pacific offset (tz data differs between machines).
  assert.equal(membershipEndDate(0, new Date('2026-12-01T05:00:00Z')), '2026-11-30');
});
