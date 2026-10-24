import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { appendUniquePosts } from '../src/lib/feed-data.ts';
import { count, t } from '../src/i18n/ko.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const visible = () => false;

// Run the real profile hooks and handlers with controllable network ordering.
function mount(file, name, data, props = {}, params = {}) {
  const hooks = [], calls = [], auth = { isAuthed: true, me: { id: 'viewer' } };
  let index = 0, effects = [], tree;
  const effect = (fn, deps) => {
    const slot = index++, previous = hooks[slot];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    hooks[slot] = { deps, cleanup: previous?.cleanup };
    effects.push(() => { hooks[slot].cleanup?.(); hooks[slot].cleanup = fn(); });
  };
  const react = {
    useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial; return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = index++, previous = hooks[slot]; if (!previous || !deps.every((value, i) => Object.is(value, previous.deps[i]))) hooks[slot] = { fn, deps }; return hooks[slot].fn; },
    useEffect: effect, useLayoutEffect: effect,
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { FlatList: 'FlatList', View: 'View', Modal: 'Modal', Platform: { OS: data.os ?? 'ios' }, StyleSheet: { create: x => x }, Alert: { alert: (...args) => calls.push(['alert', ...args]) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ canGoBack: () => true, back() {}, replace() {}, push: path => calls.push(['navigate', path]) }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/gling-loader': { GlingLoader: 'Loader' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' },
    '@/components/post-card': { PostCard: 'PostCard' }, '@/components/post-detail': { PostDetail: 'PostDetail' },
    '@/components/saved-entry': { SavedEntryButton: 'SavedEntryButton', useSavedEntry: (target, visible) => { calls.push(['savedEntry', target, visible]); return { state: null, error: '', loading: false, busy: false, visible, onPress() {} }; } },
    '@/components/manner-summary': { MannerSummary: 'MannerSummary' }, '@/components/report-sheet': { ReportSheet: 'ReportSheet' },
    '@/components/raised-action-button': { RaisedActionButton: 'RaisedActionButton' }, '@/components/trust-badge': { TrustBadge: 'TrustBadge' },
    '@/constants/theme': { Spacing: {}, Depth: { control: {} } }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-chat-identity': { useChatIdentity: () => data.businessIdentity ?? null },
    '@/lib/business-chat': { startBusinessConversation: data.startBusinessConversation },
    '@/lib/chat-identity': { chatBusinessIdentity: () => data.businessIdentity ?? null },
    '@/lib/auth': { useAuth: () => auth }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => data.hidden ?? visible },
    '@/lib/supabase': { supabase: {} }, '@/lib/user-profile': data, '@/lib/community-data': data,
    '@/lib/content-translation': { CONTENT_TRANSLATION_VIEWABILITY: { viewAreaCoveragePercentThreshold: 2, minimumViewTime: 250 } },
    '@/lib/feed-data': { appendUniquePosts }, '@/i18n/ko': { count, t },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, Date, Intl, require: withLanguageImports(key => { assert.ok(key in imports, `Known import: ${key}`); return imports[key]; }) });
  const render = () => { index = 0; effects = []; tree = exports[name](props); effects.forEach(fn => fn()); return tree; };
  render();
  return { auth, calls, render, nodes: () => nodes(tree), async settle() { for (let i = 0; i < 4; i++) { render(); await new Promise(resolve => setImmediate(resolve)); } render(); }, cleanup() { hooks.forEach(hook => hook?.cleanup?.()); } };
}
const manner = { meeting: { participants: 6, score: 95 }, chat: { participants: 0, score: null } };
const profile = id => ({ id, nickname: id, memberSince: '2026-01-01', manner, cityId: 'vancouver', storyCount: 31, listingCount: 1, completedCount: 1 });
const post = (id, author = 'author') => ({ id, author: { id: author }, createdAt: '2026-10-11T00:00:00Z' });
const list = harness => harness.nodes().find(node => node.type === 'FlatList');
const detail = harness => harness.nodes().find(node => node.type === 'PostDetail');
const control = (harness, id) => harness.nodes().find(node => node.props?.analyticsId === id);

test('approved mini profile has an explicit close action with feedback', async context => {
  const closed = [], harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    loadTradeProfile: async () => null, loadMannerSummary: async () => manner,
  }, { user: { id: 'neighbor', nickname: '이웃' }, onClose: () => closed.push(true) });
  context.after(() => harness.cleanup()); await harness.settle();
  const close = control(harness, 'user.profile.close'); assert.ok(close);
  assert.equal(control(harness, 'components_user-sheet.pressable.1').props.children, undefined, 'dismiss backdrop must not contain other interactive controls');
  close.props.onPress();
  assert.equal(closed.length, 1); assert.ok(harness.calls.some(call => call[0] === 'feedback' && call[1] === 'selection'));
});

