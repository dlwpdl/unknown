import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import { TAGS } from '../src/lib/mock.ts';
import { groupJournalPosts, appendUniquePosts } from '../src/lib/feed-data.ts';
import { withPostMap, postMapBody } from '../src/lib/post-maps.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function screen({ createdPost, deferPublish = false, os = 'web' } = {}) {
  const slots = [], effects = [], calls = [], writes = [], drafts = [], routes = [], feedback = [], params = {};
  let viewer = 'viewer';
  let at = 0;
  const slot = initial => { const index = at++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return index; };
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} interpolate() { return 0; } }
  const jsx = (type, props) => type === 'PostBodyEditor' && props.renderLayout ? props.renderLayout({ input: { type, props }, attachments: null, actions: { type: 'EditorActions', props: {} } }) : ({ type, props });
  const theme = { background: '#0B0B12', accent: '#CBB9FF' };
  const imports = {
    react: { useState: initial => { const i = slot(initial); return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef: initial => slots[slot(() => ({ current: initial }))], useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: os }, useWindowDimensions: () => ({ width: 390, fontScale: 1 }), View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', TextInput: 'TextInput', Modal: 'Modal', StyleSheet: { create: x => x, hairlineWidth: 1 }, Animated: { Value, View: 'AnimatedView', timing: () => ({ start() {} }), spring: () => ({ start() {} }) }, Alert: { alert() {} }, Keyboard: { dismiss() {} }, DeviceEventEmitter: {}, Easing: { out: x => x, quad: 0 } },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push() {}, navigate: path => routes.push(path), setParams: next => Object.assign(params, next) }), useScrollToTop() {} },
    'react-native-reanimated': { default: { View: 'ReanimatedView' }, useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/hooks/use-theme': { useTheme: () => theme }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/components/daily-chip': { todayLabel: () => '10월 12일 월요일' },
    '@/lib/image-upload': { canAddPostImage: () => true, MAX_POST_IMAGES: 10 },
    '@/constants/theme': { Colors: { light: {} }, Depth: { control: {}, card: {} }, Spacing: { one: 4, two: 8, three: 16, four: 24, five: 32 }, TabBarHeight: 64 },
    '@/i18n/ko': { t }, '@/lib/mock': { TAGS }, '@/lib/auth': { useAuth: () => ({ isAuthed: viewer !== null, me: { id: viewer ?? 'guest' }, promptLogin() {} }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버', state: 'open' }, setCity() {} }) },
    '@/lib/location-provider': { useCommunityLocation: () => ({ record() {}, capture: async () => null }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/community-data': { loadListingQuota: async () => ({ used: 0, max: 3 }), createCommunityPost: () => deferPublish ? new Promise(resolve => writes.push({ resolve })) : Promise.resolve({ id: createdPost.id, post: createdPost }), getCommunityActionError: () => null, isContentRejected: () => false },
    '@/lib/post-maps': { withPostMap, postMapBody },
    '@/lib/hashtags': { getSuggestedHashtags: () => [], parseHashtags: () => [], canonicalizeHashtag: value => value },
    '@/lib/ads': { adsSupported: false }, '@/lib/supabase': { supabase: { functions: { invoke: (...args) => new Promise((resolve, reject) => drafts.push({ args, resolve, reject })) } } },
    '@/lib/feed-data': { groupJournalPosts, appendUniquePosts, loadPublicFeed: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) },
    '../../supabase/functions/_shared/post-links': { splitPostAttachments: body => ({ body }) },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/feed-screen.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name in imports) return imports[name];
    return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : key === 'Image' ? 'Image' : key === 'default' ? { View: 'ReanimatedView' } : String(key) });
  }), requestAnimationFrame: fn => fn(), queueMicrotask: fn => fn(), setTimeout, clearTimeout });
  let cleanup;
  const render = () => { at = 0; effects.length = 0; return exports.default({}); };
  const refresh = () => { cleanup?.(); cleanup = effects.find(fn => String(fn).includes('return cancelFeedRequests'))(); };
  const list = () => nodes(render()).find(n => n.props?.analyticsId === 'components_feed-screen.flatlist.1').props;
  return { calls, writes, drafts, routes, feedback, list, refresh, params, render, openWriter() { params.compose = '1'; render(); effects.find(fn => String(fn).includes("compose !== '1'"))(); return render(); }, openTopic: () => { render(); effects.find(fn => String(fn).includes('hashtag: undefined'))(); }, setViewer: next => { viewer = next; }, sort: () => { const props = list(); return props.renderItem({ item: null, index: 1 }).props; },
    publish: async () => {
      const inputs = nodes(render());
      inputs.find(n => n.props?.accessibilityLabel === t.write.titlePlaceholder).props.onChangeText('새 글');
      inputs.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.onChangeText('새 본문');
      nodes(render()).find(n => n.props?.analyticsId === 'components_feed-screen.pressable.15').props.onPress();
      await new Promise(setImmediate);
    },
  };
}
const post = (id, extra = {}) => ({ id, cityId: 'vancouver', author: { id: 'author' }, tag: TAGS[0], createdAt: '2026-10-12T10:00:00Z', title: id, ...extra });

