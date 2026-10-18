import assert from 'node:assert/strict';
import test from 'node:test';

import { loadPublicFeed } from '../src/lib/feed-data.ts';

const row = {
  id: 'popular-outside-latest-page', city_id: 'vancouver', title: '반응 많은 글', body: '본문', hashtags: [], image_paths: [], room_preview: null,
  created_at: '2026-10-10T12:00:00Z', like_count: 50, view_count: 300, comment_count: 10, save_count: 12, share_count: 0,
  liked_by_me: false, saved_by_me: false, author_id: 'author', author_nickname: '이웃', author_neighborhood: null,
  author_verification_level: 1, tag_id: 4, tag_slug: 'food', tag_label: '맛집', tag_kind: 'post',
  popularity_score: 106, ranking_as_of: '2026-10-12T12:00:00Z',
};

function client(result = { data: [row], error: null }) {
  const calls = [];
  return { calls, rpc(name, params) {
    const call = { name, params }; calls.push(call);
    const request = Promise.resolve(name === 'get_public_post_businesses' ? { data: [], error: null } : result);
    request.abortSignal = signal => { call.signal = signal; return request; };
    return request;
  } };
}

test('popular requests the server-ranked city/category feed rather than re-sorting a latest page', async () => {
  const db = client();
  const posts = await loadPublicFeed(db, 'vancouver', 4, null, null, { sort: 'popular', viewerScope: 'viewer' });
  assert.deepEqual(db.calls[0], { name: 'get_public_popular_feed_page', params: {
    p_city_id: 'vancouver', p_tag_id: 4, p_before_score: null, p_before_created: null, p_before_id: null, p_as_of: null, p_limit: 30,
  } });
  assert.equal(posts[0].id, row.id);
  assert.equal(posts[0].popularityScore, 106);
  assert.equal(posts[0].rankingAsOf, row.ranking_as_of);
});

test('popular pagination forwards a zero score and the original eligibility window', async () => {
  const db = client();
  const cursor = { id: 'last', createdAt: row.created_at, popularityScore: 0, rankingAsOf: row.ranking_as_of };
  await loadPublicFeed(db, 'toronto', null, null, cursor, { sort: 'popular' });
  assert.deepEqual(db.calls[0].params, {
    p_city_id: 'toronto', p_tag_id: null, p_before_score: 0, p_before_created: row.created_at, p_before_id: 'last', p_as_of: row.ranking_as_of, p_limit: 30,
  });
});

test('latest remains compatible with the shipped feed RPC and listing bump cursor', async () => {
  const db = client();
  await loadPublicFeed(db, 'vancouver', 19, null, { createdAt: row.created_at, sortAt: '2026-10-12T10:00:00Z', id: 'listing' }, { sort: 'latest' });
  assert.deepEqual(db.calls[0], { name: 'get_public_feed_page_v2', params: {
    p_city_id: 'vancouver', p_tag_id: 19, p_query: null, p_before_sort: '2026-10-12T10:00:00Z', p_before_id: 'listing', p_limit: 30,
  } });
});

test('popular respects cancellation and never falls back to an incorrect latest order on error', async () => {
  const db = client({ data: null, error: new Error('network error') });
  const controller = new AbortController();
  await assert.rejects(loadPublicFeed(db, 'vancouver', null, null, null, { sort: 'popular', signal: controller.signal }), /network error/);
  assert.equal(db.calls[0].signal, controller.signal);
  assert.equal(db.calls[0].name, 'get_public_popular_feed_page');
  assert.equal(db.calls.length, 1);
});
