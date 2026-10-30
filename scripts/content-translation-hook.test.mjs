import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { needsContentTranslation } from './test-meetup-source-imports.mjs';

function mount() {
  let hooks = [], index = 0, effects = [], layout = [], language = 'en', viewer = 'viewer-a', visible = true;
  let source = { title: null, body: 'Hello 안녕하세요' }, focused = true, appState = 'active', appListener;
  const calls = [], preference = { mode: 'auto', ready: true, saving: false, requestMode: async () => true };
  const effect = (queue, fn, deps) => {
    const slot = index++, previous = hooks[slot];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const state = hooks[slot] = { deps, cleanup: previous?.cleanup };
    queue.push(() => { state.cleanup?.(); state.cleanup = fn(); });
  };
  const react = {
    createContext: () => ({}), useContext: () => preference,
    useState(initial) {
      const slot = index++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }];
    },
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useMemo(fn, deps) {
      const slot = index++, previous = hooks[slot];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) hooks[slot] = { value: fn(), deps };
      return hooks[slot].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { effect(effects, fn, deps); },
    useLayoutEffect(fn, deps) { effect(layout, fn, deps); },
  };
  const imports = {
    react, 'react/jsx-runtime': {},
    '@react-native-async-storage/async-storage': {},
    'expo-router': { useIsFocused: () => focused },
    'react-native': { AppState: { get currentState() { return appState; }, addEventListener: (_name, listener) => { appListener = listener; return { remove() {} }; } } },
    '@/hooks/use-language': { useLanguage: () => ({ language }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: viewer } }) },
    '@/lib/interaction-feedback': {},
    '@/lib/translation-source': { needsContentTranslation },
    '@/lib/content-translation': { resetContentTranslations() {}, requestContentTranslation: (scope, request, signal) => new Promise((resolve, reject) => {
      calls.push({ scope, request, resolve, reject, signal });
      signal.addEventListener('abort', () => reject(new Error('TRANSLATION_CANCELLED')), { once: true });
    }) },
  };
  const exports = {};
  const script = ts.transpileModule(readFileSync(new URL('../src/hooks/use-content-translation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, { exports, AbortController, Error, Promise, require: name => {
    assert.ok(name in imports, 'Known import: ' + name);
    return imports[name];
  } });
  const render = (layoutOnly = false) => {
    index = 0; effects = []; layout = [];
    const result = exports.useContentTranslation('comment', 'comment-a', source, visible);
    layout.forEach(fn => fn()); if (!layoutOnly) effects.forEach(fn => fn());
    return result;
  };
  return { calls, preference, render, flushEffects: () => effects.forEach(fn => fn()), async settle() { await new Promise(resolve => setImmediate(resolve)); return render(); },
    language: value => { language = value; }, viewer: value => { viewer = value; }, body: value => { source = { ...source, body: value }; },
    focus: value => { focused = value; }, appState: value => { appState = value; appListener?.(value); },
    visible: value => { visible = value; }, cleanup: () => hooks.forEach(hook => hook?.cleanup?.()),
    visibleIds() {
      index = 0; effects = []; layout = [];
      const result = exports.useTranslationVisibleIds();
      layout.forEach(fn => fn()); effects.forEach(fn => fn());
      return result;
    } };
}

test('visible ids change state only in automatic mode and catch up when auto turns on', () => {
  const ui = mount();
  ui.preference.mode = 'manual';
  const [initial, track] = ui.visibleIds();
  track(['a', 'b']);
  assert.equal(ui.visibleIds()[0], initial, 'scrolling in manual/off mode does not re-render the list');
  ui.preference.mode = 'auto';
  ui.visibleIds();
  assert.deepEqual([...ui.visibleIds()[0]], ['a', 'b'], 'auto starts from the items already on screen');
  ui.visibleIds()[1](['c']);
  assert.deepEqual([...ui.visibleIds()[0]], ['c']);
});

