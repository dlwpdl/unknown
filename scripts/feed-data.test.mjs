import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendUniquePosts,
  attachSignedPostImages,
  getPostImageSource,
  groupJournalPosts,
  mapPublicFeed,
} from '../src/lib/feed-data.ts';

test('저널은 첫 사진과 모임 두 개를 중복 없이 보여주고 다음 페이지를 위로 옮기지 않는다', () => {
  const posts = Object.freeze([
    { id: 'question' },
    { id: 'meetup-photo', room: { id: 'room-1' }, imageUris: ['https://example.com/room.jpg'] },
    { id: 'photo', imageUris: ['https://example.com/photo.jpg'] },
    { id: 'meetup-2', room: { id: 'room-2' } },
    { id: 'meetup-3', room: { id: 'room-3' } },
    { id: 'photo-2', imageUris: ['https://example.com/next.jpg'] },
  ]);
  const { featured, meetups, remaining } = groupJournalPosts(posts);
  assert.equal(featured.id, 'photo');
  assert.deepEqual(meetups.map(p => p.id), ['meetup-photo', 'meetup-2']);
  assert.deepEqual(remaining.map(p => p.id), ['question', 'meetup-3', 'photo-2']);
  assert.equal(new Set([featured, ...meetups, ...remaining].map(p => p.id)).size, posts.length);
  assert.equal(posts[0].id, 'question');
  assert.deepEqual(groupJournalPosts([]), { featured: undefined, meetups: [], remaining: [] });
  const textOnly = Array.from({ length: 30 }, (_, i) => ({ id: `text-${i}`, imageUris: [] }));
  assert.deepEqual(groupJournalPosts(textOnly).remaining, textOnly);
  const appended = [...textOnly, posts[2], posts[1]];
  const nextPage = groupJournalPosts(appended);
  assert.equal(nextPage.featured, undefined);
  assert.deepEqual(nextPage.meetups, []);
  assert.deepEqual(nextPage.remaining, appended);
});

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

test('종료된 모임은 모임 소개에서 제외하되 게시글 기록은 남긴다', () => {
  const closed = { id: 'closed', room: { id: 'old-room', closed: true } };
  const open = { id: 'open', room: { id: 'current-room', closed: false } };
  const journal = groupJournalPosts([closed, open]);
  assert.deepEqual(journal.meetups, [open]);
  assert.deepEqual(journal.remaining, [closed]);
});

test('피드 페이지는 겹친 커서 행을 한 번만 붙인다', () => {
  const current = [{ id: 'a' }, { id: 'b' }];
  const next = [{ id: 'b' }, { id: 'c' }, { id: 'c' }];
  assert.deepEqual(appendUniquePosts(current, next).map(({ id }) => id), ['a', 'b', 'c']);
});

test('서명 URL은 경로별로 묶고 같은 사용자 안에서 재사용한다', async () => {
  const calls = [];
  const client = {
    storage: { from(bucket) {
      assert.equal(bucket, 'post-images');
      return { async createSignedUrls(paths, expiresIn) {
        calls.push(paths);
        assert.equal(expiresIn, 3600);
        return { data: paths.map((path) => ({ path, signedUrl: `signed:${path}:${calls.length}` })), error: null };
      } };
    } },
  };
  const posts = [
    { id: 'a', imagePaths: ['one.jpg', 'one.jpg'] },
    { id: 'b', imagePaths: ['two.jpg'] },
  ];

  const first = await attachSignedPostImages(client, posts, 'user-a');
  const second = await attachSignedPostImages(client, posts, 'user-a');
  const otherUser = await attachSignedPostImages(client, posts, 'user-b');

  assert.deepEqual(calls, [['one.jpg', 'two.jpg'], ['one.jpg', 'two.jpg']]);
  assert.deepEqual(first.map(({ imageUris }) => imageUris), [
    ['signed:one.jpg:1', 'signed:one.jpg:1'], ['signed:two.jpg:1'],
  ]);
  assert.equal(getPostImageSource(first[0], 'user-b'), undefined);
  assert.deepEqual(second.map(({ imageUris }) => imageUris), first.map(({ imageUris }) => imageUris));
  assert.deepEqual(otherUser.map(({ imageUris }) => imageUris), [
    ['signed:one.jpg:2', 'signed:one.jpg:2'], ['signed:two.jpg:2'],
  ]);
});

test('이미지 캐시는 URL 갱신에는 안정적이고 사용자 변경에는 분리된다', () => {
  const post = { id: 'post-1', imagePaths: ['owner/photo.jpg'], imageUris: ['signed:first'] };
  assert.deepEqual(getPostImageSource(post, 'user-a'), {
    uri: 'signed:first', cacheKey: 'post-image:user-a:owner/photo.jpg',
  });
  assert.equal(
    getPostImageSource({ ...post, imageUris: ['signed:renewed'] }, 'user-a')?.cacheKey,
    'post-image:user-a:owner/photo.jpg',
  );
  assert.equal(getPostImageSource(post, 'user-b')?.cacheKey, 'post-image:user-b:owner/photo.jpg');
  assert.equal(getPostImageSource({ id: 'text' }, 'user-a'), undefined);
});
