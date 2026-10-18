import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as kakao from '../src/lib/kakao-auth.ts';
import * as nickname from '../src/lib/nickname.ts';
import * as chatIdentity from '../src/lib/chat-identity.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
import { getPostImageSource, setBusinessImageSession } from '../src/lib/feed-data.ts';
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const session = id => ({ access_token: `token-${id}`, user: { id, last_sign_in_at: '2026-10-11T18:00:00Z', app_metadata: {}, user_metadata: {}, identities: [] } });
const profile = (id, patch = {}) => ({ id, nickname: `${id} 이웃`, city_id: 'vancouver', avatar_path: null, verification_level: 1,
  account_status: 'active', ai_safety_consent_at: '2026-10-11T18:00:00Z', ...patch });

// Run AuthProvider's real restore/profile effects with controllable network ordering.
function mount(initialSession = session('member')) {
  const state = [], reads = [], storage = new Map(); let index = 0, effects = [], tree, currentSession = initialSession, onAuthChange;
  const effect = (fn, deps) => {
    const slot = index++, previous = state[slot];
    if (previous && deps && deps.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    state[slot] = { deps, cleanup: previous?.cleanup }; effects.push(() => { state[slot].cleanup?.(); state[slot].cleanup = fn(); });
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useMemo(fn, deps) { const slot = index++, previous = state[slot]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) state[slot] = { value: fn(), deps }; return state[slot].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); }, useEffect: effect,
  };
  const supabase = {
    from(table) { assert.equal(table, 'profiles'); let userId;
      return { select() { return this; }, eq(field, value) { assert.equal(field, 'id'); userId = value; return this; },
        maybeSingle() { const response = deferred(); reads.push({ userId, ...response }); return response.promise; } }; },
    rpc: async (name, args) => name === 'change_profile_nickname' ? { data: { id: args.p_user_id, nickname: args.p_nickname }, error: null } : { error: null },
    auth: { getSession: async () => ({ data: { session: currentSession } }),
      onAuthStateChange(callback) { onAuthChange = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      startAutoRefresh() {}, stopAutoRefresh() {}, signOut: async () => { currentSession = null; onAuthChange('SIGNED_OUT', null); return {}; } },
  };
  const jsx = (type, props, key) => ({ type, props, key }), play = () => {};
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'web' }, Modal: 'Modal', View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value },
      DeviceEventEmitter: { addListener: () => ({ remove() {} }) }, AppState: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value) } },
    '@react-native-google-signin/google-signin': {}, 'expo-apple-authentication': {}, 'expo-linking': {}, 'expo-web-browser': { maybeCompleteAuthSession() {} },
    '@/components/login-panel': { LoginPanel: 'LoginPanel' }, '@/components/profile-onboarding': { ProfileOnboarding: 'ProfileOnboarding' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' },
    '@/constants/theme': { Spacing: {} }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/i18n/ko': { t: { auth: { loginError: '로그인 오류', sessionExpired: '세션 만료' } } }, '@/lib/admin': { isAdminRole: () => false },
    '@/lib/account-security-device': { registerSecurityDevice: async () => {} }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play }) },
    '@/lib/feed-data': { setBusinessImageSession }, '@/lib/chat-identity': chatIdentity, '@/lib/nickname': nickname, '@/lib/kakao-auth': kakao, '@/lib/legal-documents': { CONTACT_EMAIL: 'fixture@example.invalid' },
    '@/lib/location-provider': { CommunityLocationProvider: 'CommunityLocationProvider' }, '@/lib/mock': { CITIES: [{ id: 'vancouver' }] },
    '@/lib/supabase': { supabase, AUTH_EXPIRED_EVENT: 'authExpired' }, '@/lib/push-notifications': { unregisterPushDevice: async () => {} },
    '@/lib/trust': { shouldCelebrateVerificationUpgrade: () => false },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, __DEV__: false, Date, process: { env: {} }, require: withLanguageImports(name => { assert.ok(name in imports, `Known import: ${name}`); return imports[name]; }) });
  const render = () => { index = 0; effects = []; tree = exports.AuthProvider({ children: null }); effects.forEach(fn => fn()); return tree.props.value; };
  render();
  return { reads, render, nodes: () => nodes(tree), async settle() { for (let i = 0; i < 4; i++) { await tick(); render(); } return tree.props.value; },
    changeSession(next,event=next ? 'SIGNED_IN' : 'SIGNED_OUT') { currentSession = next; onAuthChange(event, next); return render(); },
    unmount() { state.forEach(hook => hook?.cleanup?.()); } };
}
const onboarding = harness => harness.nodes().find(node => node.type === 'ProfileOnboarding');

