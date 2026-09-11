import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { canUseDevPasswordLogin, getKakaoAuthSessionUrl, getOAuthCallbackPath, getOAuthCode } from '../src/lib/kakao-auth.ts';

test('iOS는 글링 도메인에서 시작하며 등록된 카카오 PKCE 요청만 전달한다', () => {
  const authorize = new URL('https://wjvahbdwmctzpkndqaxa.supabase.co/auth/v1/authorize');
  authorize.search = new URLSearchParams({ provider: 'kakao', redirect_to: 'gling://auth/callback',
    code_challenge: 'a'.repeat(43), code_challenge_method: 's256', scope: 'profile_nickname profile_image', skip_http_redirect: 'true' }).toString();
  const html = readFileSync(new URL('../public/auth/kakao.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const visit = (url) => {
    let destination;
    let cleared = false;
    const status = { textContent: '' };
    runInNewContext(script, { URL, location: { hash: `#${encodeURIComponent(url)}`, pathname: '/auth/kakao.html',
      replace: (value) => { destination = value; } }, history: { replaceState: () => { cleared = true; } },
      document: { getElementById: () => status } });
    return { destination, cleared, error: status.textContent };
  };
  const entry = new URL(getKakaoAuthSessionUrl(authorize.href, 'ios'));
  assert.equal(entry.origin, 'https://gling.ej-entertainment.com');
  assert.equal(decodeURIComponent(entry.hash.slice(1)), authorize.href);
  assert.equal(getKakaoAuthSessionUrl(authorize.href, 'android'), authorize.href);
  assert.equal(getKakaoAuthSessionUrl(authorize.href, 'web'), authorize.href);
  assert.deepEqual(visit(authorize.href), { destination: authorize.href, cleared: true, error: '' });
  const native = new URL(authorize);
  native.searchParams.set('code_challenge', 'ABcd.ef~_-'.repeat(6));
  native.searchParams.set('code_challenge_method', 'plain');
  assert.equal(visit(native.href).destination, native.href);
  for (const invalid of [
    authorize.href.replace('wjvahbdwmctzpkndqaxa.supabase.co', 'evil.example'),
    authorize.href.replace('/auth/v1/authorize', '/redirect'),
    authorize.href.replace('provider=kakao', 'provider=google'),
    authorize.href.replace('gling%3A%2F%2Fauth%2Fcallback', 'https%3A%2F%2Fevil.example'),
    `${authorize.href}&redirect_to=https://evil.example`,
    `${authorize.href}&next=https://evil.example`,
    authorize.href.replace('code_challenge_method=s256', 'code_challenge_method=none'),
    'javascript:alert(1)', '', '%',
  ]) {
    assert.equal(visit(invalid).destination, undefined);
    assert.match(visit(invalid).error, /다시 시도/);
  }
});

test('웹 OAuth는 배포 하위 경로를 유지하고 네이티브 콜백은 바꾸지 않는다', () => {
  assert.equal(getOAuthCallbackPath('web', '/gling'), '/gling/auth/callback');
  assert.equal(getOAuthCallbackPath('web', '/gling/'), '/gling/auth/callback');
  assert.equal(getOAuthCallbackPath('web'), '/auth/callback');
  assert.equal(getOAuthCallbackPath('ios', '/gling'), 'auth/callback');
  assert.equal(getOAuthCallbackPath('android', '/gling'), 'auth/callback');
});

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