test('switching en → ko → en during a pending translation cannot strand automatic translation', async () => {
  const ui = mount();
  ui.render();
  ui.calls[0].resolve({ title: null, body: 'Hello there.' });
  assert.equal((await ui.settle()).display.body, 'Hello there.');
  ui.language('ko'); ui.render();
  assert.equal(ui.calls.at(-1).request.language, 'ko');
  ui.language('en'); ui.render();
  assert.equal(ui.calls.filter(call => call.request.language === 'en').length, 2, 'returning to English must reuse or request the English result');
  ui.calls.at(-1).resolve({ title: null, body: 'Hello again.' });
  assert.equal((await ui.settle()).display.body, 'Hello again.');
  ui.cleanup();
});

test('text edits, account changes and leaving view cannot display a previous response', async () => {
  const ui = mount();
  ui.render();
  const original = ui.calls[0];
  ui.body('Changed 수정한 댓글'); ui.render();
  assert.equal(ui.render().display.body, 'Changed 수정한 댓글');
  assert.equal(original.signal.aborted, true);
  original.resolve({ title: null, body: 'Old translated comment' });
  assert.equal((await ui.settle()).display.body, 'Changed 수정한 댓글');
  const previousAccount = ui.calls.at(-1);
  ui.viewer('viewer-b'); ui.render();
  assert.equal(ui.calls.at(-1).scope, 'viewer-b');
  previousAccount.resolve({ title: null, body: 'Private previous account result' });
  assert.notEqual((await ui.settle()).display.body, 'Private previous account result');
  const pending = ui.calls.at(-1);
  ui.visible(false); ui.render();
  assert.equal(pending.signal.aborted, true);
  const count = ui.calls.length;
  await ui.settle();
  assert.equal(ui.calls.length, count);
  ui.cleanup();
});

test('manual mode stays quiet until requested and original toggles never submit another translation', async () => {
  const ui = mount();
  ui.preference.mode = 'manual';
  const current = ui.render();
  assert.equal(ui.calls.length, 0);
  const work = current.action();
  ui.calls[0].resolve({ title: null, body: 'Hello there.' });
  await work;
  let displayed = await ui.settle();
  assert.equal(displayed.display.body, 'Hello there.');
  await displayed.action();
  displayed = ui.render();
  assert.equal(displayed.display.body, 'Hello 안녕하세요');
  await displayed.action();
  assert.equal(ui.render().display.body, 'Hello there.');
  assert.equal(ui.calls.length, 1);
  ui.cleanup();
});

test('leaving the route or backgrounding the app cancels queued work and prevents new submissions', async () => {
  for (const pause of ['focus', 'appState']) {
    const ui = mount();
    ui.render();
    const first = ui.calls[0];
    if (pause === 'focus') ui.focus(false); else ui.appState('background');
    ui.render(); await ui.settle();
    assert.equal(first.signal.aborted, true, pause + ' cancels an existing request');
    const count = ui.calls.length;
    ui.language('ko'); ui.render(); await ui.settle();
    assert.equal(ui.calls.length, count, pause + ' prevents a language change from translating hidden cards');
    if (pause === 'focus') ui.focus(true); else ui.appState('active');
    ui.render();
    assert.equal(ui.calls.length, count + 1);
    ui.cleanup();
  }
});

test('a manual result arriving between blur layout and cancellation cannot leave a permanent loading state', async () => {
  const ui = mount();
  ui.preference.mode = 'manual';
  const work = ui.render().action();
  ui.focus(false); ui.render(true);
  ui.calls[0].resolve({ title: null, body: 'A response arriving during blur' });
  await work;
  ui.flushEffects();
  ui.focus(true);
  const returned = ui.render();
  assert.equal(returned.loading, false, 'manual translation must be retryable after a discarded hidden result');
  assert.equal(returned.display.body, 'Hello 안녕하세요');
  const retry = returned.action();
  assert.equal(ui.calls.length, 2);
  ui.calls[1].resolve({ title: null, body: 'Retried translation' });
  await retry;
  assert.equal(ui.render().display.body, 'Retried translation');
  ui.cleanup();
});
