import { withLanguageImports } from './test-language-imports.mjs';
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
import { isFreshLocation } from '../src/lib/location.ts';
import { googlePinUrl, postPublicAddress } from '../src/lib/post-maps.ts';
import { chillingSchedule } from '../src/lib/chilling.ts';
import * as product from '../src/lib/product-analytics.ts';
import { translateUi, translationsFor } from '../src/i18n/index.ts';
import { subscribeBusinessChat } from '../src/lib/business-chat.ts';

function languageImports(resolve, data) {
  const imports = withLanguageImports(resolve);
  return name => name === '@/hooks/use-language' && data.language ? { useLanguage: () => ({
    language: data.language, locale: data.language === 'en' ? 'en-CA' : 'ko-KR', t: translationsFor(data.language),
    tr: (text, ...values) => translateUi(data.language, text, ...values),
  }) } : imports(name);
}

// Exercise the component's hooks, effects and event handlers, as in comment-threads.test.mjs.
function mount(file, exportName, data, props = {}, params = {}) {
  const hooks = [], setters = [], appListeners = new Set(), channels = new Set(), timers = new Map(), animations = [];
  let index = 0, effects = [], dirty = true, tree, timerId = 0;
  const auth = { isAuthed: true, me: { id: 'me', nickname: '나' }, ...data.auth };
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
    rpc: async (name, args) => { data.productEvents?.push([name, JSON.parse(JSON.stringify(args))]); return { error: data.telemetryError ?? null }; },
    storage: { from: () => ({ remove: async paths => { data.removed?.push(...paths); return { error: null }; } }) },
    channel(name) {
      data.subscriptionEvents?.push(['subscribe', name]);
      const channel = { handlers: [], on(_kind, filter, callback) { this.handlers.push({ filter, callback }); return this; }, subscribe(callback) { this.status = callback; callback?.('SUBSCRIBED'); return this; } };
      channels.add(channel);
      return channel;
    },
    removeChannel(channel) { data.subscriptionEvents?.push(['remove']); channels.delete(channel); return Promise.resolve('ok'); },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    Date: class extends Date { static now() { return data.clock?.now ?? Date.now(); } },
    process: { env: { EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: data.mapsKey ?? '' } },
    requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout(fn, delay = 0) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require: languageImports((name) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return react;
      if (name === 'react-native') return new Proxy({
        Keyboard: { dismiss() {} },
        StyleSheet: { create: value => value }, Platform: { OS: data.platform ?? 'ios' }, useWindowDimensions: () => ({ width: 390, height: 844 }),
        LayoutAnimation: { configureNext: config => animations.push(config), Presets: { easeInEaseOut: {} }, Types: { easeOut: 'easeOut' }, Properties: { opacity: 'opacity' } },
        AppState: { currentState: 'active', addEventListener(_name, callback) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
        DeviceEventEmitter: { addListener: () => ({ remove() {} }) },
        ...data.native,
      }, { get: (target, key) => target[key] ?? key });
      if (name === 'expo-router') return { useFocusEffect: fn => effect(() => data.focused === false ? undefined : fn(), [fn, data.focused]), useLocalSearchParams: () => params, useRouter: () => ({ setParams(value) { Object.assign(params, value); }, push(value) { data.routes?.push(value); } }) };
      if (name === '@/app/map') return { __esModule: true, default: 'MapScreen' };
      if (name === 'react-native-reanimated') return { useReducedMotion: () => data.reducedMotion ?? false };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/hooks/use-chat-identity') return { useChatIdentity: () => data.businessIdentity ?? null };
      if (name === '@/lib/chat-identity') return { chatBusinessIdentity: () => data.businessIdentity ?? null, selectChatBusiness: (_user, value) => { data.businessIdentity = value; dirty = true; } };
      if (name === '@/lib/merchant-connections') return { loadMyMerchantConnections: async (_client, userId, chatOnly = false) => data.loadMyMerchantConnections
        ? data.loadMyMerchantConnections(userId, chatOnly) : ({ user_id: auth.me.id, merchants: data.connections ?? [] }) };
      if (name === '@/lib/business-chat') return { subscribeBusinessChat: (_client, _user, changed) => { data.privateChanged = changed; return () => { data.privateChanged = null; }; }, ...data.businessChat };
      if (name === '@/lib/auth') return { useAuth: () => auth };
      if (name === '@/lib/membership-provider') return { useMembership: () => ({ refresh: refreshMembership }) };
      if (name === '@/components/relationship-slot-card') return { relationshipSlotData: () => null };
      if (name === '@/hooks/use-theme') return { useTheme: () => data.theme ?? ({}) };
      if (name === '@/hooks/use-content-visibility') return { useContentVisibility: () => {
        effect(() => subscribeVisibility(() => { dirty = true; }), []);
        return react.useCallback((type, id, authorId) => isContentHidden(auth.me.id, type, id, authorId), [auth.me.id, visibilityRevision()]);
      } };
      if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, four: 24 }, Depth: { card: {}, control: {} } };
      if (name === '@/i18n/ko') return { t, count };
      if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => data.feedback?.push(kind) }) };
      // 하트 리액션 기본값: 테스트가 필요하면 data 로 덮어쓴다.
      if (name === '@/lib/community-data') return { isContentRejected, mergeChatMessages, loadMessageReactions: async () => new Map(), setMessageReaction: async () => 1,
        loadChatReadPosition: async () => null, markChatRead: async () => {}, ...data };
      if (name === '@/lib/sharing') return { sharedLinkInMessage };
      if (name === '@/components/shared-link-card') return { SharedLinkCard: 'SharedLinkCard' };
      if (name === '@/lib/chat-details') return { ...chatDetails, ...(data.loadChatMembers ? { loadChatMembers: data.loadChatMembers } : {}) };
      if (name === '@/lib/chilling') return { chillingSchedule };
      if (name === '@/lib/chat-location') return chatLocation;
      if (name === '@/lib/location') return { isFreshLocation };
      if (name === '@/lib/post-maps') return { googlePinUrl, postPublicAddress };
      if (name === '@/lib/meetup-destination') return { splitPlaceMeetupBody: () => null };
      if (name === '@/lib/meetup-ai') return { visibleMeetupBody: body => body };
      if (name === '@/lib/feed-data') return { loadPublicPost: data.loadPublicPost ?? (async () => null), loadPublicMeetupContext: data.loadPublicMeetupContext ?? (async () => null) };
      if (name === '@/lib/meetup-reviews') return { loadMeetupUpcomingSessions: data.loadMeetupSessions };
      if (name === '@/lib/image-upload') return { MAX_POST_IMAGES: 20 };
      if (name === '@/lib/post-image-picker') return { isSupportedImage: mime => ['image/jpeg', 'image/png', 'image/webp'].includes(mime), preparePostImage: data.preparePostImage };
      if (name === 'expo-image-picker') return { UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' }, ...data.imagePicker };
      if (name === '@/lib/chat-suggestions') return { chatSuggestions, loadChatSuggestionContext: async () => null, ...data.suggestions };
      if (name === '@/lib/merchant-source') return { merchantEventId };
      if (name === 'expo-location') return { Accuracy: { High: 4, Balanced: 3 }, ...data.location };
      if (name === '@/lib/supabase') return { supabase };
      if (name === '@/lib/product-analytics') return product;
      return new Proxy({}, { get: (_target, key) => key });
    }, data),
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
    rerender() { dirty = true; render(); },
    async settle() { for (let i = 0; i < 5; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); },
    nodes: () => nodes(tree),
    messages: () => nodes(tree).find(node => node.type === 'FlatList')?.props.data ?? [],
    animations,
    foreground() { for (const callback of appListeners) callback('active'); },
    reconnect() { for (const channel of channels) channel.status?.('SUBSCRIBED'); },
    message(message) { for (const channel of channels) for (const { filter, callback } of channel.handlers) if (filter.table === 'messages') callback({ new: message }); },
    async timers() { const pending = [...timers.values()]; timers.clear(); for (const { fn, delay } of pending) { if (data.clock) data.clock.now += delay; fn(); } await harness.settle(); },
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

test('public discovery opens above the current room and returns with the same draft/messages/read position', async context => {
  for (const kind of ['group', 'direct']) {
    let reads = 0, closes = 0;
    const feedback = [], routes = [], rows = [message(1), message(2)];
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
      feedback, routes, loadConversationMessages: async () => { reads++; return rows; },
      loadChatReadPosition: async () => rows[0].created_at,
    }, { ...roomProps, conversation: { ...conversation, kind }, onClose: () => closes++ });
    context.after(() => harness.cleanup()); await harness.settle();
    const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
    input().props.onChangeText('unfinished private draft'); await harness.settle();
    const before = harness.messages(), list = harness.nodes().find(node => node.type === 'FlatList');
    const readPosition = list.props.initialScrollIndex, initialReads = reads;
    const action = harness.nodes().find(node => node.props?.analyticsId === 'chat.open-map');
    assert.ok(action, 'conversation header must offer the approved public discovery action');
    action.props.onPress(); await harness.settle();
    const map = harness.nodes().find(node => node.type === 'MapScreen');
    assert.ok(map); assert.deepEqual(Object.keys(map.props), ['onClose']);
    assert.equal(harness.nodes().filter(node => node.type === 'MapScreen').length, 1);
    assert.ok(harness.nodes().some(node => node.type === 'Modal' && node.props.visible && node.props.presentationStyle === 'fullScreen'));
    assert.equal(input().props.value, 'unfinished private draft');
    assert.equal(closes, 0); assert.deepEqual(routes, []); assert.ok(feedback.includes('selection'));
    map.props.onClose(); await harness.settle();
    assert.ok(!harness.nodes().some(node => node.type === 'MapScreen'));
    assert.equal(input().props.value, 'unfinished private draft');
    assert.deepEqual(harness.messages(), before); assert.equal(reads, initialReads);
    assert.equal(harness.nodes().find(node => node.type === 'FlatList').props.initialScrollIndex, readPosition);
    assert.ok(!harness.nodes().some(node => node.type === 'FeedAd'));
  }
});

test('messages still arrive under discovery without hidden read receipts or automatic scrolling', async context => {
  const rows = [message(1)], incoming = message(2), marked = [], scrolls = [];
  const harness = room({ loadConversationMessages: async () => rows,
    loadConversationMessagesByIds: async () => [incoming],
    markChatRead: async (_client, _room, id) => marked.push(id) });
  context.after(() => harness.cleanup()); await harness.settle();
  const list = () => harness.nodes().find(node => node.type === 'FlatList');
  list().props.ref.current = { scrollToEnd: () => scrolls.push('end'), scrollToIndex: () => scrolls.push('index') };
  await harness.timers(); scrolls.length = 0;
  const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
  input().props.onChangeText('private unfinished draft'); await harness.settle();
  const action = harness.nodes().find(node => node.props?.analyticsId === 'chat.open-map'); action.props.onPress(); await harness.settle();
  harness.message(incoming); await harness.timers();
  assert.ok(harness.messages().some(row => row.id === incoming.id), 'realtime updates and safety visibility remain active');
  list().props.onViewableItemsChanged({ viewableItems: [{ item: incoming }] });
  list().props.onLayout(); list().props.onContentSizeChange(); await harness.settle();
  assert.deepEqual(marked, []); assert.deepEqual(scrolls, []);
  harness.nodes().find(node => node.type === 'MapScreen').props.onClose(); await harness.settle();
  list().props.onLayout(); list().props.onContentSizeChange();
  assert.deepEqual(scrolls, [], 'return must not jump to messages that arrived behind the overlay');
  assert.equal(input().props.value, 'private unfinished draft');
  assert.ok(harness.nodes().some(node => node.props?.analyticsId === 'components_chat-room.jump-latest'));
  list().props.onViewableItemsChanged({ viewableItems: [{ item: incoming }] }); await harness.settle();
  assert.deepEqual(marked, [incoming.id], 'a genuinely visible message can be marked after returning');
});

