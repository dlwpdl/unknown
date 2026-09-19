import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import { recordLoginTerms, LOGIN_TERMS_VERSION } from '../src/lib/login-terms.ts';

function panel(opened = []) {
  const states = []; let index = 0;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/login-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, __DEV__: true, process: { env: {} }, require(name) {
    if (name === 'react') return { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; } };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Platform: { OS: 'ios' }, StyleSheet: { create: v => v }, useColorScheme: () => 'light', ...Object.fromEntries(['View','Pressable','ScrollView','TextInput','KeyboardAvoidingView'].map(k => [k,k])) };
    if (name === 'expo-linking') return { openURL: async url => { opened.push(url); } };
    if (name === 'expo-font') return { useFonts: () => [true] };
    if (name === 'expo-apple-authentication') return { AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 1 } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Spacing: {} };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/login-terms') return { LOGIN_TERMS_VERSION };
    return {};
  } });
  return props => { index = 0; return exports.LoginPanel(props); };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(v => Array.isArray(v) ? v.flatMap(nodes) : nodes(v))];

test('all login paths require both unchecked agreements and expose working policy URLs', () => {
  for (const provider of ['onApple', 'onGoogle', 'onKakao', 'onReviewLogin', 'onDevLogin', 'onAdminLogin']) {
    const opened = []; const render = panel(opened); const calls = [];
    const props = { [provider]: (...args) => calls.push(args) };
    let tree = render(props);
    let checkbox = nodes(tree).find(n => n.props?.accessibilityRole === 'checkbox');
    assert.equal(nodes(tree).filter(n => n.props?.accessibilityRole === 'checkbox').length, 2, 'terms and privacy must be separate');
    for (const box of nodes(tree).filter(n => n.props?.accessibilityRole === 'checkbox')) assert.equal(box.props.accessibilityState.checked, false);
    assert.equal(checkbox.props.accessibilityState.checked, false);
    if (['onReviewLogin', 'onDevLogin', 'onAdminLogin'].includes(provider)) {
      const fields = nodes(tree).filter(n => n.type === 'TextInput');
      fields[0].props.onChangeText('review@example.com'); fields[1].props.onChangeText('password');
      tree = render(props);
    }
    const button = () => nodes(tree).find(n => n.type === (provider === 'onApple' ? 'AppleButton' : 'Pressable') && n.props?.accessibilityState?.busy !== undefined);
    assert.equal(button().props.accessibilityState.disabled, true);
    button().props.onPress(); assert.equal(calls.length, 0, 'handler guard also prevents bypass');
    checkbox.props.onPress(); tree = render(props);
    assert.equal(nodes(tree).find(n => n.props?.accessibilityRole === 'checkbox').props['aria-checked'], true);
    assert.equal(button().props.accessibilityState.disabled, true, 'terms alone cannot start signup');
    button().props.onPress(); assert.equal(calls.length, 0);
    const privacy = () => nodes(tree).find(n => n.props?.accessibilityRole === 'checkbox' && n.props.accessibilityLabel.includes('개인정보'));
    privacy().props.onPress(); tree = render(props);
    assert.equal(button().props.accessibilityState.disabled, false);
    button().props.onPress(); assert.equal(calls.length, 1);
    assert.equal(calls[0].at(-1), LOGIN_TERMS_VERSION);
    tree = render({ ...props, loading: true });
    button().props.onPress(); assert.equal(calls.length, 1, 'loading blocks duplicate authentication');
    for (const box of nodes(tree).filter(n => n.props?.accessibilityRole === 'checkbox')) assert.equal(box.props.disabled, true);
    tree = render(props);
    nodes(tree).find(n => n.props?.accessibilityRole === 'checkbox').props.onPress(); tree = render(props);
    button().props.onPress(); assert.equal(calls.length, 1, 'privacy alone cannot start signup');
    nodes(tree).find(n => n.props?.accessibilityRole === 'checkbox').props.onPress(); tree = render(props);
    privacy().props.onPress(); tree = render(props);
    button().props.onPress(); assert.equal(calls.length, 1, 'unchecking privacy blocks signup again');
    for (const link of nodes(tree).filter(n => n.props?.accessibilityRole === 'link' && n.props.accessibilityLabel?.includes('전문'))) link.props.onPress();
    assert.deepEqual(opened, ['https://gling.ej-entertainment.com/terms', 'https://gling.ej-entertainment.com/privacy']);
  }
});

