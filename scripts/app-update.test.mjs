import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

import { requiresAppUpdate } from '../src/lib/app-update.ts';

test('only an older installed native build is blocked', () => {
  assert.equal(requiresAppUpdate('49', 50), true);
  assert.equal(requiresAppUpdate('50', 50), false);
  assert.equal(requiresAppUpdate('51', 50), false);
  assert.equal(requiresAppUpdate(null, 50), false);
  assert.equal(requiresAppUpdate('preview', 50), false);
  assert.equal(requiresAppUpdate('49', null), false);
});

function updateGate({ dev = false, os = 'ios', environment = 'bare', build = '61', minimum = 64, failure = false } = {}) {
  let hook = 0, dirty, tree, requests = 0;
  const hooks = [], pending = [], timers = new Map(), listeners = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const imports = {
    react: {
      useState(initial) { const index = hook++; hooks[index] ??= { value: initial }; return [hooks[index].value, value => { if (!Object.is(hooks[index].value, value)) { hooks[index].value = value; dirty = true; } }]; },
      useRef(initial) { return hooks[hook++] ??= { current: initial }; },
      useCallback(callback) { return (hooks[hook++] ??= { value: callback }).value; },
      useEffect(callback, deps) { const index = hook++, old = hooks[index]; if (!same(old?.deps, deps)) { old?.cleanup?.(); hooks[index] = { deps }; pending.push(() => { hooks[index].cleanup = callback(); }); } },
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-application': { nativeBuildVersion: build },
    'expo-constants': { __esModule: true, default: { executionEnvironment: environment }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    'expo-splash-screen': { hideAsync: async () => {} },
    'react-native': { Platform: { OS: os }, AppState: { currentState: 'active', addEventListener: (_, callback) => { listeners.push(callback); return { remove() {} }; } }, Modal: 'Modal', View: 'View', StyleSheet: { create: value => value } },
    '@/constants/theme': { Spacing: { three: 12 } }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/app-update': { requiresAppUpdate }, '@/components/launch-moment': { LaunchMoment: 'LaunchMoment' }, '@/components/state-card': { StateCard: 'StateCard' },
    '@/lib/supabase': { supabase: { from: () => { const query = { select: () => query, eq: () => query, abortSignal: () => query, maybeSingle: async () => { requests++; return { data: { minimum_build: minimum }, error: failure ? new Error('network') : null }; } }; return query; } } },
  };
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/app-update-gate.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, __DEV__: dev, AbortController,
    setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  const modal = () => tree.props.children.find(node => node?.type === 'Modal');
  const render = async () => {
    let count = 0;
    do {
      hook = 0; dirty = false; tree = exports.AppUpdateGate({ children: 'APP' });
      for (const callback of pending.splice(0)) callback();
      for (const [id, timer] of timers) if (timer.delay === 0) { timers.delete(id); timer.callback(); }
      await new Promise(resolve => setImmediate(resolve));
    } while (dirty && ++count < 12);
    assert.ok(count < 12);
    if (modal().props.children?.type === 'LaunchMoment') { modal().props.children.props.onComplete(); await render(); }
  };
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  return { render, modal, title: () => nodes(tree).find(node => node.type === 'StateCard')?.props.title, requests: () => requests,
    async foreground(nextMinimum = minimum) { minimum = nextMinimum; for (const state of ['background','active']) for (const callback of listeners) callback(state); await render(); } };
}

for (const options of [{ dev: true }, { environment: 'storeClient' }, { os: 'web' }]) test(`current development/web source can reload and resume without an obsolete native build gate: ${JSON.stringify(options)}`, async () => {
  const ui = updateGate(options); await ui.render();
  assert.equal(ui.requests(), 0); assert.equal(ui.modal().props.visible, false);
  await ui.foreground(); assert.equal(ui.requests(), 0); assert.equal(ui.modal().props.visible, false);
});
test('release binaries remain blocked at startup and when the minimum rises in the foreground', async () => {
  const old = updateGate(); await old.render(); assert.equal(old.title(), '새 버전으로 업데이트해 주세요'); assert.equal(old.requests(), 1);
  const current = updateGate({ build: '64' }); await current.render(); assert.equal(current.modal().props.visible, false);
  await current.foreground(65); assert.equal(current.title(), '새 버전으로 업데이트해 주세요'); assert.equal(current.requests(), 2);
});
test('a release policy network error remains closed', async () => {
  const ui = updateGate({ failure: true }); await ui.render(); assert.equal(ui.title(), '업데이트를 확인할 수 없어요'); assert.equal(ui.modal().props.visible, true);
});