test('initial unread positioning waits for the covering map or meetup sheet, including a pending scroll timer', async context => {
  for (const panel of ['map', 'overview']) for (const stage of ['loading', 'timer-pending']) {
    const rows = [message(1), message(2), message(3)], scrolls = [], marked = [];
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: () => stage === 'loading' ? pending : Promise.resolve(rows),
      loadChatReadPosition: async () => rows[0].created_at,
      markChatRead: async (_client, _room, id) => marked.push(id) }, { ...roomProps, conversation: { ...conversation, groupPostId: 'post-1' } });
    context.after(() => harness.cleanup()); await harness.settle();
    if (panel === 'map') harness.nodes().find(node => node.props?.analyticsId === 'chat.open-map').props.onPress();
    else harness.nodes().find(node => node.type === 'MeetupRoomSummary').props.onOpen();
    await harness.settle();
    if (stage === 'loading') { finish(rows); await harness.settle(); }
    const list = () => harness.nodes().find(node => node.type === 'FlatList');
    list().props.ref.current = { scrollToIndex: ({ index }) => scrolls.push(index), scrollToEnd: () => scrolls.push('end') };
    await harness.timers();
    list().props.onViewableItemsChanged({ viewableItems: [{ item: rows[2] }] });
    assert.deepEqual(scrolls, []); assert.deepEqual(marked, []);
    harness.nodes().find(node => node.type === (panel === 'map' ? 'MapScreen' : 'MeetupChatOverview')).props.onClose(); await harness.settle(); await harness.timers();
    assert.deepEqual(scrolls, [1], stage);
    harness.rerender(); await harness.timers(); assert.deepEqual(scrolls, [1], 'initial unread positioning runs once');
  }
});

test('report then block stops when its sheet, account, profile or target changes', async () => {
  for (const change of ['none', 'unmount', 'account', 'identity', 'dismiss', 'target', 'hidden', 'stale-error']) {
    const calls = [], alerts = [];
    let finish, fail;
    const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const data = {
      businessIdentity: { id: 'business', name: '업체' }, reducedMotion: true,
      native: { Animated: { Value: class {}, View: 'AnimatedView' }, Easing: {}, Alert: { alert: (...args) => alerts.push(args) } },
      businessChat: {
        reportBusinessChatMessage: async () => { calls.push('report'); await pending; },
        blockBusinessConversation: async () => { calls.push('block'); },
      },
    };
    const props = { visible: true, targetType: 'message', targetId: 'message', reportedBusinessId: 'other',
      businessConversation: { id: 'room', kind: 'business', selfIdentity: { kind: 'business', id: 'business' } }, onClose: () => calls.push('close') };
    const harness = mount('../src/components/report-sheet.tsx', 'ReportSheet', data, props);
    const press = id => harness.nodes().find(node => node.props?.analyticsId === `components_report-sheet.pressable.${id}`).props.onPress();
    press(3); await harness.settle(); press(4); await harness.settle(); press(5);
    assert.deepEqual(calls, ['report']);
    if (change === 'account') { harness.auth.me.id = 'another-operator'; harness.rerender(); }
    if (change === 'identity') data.businessIdentity = { id: 'other-business', name: '다른 업체' };
    if (change === 'dismiss') press(2);
    if (change === 'target') { props.targetId = 'another-message'; harness.rerender(); }
    if (change === 'hidden') { props.visible = false; harness.rerender(); }
    if (change === 'unmount' || change === 'stale-error') harness.cleanup();
    if (change === 'stale-error') fail(new Error('late failure')); else finish();
    await harness.settle();
    assert.deepEqual(calls, change === 'none' ? ['report', 'block', 'close'] : change === 'dismiss' ? ['report', 'close'] : ['report'], change);
    assert.equal(alerts.length, change === 'none' ? 1 : 0, change);
    harness.cleanup();
  }
});

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

test('a photo bundle retries interrupted uploads and an uncertain send as one ordered message', async context => {
  for (const failureStage of ['upload', 'send']) {
    const uploads = [], sends = [], removed = [], productEvents = []; let failed = false, pickerOptions;
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
      removed, productEvents, telemetryError: new Error('analytics offline'), loadConversationMessages: async () => [], loadConversationMessagesByIds: async () => [],
      imagePicker: { launchImageLibraryAsync: async options => {
        pickerOptions = options;
        return { canceled: false, assets: ['one', 'two'].map(uri => ({ uri, mimeType: 'image/jpeg' })) };
      } },
      preparePostImage: async asset => ({ uri: asset.uri, base64: asset.uri, bytes: 100, width: 100, height: 100, mimeType: 'image/webp' }),
      uploadChatImage: async (_client, _user, _room, base64) => {
        uploads.push(base64);
        if (failureStage === 'upload' && base64 === 'two' && !failed) { failed = true; throw new Error('offline'); }
        return `${base64}-path`;
      },
      sendChatAttachment: async (_client, room, attachment, parent) => {
        sends.push({ room, paths: Array.from(attachment.imagePaths ?? []), id: attachment.clientId, parent });
        if (failureStage === 'send' && !failed) { failed = true; throw new Error('lost success response'); }
        return 'album-id';
      },
    }, { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
    context.after(() => harness.cleanup()); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
    assert.equal(pickerOptions.allowsMultipleSelection, true); assert.equal(pickerOptions.orderedSelection, true); assert.equal(pickerOptions.selectionLimit, 20);
    const send = () => harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send');
    send().props.onPress(); await harness.settle();
    assert.deepEqual(productEvents, failureStage === 'upload' ? [['record_product_event', {
      p_kind: 'photo_upload_error', p_target_id: null, p_city_id: null, p_platform: 'ios',
    }]] : [], 'only a failed upload counts; an uncertain send has no upload error');
    assert.deepEqual(uploads, ['one', 'two']); assert.equal(harness.messages().length, 0);
    assert.equal(harness.nodes().filter(node => node.props?.analyticsId === 'chat.photo.preview').length, 2);
    assert.deepEqual(removed, [], 'an uncertain send must never delete potentially committed images');
    send().props.onPress(); await harness.settle();
    assert.deepEqual(uploads, failureStage === 'send' ? ['one', 'two'] : ['one', 'two', 'two']);
    assert.deepEqual(sends.at(-1).paths, ['one-path', 'two-path']);
    assert.match(sends.at(-1).id, /^[0-9a-f-]{36}$/i);
    if (failureStage === 'send') assert.deepEqual(sends[0], sends[1]);
    assert.equal(harness.messages().length, 1);
    assert.deepEqual(Array.from(harness.messages()[0].image_paths), ['one-path', 'two-path']);
    assert.equal(send(), undefined);
  }
});

test('a late upload failure after logout, account switch or unmount cannot report for another account', async context => {
  for (const change of ['logout', 'account', 'unmount']) {
    const productEvents = []; let reject;
    const harness = room({ productEvents, loadConversationMessages: async () => [],
      imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'private-path', mimeType: 'image/jpeg' }] }) },
      preparePostImage: async asset => ({ uri: asset.uri, base64: 'private-image', mimeType: 'image/webp' }),
      uploadChatImage: () => new Promise((_resolve, no) => { reject = no; }),
    }); context.after(() => harness.cleanup()); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send').props.onPress(); await harness.settle();
    if (change === 'logout') harness.auth.isAuthed = false;
    else if (change === 'account') harness.auth.me = { ...harness.auth.me, id: 'another-member' };
    else harness.cleanup();
    if (change !== 'unmount') { harness.rerender(); await harness.settle(); }
    reject(new Error('private image/path')); await harness.settle(); assert.deepEqual(productEvents, [], change);
  }
});

test('photo preparation, upload and server confirmation expose real progress and unlock after failure', async context => {
  const preparation = [], uploads = [], confirmations = [];
  const harness = room({ loadConversationMessages: async () => [], loadConversationMessagesByIds: async () => [],
    imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: ['one', 'two'].map(uri => ({ uri, mimeType: 'image/png' })) }) },
    preparePostImage: asset => new Promise(resolve => preparation.push(() => resolve({ uri: asset.uri, base64: asset.uri, mimeType: 'image/webp' }))),
    uploadChatImage: () => new Promise(resolve => uploads.push(resolve)),
    sendChatAttachment: () => new Promise((resolve, reject) => confirmations.push({ resolve, reject })),
  });
  context.after(() => harness.cleanup()); await harness.settle();
  const status = () => harness.nodes().find(node => node.props?.testID === 'chat-photo-progress');
  const send = () => harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send');
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
  assert.equal(status()?.props.accessibilityLabel, '사진 준비 중 0/2');
  preparation[0](); await harness.settle(); assert.equal(status()?.props.accessibilityLabel, '사진 준비 중 1/2');
  preparation[1](); await harness.settle(); assert.equal(status(), undefined);
  send().props.onPress(); await harness.settle();
  assert.equal(status()?.props.accessibilityLabel, '사진 올리는 중 0/2'); assert.equal(send().props.disabled, true);
  uploads[0]('one-path'); await harness.settle(); assert.equal(status()?.props.accessibilityLabel, '사진 올리는 중 1/2');
  uploads[1]('two-path'); await harness.settle(); assert.equal(status()?.props.accessibilityLabel, '전송 확인 중');
  assert.equal(status().props.accessibilityRole, 'progressbar');
  confirmations[0].reject(new Error('connection lost')); await harness.settle();
  assert.equal(status(), undefined); assert.equal(send().props.disabled, false);
  send().props.onPress(); await harness.settle();
  assert.equal(status()?.props.accessibilityLabel, '전송 확인 중'); assert.equal(uploads.length, 2, 'retry reuses completed uploads');
  confirmations[1].resolve('album-id'); await harness.settle();
  assert.equal(status(), undefined); assert.equal(send(), undefined); assert.equal(harness.messages().length, 1);
});

test('the photo-library handoff has an immediate indeterminate loader and cancellation clears it', async context => {
  let finishPicker;
  const harness = room({ loadConversationMessages: async () => [],
    imagePicker: { launchImageLibraryAsync: () => new Promise(resolve => { finishPicker = resolve; }) },
  });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
  const progress = harness.nodes().find(node => node.props?.testID === 'chat-photo-progress');
  assert.equal(progress?.props.accessibilityLabel, '사진 불러오는 중');
  assert.equal(progress.props.accessibilityValue, undefined);
  finishPicker({ canceled: true, assets: null }); await harness.settle();
  assert.equal(harness.nodes().find(node => node.props?.testID === 'chat-photo-progress'), undefined);
  assert.equal(harness.messages().length, 0);
});

