import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// QA A-set-03: Android's permission dialog sends the app to the background. That must not drop the answer:
// a refusal says so and offers the device settings, which clear once location is allowed there.
function provider({ permission }) {
  const state = [], refs = [], effects = [], listeners = [];
  let index = 0, dirty = true, tree;
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], next => { const value = typeof next === 'function' ? next(state[slot]) : next; if (value !== state[slot]) { state[slot] = value; dirty = true; } }]; },
    useRef(initial) { const slot = index++; return refs[slot] ??= { current: initial }; },
    useCallback(fn) { index++; return fn; },
    useEffect(fn, deps) { const slot = index++; const previous = effects[slot]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { previous?.cleanup?.(); effects[slot] = { deps, cleanup: fn() }; } },
  };
  const calls = [];
  const modules = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { AppState: { currentState: 'active', addEventListener: (_event, listener) => { listeners.push(listener); return { remove() {} }; } } },
    'expo-location': {
      Accuracy: { Balanced: 3 },
      requestForegroundPermissionsAsync: async () => { calls.push('ask'); for (const listener of listeners) listener('background'); return permission(); },
      getForegroundPermissionsAsync: async () => { calls.push('check'); return permission(); },
    },
    '@/lib/location': { isFreshLocation: () => true, LOCATION_CONSENT_VERSION: 'test', nearbyCommunity: () => null },
    '@/lib/supabase': { supabase: { rpc: async name => { calls.push(name); return { data: { enabled: false }, error: null }; } } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/location-provider.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => modules[name] ?? {} });
  const render = () => { for (let count = 0; dirty && count < 20; count++) { dirty = false; index = 0; tree = exports.CommunityLocationProvider({ userId: 'member', loginKey: null, children: null }); } return tree.props.value; };
  const settle = async () => { for (let i = 0; i < 5; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } return render(); };
  return { calls, render, settle, foreground: () => listeners.forEach(listener => listener('active')) };
}

test('a refusal behind the Android permission dialog still shows its message and the settings way out', async () => {
  let granted = false;
  const app = provider({ permission: () => ({ granted, canAskAgain: false }) });
  let value = await app.settle();
  assert.equal(value.ready, true);
  assert.equal(await value.capture(true), null);
  value = await app.settle();
  assert.deepEqual(app.calls.filter(call => call === 'ask'), ['ask']);
  assert.match(value.message, /위치 권한이 꺼져 있어요/, 'the dialog sending the app to the background does not swallow the answer');
  assert.equal(value.permissionOff, true);
  granted = true; app.foreground();
  value = await app.settle();
  assert.equal(value.permissionOff, false, 'allowing it in the device settings brings the normal button back');
});
