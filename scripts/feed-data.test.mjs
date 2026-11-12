import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendUniquePosts,
  attachAuthorPhotos,
  attachSignedPostImages,
  getPostImageSource,
  groupJournalPosts,
  limitBusinessPosts,
  loadAuthorPosts,
  mapPublicFeed,
  JUST_POSTED_MS,
  pinJustPosted,
  todayRowsAfter,
  writeFabOverIntro,
} from '../src/lib/feed-data.ts';
import { contentAdPosition } from '../src/lib/content-ad-placement.ts';

test('프로필 화면은 작성자 글 RPC에 작성자와 커서를 넘기고 카드로 바꾼다', async () => {
  const calls = [];
  const client = {
    rpc(name, params) {
      calls.push({ name, params });
      if (name === 'get_public_post_businesses') return Promise.resolve({ data: [], error: null });
      assert.equal(name, 'get_public_author_posts');
      const request = Promise.resolve({
        error: null,
        data: [{
          id: 'post-1', city_id: 'montreal', title: '제목', body: '본문', hashtags: [],
          image_paths: [], room_preview: null, created_at: '2026-09-20T12:00:00Z',
          like_count: 0, view_count: 12, comment_count: 0, save_count: 0, share_count: 0,
          liked_by_me: false, saved_by_me: false, author_id: 'author-1', author_nickname: '두바퀴메이플',
          author_neighborhood: null, author_verification_level: 1, tag_id: 1,
          tag_slug: 'life', tag_label: '라이프', tag_kind: 'post',
        }],
      });
      request.abortSignal = () => request;
      return request;
    },
  };

  const posts = await loadAuthorPosts(client, 'author-1', { createdAt: '2026-09-25T00:00:00Z', id: 'post-9' }, { viewerScope: 'viewer' });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'get_public_author_posts');
  assert.deepEqual(calls[0].params, {
    p_author_id: 'author-1',
    p_before_created: '2026-09-25T00:00:00Z',
    p_before_id: 'post-9',
    p_limit: 30,
  });
  assert.deepEqual(calls[1], { name: 'get_public_post_businesses', params: { p_post_ids: ['post-1'] } });
  assert.equal(posts[0].author.nickname, '두바퀴메이플');
  assert.equal(posts[0].views, 12);
});

