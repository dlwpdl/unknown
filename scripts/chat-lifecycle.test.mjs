import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { isContentRejected, mergeChatMessages } from '../src/lib/community-data.ts';
import * as chatDetails from '../src/lib/chat-details.ts';
import * as chatLocation from '../src/lib/chat-location.ts';
import { chatSuggestions } from '../src/lib/chat-suggestions.ts';
import { merchantEventId } from '../src/lib/merchant-source.ts';
import { sharedLinkInMessage } from '../src/lib/sharing.ts';
import { hideContent, isContentHidden, subscribeVisibility, visibilityRevision } from '../src/lib/content-visibility.ts';
import { count, t } from '../src/i18n/ko.ts';

// Exercise the component's hooks, effects and event handlers, as in comment-threads.test.mjs.
function mount(file, exportName, data, props = {}, params = {}) {
  const hooks = [], setters = [], appListeners = new Set(), channels = new Set(), timers = new Map(), animations = [];
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
      return [hooks[slot], setters[slot] ??= value => {
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
    useMemo(fn, deps) {
      const slot = index++, previous = hooks[slot];
      if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) hooks[slot] = { value: fn(), deps };
      return hooks[slot].value;
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
    process: { env: { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: data.mapsKey ?? '' } },
    requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return react;
      if (name === 'react-native') return new Proxy({
        StyleSheet: { create: value => value }, Platform: { OS: 'ios' },
        LayoutAnimation: { configureNext: config => animations.push(config), Presets: { easeInEaseOut: {} }, Types: { easeOut: 'easeOut' }, Properties: { opacity: 'opacity' } },
        AppState: { addEventListener(_name, callback) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
        DeviceEventEmitter: { addListener: () => ({ remove() {} }) },
      }, { get: (target, key) => target[key] ?? key });
      if (name === 'expo-router') return { useFocusEffect: fn => effect(fn, [fn]), useLocalSearchParams: () => params, useRouter: () => ({ setParams() {} }) };
      if (name === 'react-native-reanimated') return { useReducedMotion: () => data.reducedMotion ?? false };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/lib/auth') return { useAuth: () => auth };
      if (name === '@/lib/membership-provider') return { useMembership: () => ({ refresh: refreshMembership }) };
      if (name === '@/components/relationship-slot-card') return { relationshipSlotData: () => null };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === '@/hooks/use-content-visibility') return { useContentVisibility: () => {
        effect(() => subscribeVisibility(() => { dirty = true; }), []);
        return react.useCallback((type, id, authorId) => isContentHidden(auth.me.id, type, id, authorId), [auth.me.id, visibilityRevision()]);
      } };
      if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, four: 24 }, Depth: { card: {}, control: {} } };
      if (name === '@/i18n/ko') return { t, count };
      if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
      // 하트 리액션 기본값: 테스트가 필요하면 data 로 덮어쓴다.
      if (name === '@/lib/community-data') return { isContentRejected, mergeChatMessages, loadMessageReactions: async () => new Map(), setMessageReaction: async () => 1,
        loadChatReadPosition: async () => null, markChatRead: async () => {}, ...data };
      if (name === '@/lib/sharing') return { sharedLinkInMessage };
      if (name === '@/components/shared-link-card') return { SharedLinkCard: 'SharedLinkCard' };
      if (name === '@/lib/chat-details') return { ...chatDetails, ...(data.loadChatMembers ? { loadChatMembers: data.loadChatMembers } : {}) };
      if (name === '@/lib/chat-location') return chatLocation;
      if (name === '@/lib/chat-suggestions') return { chatSuggestions, loadChatSuggestionContext: async () => null, ...data.suggestions };
      if (name === '@/lib/merchant-source') return { merchantEventId };
      if (name === 'expo-location') return { Accuracy: { High: 4 }, ...data.location };
      if (name === '@/lib/supabase') return { supabase };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const render = () => {
    for (let count = 0; dirty; count++) {
      assert.ok(count < 30, 'component effects settle without a render loop');
      dirty = false; index = 0; effects = [];
      tree = exports[exportName](props);
      for (const node of nodes(tree)) if (node.type === 'View' && node.props?.ref) {
        node.props.ref.current = { measureInWindow: data.measureRegion ?? (callback => callback(0, 110, 390, 530)) };
      }
      for (const run of effects) run();
    }
  };
  const nodes = value => !value || typeof value !== 'object' ? []
    : [...(value.type ? [value] : []), ...Object.values(value).flatMap(nodes)];
  const harness = {
    auth,
    async settle() { for (let i = 0; i < 5; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); },
    nodes: () => nodes(tree),
    messages: () => nodes(tree).find(node => node.type === 'FlatList')?.props.data ?? [],
    animations,
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
const suggestionButtons = harness => harness.nodes().filter(node => node.props?.analyticsId === 'components_chat-room.suggestion');

test('suggested sends retry with the same identity and preserve the typed draft', async context => {
  const calls = [];
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
    loadConversationMessages: async () => [],
    suggestions: {
      loadChatSuggestionContext: async () => ({ category: 'used', title: 'Bike', authorId: 'neighbor' }),
      sendSuggestedMessage: async (_client, roomId, body, id) => {
        calls.push([roomId, body, id]);
        if (calls.length === 1) throw new Error('offline');
        return 'suggested-id';
      },
    },
  }, { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
  context.after(() => harness.cleanup()); await harness.settle();
  const review = harness.nodes().find(node => node.type === 'MannerReviewButton');
  assert.equal(review?.props.subjectId, 'host'); assert.equal(review?.props.context.conversationId, 'room');
  const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
  input().props.onChangeText('my unsent draft'); await harness.settle();
  assert.equal(suggestionButtons(harness).length, 3);
  assert.equal(suggestionButtons(harness)[0].props.style({ pressed: false })[0].minHeight, 44);
  suggestionButtons(harness)[0].props.onPress(); await harness.settle();
  assert.equal(suggestionButtons(harness)[1].props.disabled, true);
  assert.equal(input().props.value, 'my unsent draft');
  suggestionButtons(harness)[0].props.onPress(); await harness.settle();
  assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
  assert.equal(harness.messages().find(row => row.id === 'suggested-id')?.body, calls[0][1]);
  assert.equal(input().props.value, 'my unsent draft');
  assert.equal(suggestionButtons(harness).length, 0);
});

test('suggested send results cannot reenter the room after logout', async context => {
  let finish;
  const harness = room({ loadConversationMessages: async () => [], suggestions: {
    sendSuggestedMessage: () => new Promise(resolve => { finish = resolve; }),
  } });
  context.after(() => harness.cleanup()); await harness.settle();
  const button = suggestionButtons(harness)[0]; assert.ok(button);
  button.props.onPress(); await harness.settle();
  harness.auth.isAuthed = false; await harness.settle();
  finish('late-suggestion'); await harness.settle();
  assert.equal(harness.nodes().length, 0);
  harness.auth.isAuthed = true; harness.foreground(); await harness.settle();
  assert.equal(harness.messages().some(row => row.id === 'late-suggestion'), false);
});

test('attachment plus opens a place picker without asking for location permission', async (context) => {
  const harness = room({ loadConversationMessages: async () => [] });
  context.after(() => harness.cleanup());
  await harness.settle();
  const plus = () => harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment');
  assert.equal(plus().props.accessibilityState.expanded, false);
  assert.equal(harness.nodes().some(node => node.props?.accessibilityLabel === '위치 공유하기'), false);
  plus().props.onPress(); await harness.settle();
  assert.equal(plus().props.accessibilityState.expanded, true);
  assert.ok(harness.nodes().some(node => node.props?.accessibilityLabel === '사진 보내기'));
  const location = harness.nodes().find(node => node.props?.accessibilityLabel === '위치 공유하기');
  assert.ok(location);
  location.props.onPress(); await harness.settle();
  assert.ok(harness.nodes().some(node => node.type === 'ChatLocationPicker'), '장소 선택 창을 먼저 열고 전송하지 않는다');
  plus().props.onPress(); await harness.settle();
  plus().props.onPress(); await harness.settle();
  assert.equal(plus().props.accessibilityState.expanded, false);
});

test('long press replies in direct and group rooms and keeps the unsent draft', async context => {
  const rows = [{ ...message(1), id: 'parent', body: 'meet here' }];
  for (const kind of ['direct', 'group']) {
    const sent = [];
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => rows,
      sendDirectMessage: async (_client, id, body, parent) => { sent.push([id, body, parent]); return 'reply-id'; } },
    { ...roomProps, conversation: { ...conversation, kind } });
    context.after(() => harness.cleanup()); await harness.settle();
    assert.ok(suggestionButtons(harness).length > 0);
    const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
    input().props.onChangeText('saved draft'); await harness.settle();
    const list = harness.nodes().find(node => node.type === 'FlatList');
    const row = list.props.renderItem({ item: rows[0], index: 0 });
    const walk = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(walk)];
    const bubble = walk(row).find(node => node.props?.analyticsId === 'components_chat-room.pressable.heart');
    assert.equal(typeof bubble.props.onMenu, 'function'); bubble.props.onMenu(rows[0], { measureInWindow: callback => callback(48, 300, 200, 44) }); await harness.settle();
    assert.ok(!harness.nodes().some(node => node.props?.accessibilityLabel === '메시지 수정'), '다른 사람의 메시지는 수정 메뉴를 숨긴다');
    harness.nodes().find(node => node.props?.accessibilityLabel === '답장').props.onPress(); await harness.settle();
    assert.equal(suggestionButtons(harness).length, 0, 'suggestions do not discard an intended reply');
    assert.equal(input().props.value, 'saved draft');
    input().props.onSubmitEditing(); await harness.settle();
    assert.deepEqual(sent, [['room', 'saved draft', 'parent']]);
  }
});

