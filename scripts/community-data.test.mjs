import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostImagePath, createCommunityPost, deleteMyAccount, editPost, getCommunityActionError, isContentRejected, leaveMeetup, loadChatReadPosition, loadMyMeetups, markChatRead, recordPostView, sendChatAttachment, uploadChatImage, uploadPostImages } from '../src/lib/community-data.ts';

test('사진 교체는 여섯 장 순서를 저장하고 실패 시 새 파일만 정리한다', async () => {
  const uploaded = [], removed = [], patches = [];
  let failure = null;
  const client = {
    storage: { from: () => ({
      upload: async (path) => { uploaded.push(path); return { error: null }; },
      remove: async (paths) => { removed.push(...paths); return { error: null }; },
    }) },
    from: () => ({ update(patch) { patches.push(patch); return {
      eq: async (key, id) => { assert.equal(key, 'id'); assert.equal(id, 'existing-post'); return { error: failure }; },
    }; } }),
  };
  const replacement = { userId: 'author', images: Array.from({ length: 6 }, () => ({ base64: 'AQ==', mimeType: 'image/webp' })) };
  await editPost(client, 'existing-post', { title: ' 제목 ', body: ' 본문 ' }, replacement);
  assert.deepEqual(patches[0], { title: '제목', body: '본문', image_paths: uploaded.slice(0, 6) });
  assert.equal(removed.length, 0);
  failure = new Error('CONTENT_NOT_ALLOWED');
  await assert.rejects(editPost(client, 'existing-post', { title: '제목', body: '본문' }, replacement), /CONTENT_NOT_ALLOWED/);
  assert.deepEqual(removed.filter((path) => !path.includes('.thumb.')), uploaded.slice(6));
  await assert.rejects(editPost(client, 'existing-post', { title: '제목', body: '본문' }, { ...replacement, images: [...replacement.images, replacement.images[0]] }), /TOO_MANY_IMAGES/);
});

test('chat attachment uploads are compressed-only and send a typed private message', async () => {
  const calls = [];
  const client = { storage: { from(bucket) { assert.equal(bucket, 'chat-images'); return {
    async upload(path, bytes, options) { calls.push(['upload', path, bytes.byteLength, options.contentType]); return { error: null }; },
  }; } }, async rpc(name, args) { calls.push([name, args]); return { data: name === 'get_chat_read_position' ? '2026-09-26T00:00:00Z' : 'message-id', error: null }; } };
  const path = await uploadChatImage(client, 'user', 'room', 'AQ==');
  assert.match(path, /^user\/room_[^/]+\.webp$/);
  assert.deepEqual(calls[0], ['upload', path, 1, 'image/webp']);
  assert.equal(await sendChatAttachment(client, 'room', { kind: 'image', imagePath: path }), 'message-id');
  assert.equal(calls[1][1].p_kind, 'image');
  assert.equal(calls[1][1].p_image_path, path);
  await sendChatAttachment(client, 'room', { kind: 'location', latitude: 49.28, longitude: -123.12 });
  assert.equal(calls[2][1].p_image_path, null);
  assert.equal(calls[2][1].p_latitude, 49.28);
  assert.equal(await loadChatReadPosition(client, 'room'), '2026-09-26T00:00:00Z');
  await markChatRead(client, 'room', 'message-id');
  assert.deepEqual(calls.at(-1), ['mark_chat_read', { p_conversation_id: 'room', p_message_id: 'message-id' }]);
});

test('게시 후 상세 조회가 실패해도 생성된 글 ID를 반환한다', async () => {
  const client = {
    rpc: async (name) => {
      if (name === 'create_post') return { data: 'post-1', error: null };
      assert.equal(name, 'get_public_post');
      return { data: null, error: new Error('temporary read failure') };
    },
  };

  const created = await createCommunityPost(client, {
    userId: 'user-1', cityId: 'vancouver', tag: { id: 1, slug: 'daily', label: '일상', kind: 'post' },
    title: '제목', body: '본문', hashtags: [],
  });

  assert.deepEqual(created, { id: 'post-1', post: null });
});

test('같은 기기에서 다시 열면 조회수를 또 올리지 않고 서버 집계만 읽는다', async () => {
  const calls = [];
  const client = { rpc(name, input) {
    calls.push([name, input]);
    if (name === 'record_post_view') return Promise.resolve({ error: null });
    assert.equal(name, 'get_public_post');
    return { select(column) {
      assert.equal(column, 'view_count');
      return { single: async () => ({ data: { view_count: 17 }, error: null }) };
    } };
  } };
  assert.equal(await recordPostView(client, 'post-dedupe'), 17);
  assert.equal(await recordPostView(client, 'post-dedupe'), 17);
  assert.deepEqual(calls, [
    ['record_post_view', { post_id: 'post-dedupe' }],
    ['get_public_post', { p_post_id: 'post-dedupe' }],
    ['get_public_post', { p_post_id: 'post-dedupe' }],
  ]);
});

test('조회 기록 실패는 그대로 올라온다', async () => {
  const client = { rpc: async () => ({ error: new Error('AUTH_REQUIRED') }) };
  await assert.rejects(recordPostView(client, 'post-error'), /AUTH_REQUIRED/);
});

test('서버 콘텐츠 필터 오류만 사용자 안내 대상으로 구분한다', () => {
  assert.equal(isContentRejected({ message: 'CONTENT_NOT_ALLOWED' }), true);
  assert.equal(isContentRejected(new Error('network unavailable')), false);
});

