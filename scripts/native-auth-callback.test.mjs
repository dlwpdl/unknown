import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as oauth from '../src/lib/kakao-auth.ts';
import * as sharing from '../src/lib/sharing.ts';
import * as returns from '../src/lib/shared-post-return.ts';

const post = 'e23b0000-0000-4000-8000-000000000001', other = 'e23b0000-0000-4000-8000-000000000002';
const web = `/post?id=${post}&invite=1`, native = `/post/${post}?invite=1`, nextWeb = `/post?id=${other}`;
const key = sharing.SHARED_POST_RETURN_KEY + '.native';
const callback = 'gling://auth/callback?code=valid-code';

function mount(options = {}) {
  const env = { url: callback, focused: true, language: 'ko', auth: { isAuthed: true, isAuthLoading: false, authError: null, me: { id: 'viewer' } }, ...options };
  const values = new Map(), events = [], routes = [], exchanges = [], feedback = [];
  if (options.intent !== null) values.set(key, JSON.stringify({ path: options.intent ?? web, savedAt: Date.now() }));
  const storage = {
    async getItem(key) { if (env.getFailure) throw new Error('private-storage-detail'); const value = values.get(key) ?? null; if (env.readGate) await env.readGate; return value; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { events.push('clear'); if (env.clearFailure) throw new Error('private-clear-detail'); values.delete(key); },
  };
  const router = { replace(path) { events.push('navigate'); routes.push(path); } };
  const hooks = [], queued = [];
  let index = 0, dirty = true, alive = true, tree, updatesAfterUnmount = 0;
  const effect = (fn, deps, layout) => {
    const slot = index++, previous = hooks[slot];
    if (previous && deps.every((v, i) => Object.is(v, previous.deps[i]))) return;
    const state = hooks[slot] = { deps, cleanup: previous?.cleanup };
    queued.push({ layout, run() { state.cleanup?.(); state.cleanup = fn(); } });
  };
  const react = {
    useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[slot].value, next => { if (!alive) updatesAfterUnmount++; const value = typeof next === 'function' ? next(hooks[slot].value) : next; if (!Object.is(value, hooks[slot].value)) { hooks[slot].value = value; dirty = true; } }]; },
    useRef(value) { return hooks[index++] ??= { current: value }; },
    useCallback(fn, deps) { const slot = index++, old = hooks[slot]; if (!old || !deps.every((v, i) => Object.is(v, old.deps[i]))) hooks[slot] = { fn, deps }; return hooks[slot].fn; },
    useEffect: (fn, deps) => effect(fn, deps, false), useLayoutEffect: (fn, deps) => effect(fn, deps, true),
  };
  const jsx = (type, props) => ({ type, props }), exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/app/auth/callback.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, Promise, process: { env: {} }, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { StyleSheet: { create: value => value }, View: 'View', Platform: { OS: 'ios' } };
    if (name === 'expo-router') return { useRouter: () => router, useIsFocused: () => env.focused };
    if (name === 'expo-linking') return { useURL: () => env.url, createURL: path => { assert.equal(path, 'auth/callback'); return 'gling://auth/callback'; } };
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage };
    if (name === '@/hooks/use-language') return { useLanguage: () => ({ language: env.language, tr: text => text }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ background: '#101018', accent: '#CBB9FF', accentInk: '#161020' }) };
    if (name === '@/lib/auth') return { useAuth: () => env.auth };
    if (name === '@/lib/kakao-auth') return oauth;
    if (name === '@/lib/sharing') return sharing;
    if (name === '@/lib/shared-post-return') return returns;
    if (name === '@/lib/supabase') return { supabase: { auth: { async exchangeCodeForSession(code) { exchanges.push(code); if (env.exchangeGate) await env.exchangeGate; if (env.exchangeFailures) { env.exchangeFailures--; return { error: { message: 'private-provider-detail' } }; } return { error: null }; } } } };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) };
    if (name === '@/constants/theme') return { Spacing: { two: 8, three: 16, four: 24 }, Colors: { light: { background: '#ffffff' } } };
    if (name === '@/constants/design-system') return { ControlStyles: { action: { minHeight: 48, minWidth: 44 } } };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
    if (name === '@/components/themed-view') return { ThemedView: 'ThemedView' };
    if (name === '@/components/gling-loader') return { GlingLoader: 'GlingLoader' };
    throw new Error(`Missing fixture module: ${name}`);
  } });
  function render() {
    for (let count = 0; dirty; count++) {
      assert.ok(count < 25, 'callback settles without an effect loop');
      dirty = false; index = 0; queued.length = 0; tree = exports.default();
      for (const layout of [true, false]) for (const item of [...queued]) if (item.layout === layout) item.run();
    }
  }
  const nodes = value => !value || typeof value !== 'object' ? [] : [...(value.type ? [value] : []), ...Object.values(value).flatMap(nodes)];
  return { env, values, routes, exchanges, events, feedback, storage,
    async settle() { for (let n = 0; n < 12; n++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); },
    rerender() { dirty = true; render(); }, nodes: () => nodes(tree),
    press(label) { const button = nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label); assert.ok(button, label); button.props.onPress(); },
    text: () => nodes(tree).filter(node => node.type === 'ThemedText').flatMap(node => typeof node.props.children === 'string' ? [node.props.children] : []).join(' '),
    cleanup() { if (!alive) return; alive = false; for (const hook of hooks) hook?.cleanup?.(); },
    updatesAfterUnmount: () => updatesAfterUnmount,
  };
}
function ready(h) { h.env.auth = { ...h.env.auth, isAuthed: true, isAuthLoading: false, me: { id: 'viewer-ready' } }; h.rerender(); }