test('a topic notification opens today search and consumes its parameter so closing stays closed', () => {
  const app = screen();
  app.params.hashtag = '밴쿠버'; app.openTopic();
  let tree = nodes(app.render());
  assert.equal(tree.find(node => node.type === 'TextInput' && node.props.value === '#밴쿠버')?.props.value, '#밴쿠버');
  const search = tree.find(node => node.type === 'Modal' && node.props.visible);
  assert.ok(search, 'search is actually open');
  assert.equal(app.params.hashtag, undefined);
  search.props.onRequestClose(); app.openTopic();
  assert.equal(nodes(app.render()).some(node => node.type === 'Modal' && node.props.visible), false);
  app.params.hashtag = '토론토'; app.openTopic();
  assert.equal(nodes(app.render()).find(node => node.type === 'TextInput' && node.props.value === '#토론토')?.props.value, '#토론토');
});

test('today has a pinned sort row and preserves server order, including meetup posts', async () => {
  const app = screen(); app.list(); app.refresh();
  app.calls[0].resolve([post('new'), post('older-meetup', { room: { id: 'room' } })]); await new Promise(setImmediate);
  const props = app.list();
  assert.deepEqual(Array.from(props.stickyHeaderIndices), [1]);
  assert.deepEqual(Array.from(props.data.filter(Boolean), p => p.id), ['new', 'older-meetup']);
  assert.equal(app.sort().sort, 'latest');
});

test('switching order invalidates an older request and the next request keeps popular mode', async () => {
  const app = screen(); app.list(); app.refresh();
  app.sort().onChange('popular'); app.list(); app.refresh();
  assert.equal(app.calls[1].args[5].sort, 'popular');
  app.calls[1].resolve([post('popular', { popularityScore: 99, rankingAsOf: '2026-10-12T12:00:00Z' })]); await new Promise(setImmediate);
  app.calls[0].resolve([post('stale-latest')]); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['popular']);
});

test('category changes retain popular mode, and a failed new scope does not display old ordering', async () => {
  const app = screen(); app.list(); app.refresh();
  app.sort().onChange('popular'); app.list(); app.refresh();
  app.calls[1].resolve([post('popular')]); await new Promise(setImmediate);
  const header = app.list().renderItem({ item: null, index: 0 });
  const categories = nodes(header).filter(node => node.props?.analyticsId === 'components_feed-screen.pressable.3');
  categories[3].props.onPress(); app.list(); app.refresh();
  assert.equal(app.calls[2].args[2], 4);
  assert.equal(app.calls[2].args[5].sort, 'popular');
  app.calls[2].reject(new Error('network error')); await new Promise(setImmediate);
  assert.equal(app.sort().sort, 'popular');
  assert.deepEqual(Array.from(app.list().data.filter(Boolean)), []);
});

test('a stale page completion cannot unlock an in-flight page in the newly selected order', async () => {
  const app = screen(); app.list(); app.refresh();
  app.calls[0].resolve(Array.from({ length: 30 }, (_, i) => post(`latest-${i}`))); await new Promise(setImmediate);
  app.list().onEndReached();
  app.sort().onChange('popular'); app.list(); app.refresh();
  const ranked = Array.from({ length: 30 }, (_, i) => post(`ranked-${i}`, { popularityScore: 100-i, rankingAsOf: '2026-10-12T12:00:00Z' }));
  app.calls[2].resolve(ranked); await new Promise(setImmediate);
  app.list().onEndReached();
  assert.equal(app.calls[3].args[4].popularityScore, 71);
  assert.equal(app.calls[3].args[4].rankingAsOf, '2026-10-12T12:00:00Z');
  assert.equal(app.calls[3].args[5].sort, 'popular');
  app.calls[1].resolve([post('stale-page')]); await new Promise(setImmediate);
  app.list().onEndReached();
  assert.equal(app.calls.length, 4, 'new page remains locked despite old completion');
  app.calls[3].resolve([post('next-ranked')]); await new Promise(setImmediate);
  assert.ok(app.list().data.some(p => p?.id === 'next-ranked'));
  assert.ok(!app.list().data.some(p => p?.id === 'stale-page'));
});

