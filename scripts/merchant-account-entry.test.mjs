import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as connections from '../src/lib/merchant-connections.ts';
import * as chatIdentity from '../src/lib/chat-identity.ts';
import * as controls from '../src/constants/design-system.ts';
import * as media from '../src/lib/business-media.ts';

function app(component = 'MerchantAccountEntry') {
  const states = [], refs = [], effects = [], calls = [], pending = [], routes = [], feedback = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, auth = { me: { id: 'user-a', nickname: '개인 이름' }, isAuthed: true, isAdmin: false }, foreground;
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
  const source = ts.transpileModule(readFileSync(new URL(component === 'ChatIdentitySwitcher' ? '../src/components/chat-identity-switcher.tsx' : '../src/components/merchant-account-connections.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, window: { confirm: () => true }, Date, require: withLanguageImports((name) => {
    if (name === 'react') return React;
    if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'expo-router') return { useRouter: () => ({ push: path => routes.push(path) }), useFocusEffect: fn => recordEffect(fn, fn.deps) };
    if (name === 'react-native') return { Platform: { OS: 'web' }, View: 'View', Modal: 'Modal', StyleSheet: { create: value => value }, AppState: { addEventListener(name, fn) { foreground = fn; return { remove() {} }; } } };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable', ScrollView: 'ScrollView' };
    if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ accent: '#CBB9FF' }) };
    if (name === '@/lib/auth') return { useAuth: () => auth };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) };
    if (name === '@/lib/merchant-connections') return connections;
    if (name === '@/lib/chat-identity') return chatIdentity;
    if (name === '@/lib/business-media') return media;
    if (name === '@/constants/design-system') return controls;
    if (name === '@/hooks/use-chat-identity') return { useChatIdentity: () => chatIdentity.chatBusinessIdentity(auth.isAuthed ? auth.me.id : null) };
    if (name === '@/lib/supabase') return { supabase: client };
    throw new Error('Unexpected import ' + name);
  }) });
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

test('admin profiles can switch to a connected business after current access is checked', async () => {
  chatIdentity.resetChatIdentity();
  const view = app(); view.auth({ isAdmin: true });
  assert.equal(view.render(), null);
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].name, 'get_my_business_chat_profiles');
  view.pending.shift()(context()); await flush();
  assert.equal(view.render().props.accessibilityLabel, '비즈니스 프로필 전환');
  view.foreground();
  assert.equal(view.calls.length, 2);
  view.pending.shift()(context()); await flush();
  view.render().props.onPress();
  assert.equal(view.calls.length, 3);
  view.pending.shift()(context()); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(view.routes)), [{ pathname: '/profile/merchant', params: { merchant: 'company-a', tab: 'drafts' } }]);
  assert.deepEqual(chatIdentity.chatBusinessIdentity('user-a'), { id: 'company-a', name: '업체 A' });
  assert.deepEqual(view.feedback, ['selection']);
  chatIdentity.resetChatIdentity();
});
test('administrator review access alone cannot appear as a connected business profile', async () => {
  chatIdentity.resetChatIdentity();
  const view = app(); view.auth({ isAdmin: true }); view.render();
  assert.equal(view.calls.length, 1);
  const data = context('user-a', [{ id: 'company-a', name: '업체 A', role: 'admin', city_name: '밴쿠버' }]);
  view.pending.shift()(data); await flush();
  assert.equal(view.render(), null);
  assert.deepEqual(view.routes, []);
  assert.equal(chatIdentity.chatBusinessIdentity('user-a'), null);
});
test('connected business owners and operators still switch to their business drafts', async () => {
  for (const role of ['owner', 'operator']) {
    chatIdentity.resetChatIdentity();
    const view = app(), data = context('user-a', [{ id: 'company-a', name: '업체 A', role, city_name: '밴쿠버' }]);
    view.render(); view.pending.shift()(data); await flush();
    const entry = view.render(); assert.equal(entry.props.accessibilityLabel, '비즈니스 프로필 전환');
    entry.props.onPress(); view.pending.shift()(data); await flush();
    assert.deepEqual(JSON.parse(JSON.stringify(view.routes)), [{ pathname: '/profile/merchant', params: { merchant: 'company-a', tab: 'drafts' } }]);
    assert.deepEqual(view.feedback, ['selection']);
    assert.deepEqual(chatIdentity.chatBusinessIdentity('user-a'), { id: 'company-a', name: '업체 A' });
  }
  chatIdentity.resetChatIdentity();
});
test('last connection removal hides the entry and a revoked click never navigates', async () => {
  const view = app();
  assert.equal(view.render(), null);
  view.pending.shift()(context()); await flush();
  const entry = view.render(); assert.match(text(entry), /업체 A로 글쓰기/);
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
  assert.match(text(view.render()), /비즈니스 계정 초대/);
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
  assert.equal(action.props.disabled, true); assert.match(text(node), /비즈니스 정보가 바뀌었어요/);
  view.auth({ me: { id: 'user-b' } }); assert.equal(view.render(), null);
});

