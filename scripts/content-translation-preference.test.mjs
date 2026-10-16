import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function mount({ stored = null, language = 'en', supported = true, viewer = 'viewer-a' } = {}) {
  const hooks = [], dialogs = [], writes = [], values = new Map(stored === null ? [] : [['gling.device-translation.v1:viewer-a', stored]]);
  let index = 0, effects = [], layout = [], target = language, account = viewer;
  const effect = (queue, fn, deps) => {
    const slot = index++, old = hooks[slot];
    if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    const next = hooks[slot] = { deps, cleanup: old?.cleanup };
    queue.push(() => { next.cleanup?.(); next.cleanup = fn(); });
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial; return [hooks[slot], next => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next; }]; },
    useRef(initial) { return hooks[index++] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = index++, old = hooks[slot]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) hooks[slot] = { value: fn, deps }; return hooks[slot].value; },
    useEffect(fn, deps) { effect(effects, fn, deps); }, useLayoutEffect(fn, deps) { effect(layout, fn, deps); },
  };
  const imports = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': { Alert: { alert: (...args) => dialogs.push(args) } },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); writes.push([key, value]); } } },
    'expo-router': {}, '@/hooks/use-language': { useLanguage: () => ({ language: target }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: !!account, me: { id: account ?? 'guest' } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/content-translation': { isDeviceTranslationSupported: () => supported, resetContentTranslations() {} }, '@/lib/translation-source': {},
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/hooks/use-content-translation.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Promise, require: name => { assert.ok(name in imports, name); return imports[name]; } });
  const render = () => { index = 0; effects = []; layout = []; const node = exports.ContentTranslationProvider({ children: 'app' }); layout.forEach(fn => fn()); effects.forEach(fn => fn()); return node.props.value; };
  return { render, dialogs, writes, language: value => { target = value; }, viewer: value => { account = value; }, async settle() { for (let i = 0; i < 3; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } return render(); }, cleanup() { hooks.forEach(hook => hook?.cleanup?.()); } };
}

test('first English session offers automatic translation once and enables it only after language-pack acceptance', async () => {
  const ui = mount(); let state = await ui.settle();
  assert.equal(state.mode, 'off'); assert.equal(ui.dialogs.length, 1); assert.equal(ui.writes.length, 0);
  ui.dialogs[0][2][1].onPress(); state = await ui.settle();
  assert.equal(state.mode, 'auto'); assert.deepEqual(ui.writes, [['gling.device-translation.v1:viewer-a', 'auto']]);
  await ui.settle(); assert.equal(ui.dialogs.length, 1); ui.cleanup();
});

test('saved off/manual choices, guests and unsupported binaries never receive an automatic setup prompt', async () => {
  for (const options of [{ stored: 'off' }, { stored: 'manual' }, { viewer: null }, { supported: false }]) {
    const ui = mount(options); await ui.settle(); assert.equal(ui.dialogs.length, 0); assert.equal(ui.writes.length, 0); ui.cleanup();
  }
});

test('changing to English offers setup, cancellation stays off, and stale acceptance cannot enable another account', async () => {
  const ui = mount({ language: 'ko' }); await ui.settle(); assert.equal(ui.dialogs.length, 0);
  ui.language('en'); await ui.settle(); assert.equal(ui.dialogs.length, 1);
  ui.dialogs[0][2][0].onPress(); assert.equal((await ui.settle()).mode, 'off'); assert.equal(ui.dialogs.length, 1);
  ui.viewer('viewer-b'); await ui.settle();
  ui.dialogs[0][2][1].onPress(); await ui.settle();
  assert.equal(ui.writes.length, 0); ui.cleanup();
});