test('overlapping popularity pages advance using the server page cursor even when no new cards are appended', async () => {
  const app = screen(); app.list(); app.refresh();
  app.sort().onChange('popular'); app.list(); app.refresh();
  const ranked = Array.from({ length: 30 }, (_, i) => post(`ranked-${i}`, { popularityScore: 100-i, rankingAsOf: '2026-10-12T12:00:00Z' }));
  app.calls[1].resolve(ranked); await new Promise(setImmediate);
  app.list().onEndReached();
  app.calls[2].resolve(ranked.map((p,i) => ({ ...p, popularityScore: 70-i }))); await new Promise(setImmediate);
  assert.equal(app.list().data.filter(Boolean).length, 30, 'overlap does not duplicate cards');
  app.list().onEndReached();
  assert.equal(app.calls[3].args[4].popularityScore, 41, 'cursor must advance beyond the raw server page');
});

test('a top-page refresh does not simultaneously request a page from the previous ranking window', async () => {
  const app = screen(); app.list(); app.refresh();
  app.calls[0].resolve(Array.from({ length: 30 }, (_, i) => post(`post-${i}`))); await new Promise(setImmediate);
  app.list().onRefresh();
  app.list().onEndReached();
  assert.equal(app.calls.length, 2, 'paging waits for the refreshed first page');
});

test('publishing in popular mode refreshes the server ranking instead of prepending an unranked post', async () => {
  const app = screen({ createdPost: post('just-published') }); app.list(); app.refresh();
  app.sort().onChange('popular'); app.list(); app.refresh();
  app.calls[1].resolve([post('top-ranked', { popularityScore: 99 })]); await new Promise(setImmediate);
  await app.publish();
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['top-ranked']);
  assert.equal(app.calls.length, 3, 'publication must refresh the ranking');
  assert.equal(app.calls[2].args[5].sort, 'popular');
  app.calls[2].resolve([post('top-ranked'), post('just-published')]); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['top-ranked', 'just-published']);
});

test('publishing in latest mode retains the immediate new-post preview', async () => {
  const app = screen({ createdPost: post('just-published') }); app.list(); app.refresh();
  app.calls[0].resolve([post('previous')]); await new Promise(setImmediate);
  await app.publish();
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['just-published', 'previous']);
  assert.equal(app.calls.length, 1);
});

test('refreshing during pagination clears the old footer even when the refreshed page is empty', async () => {
  const app = screen(); app.list(); app.refresh();
  app.calls[0].resolve(Array.from({ length: 30 }, (_, i) => post(`post-${i}`))); await new Promise(setImmediate);
  app.list().onEndReached();
  assert.ok(app.list().ListFooterComponent);
  app.list().onRefresh();
  app.calls[1].resolve([post('stale-page')]);
  app.calls[2].resolve([]); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean)), []);
  assert.ok(!nodes(app.list().ListFooterComponent).some(n => n.props?.children === t.feed.loadingMore));
  assert.ok(nodes(app.list().ListFooterComponent).some(n => n.props?.children === t.feed.emptyTitle));
});

test('an old publish completion cannot refresh or overwrite a feed after account rotation', async () => {
  const app = screen({ deferPublish: true }); app.list(); app.refresh();
  app.sort().onChange('popular'); app.list(); app.refresh();
  app.calls[1].resolve([post('member-post')]); await new Promise(setImmediate);
  await app.publish();
  app.setViewer(null); app.list(); app.refresh();
  assert.equal(app.calls[2].args[5].viewerScope, 'guest');
  app.calls[2].resolve([post('guest-post')]); await new Promise(setImmediate);
  app.writes[0].resolve({ id: 'old-member-publish', post: post('old-member-publish') }); await new Promise(setImmediate);
  assert.equal(app.calls.length, 3, 'previous account must not start a new feed request');
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['guest-post']);
});