test('late menu measurements cannot reopen a dismissed menu or cross an account boundary', async context => {
  for (const phase of ['bubble', 'region']) for (const change of ['layout', 'scroll', 'auto-scroll', 'logout']) {
    let finish;
    const row = { ...message(1), sender_id: 'me' };
    const harness = room({ loadConversationMessages: async () => [row], measureRegion: callback => { if (phase === 'region') finish = callback; else callback(0, 110, 390, 530); } });
    context.after(() => harness.cleanup()); await harness.settle();
    const list = harness.nodes().find(node => node.type === 'FlatList');
    const tree = list.props.renderItem({ item: row, index: 0 });
    const walk = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(walk)];
    walk(tree).find(node => node.props?.onMenu).props.onMenu(row, { measureInWindow: callback => { if (phase === 'bubble') finish = callback; else callback(180, 320, 180, 44); } });
    if (change === 'layout') harness.nodes().find(node => node.type === 'View' && node.props?.onLayout).props.onLayout();
    if (change === 'scroll') list.props.onScrollBeginDrag();
    if (change === 'auto-scroll') list.props.onScroll({ nativeEvent: { contentOffset: { y: 96 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 530 } } });
    if (change === 'logout') harness.auth.isAuthed = false;
    finish(0, 110, 390, 530); await harness.settle();
    assert.ok(!harness.nodes().some(node => node.props?.analyticsId === 'chat.message.reply'));
  }
});

