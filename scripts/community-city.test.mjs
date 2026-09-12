import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('preferred city persists before switching, survives remounts, and isolates accounts and failures', async () => {
  const cities = [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }, { id: 'calgary', state: 'soon' }];
  let hooks = [], cursor = 0, fail = false, release;
  let auth = { isAuthed: true, me: { id: 'a', cityId: 'vancouver' } };
  let saved = 'vancouver', writes = 0;
  const alerts = [];
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/community-city.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      createContext: () => ({ Provider: 'Provider' }), useCallback: fn => fn, useLayoutEffect: fn => fn(),
      useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
      useState(initial) {
        const i = cursor++; if (!(i in hooks)) hooks[i] = initial;
        return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }];
      },
    };
    if (name === 'react-native') return { Alert: { alert: (...args) => alerts.push(args) } };
    if (name === '@/lib/mock') return { CITIES: cities };
    if (name === '@/lib/location-provider') return { useCommunityLocation: () => ({ cityId: 'toronto' }) };
    if (name === '@/lib/auth') return { useAuth: () => ({ ...auth, setProfileCity: async id => {
      writes++;
      if (fail) throw new Error('OFFLINE');
      if (release) await new Promise(resolve => { release = resolve; });
      saved = id;
      auth = { ...auth, me: { ...auth.me, cityId: id } };
    } }) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const render = () => { cursor = 0; return exports.CommunityCityProvider({}).props.value; };
  assert.equal(render().city.id, 'vancouver', 'saved preference wins over nearby GPS city');
  assert.equal(await render().selectCity({ ...cities[2], state: 'open' }), false, 'catalog availability wins over caller-provided state');
  assert.equal(writes, 0, 'upcoming cities never reach profile storage');
  release = true;
  const saving = render().selectCity(cities[1]);
  assert.equal(render().city.id, 'vancouver', 'do not claim success before storage completes');
  assert.equal(render().saving, true);
  assert.equal(await render().selectCity(cities[2]), false, 'ignore repeated taps during save');
  release();
  assert.equal(await saving, true);
  release = null;
  assert.equal(saved, 'toronto');
  assert.equal(render().city.id, 'toronto');
  hooks = [];
  assert.equal(render().city.id, 'toronto', 'a new app session reads the saved profile');
  fail = true;
  assert.equal(await render().selectCity(cities[0]), false);
  assert.equal(render().city.id, 'toronto');
  assert.equal(alerts.length, 1);
  assert.equal(render().saving, false);
  fail = false;
  render().setCity(cities[2]);
  assert.equal(render().city.id, 'calgary', 'post navigation can still browse without changing preference');
  assert.equal(saved, 'toronto');
  auth = { isAuthed: true, me: { id: 'b', cityId: 'vancouver' } };
  assert.equal(render().city.id, 'vancouver', 'previous account selection must not leak');
  auth = { isAuthed: false, me: { id: 'me' } };
  const before = writes;
  assert.equal(await render().selectCity(cities[2]), false, 'upcoming cities are unavailable to guests too');
  assert.equal(await render().selectCity(cities[1]), true);
  assert.equal(render().city.id, 'toronto');
  assert.equal(writes, before, 'guest browsing does not write a member profile');
});

test('auth saves only the signed-in profile and publishes the city only after a confirmed row update', async () => {
  const state = [], refs = [];
  let cursor = 0, refCursor = 0, response, filter, patch, writes = 0;
  const session = { user: { id: 'member', user_metadata: {}, app_metadata: {} } };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, __DEV__: false, process: { env: {} }, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      createContext: () => ({ Provider: 'Provider' }), useCallback: fn => fn, useMemo: fn => fn(), useEffect() {},
      useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
      useState(initial) {
        const i = cursor++; if (!(i in state)) state[i] = i === 0 ? session : initial;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }];
      },
    };
    if (name === 'react-native') return { Platform: { OS: 'web' }, StyleSheet: { create: x => x } };
    if (name === 'expo-web-browser') return { maybeCompleteAuthSession() {} };
    if (name === '@/lib/mock') return { CITIES: [{ id: 'vancouver' }, { id: 'toronto' }] };
    if (name === '@/lib/admin') return { isAdminRole: () => false };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Spacing: {} };
    if (name === '@/lib/supabase') return { supabase: { from(table) {
      assert.equal(table, 'profiles');
      return { update(value) { patch = value; writes++; return {
        eq(key, value) { filter = [key, value]; return { select: () => ({ single: async () => response }) }; },
      }; } };
    } } };
    return {};
  } });
  const render = () => { cursor = refCursor = 0; return exports.AuthProvider({ children: null }); };
  const node = render();
  const onboarding = node.props.children.props.children.find(child => child?.props?.onComplete);
  onboarding.props.onComplete({ id: 'member', nickname: '회원', city_id: 'vancouver', avatar_path: null });
  const auth = () => render().props.value;
  await assert.rejects(auth().setProfileCity('unknown'), /INVALID_PROFILE_CITY/);
  assert.equal(writes, 0);
  response = { error: new Error('OFFLINE'), data: null };
  await assert.rejects(auth().setProfileCity('toronto'), /OFFLINE/);
  assert.equal(auth().me.cityId, 'vancouver');
  response = { error: null, data: null };
  await assert.rejects(auth().setProfileCity('toronto'), /CITY_UPDATE_FAILED/);
  response = { error: null, data: { id: 'member', city_id: 'toronto' } };
  await auth().setProfileCity('toronto');
  assert.deepEqual(filter, ['id', 'member']);
  assert.equal(patch.city_id, 'toronto');
  assert.equal(patch.neighborhood, null, 'old neighborhood does not follow the member to a new city');
  assert.equal(auth().me.cityId, 'toronto');
});
