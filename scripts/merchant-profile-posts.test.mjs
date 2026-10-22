import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../src/lib/merchant-profile.ts';

const merchant = '13910000-0000-4000-8000-000000000001';
const postId = '13920000-0000-4000-8000-000000000001';
const row = { id: postId, city_id: 'vancouver', title: '오늘의 커피', body: '실제 공개 본문', hashtags: [], image_paths: [],
  room_preview: null, created_at: '2026-10-09T08:00:00Z', like_count: 0, view_count: 0, comment_count: 0, save_count: 0, share_count: 0,
  liked_by_me: false, saved_by_me: false, author_id: '13900000-0000-4000-8000-000000000001', author_nickname: '업체',
  author_neighborhood: null, author_verification_level: 1, tag_id: 17, tag_slug: 'business', tag_label: '업체', tag_kind: 'post', kind: 'story' };
const page = { merchant_id: merchant, kind: 'posts', post_count: 24, job_count: 2, posts: [row], has_more: true };
function client(data = page) {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); return { data, error: null }; } };
}

test('company lists use the public company relation, map real posts and keep whole-list counts when paging', async () => {
  assert.equal(typeof api.loadMerchantProfilePosts, 'function');
  const db = client({ ...page, private_contact: 'PRIVATE_CONTACT', posts: [{ ...row, private_draft: 'PRIVATE_DRAFT' }] });
  const result = await api.loadMerchantProfilePosts(db, merchant, 'posts', 20, 'guest');
  assert.deepEqual(db.calls, [['get_merchant_profile_posts', { p_merchant_id: merchant, p_kind: 'posts', p_offset: 20 }]]);
  assert.equal(result.post_count, 24);
  assert.equal(result.job_count, 2);
  assert.equal(result.nextOffset, 21);
  assert.equal(result.has_more, true);
  assert.equal(result.posts[0].id, postId);
  assert.equal(result.posts[0].title, '오늘의 커피');
  assert.equal(result.posts[0].tag.slug, 'business');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
});

test('jobs and empty companies remain distinct and an inaccessible company has no invented zero counts', async () => {
  assert.equal(typeof api.loadMerchantProfilePosts, 'function');
  const result = await api.loadMerchantProfilePosts(client({ ...page, kind: 'jobs', posts: [{ ...row, tag_id: 18, tag_slug: 'jobs' }] }), merchant, 'jobs');
  assert.equal(result.kind, 'jobs');
  assert.equal(result.posts[0].tag.slug, 'jobs');
  const empty = await api.loadMerchantProfilePosts(client({ ...page, post_count: 0, job_count: 0, posts: [], has_more: false }), merchant);
  assert.equal(empty.post_count, 0); assert.equal(empty.posts.length, 0); assert.equal(empty.has_more, false);
  assert.equal(await api.loadMerchantProfilePosts(client(null), merchant), null);
});

test('invalid list requests and mismatched or malformed pages fail without displaying another company or tab', async () => {
  assert.equal(typeof api.loadMerchantProfilePosts, 'function');
  const db = client();
  for (const [id, kind, offset] of [['bad-id', 'posts', 0], [merchant, 'all', 0], [merchant, 'jobs', -1], [merchant, 'posts', 1.5], [merchant, 'posts', 10001]]) {
    await assert.rejects(api.loadMerchantProfilePosts(db, id, kind, offset), /INVALID_MERCHANT_POST_PAGE/);
  }
  assert.equal(db.calls.length, 0);
  for (const data of [
    { ...page, merchant_id: 'other' }, { ...page, kind: 'jobs' }, { ...page, post_count: -1 }, { ...page, job_count: 0.5 },
    { ...page, posts: null }, { ...page, posts: [{ ...row, id: '../private' }] }, { ...page, posts: [{ ...row, tag_slug: 'jobs' }] },
  ]) await assert.rejects(api.loadMerchantProfilePosts(client(data), merchant), /MERCHANT_POSTS_READ_FAILED/);
  await assert.rejects(api.loadMerchantProfilePosts({ rpc: async () => ({ error: { message: 'offline' } }) }, merchant), /offline/);
});
