import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the mounted gate with the same flags observed in Dia, without credentials.
function gate(auth, level = 'aal1', factorError = null, verify = async () => ({ error: null })) {
  const state = [], refs = [], effects = [];
  const verification = [];
  let stateIndex = 0, refIndex = 0, mounted = false, reads = 0, listener;
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-mfa-gate.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      useEffect: fn => { if (!mounted) effects.push(fn); },
      useRef: value => { const i = refIndex++; return refs[i] ??= { current: value }; },
      useState: value => { const i = stateIndex++; if (!(i in state)) state[i] = value;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    };
    if (name === 'react-native') return { Platform: { OS: 'web' }, KeyboardAvoidingView: 'KeyboardAvoidingView', ScrollView: 'ScrollView', Pressable: 'Pressable', TextInput: 'TextInput', View: 'View', StyleSheet: { create: value => value } };
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
    if (name === '@/components/raised-action-button') return { RaisedActionButton: 'RaisedActionButton' };
    if (name === '@/hooks/use-theme') return { ThemeOverrideProvider: 'ThemeOverrideProvider' };
    if (name === '@/constants/theme') return { Colors: { admin: {}, dark: {} }, Spacing: {} };
    if (name.endsWith('.png')) return 'preview-logo';
    if (name === '@/lib/admin') return { adminTotpQrUri: value => value };
    if (name === '@/lib/auth') return { useAuth: () => auth };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/lib/supabase') return { supabase: { auth: {
      onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      mfa: {
        async getAuthenticatorAssuranceLevel() { reads++; return { data: { currentLevel: level }, error: null }; },
        async listFactors() { reads++; return { data: { totp: [{ id: 'existing-totp', status: 'verified' }] }, error: factorError }; },
        async challengeAndVerify(value) { verification.push(value); return verify(value); },
      },
    } } };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const children = { type: 'AdminScreen' };
  const render = () => { stateIndex = refIndex = 0; return exports.AdminMfaGate({ children }); };
  return { children, render, verification, reads: () => reads, event: name => listener(name), async mount() {
    render(); mounted = true;
    for (const effect of effects) effect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  } };
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}

test('code entry accepts six digits and keyboard submission cannot duplicate a pending challenge', async () => {
  let finish;
  const app = gate({ isAdmin: true, isAuthed: true, me: { id: 'admin' } }, 'aal1', null, () => new Promise(resolve => { finish = resolve; }));
  await app.mount();
  const input = () => nodes(app.render()).find(n => n.type === 'TextInput');
  const action = () => nodes(app.render()).find(n => n.props.analyticsId === 'admin_mfa.verify');
  input().props.onChangeText('12');
  input().props.onSubmitEditing();
  assert.equal(app.verification.length, 0, 'An incomplete code must not hit the MFA API.');
  input().props.onChangeText('123x456');
  assert.equal(input().props.value, '123456');
  assert.equal(input().props.autoComplete, 'one-time-code');
  assert.equal(input().props.textContentType, 'oneTimeCode');
  const submit = action().props.onPress;
  input().props.onSubmitEditing(); submit();
  assert.equal(app.verification.length, 1);
  assert.equal(app.verification[0].factorId, 'existing-totp');
  assert.equal(app.verification[0].code, '123456');
  assert.equal(input().props.editable, false);
  assert.equal(action().props.busy, true);
  finish({ error: null });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(input().props.value, '');
  assert.notEqual(app.render(), app.children, 'Only the refreshed server assurance level can open the dashboard.');
});

test('an invalid code keeps the challenge open, preserves its input and presents an alert', async () => {
  const app = gate({ isAdmin: true, isAuthed: true, me: { id: 'admin' } }, 'aal1', null, async () => ({ error: new Error('invalid code') }));
  await app.mount();
  nodes(app.render()).find(n => n.type === 'TextInput').props.onChangeText('123456');
  nodes(app.render()).find(n => n.props.analyticsId === 'admin_mfa.verify').props.onPress();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.notEqual(app.render(), app.children);
  assert.equal(nodes(app.render()).find(n => n.type === 'TextInput').props.value, '123456');
  assert.ok(nodes(app.render()).some(n => n.props.accessibilityRole === 'alert'));
  assert.match(text(app.render()), /최신 6자리 코드/);
});

function text(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text(node?.props?.children ?? '');
}

test('a fresh browser awaiting Google login does not masquerade as an MFA query', async () => {
  const app = gate({ isAdmin: false, isAuthed: false, isAuthLoading: true, me: { id: '' } });
  await app.mount();
  assert.equal(app.render(), app.children, 'The login screen owns initial session/login progress.');
  assert.equal(app.reads(), 0, 'There is no administrator session to check for MFA yet.');
});

test('a new AAL1 admin session challenges the existing factor; only AAL2 opens the dashboard', async () => {
  const auth = { isAdmin: true, isAuthed: true, isAuthLoading: false, me: { id: 'admin' } };
  const first = gate(auth);
  await first.mount();
  assert.notEqual(first.render(), first.children);
  assert.match(text(first.render()), /인증 앱의 6자리 코드/);
  assert.doesNotMatch(text(first.render()), /인증 앱 연결/);
  const verified = gate(auth, 'aal2');
  await verified.mount();
  assert.equal(verified.render(), verified.children);
  verified.event('TOKEN_REFRESHED');
  assert.equal(verified.render(), verified.children, 'Keep an authenticated open editor on token refresh.');
  verified.event('SIGNED_OUT');
  assert.notEqual(verified.render(), verified.children, 'A prior verified gate cannot survive logout.');
});

test('a failed factor lookup stays closed and offers the existing retry action', async () => {
  const app = gate({ isAdmin: true, isAuthed: true, isAuthLoading: false, me: { id: 'admin' } }, 'aal2', new Error('offline'));
  await app.mount();
  assert.notEqual(app.render(), app.children);
  assert.match(text(app.render()), /인증 상태를 확인하지 못했습니다/);
  assert.match(text(app.render()), /다시 확인/);
});

test('the unauthenticated login form remains visible while its Google popup is pending', () => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/admin/admin-screen.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return { useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}] };
    if (name === 'react-native') return { Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
    if (name === 'expo-router') return { useLocalSearchParams: () => ({ section: 'merchants' }) };
    if (name === '@/lib/admin') return { initialAdminSection: () => 'merchants' };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: false, isAdmin: false, isAuthLoading: true, me: { id: '' } }) };
    if (name === '@/components/login-panel') return { LoginPanel: 'LoginPanel' };
    if (name === '@/constants/theme') return { Colors: { admin: {}, dark: {} }, Spacing: {} };
    return {};
  } });
  const screen = exports.AdminScreen();
  assert.equal(screen.type, 'LoginPanel');
  assert.equal(screen.props.loading, true, 'Keep duplicate login attempts disabled.');
});