test('receipt failure signs out locally; valid agreement records only its version', async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const client = { rpc: async (...args) => { calls.push(args); return { error: fail ? new Error('offline') : null }; },
      auth: { signOut: async options => { calls.push(['signOut', options]); return { error: null }; } } };
    if (fail) await assert.rejects(recordLoginTerms(client, LOGIN_TERMS_VERSION), /offline/);
    else await recordLoginTerms(client, LOGIN_TERMS_VERSION);
    assert.deepEqual(calls[0], ['accept_login_terms', { p_version: LOGIN_TERMS_VERSION }]);
    assert.equal(calls.length, fail ? 2 : 1);
    if (fail) assert.deepEqual(calls[1], ['signOut', { scope: 'local' }]);
  }
});

test('every auth entry point rejects missing consent before contacting a provider and records successful consent', async () => {
  for (const method of ['signInApple','signInGoogle','signInKakao','signInReview','signInDev','signInAdmin']) {
    const calls = []; const exports = {};
    const success = async () => { calls.push('auth'); return { data: { url: 'https://example.invalid/auth' }, error: null }; };
    const client = { auth: { signInWithOAuth: success, exchangeCodeForSession: success, signInWithIdToken: success, signInWithPassword: success,
      updateUser: async () => { calls.push('metadata'); return { error: new Error('metadata unavailable') }; } },
      rpc: async (name, args) => { calls.push([name, args]); return { error: null }; } };
    const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(source, { exports, __DEV__: true, process: { env: {} }, require(name) {
      if (name === 'react') return { createContext: () => ({ Provider: 'Provider' }), useState: initial => [initial, () => {}], useRef: current => ({ current }), useCallback: fn => fn, useMemo: fn => fn(), useEffect() {} };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'react-native') return { Platform: { OS: 'ios' }, StyleSheet: { create: v => v } };
      if (name === '@react-native-google-signin/google-signin') return { GoogleSignin: { configure() {}, signIn: async () => { calls.push('google'); return { data: { idToken: 'test' } }; } }, isSuccessResponse: () => true, isErrorWithCode: () => false, statusCodes: {} };
      if (name === 'expo-apple-authentication') return { AppleAuthenticationScope: {}, signInAsync: async () => { calls.push('apple'); return { identityToken: 'test', authorizationCode: 'test' }; } };
      if (name === 'expo-web-browser') return { maybeCompleteAuthSession() {}, openAuthSessionAsync: async () => ({ type: 'success', url: 'test' }) };
      if (name === 'expo-linking') return { createURL: () => 'test' };
      if (name === '@/lib/kakao-auth') return { canUseDevPasswordLogin: () => true, getOAuthCallbackPath: () => '', getKakaoAuthSessionUrl: x => x, getOAuthCode: () => 'test' };
      if (name === '@/lib/login-terms') return { recordLoginTerms, LOGIN_TERMS_VERSION };
      if (name === '@/lib/supabase') return { supabase: client, signInReviewAccount: success, signInAdminAccount: success };
      if (name === '@/lib/admin') return { isAdminRole: () => false };
      if (name === '@/i18n/ko') return { t };
      if (name === '@/constants/theme') return { Spacing: {} };
      return {};
    } });
    const auth = exports.AuthProvider({ children: null }).props.value;
    const args = ['signInReview','signInDev','signInAdmin'].includes(method) ? ['user','pass'] : [];
    await auth[method](...args); assert.equal(calls.length, 0, method);
    await auth[method](...args, LOGIN_TERMS_VERSION);
    assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'accept_login_terms'), method);
    if (method === 'signInApple') assert.ok(calls.findIndex(c => Array.isArray(c) && c[0] === 'accept_login_terms') < calls.indexOf('metadata'), 'receipt saved even when optional Apple metadata fails');
  }
});
