import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldInvitePush } from '../src/lib/notification-preferences.ts';

const ready = { authed: true, configured: true, alreadyAsked: false, permissionGranted: false, pushEnabled: false };

test('처음 들어온 사람에게는 물어본다', () => {
  assert.equal(shouldInvitePush(ready), true);
});

test('한 번뿐인 기회를 낭비할 상황에서는 묻지 않는다', () => {
  assert.equal(shouldInvitePush({ ...ready, alreadyAsked: true }), false, '이미 물어봤으면 다시 묻지 않는다');
  assert.equal(shouldInvitePush({ ...ready, permissionGranted: true }), false, '이미 허용했으면 물을 필요가 없다');
  assert.equal(shouldInvitePush({ ...ready, pushEnabled: true }), false, '설정이 켜져 있으면 묻지 않는다');
  assert.equal(shouldInvitePush({ ...ready, configured: false }), false, '등록이 불가능하면 묻지 않는다');
  assert.equal(shouldInvitePush({ ...ready, authed: false }), false, '로그인 전에는 묻지 않는다');
});