test('a replacement photo selection cannot race the previous draft send or clear the new draft', async context => {
  let selection = 0, finishPreparation; const uploaded = [];
  const prepared = uri => ({ uri, base64: uri, mimeType: 'image/webp' });
  const harness = room({ loadConversationMessages: async () => [],
    imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: ++selection === 1 ? 'old' : 'new', mimeType: 'image/png' }] }) },
    preparePostImage: async asset => asset.uri === 'old' ? prepared('old') : new Promise(resolve => { finishPreparation = () => resolve(prepared('new')); }),
    uploadChatImage: async (_client, _user, _room, image) => { uploaded.push(image); return `${image}-path`; },
    sendChatAttachment: async () => 'sent', loadConversationMessagesByIds: async () => [],
  });
  context.after(() => harness.cleanup()); await harness.settle();
  const pick = async () => {
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
  };
  await pick(); const staleSend = harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send');
  await pick();
  assert.equal(harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send').props.disabled, true);
  staleSend.props.onPress(); await harness.settle(); assert.deepEqual(uploaded, [], 'the synchronous processing guard also protects a previously queued press');
  finishPreparation(); await harness.settle();
  assert.equal(harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.preview').props.children.props.source.uri, 'new');
  assert.equal(harness.messages().length, 0);
});

test('photo retries honor a canceled reply before sending and lock its binding after an uncertain RPC', async context => {
  for (const stage of ['upload', 'send']) {
    const parent = { ...message(1), id: 'parent' }; const sent = []; let failed = false;
    const harness = room({ loadConversationMessages: async () => [parent], loadConversationMessagesByIds: async () => [],
      imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'photo', mimeType: 'image/png' }] }) },
      preparePostImage: async asset => ({ uri: asset.uri, base64: asset.uri, mimeType: 'image/webp' }),
      uploadChatImage: async () => { if (stage === 'upload' && !failed) { failed = true; throw new Error('upload failed'); } return 'path'; },
      sendChatAttachment: async (_client, _room, attachment, reply) => { sent.push({ id: attachment.clientId, reply }); if (stage === 'send' && !failed) { failed = true; throw new Error('lost response'); } return 'album'; },
    });
    context.after(() => harness.cleanup()); await harness.settle();
    const row = harness.nodes().find(node => node.type === 'FlatList').props.renderItem({ item: parent, index: 0 });
    const walk = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(walk)];
    walk(row).find(node => node.props?.analyticsId === 'components_chat-room.pressable.heart').props.onMenu(parent, { measureInWindow: callback => callback(48, 300, 200, 44) }); await harness.settle();
    harness.nodes().find(node => node.props?.accessibilityLabel === '답장').props.onPress(); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
    const send = () => harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send');
    send().props.onPress(); await harness.settle();
    const cancelReply = harness.nodes().find(node => node.props?.label === '답장 취소');
    assert.equal(cancelReply.props.disabled, stage === 'send');
    cancelReply.props.onPress(); await harness.settle();
    send().props.onPress(); await harness.settle();
    assert.equal(sent.at(-1).reply, stage === 'send' ? 'parent' : undefined);
    if (stage === 'send') assert.deepEqual(sent[0], sent[1]);
  }
});

test('selected photo preview can enlarge and remove one image without sending or discarding the draft', async context => {
  const harness = room({ loadConversationMessages: async () => [],
    imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: ['one', 'two'].map(uri => ({ uri, mimeType: 'image/jpeg' })) }) },
    preparePostImage: async asset => ({ uri: asset.uri, base64: asset.uri, bytes: 100, width: 100, height: 100, mimeType: 'image/webp' }),
  });
  context.after(() => harness.cleanup()); await harness.settle();
  const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
  input().props.onChangeText('보내지 않은 원고');
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
  const preview = harness.nodes().filter(node => node.props?.analyticsId === 'chat.photo.preview');
  assert.equal(preview.length, 2); preview[0].props.onPress(); await harness.settle();
  assert.equal(harness.nodes().find(node => node.props?.accessibilityLabel === '대화 사진 크게 보기').props.source.uri, 'one');
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.photo-close').props.onPress(); await harness.settle();
  harness.nodes().filter(node => node.props?.analyticsId === 'chat.photo.remove')[0].props.onPress(); await harness.settle();
  assert.equal(harness.nodes().filter(node => node.props?.analyticsId === 'chat.photo.preview').length, 1);
  assert.equal(input().props.value, '보내지 않은 원고'); assert.equal(harness.messages().length, 0);
});

test('one album bubble opens the selected tile, pages in order and closes when the message is withdrawn', async context => {
  const row = { ...message(1), kind: 'image', image_path: 'p0', image_paths: Array.from({ length: 20 }, (_, i) => `p${i}`),
    imageUrls: Array.from({ length: 20 }, (_, i) => `photo:${i}`) };
  let removed = false;
  const harness = room({ loadConversationMessages: async () => [removed ? { ...row, kind: 'text', deleted_at: 'now', image_paths: [], imageUrls: [] } : row] });
  context.after(() => harness.cleanup()); await harness.settle();
  const all = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(v => Array.isArray(v) ? v.flatMap(all) : all(v))];
  const tree = harness.nodes().find(node => node.type === 'FlatList').props.renderItem({ item: row, index: 0 });
  const tiles = all(tree).filter(node => node.props?.analyticsId === 'chat.album.photo');
  assert.equal(tiles.length, 9);
  tiles[7].props.onPress(); await harness.settle();
  const viewer = () => harness.nodes().find(node => node.props?.testID === 'chat-photo-pages');
  assert.equal(viewer().props.contentOffset.x, 7 * 390);
  harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.next').props.onPress(); await harness.settle();
  assert.ok(harness.nodes().some(node => node.props?.children === '9/20'));
  assert.equal(viewer().props.contentOffset.x, 7 * 390, 'the native initial offset stays stable while scrollTo moves between pages');
  viewer().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 10 * 390 } } }); await harness.settle();
  assert.ok(harness.nodes().some(node => node.props?.children === '11/20'));
  removed = true; harness.foreground(); await harness.settle();
  assert.equal(viewer(), undefined, 'deleted or hidden messages cannot leave a private album viewer open');
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
    getCurrentPositionAsync: async () => { positions++; return { timestamp: Date.now(), coords: { latitude: 49.2, longitude: -123.1, accuracy: 15 } }; },
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

test('key-free MapLibre search does not use GPS or send until confirmation', async context => {
  let permissions = 0; const sent = [];
  const harness = mount('../src/components/chat-location-picker.tsx', 'ChatLocationPicker', { location: {
    requestForegroundPermissionsAsync: async () => { permissions++; return { granted: false }; },
    geocodeAsync: async query => { assert.equal(query, 'library'); return [{ latitude: 49.28, longitude: -123.12 }]; },
  } }, { sending: false, onClose() {}, onSend: async point => { sent.push(point); } });
  context.after(() => harness.cleanup()); await harness.settle();
  const map = () => harness.nodes().find(node => node.type === 'PostPinMap');
  const action = label => harness.nodes().find(node => node.props?.label === label || node.props?.accessibilityLabel === label);
  assert.ok(map(), 'the map renders without a Google API key');
  const modal = harness.nodes().find(node => node.type === 'Modal');
  assert.equal(modal.props.transparent, true, 'sharing is a bounded sheet, not a fullscreen modal');
  assert.ok(harness.nodes().some(node => node.type === 'ScrollView'), 'small screens and enlarged text can scroll controls');
  map().props.onReadyChange(true); await harness.settle();
  harness.nodes().find(node => node.type === 'TextInput').props.onChangeText('library'); await harness.settle();
  action('검색').props.onPress(); await harness.settle(); assert.equal(map().props.pin.latitude, 49.28);
  assert.equal(sent.length, 0); assert.equal(permissions, 0);
  map().props.onSelect({ latitude: 999, longitude: 0 }, 'bad'); await harness.settle();
  assert.equal(map().props.pin.latitude, 49.28, 'invalid bridge coordinates do not replace the selected point');
  map().props.onSelect({ latitude: 49.28, longitude: -123.12 }, 'Library'); await harness.settle();
  action('이 위치 공유하기').props.onPress(); await harness.settle(); assert.equal(sent[0].label, 'Library');
});

test('a late GPS fix cannot overwrite a manually selected chat location', async context => {
  let finish; const sent = [];
  const harness = mount('../src/components/chat-location-picker.tsx', 'ChatLocationPicker', { location: {
    requestForegroundPermissionsAsync: async () => ({ granted: true }),
    getCurrentPositionAsync: () => new Promise(resolve => { finish = resolve; }),
  } }, { sending: false, onClose() {}, onSend: async point => sent.push(point) });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.nodes().find(node => node.props?.label === '현재 위치 선택').props.onPress(); await harness.settle();
  harness.nodes().find(node => node.type === 'PostPinMap').props.onSelect({ latitude: 50, longitude: -120 }, '직접 고른 곳'); await harness.settle();
  finish({ timestamp: Date.now(), coords: { latitude: 49, longitude: -123, accuracy: 10 } }); await harness.settle();
  harness.nodes().find(node => node.props?.label === '이 위치 공유하기').props.onPress(); await harness.settle();
  assert.equal(sent[0].latitude, 50); assert.equal(sent[0].label, '직접 고른 곳');
});