const action = (tree, id) => { const button = nodes(tree).find(n => n.props?.analyticsId === id); assert.ok(button, id); return button; };

test('inbox profile selection checks the current connection twice and returns to personal without sending anything', async context => {
  chatIdentity.resetChatIdentity(); context.after(chatIdentity.resetChatIdentity);
  const view = app('ChatIdentitySwitcher');
  const open = action(view.render(), 'chat.identity.open');
  open.props.onPress(); open.props.onPress(); assert.equal(view.calls.length, 1);
  view.pending.shift()(contextData()); await flush();
  action(view.render(), 'chat.identity.business').props.onPress();
  assert.equal(view.calls.length, 2, 'a cached business row is not authorization');
  view.pending.shift()(contextData()); await flush();
  assert.deepEqual(chatIdentity.chatBusinessIdentity('user-a'), { id: 'company-a', name: '업체 A' });
  assert.match(text(view.render()), /업체 A/);
  action(view.render(), 'chat.identity.open').props.onPress();
  view.pending.shift()(contextData()); await flush();
  action(view.render(), 'chat.identity.personal').props.onPress();
  assert.equal(chatIdentity.chatBusinessIdentity('user-a'), null);
  assert.ok(view.calls.every(call => call.name === 'get_my_business_chat_profiles'));
  assert.equal(view.routes.length, 0);
});

test('a revoked business selection stays in the current profile and exposes a recoverable error', async context => {
  chatIdentity.resetChatIdentity(); context.after(chatIdentity.resetChatIdentity);
  const view = app('ChatIdentitySwitcher');
  action(view.render(), 'chat.identity.open').props.onPress(); view.pending.shift()(contextData()); await flush();
  action(view.render(), 'chat.identity.business').props.onPress();
  view.pending.shift()(contextData('user-a', [])); await flush();
  assert.equal(chatIdentity.chatBusinessIdentity('user-a'), null);
  assert.ok(nodes(view.render()).some(n => n.props?.accessibilityRole === 'alert'));
});

test('an outstanding profile selection cannot switch a different signed-in account', async context => {
  chatIdentity.resetChatIdentity(); context.after(chatIdentity.resetChatIdentity);
  const view = app('ChatIdentitySwitcher');
  action(view.render(), 'chat.identity.open').props.onPress(); view.pending.shift()(contextData()); await flush();
  action(view.render(), 'chat.identity.business').props.onPress();
  view.auth({ me: { id: 'user-b', nickname: '다른 이웃' } }); view.render();
  view.pending.shift()(contextData()); await flush();
  assert.equal(chatIdentity.chatBusinessIdentity('user-a'), null);
  assert.equal(chatIdentity.chatBusinessIdentity('user-b'), null);
});

const contextData = (...args) => context(...args);

test('admins can choose their actual connected business without receiving an admin-wide switch', async context => {
  chatIdentity.resetChatIdentity(); context.after(chatIdentity.resetChatIdentity);
  const view = app('ChatIdentitySwitcher'); view.auth({ isAdmin: true });
  action(view.render(), 'chat.identity.open').props.onPress();
  assert.equal(view.calls[0].name, 'get_my_business_chat_profiles');
  view.pending.shift()(contextData()); await flush();
  action(view.render(), 'chat.identity.business').props.onPress();
  view.pending.shift()(contextData()); await flush();
  assert.equal(chatIdentity.chatBusinessIdentity('user-a')?.id, 'company-a');
  action(view.render(), 'chat.identity.open').props.onPress();
  view.pending.shift()(contextData('user-a', [{ id: 'unrelated-company', name: '관리 전용 업체', role: 'admin', city_name: '밴쿠버' }])); await flush();
  assert.ok(!nodes(view.render()).some(n => n.props?.analyticsId === 'chat.identity.business'));
  assert.ok(nodes(view.render()).some(n => n.props?.accessibilityRole === 'alert'));
  assert.equal(chatIdentity.chatBusinessIdentity('user-a')?.id, 'company-a');
  assert.ok(view.calls.every(call => call.name === 'get_my_business_chat_profiles'));
});