test('error and empty states appear below the sorting control, where results normally appear', async () => {
  const app = screen(); app.list(); app.refresh();
  app.calls[0].reject(new Error('offline')); await new Promise(setImmediate);
  let props = app.list();
  assert.ok(nodes(props.ListFooterComponent).some(n => n.props?.kind === 'error'));
  assert.ok(!nodes(props.renderItem({ item: null, index: 0 })).some(n => n.props?.kind === 'error'));
  app.sort().onChange('popular'); app.list(); app.refresh();
  app.calls[1].resolve([]); await new Promise(setImmediate);
  props = app.list();
  assert.ok(nodes(props.ListFooterComponent).some(n => n.props?.children === '최근 7일 글이 아직 없어요'));
});


test('composer keeps AI outside More and disables duplicate AI requests without losing its draft', async () => {
  const app = screen();
  app.openWriter();
  let tree = nodes(app.render());
  const layout = tree.find(n => n.type === 'PostBodyEditor');
  assert.equal(typeof layout.props.renderLayout, 'function', 'real editor must supply the fixed composer layout');
  const ai = () => nodes(app.render()).find(n => n.props?.analyticsId === 'components_feed-screen.pressable.23');
  assert.equal(ai().props.disabled, true);
  tree.find(n => n.props?.accessibilityLabel === t.write.titlePlaceholder).props.onChangeText('남겨둘 제목');
  tree.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.onChangeText('남겨둘 본문');
  assert.equal(ai().props.disabled, false);
  ai().props.onPress();
  assert.equal(app.drafts.length, 1, 'visible action starts existing draft request in one tap');
  assert.equal(app.drafts[0].args[0], 'draft-post');
  assert.equal(app.drafts[0].args[1].body.bodyHint, '남겨둘 본문');
  assert.equal(ai().props.disabled, true);
  assert.equal(ai().props.accessibilityState.busy, true);
  app.drafts[0].reject(new Error('offline')); await new Promise(setImmediate);
  assert.equal(ai().props.disabled, false);
  tree = nodes(app.render());
  assert.equal(tree.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.value, '남겨둘 본문');
  tree.find(n => n.props?.analyticsId === 'components_feed-screen.pressable.26').props.onPress();
  const more = nodes(app.render()).find(n => n.type === 'Modal' && n.props.transparent && n.props.visible && nodes(n).some(child => child.props?.accessibilityLabel === t.write.hashtags));
  assert.ok(more, 'optional controls open in More');
  assert.ok(!nodes(more).some(n => n.props?.analyticsId === 'components_feed-screen.pressable.23'), 'AI is not duplicated or hidden inside More');
});

test('composer uses platform keyboard avoidance, fixed publish and toolbar, and keeps text when closed', () => {
  const app = screen({ os: 'ios' }); app.openWriter();
  let tree = nodes(app.render());
  assert.ok(tree.some(n => n.type === 'KeyboardAvoidingView' && n.props.behavior === 'padding'));
  const writer = tree.find(n => n.type === 'Modal' && n.props.visible && nodes(n).some(child => child.props?.analyticsId === 'components_feed-screen.pressable.14'));
  const scroll = nodes(writer).find(n => n.props?.analyticsId === 'components_feed-screen.scrollview.2');
  assert.ok(!nodes(scroll).some(n => ['components_feed-screen.pressable.15','components_feed-screen.pressable.23','EditorActions'].includes(n.props?.analyticsId ?? n.type)), 'publish and AI/attachment actions stay outside scrolling text');
  tree.find(n => n.props?.accessibilityLabel === t.write.titlePlaceholder).props.onChangeText('잠깐 닫을 제목');
  tree.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.onChangeText('잠깐 닫을 본문');
  tree.find(n => n.props?.analyticsId === 'components_feed-screen.pressable.14').props.onPress();
  app.openWriter(); tree = nodes(app.render());
  assert.equal(tree.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.value, '잠깐 닫을 본문');
});


test('header logo retains its existing Today navigation and selection feedback', () => {
  const app = screen();
  const header = app.render();
  const home = nodes(header).find(n => n.props?.analyticsId === 'feed.home');
  assert.ok(home, 'brand must remain an accessible44pt control');
  assert.equal(home.props.accessibilityRole, 'button');
  home.props.onPress();
  assert.deepEqual(app.routes, ['/']);
  assert.ok(app.feedback.includes('selection'));
});
