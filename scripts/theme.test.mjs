import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/hooks/use-theme.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function mountTheme(storage, system = 'light') {
  const slots = [], effects = [], contexts = [];
  let cursor = 0, current;
  const colors = { light: { background: 'light' }, dark: { background: 'dark' }, admin: { background: 'admin' } };
  const react = {
    createContext(value) { const context = { value }; context.Provider = context; contexts.push(context); return context; },
    createElement(type, props, children) { type.value = props.value; return children; },
    useContext: context => context.value,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback: callback => callback,
    useEffect(effect) { if (!current) effects.push(effect); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => react.createElement(type, props, props.children) };
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: storage };
    if (name === '@/constants/theme') return { Colors: colors };
    if (name === '@/hooks/use-color-scheme') return { useColorScheme: () => system };
    throw new Error(`Unexpected import: ${name}`);
  } });
  assert.equal(typeof exports.ThemePreferenceProvider, 'function', 'A saved app preference provider is required');
  function render() { cursor = 0; const child = exports.ThemePreferenceProvider({ children: 'app' }); current = true;
    return { child, ...exports.useThemePreference(), palette: exports.useTheme() }; }
  const first = render();
  const cleanups = effects.map(effect => effect());
  return { first, render, colors, override: scheme => exports.ThemeOverrideProvider({ scheme, children: 'override' }),
    unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('default and invalid stored values preserve dark; saved light is ready before app content', async () => {
  for (const saved of [null, 'broken', 'admin', 'dark', 'light']) {
    const mounted = mountTheme({ getItem: async () => saved, setItem: async () => {} });
    assert.equal(mounted.first.child, null);
    await settle();
    const state = mounted.render();
    assert.equal(state.child, 'app');
    assert.equal(state.scheme, saved === 'light' ? 'light' : 'dark');
    assert.equal(state.palette, state.scheme === 'light' ? mounted.colors.light : mounted.colors.dark);
    mounted.unmount();
  }
});

test('theme switches immediately, persists, restores after remount, and an explicit admin override wins', async () => {
  let saved = null;
  const storage = { getItem: async () => saved, setItem: async (key, value) => { assert.equal(key, 'gling.theme'); saved = value; } };
  const mounted = mountTheme(storage);
  await settle();
  assert.equal(await mounted.render().setScheme('light'), true);
  assert.equal(mounted.render().palette, mounted.colors.light);
  assert.equal(saved, 'light');
  mounted.override('admin');
  assert.equal(mounted.render().palette, mounted.colors.admin);
  mounted.unmount();
  const reopened = mountTheme(storage);
  await settle();
  assert.equal(reopened.render().scheme, 'light');
  reopened.unmount();
});

test('read/write failure keeps the app usable and reports that the choice was not saved', async () => {
  const mounted = mountTheme({ getItem: async () => { throw new Error('read denied'); }, setItem: async () => { throw new Error('write denied'); } });
  await settle();
  assert.equal(mounted.render().scheme, 'dark');
  assert.equal(await mounted.render().setScheme('light'), false);
  assert.equal(mounted.render().scheme, 'light');
  assert.equal(mounted.render().isSaving, false);
  mounted.unmount();
});

test('a second tap cannot race an unfinished preference write', async () => {
  let finish;
  const writes = [];
  const mounted = mountTheme({ getItem: async () => null, setItem: (key, value) => { writes.push(value); return new Promise(resolve => { finish = resolve; }); } });
  await settle();
  const saving = mounted.render().setScheme('light');
  assert.equal(mounted.render().scheme, 'light');
  assert.equal(mounted.render().isSaving, true);
  assert.equal(await mounted.render().setScheme('dark'), false);
  finish();
  assert.equal(await saving, true);
  assert.deepEqual(writes, ['light']);
  assert.equal(mounted.render().isSaving, false);
  mounted.unmount();
});

test('native builds support both appearances instead of restricting the app to dark', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(config.expo.userInterfaceStyle, 'automatic');
  const plist = readFileSync(new URL('../ios/app/Info.plist', import.meta.url), 'utf8');
  assert.match(plist, /<key>UIUserInterfaceStyle<\/key>\s*<string>Automatic<\/string>/);
});
