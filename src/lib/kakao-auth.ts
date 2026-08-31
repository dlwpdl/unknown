export function canUseDevPasswordLogin(dev: boolean) {
  return dev;
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