test('web location search explains the native geocoder limit and preserves manual selection', async context => {
  const harness = mount('../src/components/chat-location-picker.tsx', 'ChatLocationPicker', { platform: 'web', location: {
    geocodeAsync: async () => { throw new Error('web geocoder must not be called'); },
  } }, { sending: false, onClose() {}, onSend: async () => {} });
  context.after(() => harness.cleanup()); await harness.settle();
  const map = () => harness.nodes().find(node => node.type === 'PostPinMap');
  map().props.onReadyChange(true); map().props.onSelect({ latitude: 49, longitude: -123 }, '직접 고른 곳'); await harness.settle();
  harness.nodes().find(node => node.type === 'TextInput').props.onChangeText('주소'); await harness.settle();
  harness.nodes().find(node => node.props?.label === '검색').props.onPress(); await harness.settle();
  const alert = harness.nodes().find(node => node.props?.accessibilityRole === 'alert');
  assert.match(alert.props.children, /주소 검색은 앱에서 지원/);
  assert.equal(map().props.pin.label, '직접 고른 곳');
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
    const footer = list.props.ListFooterComponent;
    const footerParts = Array.isArray(footer.props.children) ? footer.props.children : [footer];
    assert.ok(footerParts.some(node => node?.props?.style?.height === 24), 'last message time has room above the composer');
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

const businessId = 'c1820000-0000-4000-8000-000000000001';
const businessRoom = { ...conversation, kind: 'business', title: '이웃', requesterId: null,
  selfIdentity: { kind: 'business', id: businessId, name: '공개 비즈니스', avatarUri: null },
  otherIdentity: { kind: 'user', id: 'neighbor', name: '이웃', avatarUri: null },
  otherUser: { id: 'neighbor', nickname: '이웃', verificationLevel: 0 } };
const businessPage = items => ({ conversation: businessRoom, messages: items, cursor: null, readAt: null });

test('business messages use only scoped safe reads and retry a text send with its original idempotency key', async context => {
  const calls = [];
  const data = { businessIdentity: { id: businessId, name: '공개 비즈니스' },
    loadConversationMessages: async () => { throw new Error('personal history must not be read'); },
    loadMessageReactions: async () => { throw new Error('raw reactions must not be read'); },
    businessChat: { loadBusinessChatMessages: async (_client, pinned) => { assert.equal(pinned.selfIdentity.id, businessId); return businessPage([]); },
      sendBusinessChatMessage: async (_client, pinned, input) => { calls.push([pinned.selfIdentity.id, input]); if (calls.length === 1) throw new Error('uncertain'); return 'saved-business-message'; } } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', data, { ...roomProps, conversation: businessRoom });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.equal(harness.nodes().some(node => node.type === 'MannerReviewButton'), false);
  assert.equal(suggestionButtons(harness).length, 0);
  const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
  input().props.onChangeText('채용 문의 답변'); await harness.settle();
  input().props.onSubmitEditing(); await harness.settle();
  assert.equal(input().props.value, '채용 문의 답변');
  input().props.onSubmitEditing(); await harness.settle();
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal(harness.messages()[0].sender_id, businessId);
  assert.equal(harness.messages()[0].sender_nickname, '공개 비즈니스');
  assert.equal(harness.messages()[0].is_mine, true);
  data.businessIdentity = null; harness.rerender(); await harness.settle();
  assert.equal(harness.nodes().length, 0, 'switching to personal hides the pinned business room immediately');
});

test('business read revocation clears visible messages and prevents composer access without falling back', async context => {
  let allowed = true, personalReads = 0;
  const own = { ...message(1), sender_id: businessId, sender_kind: 'business', sender_nickname: '공개 비즈니스', is_mine: true };
  const data = { businessIdentity: { id: businessId, name: '공개 비즈니스' },
    loadConversationMessages: async () => { personalReads++; return []; },
    businessChat: { loadBusinessChatMessages: async () => { if (!allowed) throw new Error('MERCHANT_ACCESS_REQUIRED'); return businessPage([own]); } } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', data, { ...roomProps, conversation: businessRoom });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.equal(harness.messages().length, 1);
  allowed = false; harness.foreground(); await harness.settle();
  assert.equal(harness.messages().length, 0);
  assert.equal(harness.nodes().some(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder), false);
  assert.equal(personalReads, 0);
  assert.ok(harness.nodes().some(node => node.props?.label === '대화 접근 다시 확인'));
});

test('business inbox changes cannot accept an old personal snapshot or load personal meetup requests', async context => {
  let finishPersonal; const calls = [], requests = [];
  const data = { loadPendingMeetupRequests: async (_client, user) => { requests.push(user); return []; },
    loadConversations: async (_client, _user, _filter, _cursor, _id, asBusiness) => {
      calls.push(asBusiness);
      if (!asBusiness) return new Promise(resolve => { finishPersonal = resolve; });
      return { conversations: [businessRoom], selectedConversation: null, pendingCount: 0, cursor: null };
    } };
  const harness = mount('../src/app/(tabs)/chat.tsx', 'default', data);
  context.after(() => harness.cleanup()); await harness.settle();
  data.businessIdentity = { id: businessId, name: '공개 비즈니스' }; harness.rerender(); await harness.settle();
  assert.equal(calls.at(-1), businessId); assert.equal(requests.length, 1);
  finishPersonal({ conversations: [conversation], selectedConversation: null, pendingCount: 0, cursor: null }); await harness.settle();
  assert.equal(harness.messages()[0].kind, 'business');
  assert.ok(!harness.nodes().some(node => node.props?.accessibilityRole === 'tab' && node.props.children?.props?.children === t.chat.groups));
});

test('a business notification validates current connections before opening that business inbox', async context => {
  const scopes = [];
  const data = { connections: [{ id: businessId, name: '공개 비즈니스', role: 'operator' }],
    loadPendingMeetupRequests: async () => [],
    loadConversations: async (_client, _user, _filter, _cursor, selected, asBusiness) => {
      scopes.push(asBusiness); assert.equal(selected, 'room');
      return { conversations: [businessRoom], selectedConversation: businessRoom, pendingCount: 0, cursor: null };
    } };
  const harness = mount('../src/app/(tabs)/chat.tsx', 'default', data, {}, { conversationId: 'room', businessId });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.equal(data.businessIdentity.id, businessId);
  assert.deepEqual(scopes, [businessId]);
  assert.ok(harness.nodes().some(node => node.type === 'ChatRoom' && node.props.conversation.selfIdentity.id === businessId));
});

test('legacy personal deep links clear business mode, while revoked business links never load a fallback inbox', async context => {
  const scopes = [];
  const data = { businessIdentity: { id: businessId, name: '공개 비즈니스' },
    loadPendingMeetupRequests: async () => [],
    loadConversations: async (_client, _user, _filter, _cursor, _id, asBusiness) => { scopes.push(asBusiness); return { conversations: [], selectedConversation: null, pendingCount: 0, cursor: null }; } };
  const personal = mount('../src/app/(tabs)/chat.tsx', 'default', data, {}, { conversationId: 'room' });
  context.after(() => personal.cleanup()); await personal.settle();
  assert.equal(data.businessIdentity, null); assert.deepEqual(scopes, [null]);
  let reads = 0;
  const revoked = mount('../src/app/(tabs)/chat.tsx', 'default', { connections: [], loadConversations: async () => { reads++; throw new Error('unexpected'); } }, {}, { conversationId: 'room', businessId });
  context.after(() => revoked.cleanup()); await revoked.settle();
  assert.equal(reads, 0);
  assert.ok(revoked.nodes().some(node => node.props?.accessibilityRole === 'alert'));
});

test('business notifications use actual connected admin scope without an admin-wide lookup', async context => {
  const lookups = [], reads = [];
  const data = {
    loadMyMerchantConnections: async (userId, chatOnly) => { lookups.push(chatOnly); return { user_id: userId, merchants: [{ id: businessId, name: '공개 비즈니스', role: chatOnly ? 'owner' : 'admin' }] }; },
    loadPendingMeetupRequests: async () => [],
    loadConversations: async (_client, _user, _filter, _cursor, _selected, asBusiness) => { reads.push(asBusiness); return { conversations: [], selectedConversation: null, pendingCount: 0, cursor: null }; },
  };
  const harness = mount('../src/app/(tabs)/chat.tsx', 'default', data, {}, { conversationId: 'room', businessId });
  harness.auth.isAdmin = true; harness.rerender(); context.after(() => harness.cleanup()); await harness.settle();
  assert.equal(data.businessIdentity?.id, businessId);
  assert.ok(lookups.length > 0 && lookups.every(Boolean));
  assert.deepEqual(reads, [businessId]);
  assert.ok(!harness.nodes().some(node => node.props?.accessibilityRole === 'alert'));
});

test('business photo uploads use the public business prefix and keep the pinned identity for send and reads', async context => {
  const calls = [];
  const data = { businessIdentity: { id: businessId, name: '공개 비즈니스' },
    imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'local-photo', mimeType: 'image/jpeg' }] }) },
    preparePostImage: async () => ({ uri: 'local-photo', base64: 'fixture-only' }),
    uploadChatImage: async (_client, publicId, roomId) => { calls.push(['upload', publicId, roomId]); return `${publicId}/${roomId}_test.webp`; },
    businessChat: { loadBusinessChatMessages: async () => businessPage([]),
      sendBusinessChatMessage: async (_client, pinned, input) => { calls.push(['send', pinned.selfIdentity.id, input]); return 'business-photo'; },
      markBusinessChatRead: async (_client, pinned, id) => { calls.push(['read', pinned.selfIdentity.id, id]); } } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', data, { ...roomProps, conversation: businessRoom });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.add-attachment').props.onPress(); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'components_chat-room.attachment-photo').props.onPress(); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'chat.photo.send').props.onPress(); await harness.settle();
  assert.deepEqual(calls[0], ['upload', businessId, 'room']);
  assert.equal(calls[1][0], 'send'); assert.equal(calls[1][1], businessId);
  assert.equal(calls[1][2].kind, 'image'); assert.equal(calls[1][2].imagePaths[0], `${businessId}/room_test.webp`);
  const saved = harness.messages()[0]; assert.equal(saved.sender_id, businessId); assert.equal(saved.is_mine, true);
  harness.nodes().find(node => node.type === 'FlatList').props.onViewableItemsChanged({ viewableItems: [{ item: saved }] }); await harness.settle();
  assert.deepEqual(calls.at(-1), ['read', businessId, 'business-photo']);
});

test('an incoming business sender opens its public company profile and reports without a linked user ID', async context => {
  const incoming = { ...businessRoom, selfIdentity: { kind: 'user', id: 'me', name: '나', avatarUri: null },
    otherIdentity: { kind: 'business', id: businessId, name: '공개 비즈니스', avatarUri: 'https://example.test/public-logo' }, otherUser: { id: businessId, nickname: '공개 비즈니스', verificationLevel: 2 } };
  const row = { ...message(1), sender_id: businessId, sender_kind: 'business', sender_nickname: '공개 비즈니스', is_mine: false };
  const data = { routes: [], closed: 0, businessChat: { loadBusinessChatMessages: async () => ({ ...businessPage([row]), conversation: incoming }) } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', data, { ...roomProps, conversation: incoming, onClose() { data.closed++; } });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'chat.peer-profile').props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(data.routes)), [{ pathname: '/company/[id]', params: { id: businessId } }]);
  assert.equal(data.closed, 1, 'dismiss the native chat sheet so the company route is visible');
  const list = harness.nodes().find(node => node.type === 'FlatList');
  const rendered = list.props.renderItem({ item: harness.messages()[0], index: 0 });
  const collect = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(collect)];
  collect(rendered).find(node => node.props?.label === t.report.short).props.onPress(); await harness.settle();
  const sheet = harness.nodes().find(node => node.type === 'ReportSheet');
  assert.equal(sheet.props.reportedBusinessId, businessId); assert.equal(sheet.props.reportedUserId, undefined);
  assert.equal(sheet.props.businessConversation.id, incoming.id);
});

test('a queued composer submit cannot send under an identity changed before React renders', async context => {
  let sends = 0;
  const data = { businessIdentity: { id: businessId, name: '공개 비즈니스' }, businessChat: {
    loadBusinessChatMessages: async () => businessPage([]), sendBusinessChatMessage: async () => { sends++; return 'late'; } } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', data, { ...roomProps, conversation: businessRoom });
  context.after(() => harness.cleanup()); await harness.settle();
  let input = harness.nodes().find(node => node.type === 'TextInput'); input.props.onChangeText('업무 답변'); await harness.settle();
  input = harness.nodes().find(node => node.type === 'TextInput');
  data.businessIdentity = null; input.props.onSubmitEditing(); await harness.settle();
  assert.equal(sends, 0);
});

test('conversation search narrows the loaded messages and clears back to all of them', async context => {
  const rows = [message(1), message(2), message(3)];
  const harness = room({ loadConversationMessages: async () => rows });
  context.after(() => harness.cleanup()); await harness.settle();
  const list = () => harness.nodes().find(node => node.type === 'FlatList');
  assert.equal(list().props.data.length, 3);
  harness.nodes().find(node => node.props?.analyticsId === 'chat.search-toggle').props.onPress(); await harness.settle();
  const field = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '대화 내용 검색');
  field().props.onChangeText('message 2'); await harness.settle();
  assert.deepEqual(list().props.data.map(row => row.id), ['m002']);
  field().props.onChangeText(''); await harness.settle();
  assert.equal(list().props.data.length, 3, 'an empty query shows the room again');
  harness.nodes().find(node => node.props?.analyticsId === 'chat.search-close').props.onPress(); await harness.settle();
  assert.equal(harness.nodes().some(node => node.type === 'TextInput' && node.props?.accessibilityLabel === '대화 내용 검색'), false, 'closing hides the field');
});