test('신청자 모임 한도를 승인자의 한도로 오인하지 않고 종료와 새 대화 한도를 구분한다', () => {
  for (const code of ['MEETUP_LIMIT_REACHED', 'REQUESTER_MEETUP_LIMIT_REACHED', 'MEETUP_CLOSED', 'DAILY_CONVERSATION_LIMIT_REACHED', 'DUPLICATE_POST']) {
    assert.equal(getCommunityActionError(new Error(code)), code);
  }
  assert.equal(getCommunityActionError(new Error('network unavailable')), null);
  assert.equal(getCommunityActionError(null), null);
});

test('내 모임은 진행 모임과 거절·취소 결과를 보존하고 참여 중인 모임만 대화를 연결한다', async () => {
  const post = (id, extra = {}) => ({ id, title: id, city_id: 'vancouver', status: 'published', room_preview: { id: `room-${id}`, memberCount: 5, capacity: 8 }, ...extra });
  const data = {
    posts: [post('host'), post('closed', { room_preview: { closed: true } }), post('hidden', { status: 'hidden' })],
    meetup_requests: [
      { status: 'approved', post: post('joined') }, { status: 'cancelled', post: post('cancelled', { room_preview: { closed: true } }) },
      { status: 'pending', post: post('pending') }, { status: 'rejected', post: post('rejected') },
      { status: 'approved', post: null }, { status: 'pending', post: post('ended', { room_preview: { closed: true } }) },
    ],
  };
  const ownershipFilters = [];
  const client = {
    from(table) {
      const query = { select() { return this; }, eq(column, value) { if (column === 'author_id' || column === 'requester_id') ownershipFilters.push([table, column, value]); return this; }, not() { return this; }, or() { return this; }, in() { return this; }, order() { return this; },
        then(resolve) { return Promise.resolve({ data: data[table], error: null }).then(resolve); } };
      return query;
    },
    rpc: async (name, input) => {
      assert.equal(name, 'leave_meetup');
      assert.deepEqual(input, { p_post_id: 'joined' });
      return { data: null, error: null };
    },
  };
  data.conversations = [{ id: 'joined-chat', group_post_id: 'joined' }, { id: 'old-chat', group_post_id: 'rejected' }, { id: 'closed-chat', group_post_id: 'cancelled' }];
  assert.deepEqual((await loadMyMeetups(client, 'user-1')).map(({ id, role, conversationId }) => [id, role, conversationId]), [['host', 'host', null], ['joined', 'approved', 'joined-chat'], ['pending', 'pending', null], ['cancelled', 'cancelled', null], ['rejected', 'rejected', null]]);
  assert.deepEqual(ownershipFilters, [['posts', 'author_id', 'user-1'], ['meetup_requests', 'requester_id', 'user-1']]);
  await leaveMeetup(client, 'joined');
  client.rpc = async () => ({ error: new Error('AUTH_REQUIRED') });
  await assert.rejects(leaveMeetup(client, 'joined'), /AUTH_REQUIRED/);
});

test('게시글 이미지는 사용자 폴더와 MIME 확장자를 사용한다', () => {
  assert.equal(
    buildPostImagePath('user-1', 'image/jpeg', 1234),
    'user-1/1234.jpg',
  );
  assert.equal(
    buildPostImagePath('user-1', 'image/png', 1234),
    'user-1/1234.png',
  );
});

test('사진 다섯 장은 같은 밀리초에 경로를 만들어도 모두 업로드된다', async () => {
  const originalNow = Date.now;
  const uploaded = new Set();
  const client = { storage: { from: () => ({
    upload: async (path) => {
      if (uploaded.has(path)) return { error: new Error('Duplicate') };
      uploaded.add(path);
      return { error: null };
    },
    remove: async () => ({ error: null }),
  }) } };
  Date.now = () => 1234;
  try {
    const media = await uploadPostImages(client, 'user-1', Array.from({ length: 5 }, () => ({ base64: 'AQ==', thumbBase64: 'AQ==', mimeType: 'image/webp' })));
    assert.equal(media.length, 5);
    assert.equal(new Set(media.map(({ path }) => path)).size, 5);
    assert.equal(uploaded.size, 10);
  } finally {
    Date.now = originalNow;
  }
});

test('Storage가 허용하지 않는 이미지 형식은 업로드 전에 거부한다', () => {
  assert.throws(() => buildPostImagePath('user-1', 'image/gif', 1234), /UNSUPPORTED_IMAGE_TYPE/);
});

test('탈퇴 검증과 파일 삭제를 서버에 맡기고 실패를 호출자에게 전달한다', async () => {
  const calls = [];
  const client = {
    functions: {
      invoke: async (name, input) => {
        calls.push(`function:${name}:${input.body.confirmation}:${input.body.appleAuthorizationCode}`);
        return { data: { deleted: true }, error: null };
      },
    },
  };

  await deleteMyAccount(client, 'apple-code');

  assert.deepEqual(calls, [
    'function:delete-account:탈퇴합니다:apple-code',
  ]);
  client.functions.invoke = async () => ({ error: new Error('APPLE_REVOCATION_FAILED') });
  await assert.rejects(deleteMyAccount(client, 'apple-code'), /APPLE_REVOCATION_FAILED/);
});
