import assert from 'node:assert/strict';
import test from 'node:test';

import { conversationLabel, decodeUserAgent, displayName, referencedUserIds, shortId } from '../src/lib/admin-labels.ts';

const profile = (overrides = {}) => ({
  id: 'cb270ce5-1111-2222-3333-444455556666',
  nickname: '글링심사',
  account_status: 'active',
  deleted_at: null,
  ...overrides,
});

test('이름이 있으면 닉네임을, 없으면 사람이 읽을 수 있는 대체 문구를 쓴다', () => {
  assert.equal(displayName(profile(), 'cb270ce5-1111-2222-3333-444455556666'), '글링심사');
  assert.equal(displayName(profile({ deleted_at: '2026-09-01T00:00:00Z' }), 'cb270ce5-1111-2222-3333-444455556666'), '탈퇴한 회원 · cb270ce5');
  assert.equal(displayName(profile({ account_status: 'deleted' }), 'cb270ce5-1111-2222-3333-444455556666'), '탈퇴한 회원 · cb270ce5');
  assert.equal(displayName(profile({ nickname: '   ' }), 'cb270ce5-1111-2222-3333-444455556666'), '이름 없음 · cb270ce5');
  assert.equal(displayName(undefined, '3bc29aee-1111-2222-3333-444455556666'), '이름 미확인 · 3bc29aee');
  assert.equal(displayName(undefined, null), '—');
  assert.equal(shortId('cb270ce5-1111-2222-3333-444455556666'), 'cb270ce5');
});

test('대화방은 참여자 이름이나 모임 글로 표시하고 ID는 보조로만 남긴다', () => {
  const profiles = new Map([
    ['low', profile({ id: 'low', nickname: '글링심사' })],
    ['high', profile({ id: 'high', nickname: '포근한수달' })],
  ]);
  const direct = conversationLabel({ id: 'fc3a511c-1111-2222-3333-444455556666', user_low_id: 'low', user_high_id: 'high', group_post_id: null }, profiles);
  assert.equal(direct.primary, '글링심사 ↔ 포근한수달');
  assert.equal(direct.secondary, '1:1 · fc3a511c');

  const group = conversationLabel(
    { id: '8ead0252-1111-2222-3333-444455556666', user_low_id: null, user_high_id: null, group_post_id: 'post-1' },
    profiles,
    [{ id: 'post-1', title: '주말 등산 같이 가실 분' }],
  );
  assert.equal(group.primary, '모임 · 주말 등산 같이 가실 분');

  const unknown = conversationLabel({ id: 'aaaaaaaa-1111-2222-3333-444455556666', user_low_id: null, user_high_id: null, group_post_id: null }, profiles);
  assert.equal(unknown.primary, '대화 aaaaaaaa');
  assert.equal(unknown.secondary, '참여자 기록 없음');

  const half = conversationLabel({ id: 'bbbbbbbb-1111-2222-3333-444455556666', user_low_id: 'low', user_high_id: null, group_post_id: null }, profiles);
  assert.equal(half.primary, '글링심사');
});

test('퍼센트 인코딩된 앱 이름을 화면에서만 되돌린다', () => {
  const stored = '%EA%B8%80%EB%A7%81%EC%8B%AC%EC%82%AC/32 CFNetwork/3896.100.1.2.1 Darwin/27.0.0';
  assert.equal(decodeUserAgent(stored), '글링심사/32 CFNetwork/3896.100.1.2.1 Darwin/27.0.0');
  assert.equal(decodeUserAgent(null), null);
  assert.equal(decodeUserAgent('Gling/32 100% offline'), 'Gling/32 100% offline');
});

test('표시 중인 행에서 이름을 찾을 사용자 ID만 모은다', () => {
  const ids = referencedUserIds({
    reports: [{ reporter_id: 'r1', reported_user_id: 'r2' }],
    posts: [{ author_id: 'p1' }],
    messages: [{ sender_id: 'm1' }],
    conversations: [{ user_low_id: 'c1', user_high_id: null }],
    alerts: [{ author_id: 'a1', reviewed_by: 'a2' }],
    actions: [{ actor_id: 'x1' }],
  });
  assert.deepEqual([...ids].sort(), ['a1', 'a2', 'c1', 'm1', 'p1', 'r1', 'r2', 'x1']);
});