test('automatic scrolling dismisses a menu instead of leaving it at an old bubble position', async context => {
  const row = { ...message(1), sender_id: 'me' };
  const harness = room({ loadConversationMessages: async () => [row] });
  context.after(() => harness.cleanup()); await harness.settle();
  const list = harness.nodes().find(node => node.type === 'FlatList');
  const tree = list.props.renderItem({ item: row, index: 0 });
  const walk = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(walk)];
  walk(tree).find(node => node.props?.onMenu).props.onMenu(row, { measureInWindow: callback => callback(180, 320, 180, 44) });
  await harness.settle();
  assert.ok(harness.nodes().some(node => node.props?.analyticsId === 'chat.message.reply'));
  list.props.onScroll({ nativeEvent: { contentOffset: { y: 96 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 530 } } });
  await harness.settle();
  assert.ok(!harness.nodes().some(node => node.props?.analyticsId === 'chat.message.reply'));
});

test('own message edit/delete preserve the composer and a refused edit preserves its draft', async context => {
  const original = { ...message(1), sender_id: 'me', body: 'before' };
  const calls = []; let refuse = true;
  const harness = room({ loadConversationMessages: async () => [original],
    editChatMessage: async (_client, id, body, revision) => {
      calls.push(['edit', id, body, revision]); if (refuse) throw new Error('MESSAGE_CHANGED');
      return { ...original, body, edited_at: 'revision' };
    }, deleteChatMessage: async (_client, id, revision) => { calls.push(['delete', id, revision]); return { ...original, body: '삭제된 메시지입니다.', edited_at: 'revision', deleted_at: 'now' }; } });
  context.after(() => harness.cleanup()); await harness.settle();
  const composer = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
  const action = label => harness.nodes().find(node => node.props?.label === label || node.props?.accessibilityLabel === label);
  const open = async () => {
    const row = harness.nodes().find(node => node.type === 'FlatList').props.renderItem({ item: harness.messages()[0], index: 0 });
    const walk = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(walk)];
    const bubble = walk(row).find(node => node.props?.onMenu); bubble.props.onMenu(harness.messages()[0], { measureInWindow: callback => callback(180, 320, 180, 44) }); await harness.settle();
  };
  composer().props.onChangeText('unsent'); await harness.settle(); await open();
  assert.ok(action('메시지 삭제')); action('메시지 수정').props.onPress(); await harness.settle();
  const edit = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '수정할 메시지');
  edit().props.onChangeText('after'); await harness.settle(); action('수정 저장').props.onPress(); await harness.settle();
  assert.equal(edit().props.value, 'after'); assert.equal(composer().props.value, 'unsent');
  refuse = false; action('수정 저장').props.onPress(); await harness.settle();
  assert.equal(harness.messages()[0].body, 'after'); assert.equal(composer().props.value, 'unsent');
  await open(); action('메시지 삭제').props.onPress(); await harness.settle(); action('삭제하기').props.onPress(); await harness.settle();
  assert.ok(harness.messages()[0].deleted_at); assert.deepEqual(calls.at(-1), ['delete', original.id, 'revision']);
});

