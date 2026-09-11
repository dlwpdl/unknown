export function canUseDevPasswordLogin(dev: boolean) {
  return dev;
}

export function getOAuthCallbackPath(platform: string, webBaseUrl = '') {
  return platform === 'web' ? `${webBaseUrl.replace(/\/+$/, '')}/auth/callback` : 'auth/callback';
}

export function getKakaoAuthSessionUrl(authorizeUrl: string, platform: string) {
  // The iOS consent sheet names the first host. Start on our owned sign-in page;
  // keep the existing Supabase PKCE flow and registered callback intact.
  return platform === 'ios'
    ? `https://gling.ej-entertainment.com/auth/kakao.html#${encodeURIComponent(authorizeUrl)}`
    : authorizeUrl;
}

export function getOAuthCode(callbackUrl: string, expectedRedirectUrl: string) {
  const callback = new URL(callbackUrl);
  const expected = new URL(expectedRedirectUrl);

  if (
    callback.protocol !== expected.protocol ||
    callback.username !== expected.username ||
    callback.password !== expected.password ||
    callback.host !== expected.host ||
    callback.pathname !== expected.pathname
  ) {
    throw new Error('OAUTH_CALLBACK_MISMATCH');
  }
  if (callback.searchParams.has('error') || callback.searchParams.has('error_description')) {
    throw new Error('OAUTH_CALLBACK_ERROR');
  }

  const code = callback.searchParams.get('code');
  if (!code) throw new Error('OAUTH_CODE_MISSING');
  return code;
}