test('approved mini profile expands trade detail on demand and keeps chat available', async context => {
  const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    loadTradeProfile: async () => ({ userId: 'neighbor', dealPartners: 2, closedListings: 3, memberMonths: 4 }), loadMannerSummary: async () => manner,
  }, { user: { id: 'neighbor', nickname: '이웃' }, onClose() {} });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(!harness.nodes().some(node => node.props?.trade), 'trade detail starts collapsed');
  const trade = control(harness, 'user.profile.trade'); assert.ok(trade);
  assert.equal(trade.props.accessibilityState.expanded, false); trade.props.onPress(); harness.render();
  assert.ok(harness.nodes().some(node => node.props?.trade?.userId === 'neighbor'));
  assert.equal(control(harness, 'user.profile.trade').props.accessibilityState.expanded, true);
  assert.ok(control(harness, 'components_user-sheet.pressable.4'));
});

test('approved full profile keeps a compact title and reviews before the public activity tabs', async context => {
  const harness = mount('../src/app/user/[id].tsx', 'default', {
    loadPublicUserActivity: async () => [], loadPublicUserProfile: async () => profile('author'),
  }, {}, { id: 'author', nickname: 'a long unverified route label' });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(harness.nodes().some(node => node.props?.children === '사용자 프로필'));
  const header = nodes(list(harness).props.ListHeaderComponent);
  assert.ok(header.findIndex(node => node.type === 'MannerSummary') < header.findIndex(node => node.props?.analyticsId === 'user.activity.story'));
});

test('switching sheet users and viewers immediately drops the previous trade and manner snapshot', async context => {
  const slow = deferred(), props = { user: { id: 'first', nickname: '첫 이웃' }, onClose() {} };
  let delay = false;
  const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    loadTradeProfile: async (_client, id) => delay ? slow.promise : { userId: id },
    loadMannerSummary: async () => delay ? slow.promise : manner,
  }, props);
  context.after(() => harness.cleanup()); await harness.settle();
  control(harness, 'user.profile.trade').props.onPress(); harness.render();
  assert.ok(harness.nodes().some(node => node.props?.trade?.userId === 'first'));
  delay = true; props.user = { id: 'second', nickname: '다른 이웃' }; harness.render();
  assert.ok(!harness.nodes().some(node => node.props?.trade), 'other person must not inherit the first trade history');
  props.user = { id: 'first', nickname: '첫 이웃' }; harness.auth.me.id = 'different-viewer'; harness.render();
  assert.ok(!harness.nodes().some(node => node.props?.trade || node.type === 'MannerSummary'), 'account switch hides the old viewer-scoped data immediately');
});

test('a late chat-start response cannot dismiss or navigate a newly selected profile', async context => {
  const response = deferred(), props = { user: { id: 'first', nickname: '첫 이웃', contextPostId: 'source' }, onClose() {} };
  const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    loadTradeProfile: async () => null, loadMannerSummary: async () => manner, startDirectConversation: () => response.promise,
  }, props);
  context.after(() => harness.cleanup()); await harness.settle();
  control(harness, 'components_user-sheet.pressable.4').props.onPress();
  props.user = { id: 'second', nickname: '다른 이웃' }; harness.render();
  response.resolve('original-conversation'); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0, 'stale request is not the current profile action');
});

test('an empty trade response does not mount a trade record with missing data', async context => {
  const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    loadTradeProfile: async () => null, loadMannerSummary: async () => manner,
  }, { user: { id: 'author', nickname: '이웃' }, onClose() {} });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(!harness.nodes().some(node => node.props && Object.hasOwn(node.props, 'trade')));
});

test('closing, signing out or returning to a profile cannot revive its old chat request', async context => {
  for (const change of ['closed', 'signed-out', 'returned', 'unmounted']) {
    const response = deferred(), props = { user: { id: 'first', nickname: '첫 이웃' }, onClose() {} };
    const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
      loadTradeProfile: async () => null, loadMannerSummary: async () => manner, startDirectConversation: () => response.promise,
    }, props);
    context.after(() => harness.cleanup()); await harness.settle();
    control(harness, 'components_user-sheet.pressable.4').props.onPress();
    if (change === 'closed') props.user = null;
    if (change === 'signed-out') harness.auth.isAuthed = false;
    if (change === 'returned') { props.user = null; harness.render(); props.user = { id: 'first', nickname: '첫 이웃' }; }
    if (change === 'unmounted') harness.cleanup(); else harness.render();
    response.resolve('old-conversation'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0, change);
  }
});

test('profile detail closes immediately when the author or viewer changes', async context => {
  const params = { id: 'author' }, response = deferred(); let delay = false;
  const harness = mount('../src/app/user/[id].tsx', 'default', {
    loadPublicUserActivity: async () => delay ? response.promise : [post('old-post')],
    loadPublicUserProfile: async (_client, id) => delay ? response.promise : profile(id),
  }, {}, params);
  context.after(() => harness.cleanup()); await harness.settle();
  list(harness).props.renderItem({ item: post('old-post') }).props.onPress(); await harness.settle(); assert.ok(detail(harness));
  delay = true; harness.auth.me.id = 'other-viewer'; harness.render();
  assert.equal(detail(harness), undefined, 'previous viewer cannot keep an old open detail during reload');
  params.id = 'different-author'; harness.render(); assert.equal(detail(harness), undefined);
});