test('restoring a valid session remains auth-loading until the first profile response completes', async context => {
  const harness = mount(); context.after(() => harness.unmount()); let auth = await harness.settle();
  assert.equal(harness.reads.length, 1); assert.equal(harness.reads[0].userId, 'member'); assert.equal(auth.me.id, 'member');
  assert.equal(auth.isAuthed, false); assert.equal(auth.isAuthLoading, true, 'a slow profile is not an anonymous visitor requiring a second login');
  harness.reads[0].resolve({ data: profile('member'), error: null }); auth = await harness.settle();
  assert.equal(auth.isAuthed, true); assert.equal(auth.isAuthLoading, false); assert.equal(onboarding(harness).props.visible, false);
  assert.ok(!harness.nodes().some(node => node.type === 'LoginPanel'));
});

test('switching sessions drops the previous identity and ignores its late profile response', async context => {
  const harness = mount(session('first')); context.after(() => harness.unmount()); await harness.settle();
  let auth = harness.changeSession(session('second')); assert.equal(auth.me.id, 'second'); assert.equal(auth.isAuthed, false); assert.equal(auth.isAuthLoading, true);
  await harness.settle(); assert.deepEqual(harness.reads.map(read => read.userId), ['first', 'second']);
  harness.reads[0].resolve({ data: profile('first'), error: null }); auth = await harness.settle();
  assert.equal(auth.me.id, 'second'); assert.equal(auth.isAuthed, false); assert.equal(auth.isAuthLoading, true);
  harness.reads[1].resolve({ data: profile('second'), error: null }); auth = await harness.settle();
  assert.equal(auth.isAuthed, true); assert.equal(auth.isAuthLoading, false); assert.equal(auth.me.nickname, 'second 이웃');
});

for (const failure of ['database error', 'network rejection']) {
  test(`a first profile ${failure} releases loading and preserves the existing login error`, async context => {
    const harness = mount(); context.after(() => harness.unmount()); await harness.settle();
    if (failure === 'database error') harness.reads[0].resolve({ data: null, error: new Error('profile unavailable') });
    else harness.reads[0].reject(new Error('profile transport failed'));
    const auth = await harness.settle(); assert.equal(auth.isAuthed, false); assert.equal(auth.isAuthLoading, false);
    assert.equal(auth.authError, '로그인 오류'); assert.equal(onboarding(harness).props.visible, false, 'a failed read must not pretend that the user has no saved profile');
  });
}

for (const existing of [false, true]) {
  test(`${existing ? 'a saved profile missing AI consent' : 'a new social user'} waits in onboarding until completion without reopening login`, async context => {
    const harness = mount(); context.after(() => harness.unmount()); await harness.settle();
    harness.reads[0].resolve({ data: existing ? profile('member', { ai_safety_consent_at: null }) : null, error: null }); let auth = await harness.settle();
    assert.equal(auth.isAuthed, false); assert.equal(auth.isAuthLoading, true, 'automatic shared-link login must wait while onboarding is visible');
    const form = onboarding(harness); assert.equal(form.props.visible, true); assert.equal(form.props.userId, 'member'); assert.equal(Boolean(form.props.existingProfile), existing);
    assert.ok(!harness.nodes().some(node => node.type === 'LoginPanel'));
    form.props.onComplete({ id: 'member', nickname: '가입 완료 이웃', city_id: 'vancouver', avatar_path: null, photoUri: null, ai_safety_consent_at: '2026-10-11T18:30:00Z' });
    auth = harness.render(); assert.equal(auth.isAuthed, true); assert.equal(auth.isAuthLoading, false); assert.equal(auth.me.nickname, '가입 완료 이웃'); assert.equal(onboarding(harness).props.visible, false);
  });
}

