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

test('the chat upcoming read uses its own ordered RPC while attendance history keeps the existing RPC', async () => {
  const api = await import('../src/lib/meetup-reviews.ts');
  assert.equal(typeof api.loadMeetupUpcomingSessions, 'function');
  const calls = [], payload = { isHost: false, member: true, kind: 'group', sessions: [] };
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: payload, error: null }; } };
  assert.equal(await api.loadMeetupUpcomingSessions(client, session), payload);
  assert.equal(await api.loadMeetupSessions(client, session), payload);
  assert.deepEqual(calls, [['get_meetup_upcoming_sessions', { p_post_id: session }], ['get_meetup_sessions', { p_post_id: session }]]);
  client.rpc = async () => ({ data: null, error: { message: 'MEETUP_ACCESS_REQUIRED' } });
  await assert.rejects(api.loadMeetupUpcomingSessions(client, session), /MEETUP_ACCESS_REQUIRED/);
});

test('the review screen reads the session queue and falls back to the meetup list on servers without it', async () => {
  const api = await import('../src/lib/meetup-reviews.ts');
  const calls = [], meetups = [{ postId: session, title: '맛집 탐방 모임', kind: 'group' }];
  let queue = { error: { code: 'PGRST202', message: 'Could not find the function public.get_my_meetup_review_queue' } };
  const client = { rpc: async name => { calls.push(name); return name === 'get_my_meetup_review_queue' ? queue : { data: meetups, error: null }; } };
  assert.deepEqual(await api.loadMyMeetupReviewQueue(client), { meetups });
  assert.deepEqual(calls, ['get_my_meetup_review_queue', 'get_my_meetup_review_inbox']);
  queue = { error: { code: '42883', message: 'function does not exist' } };
  assert.deepEqual(await api.loadMyMeetupReviewQueue(client), { meetups });
  queue = { data: [], error: null }; calls.length = 0;
  assert.deepEqual(await api.loadMyMeetupReviewQueue(client), { sessions: [] });
  assert.deepEqual(calls, ['get_my_meetup_review_queue'], 'with the migration the older list is not read');
  queue = { error: { code: 'P0001', message: 'AUTH_REQUIRED' } };
  await assert.rejects(api.loadMyMeetupReviewQueue(client), /AUTH_REQUIRED/, 'other failures stay visible instead of showing the old list');
});

test('the top card is the review that closes first, with days left counted in the meetup zone', async () => {
  const { nextReview, reviewDaysLeft, reviewDue } = await import('../src/lib/meetup-reviews.ts');
  const row = (id, reviewUntil, extra = {}) => ({ sessionId: id, postId: session, title: '모임', kind: 'group', timezone: 'America/Toronto', cityId: 'toronto',
    startsAt: '2026-11-08T23:00:00Z', endsAt: '2026-11-09T01:00:00Z', reviewUntil, isHost: false, verified: true, canReview: true, reviewStatus: null, ...extra });
  const late = row('late', '2026-11-20T01:00:00Z'), soon = row('soon', '2026-11-16T01:00:00Z');
  assert.equal(nextReview([late, soon, row('done', '2026-11-15T01:00:00Z', { reviewStatus: 'pending' }), row('closed', '2026-11-15T01:00:00Z', { canReview: false })]), soon);
  assert.equal(nextReview([row('done', '2026-11-15T01:00:00Z', { reviewStatus: 'published' })]), null);
  assert.equal(reviewDue(row('host', '2026-11-15T01:00:00Z', { canReview: false, isHost: true })), false);
  // Nov 16 01:00 UTC is Nov 15 20:00 in Toronto.
  assert.equal(reviewDaysLeft(soon, Date.parse('2026-11-15T15:00:00Z')), 0);
  assert.equal(reviewDaysLeft(soon, Date.parse('2026-11-14T15:00:00Z')), 1);
  assert.equal(reviewDaysLeft(soon, Date.parse('2026-11-13T15:00:00Z')), 2);
  assert.equal(reviewDaysLeft(soon, Date.parse('2026-11-16T03:00:00Z')), 0, 'never below zero');
});