test('conversation search no matches shows result copy while preserving loaded direct messages', async context => {
  for (const status of ['active', 'ended']) {
    const rows = [message(1)];
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
      loadConversationMessages: async () => rows,
    }, { ...roomProps, conversation: { ...conversation, kind: 'direct', status } });
    context.after(() => harness.cleanup()); await harness.settle();
    const list = () => harness.nodes().find(node => node.type === 'FlatList');
    assert.deepEqual(list().props.data.map(row => row.id), ['m001']);
    harness.nodes().find(node => node.props?.analyticsId === 'chat.search-toggle').props.onPress(); await harness.settle();
    const field = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '대화 내용 검색');
    const query = '  GLING_QA_NO_MATCH_20261023  ';
    field().props.onChangeText(query); await harness.settle();
    assert.equal(list().props.data.length, 0);
    assert.equal(list().props.ListEmptyComponent.props.children, t.search.none(query.trim()), `${status}: an unmatched search is not an empty or ended room`);
    assert.equal(field().props.value, query, 'displaying the result does not rewrite the input');
    field().props.onChangeText(''); await harness.settle();
    assert.deepEqual(list().props.data.map(row => row.id), ['m001'], 'clearing search restores the loaded message');
    harness.nodes().find(node => node.props?.analyticsId === 'chat.search-close').props.onPress(); await harness.settle();
    assert.deepEqual(list().props.data.map(row => row.id), ['m001']);
  }
});

test('empty conversations retain active and ended guidance without a search query', async context => {
  for (const status of ['active', 'ended']) {
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
      loadConversationMessages: async () => [],
    }, { ...roomProps, conversation: { ...conversation, kind: 'direct', status } });
    context.after(() => harness.cleanup()); await harness.settle();
    const list = () => harness.nodes().find(node => node.type === 'FlatList');
    const expected = status === 'active' ? t.chat.newConversation : t.chat.endedBody;
    assert.equal(list().props.data.length, 0);
    assert.equal(list().props.ListEmptyComponent.props.children, expected);
    harness.nodes().find(node => node.props?.analyticsId === 'chat.search-toggle').props.onPress(); await harness.settle();
    const field = harness.nodes().find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '대화 내용 검색');
    field.props.onChangeText('   '); await harness.settle();
    assert.equal(list().props.data.length, 0);
    assert.equal(list().props.ListEmptyComponent.props.children, expected, `${status}: whitespace is not an actual search`);
    harness.nodes().find(node => node.props?.analyticsId === 'chat.search-close').props.onPress(); await harness.settle();
    assert.equal(list().props.ListEmptyComponent.props.children, expected);
  }
});

test('a group room shows the meetup summary and only the host gets the manage sheet', async context => {
  const post = { id: 'post-1', title: '한강 노을 러닝', room: { id: 'room-1', title: '한강 노을 러닝', memberCount: 5, capacity: 8, verifiedOnly: false, eventKind: 'once', startsAt: '2026-10-24T09:30:00Z', timezone: 'Asia/Seoul' } };
  for (const isGroupHost of [true, false]) {
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
      loadConversationMessages: async () => [message(1)],
      '@/lib/feed-data': { loadPublicPost: async () => post },
    }, { ...roomProps, conversation: { ...conversation, kind: 'group', groupPostId: 'post-1', isGroupHost } });
    context.after(() => harness.cleanup()); await harness.settle();
    const summary = harness.nodes().find(node => node.type === 'MeetupRoomSummary');
    assert.ok(summary, 'the meetup summary sits above the messages');
    const manage = summary.props.onManage;
    assert.equal(typeof manage === 'function', isGroupHost, isGroupHost ? 'the host can open management from the meetup card' : 'members cannot');
    if (!isGroupHost) continue;
    manage(); await harness.settle();
    const sheet = harness.nodes().find(node => node.type === 'MeetupManageSheet');
    assert.ok(sheet?.props.visible, 'pressing manage opens the sheet');
    const actions = sheet.props.actions.map(action => action.key);
    assert.equal(actions.join(','), 'location,requests,share,end');
  }
});

const inboxModal = harness => harness.nodes().find(node => node.type === 'Modal');
const inboxRoom = harness => harness.nodes().find(node => node.type === 'ChatRoom');
const openInboxRoom = (harness, item) => harness.nodes().find(node => node.type === 'FlatList').props.renderItem({ item, index: 0 }).props.onPress();
function closableInbox(extra = {}, params = {}) {
  const rows = [conversation, { ...conversation, id: 'second', title: '다른 모임' }];
  const data = { loadPendingMeetupRequests: async () => [], loadConversations: async () => ({ conversations: rows, selectedConversation: null, pendingCount: 0, cursor: null }), ...extra };
  return { harness: mount('../src/app/(tabs)/chat.tsx', 'default', data, {}, params), data, rows };
}

test('closing a chat keeps its content through native dismissal without a second transition', async context => {
  for (const reducedMotion of [false, true]) {
    let keyboardDismisses = 0;
    const { harness, rows } = closableInbox({ reducedMotion, native: { Keyboard: { dismiss() { keyboardDismisses++; } } } });
    context.after(() => harness.cleanup()); await harness.settle();
    openInboxRoom(harness, rows[0]); await harness.settle();
    const child = inboxRoom(harness), close = child.props.onClose;
    close(); close(); await harness.settle();
    assert.equal(inboxModal(harness).props.visible, false);
    assert.equal(inboxModal(harness).props.animationType, reducedMotion ? 'none' : 'slide');
    assert.equal(inboxRoom(harness)?.key, child.key, 'keep the same room instance while the native sheet exits');
    assert.equal(keyboardDismisses, 1, 'rapid repeated close dismisses the keyboard once');
    inboxModal(harness).props.onDismiss(); await harness.settle();
    assert.equal(inboxRoom(harness), undefined, 'release content after native dismissal');
  }
});

test('a late close or dismissal from the previous presentation cannot close a newly opened chat', async context => {
  const { harness, rows } = closableInbox(); context.after(() => harness.cleanup()); await harness.settle();
  openInboxRoom(harness, rows[0]); await harness.settle();
  const oldClose = inboxRoom(harness).props.onClose;
  oldClose(); await harness.settle();
  const oldDismiss = inboxModal(harness).props.onDismiss;
  openInboxRoom(harness, rows[1]); await harness.settle();
  oldClose(); oldDismiss(); await harness.settle();
  assert.equal(inboxModal(harness).props.visible, true);
  assert.equal(inboxRoom(harness)?.props.conversation.id, 'second');
  inboxRoom(harness).props.onClose(); await harness.settle();
  inboxModal(harness).props.onDismiss(); await harness.settle();
  assert.equal(inboxRoom(harness), undefined);
});

test('retained closing content cannot cross an account, business identity or focus boundary', async context => {
  for (const boundary of ['account', 'identity', 'blur']) {
    const { harness, data, rows } = closableInbox(); context.after(() => harness.cleanup()); await harness.settle();
    openInboxRoom(harness, rows[0]); await harness.settle();
    inboxRoom(harness).props.onClose(); await harness.settle();
    if (boundary === 'account') harness.auth.me.id = 'other';
    if (boundary === 'identity') data.businessIdentity = { id: 'business', name: '비즈니스' };
    if (boundary === 'blur') data.focused = false;
    harness.rerender(); await harness.settle();
    assert.equal(inboxModal(harness).props.visible, false, boundary);
    assert.equal(inboxRoom(harness), undefined, boundary);
  }
});

test('meetup summary opens a nested overview and closing it restores the same draft and messages', async context => {
  let closes = 0, reads = 0; const routes = [], rows = [message(1)];
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { routes, loadConversationMessages: async () => { reads++; return rows; } },
    { ...roomProps, conversation: { ...conversation, groupPostId: 'post-1' }, onClose: () => closes++ });
  context.after(() => harness.cleanup()); await harness.settle();
  const input = () => harness.nodes().find(node => node.type === 'TextInput' && node.props.placeholder === t.chat.messagePlaceholder);
  input().props.onChangeText('보내지 않은 메모'); await harness.settle();
  const before = harness.messages(), beforeReads = reads;
  harness.nodes().find(node => node.type === 'MeetupRoomSummary').props.onOpen(); await harness.settle();
  const overview = harness.nodes().find(node => node.type === 'MeetupChatOverview');
  assert.ok(overview, 'open the in-chat status sheet, not the public post route');
  assert.equal(closes, 0); assert.deepEqual(routes, []);
  overview.props.onClose(); await harness.settle();
  assert.equal(input().props.value, '보내지 않은 메모');
  assert.deepEqual(harness.messages(), before); assert.equal(reads, beforeReads);
  assert.equal(harness.nodes().some(node => node.type === 'MeetupChatOverview'), false);
});

test('shared location preview uses the exact original coordinates and never asks for GPS permission', async context => {
  const calls = [];
  const harness = mount('../src/components/chat-room.tsx', 'ChatLocationMessage', {
    location: { reverseGeocodeAsync: async pin => { calls.push(pin); return [{ street: 'Austin Avenue', city: 'Coquitlam', region: 'BC' }]; },
      requestForegroundPermissionsAsync: async () => { throw new Error('must not request location access'); } },
  }, { latitude: 49.24991, longitude: -122.86145, label: '현재 위치' });
  context.after(() => harness.cleanup()); await harness.settle();
  const map = harness.nodes().find(node => node.type === 'PostPinMap');
  assert.equal(map?.props.preview, true);
  assert.equal(map?.props.pin.latitude, 49.24991); assert.equal(map?.props.pin.longitude, -122.86145);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ latitude: 49.24991, longitude: -122.86145 }]);
  assert.ok(harness.nodes().some(node => node.props?.children === 'Austin Avenue, Coquitlam, BC'));
});

const overviewPost = { id: 'post-1', cityId: 'vancouver', title: '맛집 탐방', body: '기존 멤버만 보는 모임 소개', authorId: 'host', room: { eventKind: 'group', memberCount: 5 } };
const overviewData = extra => ({ clock: { now: Date.parse('2026-10-23T12:00:00Z') }, loadPublicMeetupContext: async () => overviewPost,
  loadMeetupSessions: async () => ({ member: true, isHost: false, kind: 'group', sessions: [] }), ...extra });
const overviewProps = { postId: 'post-1', currentUserId: 'me', onClose() {} };
const session = (id, day) => ({ id, startsAt: `2026-10-${day}T14:00:00Z`, endsAt: `2026-10-${day}T16:00:00Z`, checkedIn: false, verified: false, claimStatus: 'none', members: [] });
const hasText = (harness, text) => harness.nodes().some(node => node.props?.children === text);