test('Today profile switching is hidden until actual linked business access is known', async () => {
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business' });
  assert.equal(view.render(), null);
  assert.equal(view.calls[0].name, 'get_my_business_chat_profiles');
  view.pending.shift()(context('user-a', [])); await flush(); assert.equal(view.render(), null);
  view.auth({ isAuthed: false }); assert.equal(view.render(), null);
});

test('Today Instagram sheet opens the selected business workspace after access revalidation', async () => {
  chatIdentity.resetChatIdentity();
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business' }); view.render();
  assert.equal(view.pending.length, 1); view.pending.shift()(context()); await flush();
  const trigger = nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.open');
  assert.ok(trigger); await trigger.props.onPress();
  assert.equal(view.calls.length, 1, 'Opening the cached sheet must not request each business profile.');
  const row = nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.business');
  assert.ok(row); const opening = row.props.onPress();
  assert.deepEqual(view.routes, []);
  view.pending.shift()(context()); await opening; await flush();
  assert.equal(view.routes[0].pathname, '/profile/merchant'); assert.equal(view.routes[0].params.merchant, 'company-a');
  assert.equal(view.routes[0].params.tab, undefined, 'Land on the business overview with writing and photo actions.');
});

test('Today sheet rejects revoked business access and never reuses another user connection', async () => {
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business' }); view.render();
  assert.equal(view.pending.length, 1); view.pending.shift()(context()); await flush();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.open').props.onPress();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.business').props.onPress();
  view.pending.shift()(context('user-a', [])); await flush();
  assert.deepEqual(view.routes, []); assert.match(text(view.render()), /연결을 다시 확인/);
  view.auth({ me: { id: 'user-b', nickname: '다른 이웃' } }); assert.equal(view.render(), null);
});


test('Today sheet uses opaque business photos and returns the personal row to the existing profile', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business' }); view.render();
  view.pending.shift()(context('user-a', [{ id, name: '가게', role: 'owner', city_name: '밴쿠버', avatar_path: `business-profile/${id}/avatar/${'a'.repeat(32)}` }])); await flush();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.open').props.onPress();
  assert.ok(nodes(view.render()).some(n => n.type === 'Image' && n.props.source.uri.includes('kind=avatar')));
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.personal').props.onPress();
  assert.equal(view.routes[0], '/profile');
});

test('Today foreground checks remove a revoked switch and cannot expose admin review access', async () => {
  const availability = [];
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business', onAvailabilityChange: value => availability.push(value) });
  view.auth({ isAdmin: true }); view.render();
  view.pending.shift()(context()); await flush(); view.render(); assert.equal(availability.at(-1), true);
  view.foreground(); view.pending.shift()(context('user-a', [])); await flush(); assert.equal(view.render(), null); assert.equal(availability.at(-1), false);
  view.foreground(); view.pending.shift()(context('user-a', [{ id: 'review', name: '검토만 가능한 가게', role: 'admin' }])); await flush();
  assert.equal(view.render(), null); assert.ok(view.calls.every(call => call.name === 'get_my_business_chat_profiles'));
});


test('Today foreground refresh cannot strand an in-flight business selection', async () => {
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business' }); view.render();
  view.pending.shift()(context()); await flush();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.open').props.onPress();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.business').props.onPress();
  const selected = view.pending.shift(); view.foreground(); selected(context()); await flush();
  assert.equal(view.routes.length, 1);
  assert.ok(!nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.business').props.disabled);
});

test('a new account can select its own business while an old account selection is unresolved', async () => {
  const view = app('ChatIdentitySwitcher'); view.props({ target: 'business' }); view.render();
  view.pending.shift()(context()); await flush();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.open').props.onPress();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.business').props.onPress();
  const old = view.pending.shift(); view.auth({ me: { id: 'user-b', nickname: '다른 이웃' } }); view.render();
  const next = context('user-b', [{ id: 'company-b', name: '다른 가게', role: 'operator' }]);
  view.pending.shift()(next); await flush(); old(context()); await flush();
  nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.open').props.onPress();
  const option = nodes(view.render()).find(n => n.props?.analyticsId === 'chat.identity.business');
  assert.equal(option.props.disabled, false); option.props.onPress();
  assert.equal(view.pending.length, 1); view.pending.shift()(next); await flush();
  assert.equal(view.routes.length, 1); assert.equal(view.routes[0].params.merchant, 'company-b');
});
