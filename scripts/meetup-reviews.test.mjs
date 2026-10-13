import { mannerLabel, loadPublicUserActivity } from '../src/lib/user-profile.ts';
import { reviewAdminTrustTarget } from '../src/lib/admin-trust-reviews.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeMannerReview, writeMeetupReview } from '../src/lib/meetup-reviews.ts';

const session = 'ab000000-0000-0000-0000-000000000001', subject = 'ab000000-0000-0000-0000-000000000002';
test('small samples show insufficient information, never zero trust', () => {
  assert.match(mannerLabel({ participants: 0, score: null }), /쌓이는 중/);
  assert.match(mannerLabel({ participants: 5, score: 80 }), /리뷰가 쌓이는 중 · 0명/);
  assert.match(mannerLabel({ rating: { participants: 4, score: 10 } }), /쌓이는 중/);
  assert.equal(mannerLabel({ rating: { participants: 5, score: 8.7 } }), '8.7 / 10 · 5명');
});
test('personal feedback uses the scoped RPC and preserves null unknowns', async () => {
  let call;
  const client = { rpc: async (name, args) => { call = [name, args]; return { data: session }; } };
  const signals = { punctual: null, respectful: true, boundaries: true };
  await writeMannerReview(client, subject, { conversationId: session }, signals, 8.5, '  친절했어요  ');
  assert.deepEqual(call, ['write_user_review', { p_session_id: null, p_conversation_id: session, p_subject_id: subject, p_signals: signals, p_score: 8.5, p_body: '친절했어요' }]);
  await assert.rejects(writeMannerReview(client, subject, { conversationId: session }, { ...signals, punctual: true }, 8, ''), /INVALID_REVIEW/);
  await assert.rejects(writeMannerReview(client, subject, { sessionId: session }, { ...signals, respectful: false }, 8, ''), /REVIEW_REASON_REQUIRED/);
  await assert.rejects(writeMannerReview(client, subject, { sessionId: session, conversationId: session }, signals, 8, ''), /INVALID_REVIEW/);
  for (const score of [null, NaN, Infinity, 0, 10.5, 7.3]) {
    await assert.rejects(writeMannerReview(client, subject, { sessionId: session }, signals, score, ''), /INVALID_REVIEW/);
  }
  await assert.rejects(writeMannerReview(client, subject, { sessionId: session }, signals, 5, ''), /REVIEW_REASON_REQUIRED/);
});
test('regular meetup feedback validates scores and keeps an ambiguous failure visible', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: null, error: { message: 'offline' } }; } };
  await assert.rejects(writeMeetupReview(client, session, 7.3, ''), /INVALID_REVIEW/);
  assert.equal(calls, 0);
  await assert.rejects(writeMeetupReview(client, session, 8, ''), /offline/);
  assert.equal(calls, 1);
});
test('moderation binds the fetched version and private content type', async () => {
  let call;
  const client = { rpc: async (name, args) => { call = [name, args]; return {}; } };
  const version = '2026-10-11T08:00:00.123456+00:00';
  await reviewAdminTrustTarget(client, 'manner_review', subject, 'published', ' 근거와 맥락을 확인함 ', version);
  assert.equal(call[0], 'review_admin_trust_target');
  assert.equal(call[1].p_expected_updated_at, version);
  assert.equal(call[1].p_note, '근거와 맥락을 확인함');
  await assert.rejects(reviewAdminTrustTarget(client, 'user', subject, 'published', '확인한 메모입니다', version), /INVALID_REVIEW/);
});
test('public activity uses category history and propagates hidden/blocked responses', async () => {
  let call;
  const client = { rpc: async (name, args) => { call = [name, args]; return { data: [] }; } };
  assert.deepEqual(await loadPublicUserActivity(client, subject, 'story', null, 'guest'), []);
  assert.equal(call[0], 'get_public_user_activity');
  assert.equal(call[1].p_kind, 'story');
  assert.equal(call[1].p_before_created, null);
  await assert.rejects(loadPublicUserActivity(client, subject, 'private', null, 'guest'), /INVALID_POST_KIND/);
});