test('meetup overview sorts real upcoming sessions and separates introduction from existing attendance controls', async context => {
  let closes = 0;
  const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({
    loadMeetupSessions: async () => ({ member: true, isHost: false, kind: 'group', sessions: [session('later', '28'), session('past', '20'), session('next', '24')] }),
  }), { ...overviewProps, onClose() { closes++; } });
  context.after(() => harness.cleanup()); await harness.settle();
  const cards = harness.nodes().filter(node => node.props?.testID === 'meetup-upcoming-session');
  assert.deepEqual(cards.map(node => node.key), ['next', 'later']);
  assert.equal(hasText(harness, overviewPost.body), false, 'introduction is secondary');
  const intro = harness.nodes().find(node => node.props?.accessibilityLabel === '모임 소개');
  intro.props.onPress(); await harness.settle();
  assert.ok(harness.nodes().some(node => node.type === 'PostBody' && node.props.body === overviewPost.body));
  harness.nodes().find(node => node.props?.accessibilityLabel === '모임 현황으로 돌아가기').props.onPress(); await harness.settle();
  assert.equal(closes, 0);
  harness.nodes().find(node => node.props?.accessibilityLabel === '참석 확인').props.onPress(); await harness.settle();
  assert.equal(harness.nodes().find(node => node.type === 'MeetupReviews')?.props.attendanceOnly, true);
  harness.nodes().find(node => node.props?.accessibilityLabel === '모임 현황 닫기').props.onPress();
  await harness.settle();
  assert.equal(closes, 0, 'keep nested content through the native dismiss transition');
  harness.nodes().find(node => node.type === 'Modal').props.onDismiss();
  harness.nodes().find(node => node.type === 'Modal').props.onDismiss();
  assert.equal(closes, 1, 'native dismissal completes exactly once');
});

test('empty recurring schedules stay empty while the existing host scheduling action remains available', async context => {
  for (const isHost of [false, true]) {
    const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({
      loadMeetupSessions: async () => ({ member: true, isHost, kind: 'group', sessions: [] }),
    }), overviewProps);
    context.after(() => harness.cleanup()); await harness.settle();
    assert.ok(hasText(harness, '등록된 예정 일정이 없어요.'));
    assert.equal(harness.nodes().filter(node => node.props?.testID === 'meetup-upcoming-session').length, 0);
    assert.ok(harness.nodes().some(node => node.props?.accessibilityLabel === (isHost ? '일정·참석 관리' : '참석 확인')));
    assert.equal(harness.nodes().some(node => node.props?.children === '0명 참가 예정'), false);
  }
});

test('a late meetup overview response and retained introduction cannot cross an account or visibility boundary', async context => {
  for (const boundary of ['account', 'hidden']) {
    let finish;
    const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({ loadPublicMeetupContext: async () => ({ ...overviewPost, id: 'private-post' }), loadMeetupSessions: () => new Promise(resolve => { finish = resolve; }) }), { ...overviewProps, postId: 'private-post' });
    context.after(() => harness.cleanup()); await harness.settle();
    if (boundary === 'account') harness.auth.me.id = 'other';
    else hideContent('me', 'post', 'private-post');
    harness.rerender(); await harness.settle();
    finish({ member: true, isHost: true, kind: 'group', sessions: [session('private', '24')] }); await harness.settle();
    assert.equal(harness.nodes().some(node => node.props?.testID === 'meetup-upcoming-session'), false, boundary);
    assert.equal(harness.nodes().some(node => node.type === 'MeetupReviews' || node.type === 'PostBody'), false, boundary);
  }
});

test('switching away and back never restores a dismissed account presentation', async context => {
  const { harness, rows } = closableInbox(); context.after(() => harness.cleanup()); await harness.settle();
  openInboxRoom(harness, rows[0]); await harness.settle();
  harness.auth.me.id = 'other'; harness.rerender(); await harness.settle();
  harness.auth.me.id = 'me'; harness.rerender(); await harness.settle();
  assert.equal(inboxModal(harness).props.visible, false);
  assert.equal(inboxRoom(harness), undefined);
});

test('an old dismissal after a rapid second close cannot remove a later presentation of the same conversation', async context => {
  const { harness, rows } = closableInbox(); context.after(() => harness.cleanup()); await harness.settle();
  openInboxRoom(harness, rows[0]); await harness.settle();
  const firstDismiss = inboxModal(harness).props.onDismiss;
  inboxRoom(harness).props.onClose(); await harness.settle();
  openInboxRoom(harness, rows[0]); await harness.settle();
  inboxRoom(harness).props.onClose(); await harness.settle();
  const secondDismiss = inboxModal(harness).props.onDismiss;
  firstDismiss(); await harness.settle();
  assert.ok(inboxRoom(harness), 'an earlier native sheet must not unmount the current closing sheet');
  secondDismiss(); await harness.settle(); assert.equal(inboxRoom(harness), undefined);
});

test('a missing upcoming read shows a retry without inventing an empty schedule and keeps authorized introduction navigation', async context => {
  const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({
    loadMeetupSessions: async () => { throw new Error('PGRST202'); },
  }), overviewProps);
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(hasText(harness, '일정을 불러오지 못했어요.'));
  assert.equal(hasText(harness, '등록된 예정 일정이 없어요.'), false);
  assert.equal(harness.nodes().some(node => node.props?.accessibilityLabel === '참석 확인' || node.props?.accessibilityLabel === '일정·참석 관리'), false);
  const intro = harness.nodes().find(node => node.props?.accessibilityLabel === '모임 소개');
  assert.ok(intro, 'existing authorized post projection is independent from the new schedule read');
  intro.props.onPress(); await harness.settle();
  assert.ok(harness.nodes().some(node => node.type === 'PostBody' && node.props.body === overviewPost.body));
});

test('unavailable addresses retain the original label and coordinates without sending a location', async context => {
  for (const platform of ['ios', 'android', 'web']) {
    let reverseReads = 0;
    const harness = mount('../src/components/chat-room.tsx', 'ChatLocationMessage', { platform, location: {
      getForegroundPermissionsAsync: async () => ({ granted: false }),
      reverseGeocodeAsync: async () => { reverseReads++; throw new Error('offline'); },
      requestForegroundPermissionsAsync: () => { throw new Error('unexpected permission prompt'); },
    } }, { latitude: 49.24991, longitude: -122.86145, label: 'Jimoco Café & Pasta' });
    context.after(() => harness.cleanup()); await harness.settle();
    assert.ok(hasText(harness, 'Jimoco Café & Pasta'));
    assert.ok(hasText(harness, '49.2499, -122.8615'));
    assert.equal(reverseReads, platform === 'ios' ? 1 : 0);
    assert.ok(harness.nodes().some(node => node.type === 'PostPinMap' && node.props.pin.latitude === 49.24991));
  }
});

test('invalid location coordinates never render a map or open a reversed or unsafe destination', async context => {
  for (const latitude of [NaN, Infinity, -122.86145, 91]) {
    let geocodes = 0;
    const bubble = mount('../src/components/chat-room.tsx', 'ChatLocationMessage', { location: { reverseGeocodeAsync: async () => { geocodes++; return []; } } },
      { latitude, longitude: 49.24991, label: '현재 위치' });
    context.after(() => bubble.cleanup()); await bubble.settle();
    assert.equal(bubble.nodes().some(node => node.type === 'PostPinMap'), false); assert.equal(geocodes, 0);
  }
  const opened = [], shared = { ...message(1), kind: 'location', latitude: 49.24991, longitude: -122.86145 };
  const harness = room({ native: { Linking: { openURL: async url => opened.push(url) } }, loadConversationMessages: async () => [shared] });
  context.after(() => harness.cleanup()); await harness.settle();
  const renderBubble = item => harness.nodes().find(node => node.type === 'FlatList').props.renderItem({ item, index: 0 });
  const nodes = value => !value || typeof value !== 'object' ? [] : [...(value.type ? [value] : []), ...Object.values(value).flatMap(nodes)];
  nodes(renderBubble(shared)).find(node => node.props?.analyticsId === 'components_chat-room.pressable.heart').props.onPress({ nativeEvent: { timestamp: 1000 } });
  const destination = new URL(opened[0]); assert.equal(destination.searchParams.get('query'), '49.24991,-122.86145');
  nodes(renderBubble({ ...shared, latitude: 91 })).find(node => node.props?.analyticsId === 'components_chat-room.pressable.heart').props.onPress({ nativeEvent: { timestamp: 2000 } });
  assert.equal(opened.length, 1);
});

test('late reverse-geocoding cannot place an old account address in a new account or after unmount', async context => {
  for (const change of ['account', 'unmount']) {
    let finish;
    const harness = mount('../src/components/chat-room.tsx', 'ChatLocationMessage', { location: {
      reverseGeocodeAsync: () => new Promise(resolve => { finish = resolve; }),
    } }, { latitude: 49.24991, longitude: -122.86145, label: '현재 위치' });
    await harness.settle(); const old = finish;
    if (change === 'unmount') harness.cleanup();
    else { harness.auth.me.id = 'other'; harness.rerender(); await harness.settle(); }
    old([{ street: 'Old account address', city: 'Coquitlam' }]); await harness.settle();
    assert.equal(hasText(harness, 'Old account address, Coquitlam'), false, change);
    harness.cleanup();
  }
});

test('a one-time meetup uses its original real schedule without inventing attendance records', async context => {
  const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({
    loadPublicMeetupContext: async () => ({ ...overviewPost, room: { ...overviewPost.room, eventKind: 'once', startsAt: '2026-10-24T14:00:00Z', endsAt: '2026-10-24T16:00:00Z' } }),
    loadMeetupSessions: async () => ({ member: true, isHost: false, kind: 'once', sessions: [] }),
  }), overviewProps);
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(harness.nodes().some(node => node.props?.testID === 'meetup-once-schedule'));
  assert.equal(harness.nodes().some(node => node.props?.testID === 'meetup-upcoming-session'), false);
  assert.equal(hasText(harness, '등록된 예정 일정이 없어요.'), false);
});

test('overview and location recovery copy follow Korean or English without translating stored content', async context => {
  for (const language of ['ko', 'en']) {
    const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({ language }), overviewProps);
    context.after(() => harness.cleanup()); await harness.settle();
    assert.ok(hasText(harness, overviewPost.title));
    assert.ok(hasText(harness, language === 'en' ? 'No upcoming sessions yet.' : '등록된 예정 일정이 없어요.'));
    harness.nodes().find(node => node.props?.accessibilityLabel === (language === 'en' ? 'About the meetup' : '모임 소개')).props.onPress(); await harness.settle();
    assert.ok(harness.nodes().some(node => node.type === 'PostBody' && node.props.body === overviewPost.body));
  }
});

test('null or malformed schedule responses remain unavailable rather than fabricated zero schedules', async context => {
  for (const response of [null, {}, { member: true, isHost: true, kind: 'group', sessions: null }]) {
    const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({ loadMeetupSessions: async () => response }), overviewProps);
    context.after(() => harness.cleanup()); await harness.settle();
    assert.ok(hasText(harness, '일정을 불러오지 못했어요.'));
    assert.equal(hasText(harness, '등록된 예정 일정이 없어요.'), false);
  }
});