test('live changes revalidate visibility and remove inaccessible cached messages and quotes', async context => {
  const parent = message(1), reply = { ...message(2), sender_id: 'me', reply_to_id: parent.id, reply: parent };
  const harness = room({ loadConversationMessages: async () => [parent, reply], loadConversationMessagesByIds: async () => [] });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.message(parent); await harness.timers();
  assert.deepEqual(harness.messages().map(row => row.id), [reply.id]);
  assert.equal(harness.messages()[0].reply, null);
});

test('location picker requests permission only on current-location selection and preserves a failed send', async context => {
  let permissions = 0, positions = 0; const sent = [];
  const harness = mount('../src/components/chat-location-picker.tsx', 'ChatLocationPicker', { location: {
    requestForegroundPermissionsAsync: async () => { permissions++; return { granted: true }; },
    getCurrentPositionAsync: async () => { positions++; return { coords: { latitude: 49.2, longitude: -123.1 } }; },
  } }, { sending: false, onClose() {}, onSend: async point => { sent.push(point); throw new Error('offline'); } });
  context.after(() => harness.cleanup()); await harness.settle();
  const action = label => harness.nodes().find(node => node.props?.label === label || node.props?.accessibilityLabel === label);
  assert.equal(permissions, 0); assert.equal(action('이 위치 공유하기').props.disabled, true);
  action('현재 위치 선택').props.onPress(); await harness.settle();
  assert.equal(permissions, 1); assert.equal(positions, 1); assert.equal(sent.length, 0);
  action('이 위치 공유하기').props.onPress(); await harness.settle();
  assert.equal(sent[0].latitude, 49.2); assert.equal(action('이 위치 공유하기').props.disabled, false);
  assert.ok(harness.nodes().some(node => node.props?.accessibilityRole === 'alert'));
});

