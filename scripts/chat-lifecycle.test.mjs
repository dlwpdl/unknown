import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { mergeChatMessages } from '../src/lib/community-data.ts';
import { count, t } from '../src/i18n/ko.ts';

// Exercise the component's hooks, effects and event handlers, as in comment-threads.test.mjs.
function mount(file, exportName, data, props = {}, params = {}) {
  const hooks = [], appListeners = new Set(), channels = new Set(), timers = new Map();
  let index = 0, effects = [], dirty = true, tree, timerId = 0;
  const auth = { isAuthed: true, me: { id: 'me', nickname: '나' } };
  const refreshMembership = async () => {};
  const jsx = (type, props, key) => ({ type, props, key });
  const effect = (fn, deps) => {
    const slot = index++, previous = hooks[slot];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const state = hooks[slot] = { deps, cleanup: previous?.cleanup };
    effects.push(() => { state.cleanup?.(); state.cleanup = fn(); });
  };
  const react = {
    useId: () => 'test-id',
    useState(initial) {
      const slot = index++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], value => {
        const next = typeof value === 'function' ? value(hooks[slot]) : value;
        if (!Object.is(next, hooks[slot])) { hooks[slot] = next; dirty = true; }
      }];
    },
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useCallback(fn, deps) {
      const slot = index++, previous = hooks[slot];
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) hooks[slot] = { fn, deps };
      return hooks[slot].fn;
    },
    useEffect: effect, useLayoutEffect: effect,
  };
  const supabase = {
    channel() {
      const channel = { handlers: [], on(_kind, filter, callback) { this.handlers.push({ filter, callback }); return this; }, subscribe() { return this; } };
      channels.add(channel);
      return channel;
    },
    removeChannel(channel) { channels.delete(channel); },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return react;
      if (name === 'react-native') return new Proxy({
        StyleSheet: { create: value => value }, Platform: { OS: 'ios' },
        AppState: { addEventListener(_name, callback) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
        DeviceEventEmitter: { addListener: () => ({ remove() {} }) },
      }, { get: (target, key) => target[key] ?? key });
      if (name === 'expo-router') return { useFocusEffect: fn => effect(fn, [fn]), useLocalSearchParams: () => params, useRouter: () => ({ setParams() {} }) };
      if (name === 'react-native-reanimated') return { useReducedMotion: () => false };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/lib/auth') return { useAuth: () => auth };
      if (name === '@/lib/membership-provider') return { useMembership: () => ({ refresh: refreshMembership }) };
      if (name === '@/components/relationship-slot-card') return { relationshipSlotData: () => null };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16 } };
      if (name === '@/i18n/ko') return { t, count };
      if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
      if (name === '@/lib/community-data') return { mergeChatMessages, ...data };
      if (name === '@/lib/supabase') return { supabase };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const render = () => {
    for (let count = 0; dirty; count++) {
      assert.ok(count < 30, 'component effects settle without a render loop');
      dirty = false; index = 0; effects = [];
      tree = exports[exportName](props);
      for (const run of effects) run();
    }
  };
  const nodes = value => !value || typeof value !== 'object' ? []
    : [...(value.type ? [value] : []), ...Object.values(value).flatMap(nodes)];
  const harness = {
    async settle() { for (let i = 0; i < 5; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); },
    nodes: () => nodes(tree),
    messages: () => nodes(tree).find(node => node.type === 'FlatList')?.props.data ?? [],
    foreground() { for (const callback of appListeners) callback('active'); },
    message(message) { for (const channel of channels) for (const { filter, callback } of channel.handlers) if (filter.table === 'messages') callback({ new: message }); },
    async timers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await harness.settle(); },
    cleanup() { for (const hook of hooks) hook?.cleanup?.(); timers.clear(); },
  };
  render();
  return harness;
}

const message = number => ({ id: `m${String(number).padStart(3, '0')}`, conversation_id: 'room', sender_id: 'neighbor',
  sender_nickname: '이웃', body: `message ${number}`, created_at: new Date(Date.UTC(2026, 8, 12, 0, 0, number)).toISOString() });
const conversation = { id: 'room', kind: 'group', status: 'active', title: '모임', otherUser: { id: 'host', nickname: '호스트', verificationLevel: 2 } };
const roomProps = { conversation, currentUserId: 'me', onClose() {}, onChanged: async () => {} };
const room = data => mount('../src/components/chat-room.tsx', 'ChatRoom', data, roomProps);
const olderButton = harness => harness.nodes().find(node => node.props?.label === t.chat.loadOlder);

test('request route preference does not override later All, Group or Direct tab choices', async (context) => {
  const filters = [];
  const harness = mount('../src/app/(tabs)/chat.tsx', 'default', {
    async loadConversations(_client, _user, filter) {
      filters.push(filter);
      return { conversations: [], selectedConversation: null, pendingCount: 0, cursor: null };
    },
    loadPendingMeetupRequests: async () => [],
  }, {}, { view: 'requests' });
  context.after(() => harness.cleanup());
  await harness.settle();
  for (const [index, filter] of ['all', 'group', 'direct'].entries()) {
    harness.nodes().filter(node => node.props?.accessibilityRole === 'tab')[index].props.onPress();
    await harness.settle();
    assert.equal(harness.nodes().filter(node => node.props?.accessibilityRole === 'tab')[index].props.accessibilityState.selected, true, `${filter} remains selected`);
    assert.equal(filters.at(-1), filter);
  }
});

test('foreground after 60 missed messages resets the window and can page through the entire gap', async (context) => {
  let database = [message(0)];
  const harness = room({ async loadConversationMessages(_client, _room, before) {
    return database.filter(row => !before || row.created_at < before.createdAt).slice(-50);
  } });
  context.after(() => harness.cleanup());
  await harness.settle();
  assert.equal(harness.messages().length, 1);
  database = Array.from({ length: 61 }, (_, index) => message(index));
  harness.foreground(); await harness.settle();
  assert.equal(harness.messages().length, 50);
  assert.equal(harness.messages()[0].id, 'm011');
  assert.ok(olderButton(harness), 'new history enables older pagination after an initially short page');
  olderButton(harness).props.onPress(); await harness.settle();
  assert.equal(harness.messages().map(row => row.id).join(','), database.map(row => row.id).join(','));
});

test('foreground removes cached group messages that RLS no longer returns after a remote block', async (context) => {
  let database = [message(0), { ...message(1), sender_id: 'blocked' }];
  const harness = room({ loadConversationMessages: async () => database });
  context.after(() => harness.cleanup());
  await harness.settle();
  assert.equal(harness.messages().length, 2);
  database = [message(0)];
  harness.foreground(); await harness.settle();
  assert.equal(harness.messages().map(row => row.id).join(','), 'm000');
});

test('a live message arriving during a foreground snapshot survives snapshot completion', async (context) => {
  let releaseSnapshot, delaySnapshot = false;
  const harness = room({
    loadConversationMessages: async () => delaySnapshot ? new Promise(resolve => { releaseSnapshot = resolve; }) : [message(0)],
    loadConversationMessagesByIds: async (_client, _room, ids) => ids.includes('m001') ? [message(1)] : [],
  });
  context.after(() => harness.cleanup());
  await harness.settle();
  delaySnapshot = true;
  harness.foreground(); await harness.settle();
  harness.message(message(1)); await harness.timers();
  releaseSnapshot([message(0)]); await harness.settle(); await harness.timers();
  assert.equal(harness.messages().map(row => row.id).join(','), 'm000,m001');
});
