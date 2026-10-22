import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as connections from '../src/lib/merchant-connections.ts';

function app(component = 'MerchantAccountEntry') {
  const states = [], refs = [], effects = [], calls = [], pending = [], routes = [], feedback = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, auth = { me: { id: 'user-a' }, isAuthed: true, isAdmin: false }, foreground;
  const client = { rpc: (name, args) => {
    calls.push({ name, args }); return new Promise(resolve => pending.push(data => resolve({ data, error: null })));
  } };
  function recordEffect(fn, deps) { const i = effectIndex++; if (!effects[i] || deps.some((dep, index) => dep !== effects[i].deps[index])) { effects[i]?.cleanup?.(); effects[i] = { fn, deps, changed: true }; } }
  const React = {
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useCallback(fn, deps) { fn.deps = deps; return fn; },
    useEffect: recordEffect,
    useLayoutEffect: recordEffect,
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/merchant-account-connections.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, window: { confirm: () => true }, Date, require(name) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'expo-router') return { useRouter: () => ({ push: path => routes.push(path) }), useFocusEffect: fn => recordEffect(fn, fn.deps) };
    if (name === 'react-native') return { Platform: { OS: 'web' }, View: 'View', StyleSheet: { create: value => value }, AppState: { addEventListener(name, fn) { foreground = fn; return { remove() {} }; } } };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ accent: '#CBB9FF' }) };
    if (name === '@/lib/auth') return { useAuth: () => auth };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) };
    if (name === '@/lib/merchant-connections') return connections;
    if (name === '@/lib/supabase') return { supabase: client };
    throw new Error('Unexpected import ' + name);
  } });
  let props = { refreshSignal: 0, onChanged: () => {}, merchantId: 'company-a' };
  return { calls, pending, routes, feedback,
    auth(value) { auth = { ...auth, ...value }; }, props(value) { props = { ...props, ...value }; },
    foreground() { foreground('active'); },
    render() {
      stateIndex = refIndex = effectIndex = 0;
      const node = exports[component](props);
      for (const effect of effects) if (effect.changed) { effect.changed = false; effect.cleanup = effect.fn(); }
      return node;
    },
  };
}
const context = (user = 'user-a', merchants = [{ id: 'company-a', name: '업체 A', role: 'owner', city_name: '밴쿠버' }], invitations = []) => ({ user_id: user, merchants, invitations });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function nodes(node) { return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
function text(node) { return node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' '); }

test('last connection removal hides the entry and a revoked click never navigates', async () => {
  const view = app();
  assert.equal(view.render(), null);
  view.pending.shift()(context()); await flush();
  const entry = view.render(); assert.match(text(entry), /1개 업체/);
  entry.props.onPress();
  assert.equal(view.calls.length, 2, 'every switch rechecks the current server connection');
  view.pending.shift()(context('user-a', [])); await flush();
  assert.equal(view.render(), null); assert.deepEqual(view.routes, []);
});
test('foreground revocation clears switches and preserves a pending invitation entry', async () => {
  const view = app(); view.render(); view.pending.shift()(context()); await flush(); view.render();
  view.foreground(); view.pending.shift()(context('user-a', [])); await flush();
  assert.equal(view.render(), null);
  view.foreground();
  view.pending.shift()(context('user-a', [], [{ id: 'invite-a', merchant_id: 'company-a', role: 'owner', can_accept: true }])); await flush();
  assert.match(text(view.render()), /업체 계정 초대/);
});
test('account change discards outstanding reads and an outstanding switch click', async () => {
  const view = app(); view.render(); view.pending.shift()(context()); await flush(); view.render().props.onPress();
  view.auth({ me: { id: 'user-b' } }); assert.equal(view.render(), null);
  view.pending.shift()(context()); await flush();
  assert.equal(view.render(), null); assert.deepEqual(view.routes, []);
  view.pending.shift()(context('user-b', [])); await flush(); assert.equal(view.render(), null);
});
test('a failed connection check clears cached switches', async () => {
  const view = app(); view.render(); view.pending.shift()(context()); await flush(); view.render();
  view.foreground(); view.pending.shift()(null); await flush(); assert.equal(view.render(), null);
});
test('invitations cannot display another account cache or accept changed business details', async () => {
  const view = app('MerchantAccountInvitations'); view.render();
  const invitation = { id: 'invite-a', merchant_id: 'company-a', merchant_name: '업체 A', address: '주소 A', city_name: '밴쿠버', role: 'owner', expires_at: '2026-10-16', can_accept: false };
  view.pending.shift()(context('user-a', [], [invitation])); await flush();
  const node = view.render(), action = nodes(node).find(n => n.props?.label === '확인하고 연결');
  assert.equal(action.props.disabled, true); assert.match(text(node), /업체 정보가 바뀌었어요/);
  view.auth({ me: { id: 'user-b' } }); assert.equal(view.render(), null);
});