test('place search does not use GPS or send until a valid map point is chosen', async context => {
  let permissions = 0; const sent = [];
  const harness = mount('../src/components/chat-location-picker.tsx', 'ChatLocationPicker', { mapsKey: 'offline-key', location: {
    requestForegroundPermissionsAsync: async () => { permissions++; return { granted: false }; },
  } }, { sending: false, onClose() {}, onSend: async point => { sent.push(point); } });
  context.after(() => harness.cleanup()); await harness.settle();
  const map = () => harness.nodes().find(node => node.type === 'ChatMap');
  const action = label => harness.nodes().find(node => node.props?.label === label || node.props?.accessibilityLabel === label);
  map().props.onEvent('{"type":"ready"}'); await harness.settle();
  harness.nodes().find(node => node.type === 'TextInput').props.onChangeText('library'); await harness.settle();
  action('검색').props.onPress(); await harness.settle(); assert.equal(map().props.command.query, 'library');
  assert.equal(sent.length, 0); assert.equal(permissions, 0);
  map().props.onEvent('{"type":"selection","latitude":999,"longitude":0,"label":"bad"}'); await harness.settle();
  assert.equal(action('이 위치 공유하기').props.disabled, true);
  map().props.onEvent('{"type":"selection","latitude":49.28,"longitude":-123.12,"label":"Library"}'); await harness.settle();
  action('이 위치 공유하기').props.onPress(); await harness.settle(); assert.equal(sent[0].label, 'Library');
});

test('only newly arriving chat messages animate, not the opened history', async (context) => {
  const harness = room({
    loadConversationMessages: async () => [message(0)],
    loadConversationMessagesByIds: async () => [message(1)],
  });
  context.after(() => harness.cleanup());
  await harness.settle();
  assert.equal(harness.animations.length, 0);
  harness.message(message(1)); await harness.timers();
  assert.equal(harness.messages().length, 2);
  assert.equal(harness.animations.length, 1);
});

test('rendered messages retain report controls and show time only at the end of a sender-minute group', async (context) => {
  const rows = [message(1), message(2), { ...message(3), sender_id: 'me' }];
  const harness = room({ loadConversationMessages: async () => rows });
  context.after(() => harness.cleanup());
  await harness.settle();
  const list = harness.nodes().find(node => node.type === 'FlatList');
  const contains = (value, text) => value === text || !!value && typeof value === 'object' && Object.values(value).some(child => contains(child, text));
  const first = list.props.renderItem({ item: rows[0], index: 0 });
  const second = list.props.renderItem({ item: rows[1], index: 1 });
  const mine = list.props.renderItem({ item: rows[2], index: 2 });
  assert.equal(contains(first, chatDetails.chatMessageTime(rows[0].created_at)), false);
  assert.equal(contains(second, chatDetails.chatMessageTime(rows[1].created_at)), true);
  assert.equal(contains(second, t.report.short), true);
  assert.equal(contains(mine, chatDetails.chatMessageTime(rows[2].created_at)), true);
});