test('denied membership never renders introduction or attendance controls even with an authorized post projection', async context => {
  const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({
    loadMeetupSessions: async () => ({ member: false, isHost: false, kind: 'group', sessions: [] }),
  }), overviewProps);
  context.after(() => harness.cleanup()); await harness.settle();
  assert.equal(harness.nodes().some(node => ['PostBody', 'MeetupReviews'].includes(node.type) || node.props?.accessibilityLabel === '모임 소개'), false);
});

test('native back and Reduce Motion keep nested navigation local and finish dismissal once', async context => {
  for (const platform of ['ios', 'android']) for (const reducedMotion of [true, false]) {
    let closes = 0;
    const harness = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({ platform, reducedMotion }), { ...overviewProps, onClose() { closes++; } });
    context.after(() => harness.cleanup()); await harness.settle();
    const modal = () => harness.nodes().find(node => node.type === 'Modal');
    assert.equal(modal().props.animationType, reducedMotion ? 'none' : 'slide');
    harness.nodes().find(node => node.props?.accessibilityLabel === '모임 소개').props.onPress(); await harness.settle();
    modal().props.onRequestClose(); await harness.settle();
    if (platform === 'android') {
      assert.equal(closes, 0); assert.equal(modal().props.visible, true);
      assert.equal(harness.nodes().some(node => node.type === 'PostBody'), false);
      modal().props.onRequestClose(); await harness.settle();
    } else assert.equal(closes, 0, 'iOS retains its content through the native animation');
    modal().props.onDismiss(); modal().props.onDismiss();
    assert.equal(closes, 1);
  }
});

test('summary and overview execute only their narrow context read even when unused comment and media services fail', async context => {
  const { loadPublicMeetupContext } = await import('../src/lib/feed-data.ts');
  const calls = []; let participationReads = 0;
  const row = { id: 'post-1', city_id: 'vancouver', title: 'Synthetic public meetup', body: 'Authorized original introduction',
    author_id: 'canonical-public-host', room_preview: { ...overviewPost.room, title: 'Synthetic public meetup', verifiedOnly: false }, image_paths: ['PRIVATE_UPLOAD_PATH'] };
  const client = { rpc: async (name, params) => {
    calls.push({ name, params });
    if (name !== 'get_public_post') throw Error('unused comments or business media unavailable');
    return { data: [row], error: null };
  } };
  const read = (_unused, postId) => loadPublicMeetupContext(client, postId);
  const summary = mount('../src/components/meetup-room-summary.tsx', 'MeetupRoomSummary', { loadPublicMeetupContext: read }, { postId: 'post-1', onOpen() {} });
  context.after(() => summary.cleanup()); await summary.settle();
  assert.ok(hasText(summary, row.title)); assert.equal(calls.length, 1);
  const overview = mount('../src/components/meetup-chat-overview.tsx', 'MeetupChatOverview', overviewData({ loadPublicMeetupContext: read,
    loadMeetupSessions: async () => { participationReads++; return { member: true, isHost: false, kind: 'group', sessions: [] }; },
  }), overviewProps);
  context.after(() => overview.cleanup()); await overview.settle();
  assert.ok(hasText(overview, row.title)); assert.equal(calls.length, 2, 'each surface does one scoped public read; no global cache');
  assert.equal(participationReads, 1, 'overview independently checks participant permissions');
  assert.deepEqual(calls.map(call => call.name), ['get_public_post', 'get_public_post']);
  overview.nodes().find(node => node.props?.accessibilityLabel === '모임 소개').props.onPress(); await overview.settle();
  assert.ok(overview.nodes().some(node => node.type === 'PostBody' && node.props.body === row.body));
  assert.equal(calls.length, 2, 'the authorized projection already contains the original introduction');
  assert.equal(JSON.stringify(overview.nodes()).includes('PRIVATE_UPLOAD_PATH'), false);
});

test('a summary unmounted before its deferred read starts makes no request', async () => {
  let reads = 0;
  const harness = mount('../src/components/meetup-room-summary.tsx', 'MeetupRoomSummary', { loadPublicMeetupContext: async () => { reads++; return overviewPost; } }, { postId: 'post-1', onOpen() {} });
  harness.cleanup(); await new Promise(setImmediate);
  assert.equal(reads, 0);
});

const settingsSheet = harness => harness.nodes().find(node => node.props?.testID === 'chat-room-settings');
const settingsActions = harness => {
  const walk = value => !value || typeof value !== 'object' ? [] : [...(value.type ? [value] : []), ...Object.values(value).flatMap(walk)];
  return walk(settingsSheet(harness)).filter(node => node.props?.label);
};

test('the neutral header close only dismisses; end, report and block are nested in room settings', async context => {
  let closes = 0, ends = 0, blocks = 0;
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', {
    loadConversationMessages: async () => [], endConversation: async () => { ends++; }, blockUser: async () => { blocks++; },
  }, { ...roomProps, conversation: { ...conversation, kind: 'direct' }, onClose() { closes++; } });
  context.after(() => harness.cleanup()); await harness.settle();
  const close = harness.nodes().find(node => node.props?.accessibilityLabel === t.detail.close || node.props?.label === t.detail.close);
  close.props.onPress(); assert.equal(closes, 1); assert.equal(ends, 0); assert.equal(blocks, 0);
  const gear = harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open');
  assert.ok(gear); assert.equal(gear.props.accessibilityLabel, '대화 설정');
  assert.equal(harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal').props.visible, false);
  gear.props.onPress(); await harness.settle();
  assert.equal(harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal').props.visible, true);
  const actions = settingsActions(harness);
  assert.ok(actions.some(node => node.props.label === t.chat.end));
  assert.ok(actions.some(node => node.props.label === t.report.short));
  assert.ok(actions.some(node => node.props.label === t.chat.block));
  for (const label of [t.chat.end, t.report.short, t.chat.block]) {
    assert.equal(harness.nodes().filter(node => node.props?.label === label).length, actions.filter(node => node.props.label === label).length, 'room-level actions exist only inside settings');
  }
  assert.equal(ends, 0); assert.equal(blocks, 0);
  actions.find(node => node.props.label === t.chat.end).props.onPress(); await harness.settle();
  assert.equal(ends, 0, 'choosing end still requires the existing confirmation');
  const confirmation = harness.nodes().find(node => node.props?.label === t.chat.end && node.props.primary);
  assert.ok(confirmation); assert.equal(confirmation.props.danger, true);
  harness.nodes().find(node => node.props?.label === t.profile.cancel).props.onPress(); await harness.settle();
  assert.equal(ends, 0); assert.equal(closes, 1);
});

test('room settings preserve ended and pending capabilities, report targets, and guarded final end', async context => {
  for (const status of ['active', 'ended', 'pending']) {
    let ends = 0;
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => [], endConversation: async () => { ends++; } },
      { ...roomProps, conversation: { ...conversation, kind: 'direct', status } });
    context.after(() => harness.cleanup()); await harness.settle();
    harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress(); await harness.settle();
    const actions = settingsActions(harness), end = actions.find(node => node.props.label === t.chat.end);
    assert.equal(Boolean(end), status === 'active');
    actions.find(node => node.props.label === t.report.short).props.onPress(); await harness.settle();
    assert.equal(harness.nodes().some(node => node.type === 'ReportSheet'), false, 'iOS opens the report only after settings dismissal');
    harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal').props.onDismiss(); await harness.settle();
    const report = harness.nodes().find(node => node.type === 'ReportSheet');
    assert.equal(report.props.targetType, 'user'); assert.equal(report.props.targetId, conversation.otherUser.id);
    assert.equal(ends, 0);
    report.props.onClose(); await harness.settle();
    if (!end) continue;
    harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress(); await harness.settle();
    settingsActions(harness).find(node => node.props.label === t.chat.end).props.onPress(); await harness.settle();
    const confirm = harness.nodes().find(node => node.props?.label === t.chat.end && node.props.primary);
    confirm.props.onPress(); confirm.props.onPress(); await harness.settle();
    assert.equal(ends, 1, 'only the confirmed action ends; repeat taps are single-flight');
  }
});

test('destructive confirmation uses the actual theme danger color with readable contrast and disabled feedback', async context => {
  const constants = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/constants/theme.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: constants, require: () => ({ Platform: { OS: 'ios', select: values => values.default } }) });
  const luminance = color => {
    const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const theme of [constants.Colors.light, constants.Colors.dark]) {
    let finish, ends = 0;
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { theme, loadConversationMessages: async () => [], endConversation: () => { ends++; return new Promise(resolve => { finish = resolve; }); } },
      { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
    context.after(() => harness.cleanup()); await harness.settle();
    const close = harness.nodes().find(node => node.props?.accessibilityLabel === t.detail.close);
    assert.equal(close.props.children.props.tintColor, theme.textSecondary, 'close stays neutral');
    harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress(); await harness.settle();
    const destructive = settingsActions(harness).find(node => node.props.label === t.chat.end);
    assert.equal(destructive.props.danger, true);
    destructive.props.onPress(); await harness.settle();
    const confirmation = () => harness.nodes().find(node => node.props?.label === t.chat.end && node.props.primary);
    const rendered = confirmation().type(confirmation().props);
    const style = Object.assign({}, ...rendered.props.style({ pressed: false }).flat(Infinity).filter(value => value && typeof value === 'object'));
    assert.equal(style.borderColor, theme.danger); assert.ok(style.minHeight >= 44);
    assert.equal(rendered.props.accessibilityLabel, t.chat.end);
    const icon = rendered.props.children.find(node => node?.type === 'SymbolView');
    const label = rendered.props.children.find(node => node?.type === 'ThemedText');
    assert.equal(icon.props.tintColor, theme.danger); assert.equal(label.props.style.color, theme.danger);
    const a = luminance(label.props.style.color), b = luminance(style.backgroundColor);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, 'destructive text contrast remains readable');
    confirmation().props.onPress(); await harness.settle();
    const disabled = confirmation().type(confirmation().props);
    assert.equal(disabled.props.disabled, true); assert.equal(disabled.props.accessibilityState.disabled, true);
    disabled.props.onPress(); assert.equal(ends, 1);
    finish(); await harness.settle();
  }
});

test('group and business room settings retain their existing role and safety action boundaries', async context => {
  for (const isGroupHost of [false, true]) {
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => [] },
      { ...roomProps, conversation: { ...conversation, groupPostId: 'post-1', isGroupHost } });
    context.after(() => harness.cleanup()); await harness.settle();
    assert.equal(Boolean(harness.nodes().find(node => node.type === 'MeetupRoomSummary').props.onManage), isGroupHost);
    harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress(); await harness.settle();
    const labels = settingsActions(harness).map(node => node.props.label);
    assert.ok(labels.includes(isGroupHost ? t.meetup.end : t.meetup.leave));
    assert.equal(labels.includes(t.report.short) || labels.includes(t.chat.block), false, 'message-specific group safety controls keep their own context');
  }
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { businessIdentity: { id: businessId, name: 'Public business' },
    businessChat: { loadBusinessChatMessages: async () => businessPage([]) } }, { ...roomProps, conversation: businessRoom });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress(); await harness.settle();
  const labels = settingsActions(harness).map(node => node.props.label);
  assert.ok(labels.includes(t.chat.end)); assert.ok(labels.includes(t.chat.block));
  assert.equal(labels.includes(t.report.short), false, 'business chat never uses a raw personal-user report target');
});

