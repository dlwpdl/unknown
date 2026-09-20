import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as kakao from '../src/lib/kakao-auth.ts';

// Exercise the actual provider with controlled browser completion, including a
// second press before React has rendered the disabled state.
test('cancel, dismiss and browser failure release the shared login state for retry', async () => {
  const state = [];
  const refs = [];
  const effects = [];
  let stateIndex = 0, refIndex = 0, mounted = false;
  let browserCalls = 0, nativeGoogleCalls = 0, appleCalls = 0, exchangeCalls = 0, idTokenCalls = 0, complete, fail, oauthOptions;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, __DEV__: false, process: { env: {} }, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      createContext: () => ({ Provider: 'Provider' }), useCallback: fn => fn, useMemo: fn => fn(),
      useEffect: fn => { if (!mounted) effects.push(fn); },
      useRef: value => { const i = refIndex++; return refs[i] ??= { current: value }; },
      useState: value => { const i = stateIndex++; if (!(i in state)) state[i] = value;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    };
    if (name === 'react-native') return { Platform: { OS: 'ios' }, Modal: 'Modal', View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value }, DeviceEventEmitter: { emit() {}, addListener: () => ({ remove() {} }) }, AppState: { addEventListener: () => ({ remove() {} }) } };
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: { async getItem() { return null; }, async setItem() {} } };
    if (name === 'expo-linking') return { createURL: path => `gling://${path}` };
    if (name === 'expo-web-browser') return { maybeCompleteAuthSession() {}, openAuthSessionAsync() {
      browserCalls++; return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    } };
    if (name === '@react-native-google-signin/google-signin') return {
      statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' }, isErrorWithCode: error => typeof error?.code === 'string',
      isSuccessResponse: response => response.type === 'success',
      GoogleSignin: { configure() {}, signIn() { nativeGoogleCalls++; return new Promise((resolve, reject) => { complete = resolve; fail = reject; }); } },
    };
    if (name === 'expo-apple-authentication') return { AppleAuthenticationScope: {}, addRevokeListener: () => ({ remove() {} }),
      async signInAsync() { appleCalls++; throw { code: 'ERR_REQUEST_CANCELED' }; } };
    if (name === '@/lib/supabase') return { supabase: { rpc: async () => ({ error: null }), auth: {
      async getSession() { return { data: { session: null } }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      startAutoRefresh() {}, stopAutoRefresh() {}, async signOut() { return {}; },
      async signInWithOAuth(options) { oauthOptions = options; return { data: { url: 'https://wjvahbdwmctzpkndqaxa.supabase.co/auth/v1/authorize' } }; },
      async exchangeCodeForSession() { exchangeCalls++; return {}; },
      async signInWithIdToken(options) { idTokenCalls++; assert.equal(`${options.provider}:${options.token}`, 'google:valid-id-token'); return {}; },
    } } };
    if (name === '@/lib/kakao-auth') return kakao;
    if (name === '@/lib/admin') return { isAdminRole: () => false };
    if (name === '@/i18n/ko') return { t: { auth: { loginError: '로그인 오류', sessionExpired: '세션 만료' } } };
    if (name === '@/constants/theme') return { Spacing: {} };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    return {};
  } });
  const render = () => { stateIndex = refIndex = 0; return exports.AuthProvider({ children: null }).props.value; };
  render(); mounted = true;
  for (const effect of effects) effect();
  for (let i = 0; i < 10; i++) await Promise.resolve(); // session restore awaits storage before getSession
  assert.equal(render().isAuthLoading, false);
  for (const provider of ['Kakao', 'Google']) for (const outcome of ['cancel', 'dismiss', 'error', 'success']) {
    const auth = render();
    const before = browserCalls;
    const exchangesBefore = exchangeCalls;
    // Google on iOS uses the native SDK (no browser); Kakao still runs the browser PKCE flow.
    const native = provider === 'Google';
    const nativeBefore = nativeGoogleCalls;
    const idTokensBefore = idTokenCalls;
    const first = auth[`signIn${provider}`]();
    const duplicate = auth[`signIn${provider}`]();
    await auth.signInApple();
    await Promise.resolve();
    assert.equal(browserCalls, before + (native ? 0 : 1));
    assert.equal(nativeGoogleCalls, nativeBefore + (native ? 1 : 0));
    if (!native) {
      assert.equal(oauthOptions.provider, 'kakao');
      assert.equal(oauthOptions.options.queryParams?.scope, 'profile_nickname profile_image');
    }
    assert.equal(appleCalls, 0);
    assert.equal(render().isAuthLoading, true);
    if (outcome === 'error') fail(native ? { code: 'PLAY_SERVICES_NOT_AVAILABLE' } : new Error('Browser unavailable'));
    else if (native) complete(outcome === 'success' ? { type: 'success', data: { idToken: 'valid-id-token' } } : { type: 'cancelled', data: null });
    else complete({ type: outcome, url: 'gling://auth/callback?code=valid-code' });
    await Promise.all([first, duplicate]);
    assert.equal(render().isAuthLoading, false);
    assert.equal(render().authError, outcome === 'error' ? '로그인 오류' : null, `${provider} ${outcome}`);
    assert.equal(exchangeCalls, exchangesBefore + (outcome === 'success' && !native ? 1 : 0));
    assert.equal(idTokenCalls, idTokensBefore + (outcome === 'success' && native ? 1 : 0));
  }
  await render().signInApple();
  assert.equal(appleCalls, 1);
  assert.equal(render().isAuthLoading, false);
  assert.equal(render().authError, null);
});