test('authenticated callback returns to the shared post once and clears only after navigation', async t => {
  const h = mount(); t.after(() => h.cleanup()); await h.settle();
  assert.deepEqual(h.routes, [native]); assert.deepEqual(h.exchanges, []);
  assert.deepEqual(h.events, ['navigate', 'clear']); assert.equal(h.values.has(key), false);
  h.press('공유 글로 돌아가기'); await h.settle(); assert.deepEqual(h.routes, [native]);
  const page = h.nodes().find(node => node.type === 'View'); assert.equal(page.props.style.at(-1).backgroundColor, '#101018');
});
test('cold callback exchanges only a validated code and waits through profile/onboarding loading', async t => {
  const h = mount({ auth: { isAuthed: false, isAuthLoading: false, authError: null, me: { id: 'guest' } } }); t.after(() => h.cleanup()); await h.settle();
  assert.deepEqual(h.exchanges, ['valid-code']); assert.deepEqual(h.routes, []);
  h.env.auth = { ...h.env.auth, isAuthLoading: true, me: { id: 'viewer-ready' } }; h.rerender(); await h.settle();
  h.press('공유 글로 돌아가기'); await h.settle(); assert.deepEqual(h.routes, []);
  ready(h); await h.settle(); assert.deepEqual(h.routes, [native]); assert.equal(h.exchanges.length, 1);
});
test('warm provider loading never exchanges again and resumes only after onboarding', async t => {
  const h = mount({ auth: { isAuthed: false, isAuthLoading: true, authError: null, me: { id: 'guest' } } }); t.after(() => h.cleanup()); await h.settle();
  assert.deepEqual(h.exchanges, []); assert.deepEqual(h.routes, []);
  ready(h); await h.settle(); assert.deepEqual(h.routes, [native]); assert.deepEqual(h.exchanges, []);
});
test('a cold exchange failure while unfocused becomes retryable on return without another automatic exchange', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = mount({ exchangeGate: gate, exchangeFailures: 1, auth: { isAuthed: false, isAuthLoading: false, authError: null, me: { id: 'guest' } } });
  t.after(() => { release(); h.cleanup(); }); await h.settle();
  h.env.focused = false; h.rerender(); release(); await h.settle();
  h.env.focused = true; h.rerender(); await h.settle();
  assert.ok(h.text().includes('로그인을 완료하지 못했어요.')); assert.equal(h.exchanges.length, 1);
  h.press('다시 시도'); await h.settle(); assert.equal(h.exchanges.length, 2); assert.equal(h.values.has(key), true);
});
test('provider failure cannot trigger a duplicate cold exchange and back preserves the original preview', async t => {
  const h = mount({ auth: { isAuthed: false, isAuthLoading: false, authError: 'private-provider-detail', me: { id: 'guest' } } }); t.after(() => h.cleanup()); await h.settle();
  assert.deepEqual(h.exchanges, []); assert.ok(!h.text().includes('private-provider-detail'));
  h.press('다시 시도'); await h.settle(); assert.deepEqual(h.exchanges, []);
  assert.deepEqual(h.routes, [native]); assert.equal(h.values.has(key), true);
});
test('the signed-out return control opens the original preview without clearing its login intent', async t => {
  const h = mount({ url: 'gling://auth/callback?error=access_denied', auth: { isAuthed: false, isAuthLoading: false, authError: null, me: { id: 'guest' } } });
  t.after(() => h.cleanup()); await h.settle();
  h.press('공유 글로 돌아가기'); await h.settle();
  assert.deepEqual(h.routes, [native]); assert.deepEqual(h.events, ['navigate']);
  assert.equal(h.values.has(key), true); assert.deepEqual(h.exchanges, []); assert.ok(h.feedback.includes('selection'));
});
test('invalid, cancelled, external, duplicated and missing callback responses never exchange or leak details', async t => {
  for (const url of [null, 'gling://auth/callback', 'gling://auth/callback?error=access_denied&error_description=private-provider-detail', 'https://evil.test/auth/callback?code=secret', callback + '&code=another']) {
    const h = mount({ url, language: 'en', auth: { isAuthed: false, isAuthLoading: false, authError: null, me: { id: 'guest' } } });
    t.after(() => h.cleanup()); await h.settle(); assert.deepEqual(h.exchanges, []); assert.deepEqual(h.routes, []);
    assert.ok(h.text().includes('Couldn’t finish signing in.')); assert.ok(!/private-provider-detail|secret|another|evil\.test/.test(h.text()));
    assert.equal(h.values.has(key), true); h.cleanup();
  }
});
test('exchange failure and storage-read failure are retryable without consuming the intent', async t => {
  const h = mount({ exchangeFailures: 1, auth: { isAuthed: false, isAuthLoading: false, authError: null, me: { id: 'guest' } } }); t.after(() => h.cleanup()); await h.settle();
  assert.equal(h.values.has(key), true); assert.deepEqual(h.routes, []); assert.ok(h.text().includes('로그인을 완료하지 못했어요.'));
  h.press('다시 시도'); await h.settle(); assert.equal(h.exchanges.length, 2);
  h.env.getFailure = true; ready(h); await h.settle(); assert.deepEqual(h.routes, []); assert.equal(h.values.has(key), true);
  h.env.getFailure = false; h.press('다시 시도'); await h.settle(); assert.deepEqual(h.routes, [native]);
});
test('manual return and auto return share one flight and do not overwrite with home', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const h = mount({ readGate: gate }); t.after(() => { release(); h.cleanup(); }); await h.settle();
  h.press('공유 글로 돌아가기'); h.press('공유 글로 돌아가기'); release(); await h.settle();
  assert.deepEqual(h.routes, [native]); assert.deepEqual(h.events, ['navigate', 'clear']);
});
test('a queued retry press cannot reset an in-flight exchange and repeat its one-time code', async t => {
  const h = mount({ exchangeFailures: 1, auth: { isAuthed: false, isAuthLoading: false, authError: null, me: { id: 'guest' } } });
  let release; t.after(() => { release?.(); h.cleanup(); }); await h.settle();
  const retry = h.nodes().find(node => node.type === 'Pressable' && node.props.accessibilityLabel === '다시 시도').props.onPress;
  h.env.exchangeGate = new Promise(resolve => { release = resolve; });
  retry(); await h.settle(); assert.equal(h.exchanges.length, 2);
  retry(); release(); await h.settle(); assert.equal(h.exchanges.length, 2);
});
test('focus loss and unmount during storage read preserve intent and cannot navigate stale results', async t => {
  for (const change of ['focus', 'unmount']) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const h = mount({ readGate: gate }); t.after(() => { release(); h.cleanup(); }); await h.settle();
    if (change === 'focus') h.env.focused = false;
    if (change === 'unmount') h.cleanup(); else h.rerender();
    release(); if (change !== 'unmount') await h.settle(); else await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.routes, [], change); assert.equal(h.values.has(key), true, change); assert.equal(h.updatesAfterUnmount(), 0, change);
    h.cleanup();
  }
});
test('an independently changed URL or ready account discards the old read before resuming the latest intent', async t => {
  for (const change of ['url', 'account']) {
    let releaseOld, releaseNew;
    const oldGate = new Promise(resolve => { releaseOld = resolve; });
    const newGate = new Promise(resolve => { releaseNew = resolve; });
    const h = mount({ readGate: oldGate }); t.after(() => { releaseOld(); releaseNew(); h.cleanup(); }); await h.settle();
    const saved = returns.rememberSharedPostReturn(h.storage, nextWeb);
    h.env.readGate = newGate;
    if (change === 'url') h.env.url = 'gling://auth/callback?code=new-code';
    else h.env.auth = { ...h.env.auth, me: { id: 'another-ready-account' } };
    h.rerender(); releaseOld(); await h.settle(); await saved;
    assert.deepEqual(h.routes, [], `${change}: old result cannot navigate`);
    assert.equal(JSON.parse(h.values.get(key)).path, nextWeb, `${change}: new intent remains unconsumed`);
    releaseNew(); await h.settle(); assert.deepEqual(h.routes, [`/post/${other}`]);
    h.cleanup();
  }
});
test('a newer intent survives the old handoff cleanup and a failed cleanup is retried by the post route', async t => {
  const h = mount({ clearFailure: true }); t.after(() => h.cleanup()); await h.settle();
  assert.deepEqual(h.routes, [native]); assert.equal(h.values.has(key), true);
  await returns.rememberSharedPostReturn(h.storage, nextWeb); h.env.clearFailure = false;
  await returns.clearSharedPostReturn(h.storage, web);
  assert.equal(await returns.readSharedPostReturn(h.storage), `/post/${other}`);
  await h.settle(); assert.deepEqual(h.routes, [native]);
});
test('missing saved intent falls back home once after complete authentication', async t => {
  const h = mount({ intent: null }); t.after(() => h.cleanup()); await h.settle(); h.rerender(); await h.settle();
  assert.deepEqual(h.routes, ['/']); assert.deepEqual(h.exchanges, []);
});