test('저널은 모임 두 개만 위로 올리고 사진 글은 최신순 그대로 두며 다음 페이지를 위로 옮기지 않는다', () => {
  const posts = Object.freeze([
    { id: 'question' },
    { id: 'meetup-photo', room: { id: 'room-1' }, imageUris: ['https://example.com/room.jpg'] },
    { id: 'photo', imageUris: ['https://example.com/photo.jpg'] },
    { id: 'meetup-2', room: { id: 'room-2' } },
    { id: 'meetup-3', room: { id: 'room-3' } },
    { id: 'photo-2', imageUris: ['https://example.com/next.jpg'] },
  ]);
  const { featured, meetups, remaining } = groupJournalPosts(posts);
  assert.equal(featured, undefined, 'photos are ordinary posts now');
  assert.deepEqual(meetups.map(p => p.id), ['meetup-photo', 'meetup-2']);
  assert.deepEqual(remaining.map(p => p.id), ['question', 'photo', 'meetup-3', 'photo-2']);
  assert.equal(new Set([...meetups, ...remaining].map(p => p.id)).size, posts.length);
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

  // 썸네일과 원본을 한 번에 서명한다.
  assert.deepEqual(calls, [
    ['one.jpg', 'one.thumb.webp', 'two.jpg', 'two.thumb.webp'],
    ['one.jpg', 'one.thumb.webp', 'two.jpg', 'two.thumb.webp'],
  ]);
  assert.deepEqual(first.map(({ imageUris }) => imageUris), [
    ['signed:one.jpg:1', 'signed:one.jpg:1'], ['signed:two.jpg:1'],
  ]);
  assert.deepEqual(first.map(({ imageThumbs }) => imageThumbs), [
    ['signed:one.thumb.webp:1', 'signed:one.thumb.webp:1'], ['signed:two.thumb.webp:1'],
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
  // 썸네일이 있으면 목록은 썸네일, 상세는 원본을 쓴다.
  const withThumb = { ...post, imageThumbs: ['signed:thumb'] };
  assert.deepEqual(getPostImageSource(withThumb, 'user-a'), {
    uri: 'signed:thumb', cacheKey: 'post-image:user-a:owner/photo.thumb.webp',
  });
  assert.deepEqual(getPostImageSource(withThumb, 'user-a', 'full'), {
    uri: 'signed:first', cacheKey: 'post-image:user-a:owner/photo.jpg',
  });
  assert.equal(
    getPostImageSource({ ...post, imageUris: ['signed:renewed'] }, 'user-a')?.cacheKey,
    'post-image:user-a:owner/photo.jpg',
  );
  assert.equal(getPostImageSource(post, 'user-b')?.cacheKey, 'post-image:user-b:owner/photo.jpg');
  assert.equal(getPostImageSource({ id: 'text' }, 'user-a'), undefined);
});

test('일부 원본·썸네일 서명이 실패해도 경로와 사진 위치를 유지하고 같은 원본으로 폴백한다', async () => {
  const client = { storage: { from: () => ({ createSignedUrls: async (paths) => ({
    data: paths.filter(path => path !== 'owner/two.thumb.webp' && path !== 'owner/three.webp').map(path => ({ path, signedUrl: `signed:${path}` })), error: null,
  }) }) } };
  const [post] = await attachSignedPostImages(client, [{ id: 'partial', imagePaths: ['owner/one.webp', 'owner/two.webp', 'owner/three.webp', 'owner/four.webp'] }], 'viewer');
  assert.deepEqual(post.imageUris, ['signed:owner/one.webp', 'signed:owner/two.webp', '', 'signed:owner/four.webp']);
  assert.deepEqual(post.imageThumbs, ['signed:owner/one.thumb.webp', '', 'signed:owner/three.thumb.webp', 'signed:owner/four.thumb.webp']);
  assert.deepEqual(getPostImageSource(post, 'viewer', 'feed', 1), { uri: 'signed:owner/two.webp', cacheKey: 'post-image:viewer:owner/two.webp' });
  assert.equal(getPostImageSource(post, 'viewer', 'full', 2), undefined);
  assert.deepEqual(getPostImageSource(post, 'viewer', 'full', 3), { uri: 'signed:owner/four.webp', cacheKey: 'post-image:viewer:owner/four.webp' });
  assert.equal(getPostImageSource(post, 'other-viewer', 'feed', 1), undefined);
});

test('meetup context reads the existing public projection once without comments, business or image hydration', async () => {
  const api = await import('../src/lib/feed-data.ts');
  assert.equal(typeof api.loadPublicMeetupContext, 'function');
  const calls = [], room = { id: 'room', title: 'Meetup', memberCount: 2, verifiedOnly: false, eventKind: 'group' };
  const row = { id: 'post', city_id: 'vancouver', title: 'Meetup', body: 'Authorized introduction', room_preview: room,
    author_id: 'canonical-public-identity', author_nickname: 'Public display name', image_paths: ['PRIVATE_UPLOAD_PATH'], owner_id: 'PRIVATE_ACTOR' };
  const client = { rpc: async (name, params) => {
    calls.push({ name, params });
    if (name !== 'get_public_post') throw new Error('Unused comments or hydration must not run');
    return { data: [row], error: null };
  }, auth: { getSession() { throw new Error('No image/session hydration'); } }, storage: { from() { throw new Error('No image signing'); } } };
  assert.deepEqual(await api.loadPublicMeetupContext(client, 'post'), { id: 'post', cityId: 'vancouver', title: 'Meetup', body: 'Authorized introduction', room, authorId: 'canonical-public-identity' });
  assert.deepEqual(calls, [{ name: 'get_public_post', params: { p_post_id: 'post' } }]);
  assert.equal(JSON.stringify(await api.loadPublicMeetupContext(client, 'post')).includes('PRIVATE_'), false);
});

test('meetup context preserves denied, non-meetup and error results without any fallback or cached identity', async () => {
  const api = await import('../src/lib/feed-data.ts');
  assert.equal(typeof api.loadPublicMeetupContext, 'function');
  for (const data of [[], [{ id: 'story', room_preview: null }]]) {
    assert.equal(await api.loadPublicMeetupContext({ rpc: async () => ({ data, error: null }) }, 'post'), null);
  }
  await assert.rejects(api.loadPublicMeetupContext({ rpc: async () => ({ data: [{ id: 'different', room_preview: { id: 'room' } }], error: null }) }, 'post'), /INVALID_PUBLIC_MEETUP_CONTEXT/);
  const unavailable = Error('POST_NOT_VISIBLE');
  await assert.rejects(api.loadPublicMeetupContext({ rpc: async () => ({ data: null, error: unavailable }) }, 'post'), error => error === unavailable);
});

test('오늘 전체는 비즈니스 글을 5개 중 최대 1개만 섞고 비즈니스 채용글은 뺀다', () => {
  const p = (id, business = false, slug = 'life') => ({ id, business: business ? { id: 'm' } : undefined, tag: { slug } });
  const posts = [p('b1', true), p('b2', true), p('a'), p('b3', true, 'jobs'), p('c'), p('d'), p('e'), p('b4', true), p('f')];
  assert.deepEqual(limitBusinessPosts(posts).map(({ id }) => id), ['b1', 'a', 'c', 'd', 'e', 'b4', 'f']);
});

// Same cadence as src/lib/ads.ts feedAdPosition (that module needs the native SDK, so the rule is restated here).
const adSlot = index => index >= 3 && (index - 3) % 4 === 0;
const rowsIn = (count, isAdSlot = adSlot) => Array.from({ length: count }, (_, index) => todayRowsAfter(index, count, isAdSlot)
  .map(({ kind, page }) => `${index}:${kind}${page}`)).flat();

test('오늘 전체 글 사이 줄은 두 번째 글 뒤 가볼 만한 곳부터 4글마다 페스티벌과 번갈아 나오고 광고 자리는 피한다', () => {
  assert.deepEqual(rowsIn(30), ['1:places0', '5:festivals0', '9:places1', '13:festivals1', '17:places2', '21:festivals2', '25:places3', '29:festivals3']);
  for (let index = 0; index < 200; index++) if (adSlot(index)) assert.deepEqual(todayRowsAfter(index, 200, adSlot), [], `ad slot ${index}`);
  const everyThird = index => index >= 2 && (index - 2) % 3 === 0;
  const shifted = rowsIn(30, everyThird);
  assert.deepEqual(shifted.slice(0, 3), ['1:places0', '6:festivals0', '9:places1'], 'a changed ad cadence pushes the row past the ad');
  for (const row of shifted) assert.equal(everyThird(Number(row.split(':')[0])), false, row);
});

test('웹 광고 자리(contentAdPosition, 글 수까지 보는 방식)와도 글 사이 줄이 겹치지 않는다', () => {
  for (let total = 0; total <= 120; total++) {
    const web = at => contentAdPosition(at, total);
    for (let index = -1; index < total; index++) if (web(index)) assert.deepEqual(todayRowsAfter(index, total, web), [], `total ${total}, ad after ${index}`);
  }
  assert.deepEqual(rowsIn(30, at => contentAdPosition(at, 30)), rowsIn(30), 'the web cadence lands the rows where the app does');
});

test('글이 짧으면 아직 차례가 안 온 줄은 마지막 글 아래에, 글이 없으면 빈 화면 아래에 나온다', () => {
  assert.deepEqual(todayRowsAfter(-1, 0, adSlot), [{ kind: 'places', page: 0 }, { kind: 'festivals', page: 0 }]);
  assert.deepEqual(rowsIn(1), ['0:places0', '0:festivals0']);
  assert.deepEqual(rowsIn(2), ['1:places0', '1:festivals0']);
  assert.deepEqual(rowsIn(4), ['1:places0', '3:festivals0']);
  assert.deepEqual(rowsIn(6), ['1:places0', '5:festivals0']);
});

test('방금 쓴 내 글은 정렬·새로고침과 상관없이 10분 동안 맨 위에 있고, 서버에서 온 최신 내용으로 보인다', () => {
  const mine = { id: 'mine', likes: 0 }, pin = { post: mine, at: 1_000_000, viewer: 'me' };
  const server = [{ id: 'top' }, { id: 'mine', likes: 3 }, { id: 'other' }];
  assert.deepEqual(pinJustPosted(server, pin, 'me', 1_000_000 + 60_000), [{ id: 'mine', likes: 3 }, { id: 'top' }, { id: 'other' }]);
  assert.deepEqual(pinJustPosted([{ id: 'top' }], pin, 'me', 1_000_000), [mine, { id: 'top' }], 'kept on top even when a refresh or 인기순 page leaves it out');
  assert.deepEqual(pinJustPosted(server, pin, 'me', 1_000_000 + JUST_POSTED_MS + 1), server, 'after ten minutes the server order returns');
  assert.deepEqual(pinJustPosted(server, pin, 'someone-else', 1_000_000), server, 'another account never sees the pin');
  assert.deepEqual(pinJustPosted(server, null, 'me'), server);
});

test('글 카드 회원 사진은 회원 글에만 붙고, 모임 글은 호스트의 별도 신원이라 빠지며, 비회원·읽기 실패면 첫 글자로 남는다', async () => {
  const posts = [{ id: 'a', author: { id: 'u1' } }, { id: 'b', author: { id: 'u2' }, room: { id: 'r' } }, { id: 'c', author: { id: 'u3' } }];
  const asked = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    from: table => { assert.equal(table, 'profiles'); return { select: () => ({ in: (_, ids) => { asked.push(ids); return { retry: () => Promise.resolve({ error: null, data: [{ id: 'u1', avatar_path: 'u1/avatar.jpg' }, { id: 'u3', avatar_path: null }] }) }; } }) }; },
    storage: { from: bucket => { assert.equal(bucket, 'avatars'); return { createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `signed:${path}` })) }) }; } },
  };
  const result = await attachAuthorPhotos(client, posts);
  assert.deepEqual(asked, [['u1', 'u3']], 'the meetup host is never looked up');
  assert.equal(result[0].author.avatarUrl, 'signed:u1/avatar.jpg');
  assert.equal(result[1].author.avatarUrl, undefined);
  assert.equal(result[2].author.avatarUrl, undefined);
  let guestRead = false;
  const guest = { auth: { getSession: async () => ({ data: { session: null } }) }, from: () => { guestRead = true; throw new Error('denied'); } };
  assert.equal(await attachAuthorPhotos(guest, posts), posts);
  assert.equal(guestRead, false, 'a guest read of profiles comes back 401 and opens the login sheet');
  const denied = { auth: client.auth, from: () => ({ select: () => ({ in: () => ({ retry: () => Promise.resolve({ data: null, error: { code: '42501' } }) }) }) }) };
  assert.equal(await attachAuthorPhotos(denied, posts), posts);
  assert.equal(await attachAuthorPhotos({ auth: client.auth, from: () => { throw new Error('offline'); } }, posts), posts, 'a failed read keeps the first letter');
});

test('the write button steps aside only while the top cards reach its spot', () => {
  const place = { viewport: 700, bottom: 16, height: 44 }; // its top edge sits at 640
  assert.equal(writeFabOverIntro({ ...place, introHeight: 800, offset: 0 }), true, 'new member cards under the label at rest');
  assert.equal(writeFabOverIntro({ ...place, introHeight: 800, offset: 160 }), false, 'the cards have passed');
  assert.equal(writeFabOverIntro({ ...place, introHeight: 300, offset: 0 }), false, 'a short header never hides it');
  assert.equal(writeFabOverIntro({ ...place, introHeight: 640, offset: -60 }), false, 'pull-to-refresh bounce keeps it');
  assert.equal(writeFabOverIntro({ ...place, viewport: 0, introHeight: 800, offset: 0 }), false, 'before layout it stays');
});