test('reported posts and authors disappear immediately from cached public history', async context => {
  const hidden = new Set();
  const harness = mount('../src/app/user/[id].tsx', 'default', {
    loadPublicUserActivity: async () => [post('reported'), post('visible')], loadPublicUserProfile: async () => profile('author'),
    hidden: (kind, id, author) => hidden.has(`${kind}:${id}`) || hidden.has(`user:${author}`),
  }, {}, { id: 'author' });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.equal(harness.nodes().filter(node => node.type === 'SavedEntryButton').length, 1);
  assert.equal(harness.calls.at(-1)[0], 'savedEntry');
  hidden.add('post:reported'); harness.render();
  assert.deepEqual(Array.from(list(harness).props.data, item => item.id), ['visible']);
  hidden.add('user:author'); harness.render();
  assert.equal(list(harness).props.data.length, 0); assert.equal(list(harness).props.ListHeaderComponent, undefined);
  assert.equal(harness.nodes().some(node => node.type === 'SavedEntryButton'), false);
  assert.equal(harness.calls.at(-1)[2], false, 'a hidden profile cannot enable the private person save');
});

test('older history keeps its cursor and rejects an in-flight response after changing tabs', async context => {
  const requests = [], response = deferred(), rows = Array.from({ length: 30 }, (_, i) => post(`story-${i}`));
  const harness = mount('../src/app/user/[id].tsx', 'default', {
    loadPublicUserActivity: async (_client, _id, kind, cursor) => { requests.push({ kind, cursor }); return cursor ? response.promise : kind === 'story' ? rows : [post('closed-listing')]; },
    loadPublicUserProfile: async () => profile('author'),
  }, {}, { id: 'author' });
  context.after(() => harness.cleanup()); await harness.settle();
  const more = control(harness, 'user.activity.more'); more.props.onPress(); more.props.onPress();
  assert.equal(requests.filter(request => request.cursor).length, 1);
  assert.equal(requests.at(-1).cursor.id, 'story-29');
  control(harness, 'user.activity.listing').props.onPress(); await harness.settle();
  response.resolve([post('late-story')]); await harness.settle();
  assert.deepEqual(Array.from(list(harness).props.data, item => item.id), ['closed-listing']);
});

test('web mini profiles retain inline reviews, direct chat and reporting without unsupported profile routes', async context => {
  const closed = [], harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    os: 'web', loadTradeProfile: async () => null, loadMannerSummary: async () => manner, startDirectConversation: async () => 'web-direct-chat',
  }, { user: { id: 'neighbor', nickname: '이웃' }, onClose: () => closed.push(true) });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(harness.nodes().some(node => node.type === 'MannerSummary' && node.props.summary === manner), 'inline member reviews remain available');
  assert.equal(control(harness, 'components_user-sheet.pressable.7'), undefined, 'unexported full user history has no web button');
  control(harness, 'components_user-sheet.pressable.4').props.onPress(); await harness.settle();
  const destination = harness.calls.find(call => call[0] === 'navigate')?.[1];
  assert.equal(destination?.pathname, '/chat'); assert.equal(destination?.params?.conversationId, 'web-direct-chat');
  control(harness, 'components_user-sheet.pressable.5').props.onPress(); harness.render();
  assert.ok(harness.nodes().some(node => node.type === 'ReportSheet' && node.props.targetType === 'user' && node.props.targetId === 'neighbor'));
  assert.equal(closed.length, 2, 'chat navigation and report action still dismiss their profile overlay');
});

test('web self profiles retain inline reviews without an unsupported account-profile destination', async context => {
  const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
    os: 'web', loadTradeProfile: async () => null, loadMannerSummary: async () => manner,
  }, { user: { id: 'viewer', nickname: '나', mine: true }, onClose() {} });
  context.after(() => harness.cleanup()); await harness.settle();
  assert.ok(harness.nodes().some(node => node.type === 'MannerSummary'));
  assert.equal(control(harness, 'components_user-sheet.pressable.3'), undefined); assert.equal(control(harness, 'components_user-sheet.pressable.7'), undefined);
});

test('iOS mini profiles preserve both existing full-profile destinations', async context => {
  for (const own of [false, true]) {
    const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {
      loadTradeProfile: async () => null, loadMannerSummary: async () => manner,
    }, { user: { id: own ? 'viewer' : 'neighbor', nickname: '이웃', mine: own }, onClose() {} });
    context.after(() => harness.cleanup()); await harness.settle();
    const open = control(harness, own ? 'components_user-sheet.pressable.3' : 'components_user-sheet.pressable.7'); assert.ok(open); open.props.onPress();
    const destination = harness.calls.find(call => call[0] === 'navigate')?.[1];
    if (own) assert.equal(destination, '/profile'); else { assert.equal(destination?.pathname, '/user/[id]'); assert.equal(destination?.params?.id, 'neighbor'); }
  }
});
