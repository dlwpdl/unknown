import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostImagePath, deleteMyAccount, getCommunityActionError, isContentRejected, leaveMeetup, loadMyMeetups, recordPostView } from '../src/lib/community-data.ts';

test('조회수를 임의로 더하지 않고 서버의 유니크 집계를 반환한다', async () => {
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
  assert.equal(await recordPostView(client, 'post-1'), 17);
  assert.equal(await recordPostView(client, 'post-1'), 17);
  assert.deepEqual(calls.slice(0, 2), [
    ['record_post_view', { post_id: 'post-1' }],
    ['get_public_post', { p_post_id: 'post-1' }],
  ]);
  client.rpc = async () => ({ error: new Error('AUTH_REQUIRED') });
  await assert.rejects(recordPostView(client, 'post-1'), /AUTH_REQUIRED/);
});

test('서버 콘텐츠 필터 오류만 사용자 안내 대상으로 구분한다', () => {
  assert.equal(isContentRejected({ message: 'CONTENT_NOT_ALLOWED' }), true);
  assert.equal(isContentRejected(new Error('network unavailable')), false);
});

test('신청자 모임 한도를 승인자의 한도로 오인하지 않고 종료와 새 대화 한도를 구분한다', () => {
  for (const code of ['MEETUP_LIMIT_REACHED', 'REQUESTER_MEETUP_LIMIT_REACHED', 'MEETUP_CLOSED', 'DAILY_CONVERSATION_LIMIT_REACHED']) {
    assert.equal(getCommunityActionError(new Error(code)), code);
  }
  assert.equal(getCommunityActionError(new Error('network unavailable')), null);
  assert.equal(getCommunityActionError(null), null);
});

test('내 모임은 공개된 진행 모임의 운영·참여·대기만 포함하고 나가기는 서버 성공을 기다린다', async () => {
  const post = (id, extra = {}) => ({ id, title: id, city_id: 'vancouver', status: 'published', room_preview: { id: `room-${id}` }, ...extra });
  const data = {
    posts: [post('host'), post('closed', { room_preview: { closed: true } }), post('hidden', { status: 'hidden' })],
    meetup_requests: [
      { status: 'approved', post: post('joined') }, { status: 'pending', post: post('pending') },
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
  assert.deepEqual((await loadMyMeetups(client, 'user-1')).map(({ id, role }) => [id, role]), [['host', 'host'], ['joined', 'approved'], ['pending', 'pending']]);
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