test('retained room settings cannot block or hand off a report after an account change', async context => {
  let blocks = 0;
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => [], blockUser: async () => { blocks++; } },
    { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
  context.after(() => harness.cleanup()); await harness.settle();
  harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress(); await harness.settle();
  const block = settingsActions(harness).find(node => node.props.label === t.chat.block).props.onPress;
  settingsActions(harness).find(node => node.props.label === t.report.short).props.onPress(); await harness.settle();
  const dismissed = harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal').props.onDismiss;
  harness.auth.me.id = 'other-account'; harness.rerender(); await harness.settle();
  block(); dismissed(); await harness.settle();
  assert.equal(blocks, 0); assert.equal(harness.nodes().some(node => node.type === 'ReportSheet'), false);
});

test('room settings labels, neutral dismissal and Reduce Motion work in Korean and English', async context => {
  for (const language of ['ko', 'en']) for (const reducedMotion of [false, true]) {
    const copy = translationsFor(language), feedback = [];
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { language, reducedMotion, feedback, loadConversationMessages: async () => [] },
      { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
    context.after(() => harness.cleanup()); await harness.settle();
    const gear = harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open');
    assert.equal(gear.props.accessibilityLabel, language === 'en' ? 'Room settings' : '대화 설정');
    assert.equal(harness.nodes().find(node => node.props?.accessibilityLabel === copy.detail.close).props.accessibilityRole, 'button');
    gear.props.onPress(); await harness.settle();
    const modal = () => harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal');
    assert.equal(modal().props.animationType, reducedMotion ? 'none' : 'slide');
    assert.ok(settingsActions(harness).some(node => node.props.label === copy.chat.end));
    harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.dismiss').props.onPress(); await harness.settle();
    assert.equal(modal().props.visible, false); assert.ok(feedback.includes('selection'));
  }
});

test('an earlier settings dismissal cannot consume a reopened presentation report', async context => {
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => [] }, { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
  context.after(() => harness.cleanup()); await harness.settle();
  const modal = () => harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal');
  const open = () => harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress();
  open(); await harness.settle();
  const oldDismiss = modal().props.onDismiss;
  settingsActions(harness).find(node => node.props.label === t.report.short).props.onPress(); await harness.settle();
  open(); await harness.settle();
  const currentDismiss = modal().props.onDismiss;
  settingsActions(harness).find(node => node.props.label === t.report.short).props.onPress(); await harness.settle();
  oldDismiss(); await harness.settle();
  assert.equal(harness.nodes().some(node => node.type === 'ReportSheet'), false, 'the first native dismissal does not consume the second handoff');
  currentDismiss(); await harness.settle();
  assert.equal(harness.nodes().find(node => node.type === 'ReportSheet').props.targetId, conversation.otherUser.id);
  harness.nodes().find(node => node.type === 'ReportSheet').props.onClose(); await harness.settle();
  oldDismiss(); currentDismiss(); await harness.settle();
  assert.equal(harness.nodes().some(node => node.type === 'ReportSheet'), false, 'each presentation hands off at most once');
});

test('retained close and safety actions cannot act on a later settings presentation', async context => {
  let blocks = 0;
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => [], blockUser: async () => { blocks++; } }, { ...roomProps, conversation: { ...conversation, kind: 'direct' } });
  context.after(() => harness.cleanup()); await harness.settle();
  const modal = () => harness.nodes().find(node => node.props?.testID === 'chat-room-settings-modal');
  const open = () => harness.nodes().find(node => node.props?.analyticsId === 'chat.settings.open').props.onPress();
  open(); await harness.settle();
  const oldClose = modal().props.onRequestClose, oldBlock = settingsActions(harness).find(node => node.props.label === t.chat.block).props.onPress;
  oldClose(); await harness.settle(); open(); await harness.settle();
  oldClose(); oldBlock(); await harness.settle();
  assert.equal(modal().props.visible, true); assert.equal(blocks, 0);
});

test('long personal and business header titles keep their full accessible name when visually truncated', async context => {
  for (const businessPeer of [false, true]) {
    const title = businessPeer ? 'LongUnbrokenBusinessNameForContainment' : 'LongNeighbourName123';
    const pinned = businessPeer ? { ...conversation, kind: 'business', title,
      selfIdentity: { kind: 'user', id: 'me', name: 'Me' }, otherIdentity: { kind: 'business', id: businessId, name: title },
      otherUser: { id: businessId, nickname: title, verificationLevel: 0 } }
      : { ...conversation, kind: 'direct', otherUser: { ...conversation.otherUser, nickname: title } };
    const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { loadConversationMessages: async () => [],
      businessChat: { loadBusinessChatMessages: async () => ({ conversation: pinned, messages: [], cursor: null, readAt: null }) } }, { ...roomProps, conversation: pinned });
    context.after(() => harness.cleanup()); await harness.settle();
    const heading = harness.nodes().find(node => node.type === 'ThemedText' && node.props?.children === title);
    assert.ok(heading); assert.equal(heading.props.accessibilityLabel, title);
    assert.equal(heading.props.numberOfLines, 2); assert.equal(heading.props.ellipsizeMode, 'tail');
    if (businessPeer) assert.ok(harness.nodes().find(node => node.props?.analyticsId === 'chat.peer-profile').props.accessibilityLabel.includes(title));
  }
});

test('preview and callback object refreshes preserve a 100-message personal window and its subscription', async context => {
  let snapshots = 0; const subscriptionEvents = [], props = { ...roomProps, conversation: { ...conversation, kind: 'direct' } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', { subscriptionEvents,
    loadConversationMessages: async (_client, _id, before) => { if (!before) snapshots++; return Array.from({ length: 50 }, (_, i) => message((before ? 1 : 51) + i)); },
  }, props);
  context.after(() => harness.cleanup()); await harness.settle();
  await olderButton(harness).props.onPress(); await harness.settle(); assert.equal(harness.messages().length, 100);
  props.conversation = { ...props.conversation, latestBody: 'new preview', latestAt: '2026-10-24T00:00:00Z', otherUser: { ...props.conversation.otherUser, nickname: 'Updated name' } };
  props.onChanged = async () => {};
  harness.rerender(); await harness.settle();
  assert.equal(snapshots, 1); assert.equal(harness.messages().length, 100);
  assert.equal(subscriptionEvents.filter(([kind]) => kind === 'subscribe').length, 1);
  assert.equal(subscriptionEvents.filter(([kind]) => kind === 'remove').length, 0);
  harness.reconnect(); await harness.settle();
  assert.equal(snapshots, 2, 'real reconnect still revalidates the contiguous server-visible window');
});

test('business preview snapshots preserve paged history but a real revocation still clears it', async context => {
  let snapshots = 0, allowed = true;
  const props = { ...roomProps, conversation: { ...businessRoom } };
  const data = { businessIdentity: { id: businessId, name: 'Public business' }, businessChat: {
    loadBusinessChatMessages: async (_client, pinned, options = {}) => {
      if (!allowed) throw Error('BUSINESS_CHAT_REVOKED');
      if (!options.before) snapshots++;
      return { conversation: pinned, messages: Array.from({ length: 50 }, (_, i) => ({ ...message((options.before ? 1 : 51) + i), sender_kind: 'user', is_mine: false })), cursor: options.before ? null : { id: 'm051', createdAt: message(51).created_at }, readAt: null };
    },
  } };
  const harness = mount('../src/components/chat-room.tsx', 'ChatRoom', data, props);
  context.after(() => harness.cleanup()); await harness.settle();
  await olderButton(harness).props.onPress(); await harness.settle(); assert.equal(harness.messages().length, 100);
  props.conversation = { ...props.conversation, latestBody: 'Updated business preview', selfIdentity: { ...props.conversation.selfIdentity, name: 'Updated public business' } };
  props.onChanged = async () => {}; harness.rerender(); await harness.settle();
  assert.equal(snapshots, 1); assert.equal(harness.messages().length, 100);
  allowed = false; harness.foreground(); await harness.settle();
  assert.equal(harness.messages().length, 0, 'actual access revalidation still discards revoked business history');
});

test('the actual shared private channel revalidates business history on reconnect and discards revoked history', async context => {
  const userId = 'b1900000-0000-4000-8000-000000000001', businessId = 'b1910000-0000-4000-8000-000000000001';
  const current = { ...businessRoom, id: 'b1920000-0000-4000-8000-000000000001', selfIdentity: { ...businessRoom.selfIdentity, id: businessId } };
  let snapshots = 0, allowed = true, changes = 0;
  const props = { conversation: current, currentUserId: userId, onClose() {}, onChanged: async () => { changes++; } };
  const h = mount('../src/components/chat-room.tsx', 'ChatRoom', {
    auth: { isAuthed: true, me: { id: userId, nickname: 'Synthetic viewer' } }, businessIdentity: { id: businessId, name: 'Business' },
    businessChat: { subscribeBusinessChat, loadBusinessChatMessages: async (_client, pinned, options) => {
      if (!options?.before) snapshots++;
      if (!allowed) throw Error('BUSINESS_CHAT_REVOKED');
      return { conversation: pinned, messages: Array.from({ length: 50 }, (_, i) => message((options?.before ? 1 : 51) + i)), cursor: options?.before ? null : { id: 'oldest', createdAt: message(51).created_at }, readAt: null };
    } },
  }, props);
  context.after(h.cleanup); await h.settle(); await olderButton(h).props.onPress(); await h.settle();
  props.conversation = { ...current, latestBody: 'Updated preview' }; h.rerender(); await h.settle();
  assert.equal(h.messages().length, 100); assert.equal(snapshots, 1);
  h.reconnect(); await h.settle(); assert.equal(snapshots, 2); assert.equal(changes, 1);
  allowed = false; h.reconnect(); await h.settle(); assert.equal(snapshots, 3); assert.equal(h.messages().length, 0);
  h.auth.isAuthed = false; h.rerender(); h.reconnect(); await h.settle(); assert.equal(snapshots, 3); assert.equal(changes, 2);
});

test('the actual private inbox channel refreshes on reconnect without a broadcast or foreground transition', async context => {
  const userId = 'b1900000-0000-4000-8000-000000000001', businessId = 'b1910000-0000-4000-8000-000000000001';
  const reads = [];
  const h = mount('../src/app/(tabs)/chat.tsx', 'default', {
    auth: { isAuthed: true, me: { id: userId, nickname: 'Synthetic viewer' } }, businessIdentity: { id: businessId, name: 'Business' },
    businessChat: { subscribeBusinessChat }, loadConversations: async (_client, owner, _filter, _cursor, _selected, asBusinessId) => {
      reads.push([owner, asBusinessId]); return { conversations: [], pendingCount: 0, cursor: null, selectedConversation: null };
    },
  });
  context.after(h.cleanup); await h.settle(); assert.equal(reads.length, 1);
  h.reconnect(); await h.timers(); assert.deepEqual(reads, [[userId, businessId], [userId, businessId]]);
});
