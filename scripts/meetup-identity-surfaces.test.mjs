import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPublicFeed } from '../src/lib/feed-data.ts';
import { loadPendingMeetupRequests } from '../src/lib/community-data.ts';

test('meetup cards never borrow community identity, neighborhood or account badges', () => {
  const row = { id: 'meetup', author_id: 'account', author_nickname: '개인 이름', author_neighborhood: '개인 동네', author_verification_level: 3,
    tag_id: 5, tag_slug: 'meetup', tag_kind: 'meetup', title: '산책', body: '소개', created_at: new Date().toISOString(), hashtags: [], image_paths: [] };
  const oldMeetup = mapPublicFeed([{ ...row, room_preview: { id: 'meetup' } }], [])[0];
  assert.equal(oldMeetup.author.nickname, '모임 호스트');
  assert.equal(oldMeetup.author.neighborhood, undefined);
  assert.equal(oldMeetup.author.verified, false);
  assert.equal(oldMeetup.author.trustLevel, undefined);
  const currentMeetup = mapPublicFeed([{ ...row, room_preview: { id: 'meetup', hostDisplayName: '걷는친구' } }], [])[0];
  assert.equal(currentMeetup.author.nickname, '걷는친구');
  assert.equal(currentMeetup.author.id, 'account', 'global block/report identity remains the same account');
  const communityPost = mapPublicFeed([{ ...row, room_preview: null }], [])[0];
  assert.equal(communityPost.author.nickname, row.author_nickname);
  assert.equal(communityPost.author.neighborhood, row.author_neighborhood);
  assert.equal(communityPost.author.trustLevel, 3);
});

test('host inbox uses the guarded alias RPC and cannot request another account profile', async () => {
  const row = { id: 'request', requester: { nickname: '모임 별명', verification_level: 0 } };
  const client = { rpc: async (name, args) => { assert.equal(name, 'get_pending_chilling_requests'); assert.equal(args, undefined); return { data: [row], error: null }; }, from() { assert.fail('no public profiles lookup'); } };
  assert.deepEqual(await loadPendingMeetupRequests(client), [row]);
  await assert.rejects(loadPendingMeetupRequests({ rpc: async () => ({ data: null, error: new Error('ACCOUNT_LOCKED') }) }), /ACCOUNT_LOCKED/);
});

test('older pending applications use the stable server cursor, without a profile lookup', async () => {
  const cursor = { id: '00000000-0000-4000-8000-000000000001', createdAt: '2026-10-19T04:00:00Z' };
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: [], error: null }; } };
  assert.deepEqual(await loadPendingMeetupRequests(client, cursor), []);
  assert.deepEqual(calls, [['get_pending_chilling_requests', { p_before_created: cursor.createdAt, p_before_id: cursor.id }]]);
});
