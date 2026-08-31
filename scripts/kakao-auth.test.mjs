import assert from 'node:assert/strict';
import test from 'node:test';

import { canUseDevPasswordLogin, getOAuthCode } from '../src/lib/kakao-auth.ts';

test('실제 개발 계정 로그인은 개발 빌드에서만 노출한다', () => {
  assert.equal(canUseDevPasswordLogin(true), true);
  assert.equal(canUseDevPasswordLogin(false), false);
});

test('등록한 카카오 콜백의 인증 코드만 반환한다', () => {
  assert.equal(getOAuthCode('gling://auth/callback?code=one-time-code', 'gling://auth/callback'), 'one-time-code');
});

test('등록하지 않은 콜백 출처는 거부한다', () => {
  assert.throws(
    () => getOAuthCode('https://example.com/auth/callback?code=stolen', 'gling://auth/callback'),
    /OAUTH_CALLBACK_MISMATCH/,
  );
});

test('카카오가 반환한 OAuth 오류를 일반 오류로 처리한다', () => {
  assert.throws(
    () => getOAuthCode('gling://auth/callback?error=access_denied', 'gling://auth/callback'),
    /OAUTH_CALLBACK_ERROR/,
  );
});

test('인증 코드가 없는 콜백은 거부한다', () => {
  assert.throws(() => getOAuthCode('gling://auth/callback', 'gling://auth/callback'), /OAUTH_CODE_MISSING/);
});
