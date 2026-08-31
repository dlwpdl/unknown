import assert from 'node:assert/strict';
import test from 'node:test';

import { mapPublicFeed } from '../src/lib/feed-data.ts';

test('공개 피드 행과 댓글을 앱 카드 형식으로 연결한다', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  const posts = mapPublicFeed([
    {
      id: 'post-1', city_id: 'vancouver', title: '제목', body: '본문', hashtags: ['2030'],
      image_paths: ['user-1/photo.jpg'], room_preview: null, created_at: '2026-08-26T11:00:00Z',
      like_count: 2, view_count: 3, comment_count: 1, save_count: 4, share_count: 6,
      liked_by_me: true, saved_by_me: false, author_id: 'user-1', author_nickname: '고요한수달',
      author_neighborhood: '코퀴틀람', author_verification_level: 3, tag_id: 1,
      tag_slug: 'life', tag_label: '라이프', tag_kind: 'post',
    },
  ], [
    {
      id: 'comment-1', post_id: 'post-1', author_id: 'user-2', body: '댓글', like_count: 5,
      liked_by_me: true,
      created_at: '2026-08-26T11:30:00Z', author_nickname: 'CalmOtter',
      author_verification_level: 2,
    },
  ], now);

  assert.equal(posts[0].createdAtLabel, '1시간 전');
  assert.equal(posts[0].author.trustLevel, 3);
  assert.equal(posts[0].commentList?.[0].nickname, 'CalmOtter');
  assert.equal(posts[0].commentList?.[0].authorId, 'user-2');
  assert.equal(posts[0].commentList?.[0].likes, 5);
  assert.equal(posts[0].commentList?.[0].likedByMe, true);
  assert.equal(posts[0].likedByMe, true);
  assert.equal(posts[0].savedByMe, false);
  assert.equal(posts[0].shares, 6);
  assert.deepEqual(posts[0].imagePaths, ['user-1/photo.jpg']);
});
