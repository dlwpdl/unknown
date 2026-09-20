import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';

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
    return {};
  } });
  return props => { index = 0; return exports.LoginPanel(props); };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(v => Array.isArray(v) ? v.flatMap(nodes) : nodes(v))];

test('all login paths authenticate before signup consent, retain policy links and block duplicate presses', () => {
  for (const provider of ['onApple', 'onGoogle', 'onKakao', 'onReviewLogin', 'onDevLogin', 'onAdminLogin']) {
    const opened = []; const render = panel(opened); const calls = [];
    const props = { [provider]: (...args) => calls.push(args) };
    let tree = render(props);
    assert.equal(nodes(tree).filter(n => n.props?.accessibilityRole === 'checkbox').length, 0);
    const password = ['onReviewLogin', 'onDevLogin', 'onAdminLogin'].includes(provider);
    if (password) {
      const fields = nodes(tree).filter(n => n.type === 'TextInput');
      fields[0].props.onChangeText('review@example.com'); fields[1].props.onChangeText('password');
      tree = render(props);
    }
    const button = () => nodes(tree).find(n => n.type === (provider === 'onApple' ? 'AppleButton' : 'Pressable') && n.props?.accessibilityState?.busy !== undefined);
    assert.equal(button().props.accessibilityState.disabled, false);
    button().props.onPress(); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], password ? ['review@example.com', 'password'] : []);
    tree = render({ ...props, loading: true });
    button().props.onPress(); assert.equal(calls.length, 1);
    for (const link of nodes(tree).filter(n => n.props?.accessibilityRole === 'link').slice(0, 2)) link.props.onPress();
    assert.deepEqual(opened, ['https://gling.ej-entertainment.com/terms', 'https://gling.ej-entertainment.com/privacy']);
  }
});

test('authentication never records signup consent on behalf of the user', async () => {
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
      if (name === '@/lib/supabase') return { supabase: client, signInReviewAccount: success, signInAdminAccount: success };
      if (name === '@/lib/admin') return { isAdminRole: () => false };
      if (name === '@/i18n/ko') return { t };
      if (name === '@/constants/theme') return { Spacing: {} };
      return {};
    } });
    const auth = exports.AuthProvider({ children: null }).props.value;
    const args = ['signInReview','signInDev','signInAdmin'].includes(method) ? ['user','pass'] : [];
    await auth[method](...args);
    assert.ok(calls.includes('auth'), method);
    assert.ok(!calls.some(c => Array.isArray(c)), 'no consent RPC during authentication');
  }
});
