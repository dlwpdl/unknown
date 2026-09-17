import assert from 'node:assert/strict';
import test from 'node:test';
import { meetupPolicyNotice, meetupRestrictionError } from '../src/lib/meetup-policy.ts';

const now = Date.parse('2026-09-17T12:00:00Z');
const clear = { leaves24h: 0, closures7d: 0, creates24h: 0, creates7d: 0, joinBlockedUntil: null, hostBlockedUntil: null, createBlockedUntil: null };
test('warns before the next qualifying action and distinguishes hosting from participation', () => {
  assert.equal(meetupPolicyNotice(clear, 'leave', now), null);
  assert.match(meetupPolicyNotice({ ...clear, leaves24h: 2 }, 'leave', now), /12시간/);
  assert.equal(meetupPolicyNotice({ ...clear, leaves24h: 2 }, 'host', now), null);
  assert.match(meetupPolicyNotice({ ...clear, closures7d: 1 }, 'close', now), /24시간/);
  assert.match(meetupPolicyNotice({ ...clear, creates7d: 9 }, 'once', now), /1회/);
});
test('shows the later release when two hosting limits overlap, hides elapsed restrictions', () => {
  const early = '2026-09-18T01:00:00Z', late = '2026-09-19T03:15:00Z';
  const policy = { ...clear, hostBlockedUntil: early, createBlockedUntil: late };
  const options = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' };
  assert.ok(meetupPolicyNotice(policy, 'once', now).includes(new Date(late).toLocaleString('ko-KR', options)));
  assert.ok(meetupPolicyNotice(policy, 'host', now).includes(new Date(early).toLocaleString('ko-KR', options)));
  assert.equal(meetupPolicyNotice({ ...clear, joinBlockedUntil: '2026-09-17T12:00:00Z' }, 'join', now), null);
});
test('API restriction errors show a release timestamp but never echo arbitrary server details', () => {
  assert.match(meetupRestrictionError({ message: 'MEETUP_JOIN_RESTRICTED', details: '2026-09-18T01:00:00Z' }), /다시/);
  assert.equal(meetupRestrictionError({ message: 'MEETUP_HOST_RESTRICTED', details: '2026-09-18 01:00:00+00' }), meetupRestrictionError({ message: 'MEETUP_HOST_RESTRICTED', details: '2026-09-18T01:00:00Z' }));
  assert.doesNotMatch(meetupRestrictionError({ message: 'CHILLING_CREATE_LIMIT', details: '<secret>' }), /secret/);
  assert.equal(meetupRestrictionError({ message: 'unrelated failure' }), null);
});