test('changing accounts hides the previous onboarding and waits for the new account profile', async context => {
  const harness = mount(session('new-member')); context.after(() => harness.unmount()); await harness.settle();
  harness.reads[0].resolve({ data: null, error: null }); await harness.settle(); assert.equal(onboarding(harness).props.visible, true);
  let auth = harness.changeSession(session('another-member')); assert.equal(onboarding(harness).props.visible, false); assert.equal(auth.isAuthLoading, true);
  await harness.settle(); harness.reads[1].resolve({ data: profile('another-member'), error: null }); auth = await harness.settle();
  assert.equal(auth.isAuthed, true); assert.equal(auth.me.id, 'another-member'); assert.equal(auth.me.nickname, 'another-member 이웃'); assert.equal(auth.isAuthLoading, false);
});

test('suspended and deleted accounts retain the locked-account screen without onboarding or an endless loader', async context => {
  for (const account_status of ['suspended', 'deleted']) {
    const harness = mount(); context.after(() => harness.unmount()); await harness.settle();
    harness.reads[0].resolve({ data: profile('member', { account_status }), error: null }); const auth = await harness.settle();
    assert.equal(auth.isAuthed, false); assert.equal(auth.isAuthLoading, false); assert.equal(onboarding(harness).props.visible, false);
    assert.ok(harness.nodes().some(node => node.type === 'Modal' && node.props.visible && nodes(node).some(child => child.props?.status === account_status)), 'existing locked-account UI must remain visible');
  }
});

test('a late profile failure from the previous session does not release the new session loader or set its error', async context => {
  const harness = mount(session('first')); context.after(() => harness.unmount()); await harness.settle();
  harness.changeSession(session('second')); await harness.settle(); harness.reads[0].reject(new Error('old request failed')); const auth = await harness.settle();
  assert.equal(auth.me.id, 'second'); assert.equal(auth.isAuthLoading, true); assert.equal(auth.authError, null); assert.equal(auth.isAuthed, false);
});


test('confirmed nickname updates auth immediately and a stale account callback cannot rename another user', async context => {
  const harness = mount(); context.after(() => harness.unmount()); await harness.settle();
  harness.reads[0].resolve({ data: profile('member'), error: null }); const auth = await harness.settle();
  await auth.setProfileNickname('새로운 이웃', 'member 이웃');
  assert.equal(harness.render().me.nickname, '새로운 이웃');
  harness.changeSession(session('another-member'));
  await assert.rejects(auth.setProfileNickname('잘못된 이름', '새로운 이웃'), /AUTH_REQUIRED/);
});

test('business gallery session follows token refresh and clears immediately on logout',async context=>{
 const harness=mount();context.after(()=>harness.unmount());await harness.settle();
 const post={id:'gallery',imagePaths:['business-post/a2000000-0000-4000-8000-000000000001/1/'+'a'.repeat(32)],imageUris:['opaque-gallery'],imageThumbs:['opaque-gallery']};
 assert.equal(getPostImageSource(post,'member','full').headers.Authorization,'Bearer token-member');
 harness.changeSession({...session('member'),access_token:'token-refreshed'},'TOKEN_REFRESHED');
 assert.equal(getPostImageSource(post,'member','full').headers.Authorization,'Bearer token-refreshed');
 harness.changeSession(null);assert.equal(getPostImageSource(post,'member','full'),undefined);
 harness.changeSession(session('next'));assert.equal(getPostImageSource(post,'member','full'),undefined);
 assert.equal(getPostImageSource(post,'next','full').headers.Authorization,'Bearer token-next');
 harness.unmount();assert.equal(getPostImageSource(post,'next','full'),undefined);
});

test('business DM selection survives token refresh but is cleared on sign-out and account changes', async context => {
  const harness = mount(); context.after(() => { harness.unmount(); chatIdentity.resetChatIdentity(); });
  await harness.settle();
  const business = { id: 'c1820000-0000-4000-8000-000000000001', name: 'Example Business' };
  chatIdentity.selectChatBusiness('member', business);
  harness.changeSession({ ...session('member'), access_token: 'refreshed' }, 'TOKEN_REFRESHED');
  assert.deepEqual(chatIdentity.chatBusinessIdentity('member'), business);
  harness.changeSession(session('another-member'));
  assert.equal(chatIdentity.chatBusinessIdentity('member'), null, 'a departed account selection must be discarded');
  chatIdentity.selectChatBusiness('another-member', business);
  harness.changeSession(null);
  harness.changeSession(session('another-member'));
  assert.equal(chatIdentity.chatBusinessIdentity('another-member'), null, 'signing back in starts with personal DMs');
});