test('keyboard submit sends in direct and group rooms through the same guarded send path', async (context) => {
  for (const kind of ['direct', 'group']) {
    const sent = [];
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
      loadConversationMessages: async () => [],
      sendDirectMessage: async (_client, roomId, body) => { sent.push([roomId, body]); return 'sent-id'; },
    }, { ...roomProps, conversation: { ...conversation, kind } });
    context.after(() => harness.cleanup());
    await harness.settle();
    let bottomScrolls = 0;
    const list = harness.nodes().find(node => node.type === 'FlatList');
    list.props.ref.current = { scrollToEnd: () => { bottomScrolls++; } };
    assert.equal(list.props.ListFooterComponent.props.style.height, 24, 'last message time has room above the composer');
    const input = harness.nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === t.chat.messagePlaceholder);
    assert.equal(input.props.returnKeyType, 'send');
    assert.equal(input.props.submitBehavior, 'submit');
    input.props.onChangeText('  안녕  ');
    await harness.settle();
    harness.nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === t.chat.messagePlaceholder).props.onSubmitEditing();
    await harness.settle();
    assert.deepEqual(sent, [['room', '안녕']]);
    assert.ok(bottomScrolls > 0, 'sending scrolls through the message time after layout');
  }
});

test('a room opens at the first unread message and offers a deliberate jump to the latest', async (context) => {
  const marked = [], scrolls = [];
  const rows = [message(0), message(1), message(2)];
  const harness = room({ loadConversationMessages: async () => rows,
    loadChatReadPosition: async () => rows[0].created_at,
    markChatRead: async (_client, _room, id) => { marked.push(id); } });
  context.after(() => harness.cleanup());
  await harness.settle();
  const list = harness.nodes().find(node => node.type === 'FlatList');
  list.props.ref.current = { scrollToIndex: ({ index }) => scrolls.push(['unread', index]), scrollToEnd: () => scrolls.push(['latest']) };
  await harness.timers();
  assert.deepEqual(scrolls, [['unread', 1]]);
  const unreadRow = list.props.renderItem({ item: rows[1], index: 1 });
  assert.match(JSON.stringify(unreadRow), /여기부터 안 읽은 메시지/);
  const jump = harness.nodes().find(node => node.props?.accessibilityLabel === '최근 메시지로 내려가기');
  assert.ok(jump);
  jump.props.onPress();
  assert.deepEqual(scrolls.at(-1), ['latest']);
  list.props.onViewableItemsChanged({ viewableItems: [{ item: rows[2] }] });
  await harness.settle();
  assert.deepEqual(marked, [rows[2].id]);
});

test('member sheet refreshes on open and removes previously loaded identities on access failure', async (context) => {
  let allowed = true;
  const harness = mount('../src/components/chat-members.tsx', 'ChatMembers', {
    loadChatMembers: async () => { if (!allowed) throw new Error('CONVERSATION_ACCESS_DENIED'); return [{ id: 'host', nickname: '호스트', is_host: true }]; },
  }, { conversationId: 'room', groupPostId: 'post', currentUserId: 'me' });
  context.after(() => harness.cleanup());
  await harness.settle();
  assert.equal(harness.nodes().find(node => node.type === 'FlatList').props.data.length, 1);
  const roster = harness.nodes().find(node => node.props.accessibilityLabel === '대화 멤버 목록');
  assert.ok(harness.nodes().some(node => node.props.accessibilityLabel === '호스트 프로필'), 'roster shows a participant portrait beside the count');
  assert.ok(roster, 'portrait and count still open the full member sheet');
  allowed = false;
  harness.nodes().find(node => node.props.accessibilityLabel === '대화 멤버 목록').props.onPress();
  await harness.settle();
  assert.equal(harness.nodes().some(node => node.type === 'FlatList'), false);
  assert.ok(harness.nodes().some(node => node.props?.accessibilityRole === 'alert'));
});

test('member sheet keeps its slide unless Reduce Motion is enabled', (context) => {
  for (const reducedMotion of [false, true]) {
    const harness = mount('../src/components/chat-members.tsx', 'ChatMembers', { reducedMotion },
      { conversationId: 'room', groupPostId: 'post', currentUserId: 'me' });
    context.after(() => harness.cleanup());
    const modal = harness.nodes().find(node => node.type === 'Modal');
    assert.equal(modal.props.animationType, reducedMotion ? 'none' : 'slide');
  }
});

test('report and block remove rendered messages immediately and reject late snapshots', async (context) => {
  const rows = [
    { ...message(0), id: 'reported-live' },
    { ...message(1), sender_id: 'blocked-live' },
    message(2),
  ];
  const harness = room({ loadConversationMessages: async () => rows });
  context.after(() => harness.cleanup());
  await harness.settle();
  assert.equal(harness.messages().length, 3);
  hideContent('me', 'message', 'reported-live');
  await harness.settle();
  assert.equal(harness.messages().length, 2);
  hideContent('me', 'user', 'blocked-live');
  await harness.settle();
  assert.equal(harness.messages().map(row => row.id).join(','), 'm002');
  harness.foreground(); await harness.settle();
  assert.equal(harness.messages().map(row => row.id).join(','), 'm002');
});

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

test('direct profile route selects the free direct inbox without taking over later tab choices', async (context) => {
  const filters = [];
  const harness = mount('../src/app/(tabs)/chat.tsx', 'default', {
    async loadConversations(_client, _user, filter) {
      filters.push(filter);
      return { conversations: [], selectedConversation: null, pendingCount: 0, cursor: null };
    },
    loadPendingMeetupRequests: async () => [],
  }, {}, { view: 'direct' });
  context.after(() => harness.cleanup());
  await harness.settle();
  assert.equal(filters.at(-1), 'direct');
  const tabs = () => harness.nodes().filter(node => node.props?.accessibilityRole === 'tab');
  assert.equal(tabs()[2].props.accessibilityState.selected, true);
  assert.ok(JSON.stringify(tabs()[2]).includes('1:1 대화'));
  assert.doesNotMatch(JSON.stringify(tabs()[2]), /무료/);
  tabs()[0].props.onPress();
  await harness.settle();
  assert.equal(filters.at(-1), 'all');
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


test('chat bubbles attach protected cards only to owned plain-text links and keep ordinary/attachment messages unchanged', async context => {
  const shared = 'https://gling.ej-entertainment.com/post?id=9f100000-0000-4000-8000-000000000001';
  const rows = [
    { ...message(1), body: `같이 가요!\n${shared}` },
    { ...message(2), body: '평범한 안부 메시지' },
    { ...message(3), body: shared.replace('gling.ej-entertainment.com', 'gling.ej-entertainment.com.evil.test') },
    { ...message(4), body: shared, kind: 'image', imageUrl: 'signed-photo' },
    { ...message(5), body: shared, kind: 'location', latitude: 49, longitude: -123 },
  ];
  const harness = room({ loadConversationMessages: async () => rows }); context.after(() => harness.cleanup()); await harness.settle();
  const list = harness.nodes().find(node => node.type === 'FlatList'); assert.ok(list);
  for (let index = 0; index < rows.length; index++) {
    const item = list.props.renderItem({ item: rows[index], index });
    const all = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(v => Array.isArray(v) ? v.flatMap(all) : all(v))];
    const cards = all(item).filter(node => node.type === 'SharedLinkCard'); assert.equal(cards.length, index === 0 ? 1 : 0);
    if (cards.length) { assert.equal(cards[0].props.url, shared); assert.equal(cards[0].key, `${rows[index].id}:me`); }
    if (index === 1) assert.ok(JSON.stringify(item).includes(rows[index].body), 'ordinary chat stays visible');
  }
});

test('pending and rejected chat scopes never read messages or render shared cards', async context => {
  for (const status of ['pending', 'rejected']) {
    let reads = 0;
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => { reads++; return []; } }, { ...roomProps, conversation: { ...conversation, status } });
    context.after(() => harness.cleanup()); await harness.settle();
    assert.equal(reads, 0); assert.ok(!harness.nodes().some(node => node.type === 'FlatList' || node.type === 'SharedLinkCard'));
  }
});
