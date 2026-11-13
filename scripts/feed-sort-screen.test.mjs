import { withLanguageImports } from './test-language-imports.mjs';
import * as aiDraft from '../src/lib/ai-draft.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import { TAGS } from '../src/lib/mock.ts';
import { groupJournalPosts, appendUniquePosts, limitBusinessPosts, pinJustPosted, todayRowsAfter, writeFabOverIntro, writeFabScroll } from '../src/lib/feed-data.ts';
import { withPostMap, postMapBody, googlePinUrl, googleMapsPin, withPlacePin } from '../src/lib/post-maps.ts';
import * as listingDetails from '../src/lib/listing-details.ts';
import * as neighborhoods from '../src/lib/neighborhoods.ts';
import * as postUpload from '../src/lib/post-upload.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const theme = { background: '#0B0B12', accent: '#CBB9FF', glowA: 'rgba(203,185,255,0.15)', glowB: 'rgba(185,200,255,0.07)', bodyGlowA: '#0D0A17', bodyGlowB: '#090B17' };
// The shared background part runs for real inside the screen's mocked hooks.
const glowModule = imports => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/screen-glow.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] });
  return exports;
};
function screen({ createdPost, deferPublish = false, clay = false, os = 'web', meetupsOnly = false, writeRequest, width = 390, height, fontScale = 1, adPosition = index => index >= 3 && (index - 3) % 4 === 0, photoConsent = null, consentSaves = [] } = {}) {
  const slots = [], effects = [], calls = [], writes = [], drafts = [], routes = [], feedback = [], params = {}, consents = [], alerts = [], reopened = [], cityChanges = [];
  let viewer = 'viewer', authLoading = false;
  let at = 0;
  const slot = initial => { const index = at++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return index; };
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} interpolate() { return 0; } }
  const jsx = (type, props) => type === 'PostBodyEditor' && props.renderLayout ? props.renderLayout({ input: { type, props }, attachments: null, actions: { type: 'EditorActions', props: {} } }) : ({ type, props });
  const imports = {
    react: { useState: initial => { const i = slot(initial); return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; }, useRef: initial => slots[slot(() => ({ current: initial }))], useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: os }, useWindowDimensions: () => ({ width, height, fontScale }), View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', TextInput: 'TextInput', Modal: 'Modal', StyleSheet: { create: x => x, hairlineWidth: 1 }, Animated: { Value, View: 'AnimatedView', timing: () => ({ start() {} }), spring: () => ({ start() {} }) }, Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss() {} }, DeviceEventEmitter: {}, Easing: { out: x => x, quad: 0 } },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: path => routes.push(path), navigate: path => routes.push(path), setParams: next => Object.assign(params, next) }), useScrollToTop() {} },
    'react-native-reanimated': { default: { View: 'ReanimatedView' }, useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/components/clay': { useClay: () => clay, useClayBox: () => false, ClayIcon: ({ name, size, tintColor }) => name ? { type: 'SymbolView', props: { name, size, tintColor } } : null, ClayPillFill: () => null, ClayBoxFill: () => null, ClayCoinFill: () => null, ClayControlFill: () => null, ClayPhoto: () => null },
    '@/hooks/use-theme': { useTheme: () => theme }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false }, '@/hooks/use-reveal-chip': { useRevealChip: (selected, _animated, fade) => ({ scroll: { revealing: selected, fade }, chip: key => `layout:${key}` }) },
    '@/components/daily-chip': { todayLabel: () => '10월 12일 월요일' },
    '@/components/chilling-host-profile': { useMyOpenMeetupRequests: () => ({}) },
    '@/lib/image-upload': { canAddPostImage: () => true, MAX_POST_IMAGES: 10 },
    '@/constants/theme': { Colors: { light: {} }, Depth: { control: {}, card: {} }, Spacing: { one: 4, two: 8, three: 16, four: 24, five: 32 }, TabBarHeight: 64 },
    '@/i18n/ko': { t }, '@/lib/mock': { TAGS, CITIES: [{ id: 'vancouver', name: '밴쿠버', state: 'open' }, { id: 'toronto', name: '토론토', state: 'open' }] },
    '@/lib/city-places': { composePlace: (cityId, id) => cityId === 'toronto' && id === 'osm:way:1' ? { id, cityId, name: 'Nathan Phillips Square', latitude: 43.6525, longitude: -79.3835 } : null }, '@/lib/auth': { useAuth: () => ({ isAuthed: viewer !== null, isAuthLoading: authLoading, me: { id: viewer ?? 'guest' }, promptLogin() {} }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버', state: 'open' }, setCity: next => cityChanges.push(next) }) },
    '@/hooks/use-place-compose': { PLACE_WRITE_EVENT: 'place-write', openPlaceWriter: place => reopened.push(place) },
    '@/lib/location-provider': { useCommunityLocation: () => ({ record() {}, capture: async () => null }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/community-data': { loadListingQuota: async () => ({ used: 0, max: 3 }), createCommunityPost: (_client, input) => deferPublish ? new Promise((resolve, reject) => writes.push({ input, resolve, reject })) : Promise.resolve({ id: createdPost.id, post: createdPost }), getCommunityActionError: () => null, isContentRejected: () => false, isFirstPost: async () => false },
    '@/lib/post-maps': { withPostMap, postMapBody, googlePinUrl, googleMapsPin, withPlacePin }, '@/lib/listing-details': listingDetails, '@/lib/neighborhoods': neighborhoods,
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } },
    '@/lib/hashtags': { getSuggestedHashtags: () => [], parseHashtags: () => [], canonicalizeHashtag: value => value },
    '@/lib/ads': { adsSupported: false, feedAdPosition: adPosition }, '@/lib/supabase': { supabase: { functions: { invoke: (...args) => new Promise((resolve, reject) => drafts.push({ args, resolve, reject })) } } },
    '@/hooks/use-chat-identity': { useChatIdentity: () => null },
    '@/lib/feed-data': { groupJournalPosts, appendUniquePosts, limitBusinessPosts, pinJustPosted, todayRowsAfter, writeFabOverIntro, writeFabScroll, loadPublicFeed: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) },
    '../../supabase/functions/_shared/post-links': { splitPostAttachments: body => ({ body }) },
    '@/lib/ai-draft': aiDraft, '@/lib/post-upload': postUpload, '@/lib/push-prompt': { requestPushPrompt() {} },
    '@/lib/post-photo-consent': { loadPhotoConsentSettings: async () => photoConsent, savePostPhotoConsent: async (_client, id) => { consents.push(id); return consentSaves.shift() ?? true; } },
    'expo-image-picker': { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///photo.jpg', mimeType: 'image/jpeg' }] }), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } },
    '@/lib/post-image-picker': { isSupportedImage: () => true, preparePostImage: async asset => ({ uri: asset.uri, base64: 'AA', mimeType: 'image/jpeg' }) },
  };
  imports['@/components/screen-glow'] = glowModule(imports);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/feed-screen.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name in imports) return imports[name];
    return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : key === 'Image' ? 'Image' : key === 'default' ? { View: 'ReanimatedView' } : String(key) });
  }), requestAnimationFrame: fn => fn(), queueMicrotask: fn => fn(), setTimeout, clearTimeout });
  let cleanup;
  const render = () => { at = 0; effects.length = 0; return exports.default({ meetupsOnly, writeRequest }); };
  const refresh = () => { cleanup?.(); cleanup = effects.find(fn => String(fn).includes('return cancelFeedRequests'))(); };
  const list = () => nodes(render()).find(n => n.props?.analyticsId === 'components_feed-screen.flatlist.1').props;
  return { calls, writes, drafts, routes, feedback, consents, alerts, reopened, cityChanges, list, refresh, params, render,
    openPlace() { render(); effects.find(fn => String(fn).includes('handledWrite'))(); return render(); }, openWriter() { params.compose = '1'; render(); effects.find(fn => String(fn).includes("compose !== '1'"))(); return render(); }, openTopic: () => { render(); effects.find(fn => String(fn).includes('hashtag: undefined'))(); }, setViewer: next => { viewer = next; }, setAuthLoading: next => { authLoading = next; }, sort: () => { const props = list(); return props.renderItem({ item: null, index: 1 }).props; },
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

test('business remains a news board; only its explicit directory action opens business profiles exploration', async () => {
  const app = screen(); app.list(); app.refresh();
  app.calls[0].resolve([post('ordinary')]); await new Promise(setImmediate);
  assert.equal(nodes(app.list().renderItem({ item: post('ordinary'), index: 2 })).find(n => n.type === 'PostCard')?.props.post.id, 'ordinary');
  // 비즈니스 is not one of the six pinned chips; it is picked from the "더보기" sheet in the header.
  const business = nodes(app.render()).find(n => n.props?.analyticsId === 'feed.categories.pick' && nodes(n).some(child => child.props?.children === '비즈니스'));
  assert.ok(business); business.props.onPress();
  assert.equal(app.sort().title, '새 소식');
  assert.equal(app.routes.length, 0, 'choosing the category itself does not navigate to the directory');
  const card = nodes(app.list().renderItem({ item: post('business-news', { tag: TAGS.find(t => t.slug === 'business') }), index: 2 })).find(n => n.type === 'BusinessNewsCard');
  assert.equal(card.props.post.id, 'business-news');
  assert.ok(card.props.onPress && card.props.onAuthor, 'existing detail and profile navigation remain available');
  app.sort().action.props.onPress();
  assert.equal(app.routes.at(-1), '/businesses');
});

test('the first feed load waits for auth to settle, so a signed-in launch loads once in its own scope', async () => {
  const app = screen(); app.setViewer(null); app.setAuthLoading(true);
  app.list(); app.refresh();
  assert.equal(app.calls.length, 0, 'no guest/default-city load while the session and profile are still resolving');
  app.setViewer('member'); app.setAuthLoading(false); app.list(); app.refresh();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].args[5].viewerScope, 'member');
  app.calls[0].resolve([post('first')]); await new Promise(setImmediate);
  app.setAuthLoading(true);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['first'], 'a later sign-in spinner does not hide the loaded feed');
});

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

test('today background light is fixed to the screen; the sort row is clear until pinned, then repaints the same light at its spot', () => {
  const layout = (node, box) => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0, ...box } } });
  const app = screen({ os: 'ios' });
  let tree = nodes(app.render());
  layout(tree.find(n => n.type === 'TabContent'), { width: 400, height: 800 });
  layout(tree.find(n => n.type === 'SafeAreaView' && n.props.edges).props.children, { y: 47 });
  layout(tree.find(n => [n.props?.children].flat().some(child => child?.props?.analyticsId === 'components_feed-screen.flatlist.1')), { y: 130 });
  tree = nodes(app.render());
  const { screenGlowImage } = glowModule({});
  const glow = y => screenGlowImage(theme, 400, 800, 0, y);
  assert.equal([tree.find(n => n.type === 'TabContent').props.style].flat().find(style => style?.backgroundImage)?.backgroundImage, glow(0), 'screen-sized header light and body tint');
  const head = tree.find(n => [n.props?.children].flat(Infinity).some(child => child?.props?.analyticsId === 'feed.home'));
  assert.equal([head.props.style].flat().some(style => style?.backgroundColor), false, 'header row lets the light through');
  layout(app.list().renderItem({ item: null, index: 0 }), { height: 300 });
  const bar = () => Object.assign({}, ...[app.sort().style].flat(Infinity).filter(Boolean));
  app.list().onScroll({ nativeEvent: { contentOffset: { y: 120 } } });
  assert.equal(bar().backgroundColor, 'transparent', 'at rest the row shows the screen light behind it');
  app.list().onScroll({ nativeEvent: { contentOffset: { y: 300 } } });
  assert.equal(bar().backgroundColor, undefined, 'pinned: the row keeps its opaque background so posts stay hidden underneath');
  assert.equal(bar().backgroundImage, glow(177), 'pinned at the list top (47 + 130), so the light lines up with the header');
  assert.equal(bar().marginHorizontal, -16, 'and covers the list gutters edge to edge');
  const meetups = screen({ meetupsOnly: true });
  layout(nodes(meetups.render()).find(n => n.type === 'TabContent'), { width: 400, height: 800 });
  assert.equal([nodes(meetups.render()).find(n => n.type === 'TabContent').props.style].flat().some(style => style?.backgroundImage), false, 'other screens stay plain');
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
  const food = nodes(app.render()).find(node => node.props?.analyticsId === 'components_feed-screen.pressable.3' && nodes(node).some(child => child.props?.children === '맛집'));
  food.props.onPress(); app.list(); app.refresh();
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

test('publishing in popular mode refreshes the server ranking and keeps my new post on top (owner 2026-11-04)', async () => {
  const app = screen({ createdPost: post('just-published') }); app.list(); app.refresh();
  app.sort().onChange('popular'); app.list(); app.refresh();
  app.calls[1].resolve([post('top-ranked', { popularityScore: 99 })]); await new Promise(setImmediate);
  await app.publish();
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['just-published', 'top-ranked']);
  assert.equal(app.calls.length, 3, 'publication must refresh the ranking');
  assert.equal(app.calls[2].args[5].sort, 'popular');
  app.calls[2].resolve([post('top-ranked'), post('just-published', { likes: 2 })]); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => [p.id, p.likes]), [['just-published', 2], ['top-ranked', undefined]], 'the ranked copy replaces the local one, still on top');
  assert.equal(app.calls[2].args[4], null, 'the ranking cursor still comes from the server page');
});

test('my new post stays on top through a pull-to-refresh that brings back newer posts or leaves it out', async () => {
  const app = screen({ createdPost: post('just-published') }); app.list(); app.refresh();
  app.calls[0].resolve([post('previous')]); await new Promise(setImmediate);
  await app.publish();
  app.list().onRefresh();
  app.calls[1].resolve([post('someone-newer'), post('previous')]); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['just-published', 'someone-newer', 'previous']);
  app.setViewer(null); app.list(); app.refresh();
  app.calls[2].resolve([post('guest-view')]); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['guest-view'], 'another account never sees the pin');
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

test('today 전체 puts festivals and places after the second post, drops the date line and uses the photo-feed card (owner 2026-11-03)', async () => {
  const sectionTypes = tree => nodes(tree).filter(n => n.type === 'LocalEventsCarousel' || n.type === 'CityPopularPlaces').map(n => n.type);
  const app = screen({ os: 'ios' }); app.list(); app.refresh();
  assert.equal(app.list().accessibilityElementsHidden, true, 'the city cover shows while the first page loads');
  const posts = [post('one'), post('two'), post('three')];
  app.calls[0].resolve(posts); await new Promise(setImmediate);
  const props = app.list();
  assert.equal(props.accessibilityElementsHidden, false, 'the city cover lifts with the posts, without waiting for festivals');
  assert.deepEqual(posts.map((item, index) => sectionTypes(props.renderItem({ item, index: index + 2 }))), [[], ['CityPopularPlaces'], ['LocalEventsCarousel']], 'places after the second post; a short list ends with festivals');
  const header = props.renderItem({ item: null, index: 0 });
  assert.deepEqual(sectionTypes(header), []);
  assert.ok(!nodes(header).some(n => n.props?.children === '10월 12일 월요일'), 'no date line on Today');
  assert.equal(nodes(props.renderItem({ item: posts[0], index: 2 })).find(n => n.type === 'PostCard').props.feed, true);

  const one = screen({ os: 'ios' }); one.list(); one.refresh();
  one.calls[0].resolve([post('only')]); await new Promise(setImmediate);
  assert.deepEqual(sectionTypes(one.list().renderItem({ item: post('only'), index: 2 })), ['CityPopularPlaces', 'LocalEventsCarousel']);

  const empty = screen({ os: 'ios' }); empty.list(); empty.refresh();
  empty.calls[0].resolve([]); await new Promise(setImmediate);
  const footer = empty.list().ListFooterComponent;
  assert.ok(nodes(footer).some(n => n.props?.children === t.feed.emptyTitle));
  assert.deepEqual(sectionTypes(footer), ['CityPopularPlaces', 'LocalEventsCarousel'], 'with no posts they follow the empty state');

  const long = screen({ os: 'ios' }); long.list(); long.refresh();
  const thirty = Array.from({ length: 30 }, (_, i) => post(`p${i}`));
  long.calls[0].resolve(thirty); await new Promise(setImmediate);
  const rows = thirty.flatMap((item, index) => nodes(long.list().renderItem({ item, index: index + 2 }))
    .filter(n => n.type === 'LocalEventsCarousel' || n.type === 'CityPopularPlaces').map(n => `${index}:${n.type === 'CityPopularPlaces' ? 'places' : 'festivals'}${n.props.page}`));
  assert.deepEqual(rows, ['1:places0', '5:festivals0', '9:places1', '13:festivals1', '17:places2', '21:festivals2', '25:places3', '29:festivals3'],
    'they take turns every four posts, two posts away from the ads after posts 4, 8, 12…');

  // The web ad rule needs the list length (contentAdPosition(index, total)); without it every slot would look ad-free.
  const web = screen({ os: 'ios', adPosition: (index, total) => Number.isSafeInteger(total) && index === 1 });
  web.list(); web.refresh();
  web.calls[0].resolve(thirty); await new Promise(setImmediate);
  assert.equal(nodes(web.list().renderItem({ item: thirty[1], index: 3 })).some(n => n.type === 'CityPopularPlaces'), false, 'no row in the ad slot');
  assert.equal(nodes(web.list().renderItem({ item: thirty[2], index: 4 })).find(n => n.type === 'CityPopularPlaces')?.props.page, 0, 'the row moves past it');

  const food = nodes(app.render()).find(node => node.props?.analyticsId === 'components_feed-screen.pressable.3' && nodes(node).some(child => child.props?.children === '맛집'));
  food.props.onPress(); app.list(); app.refresh();
  app.calls.at(-1).resolve(posts); await new Promise(setImmediate);
  assert.deepEqual(posts.flatMap((item, index) => sectionTypes(app.list().renderItem({ item, index: index + 2 }))), [], 'a category list shows posts only');

  const meetups = screen({ os: 'ios', meetupsOnly: true });
  const meetupProps = meetups.list();
  assert.ok(nodes(meetupProps.renderItem({ item: null, index: 0 })).some(n => n.props?.children === '10월 12일 월요일'), 'the meetups tab keeps its title rows');
  assert.equal(nodes(meetupProps.renderItem({ item: post('meetup', { room: { id: 'room' } }), index: 1 })).find(n => n.type === 'PostCard').props.feed, false);
});

test('posting closes the writer at once, blocks a second post, and a failed upload keeps the whole draft', async () => {
  const app = screen({ deferPublish: true }); app.list(); app.refresh();
  app.calls[0].resolve([post('previous')]); await new Promise(setImmediate);
  const writerOpen = () => nodes(app.render()).some(n => n.type === 'Modal' && n.props.visible && nodes(n).some(c => c.props?.analyticsId === 'components_feed-screen.pressable.14'));
  app.openWriter();
  assert.equal(writerOpen(), true);
  await app.publish();
  assert.equal(writerOpen(), false, 'the writer closes before the server answers (owner 2026-11-04 ③)');
  assert.equal(postUpload.getPostUpload().status, 'uploading');
  assert.equal(postUpload.getPostUpload().title, '새 글');
  assert.equal(app.writes[0].input.body, '새 본문', 'the same values go to the server as before');
  app.openWriter();
  assert.equal(writerOpen(), false, 'one post at a time: the writer stays shut while one uploads');
  assert.equal(app.feedback.at(-1), 'warning');
  app.writes[0].reject(new Error('Failed to fetch')); await new Promise(setImmediate);
  assert.equal(postUpload.getPostUpload().status, 'failed');
  assert.deepEqual(Array.from(app.list().data.filter(Boolean), p => p.id), ['previous'], 'nothing is added for a failed post');
  app.openWriter();
  assert.equal(writerOpen(), true, 'editing reopens the writer');
  const tree = nodes(app.render());
  assert.equal(tree.find(n => n.props?.accessibilityLabel === t.write.titlePlaceholder).props.value, '새 글');
  assert.equal(tree.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.value, '새 본문');
  assert.equal(postUpload.getPostUpload(), null, 'the writer takes over the failed card; its draft is right here');
});

test('a retry the server calls a duplicate counts as posted: no second post, no error, and the draft clears', async () => {
  const app = screen({ deferPublish: true }); app.list(); app.refresh();
  app.calls[0].resolve([post('previous')]); await new Promise(setImmediate);
  await app.publish();
  app.writes[0].reject(new Error('Failed to fetch')); await new Promise(setImmediate);
  assert.equal(postUpload.retryPostUpload(), true);
  assert.equal(postUpload.retryPostUpload(), false, 'a double tap sends once');
  assert.equal(app.writes.length, 2);
  assert.deepEqual(app.writes[1].input, app.writes[0].input, 'the retry sends exactly the kept draft');
  app.writes[1].reject(new Error('DUPLICATE_POST')); await new Promise(setImmediate);
  assert.equal(postUpload.getPostUpload().status, 'done');
  assert.equal(app.feedback.filter(kind => kind === 'warning').length, 1, 'only the first, real failure warned');
  assert.equal(app.calls.length, 2, 'the feed reloads to show the post the earlier try saved');
  assert.equal(nodes(app.render()).find(n => n.props?.accessibilityLabel === t.write.titlePlaceholder).props.value, '');
  postUpload.clearPostUpload();
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

test('Today and meetup headers share profile switching and retain narrow-header wrapping', () => {
  for (const meetupsOnly of [false, true]) {
    const app = screen({ os: 'ios', meetupsOnly, width: 320 });
    const avatar = nodes(app.render()).find(n => n.type === 'ProfileAvatarButton');
    assert.ok(avatar);
    assert.notEqual(avatar.props.enableBusinessSwitch, false, 'Both own-avatar headers must allow the shared profile menu.');
    assert.equal(typeof avatar.props.onBusinessSwitchAvailabilityChange, 'function');
    avatar.props.onBusinessSwitchAvailabilityChange(true);
    const home = nodes(app.render()).find(n => n.props?.analyticsId === 'feed.home');
    assert.ok(home.props.style.some(style => style?.width === '100%'), 'The existing narrow-header second row makes room for the extra44pt switch control.');
  }
});


test('Home magnifier opens the common search route without clearing the current feed', () => {
  const app=screen(),tree=app.render();
  nodes(tree).find(node=>node.props?.analyticsId==='components_feed-screen.pressable.2').props.onPress();
  assert.equal(app.routes[0]?.pathname,'/search');
  assert.equal(nodes(app.render()).some(node=>node.type==='Modal'&&node.props.visible),false,'Ordinary search no longer opens the old post-only modal');
  assert.ok(app.feedback.includes('selection'));
});

test('Home search is a magnifier next to the profile that still says what it finds; the map is a tab, and writing is a floating button on native', () => {
  const app = screen(), tree = app.render();
  const search = nodes(tree).find(node => node.props?.analyticsId === 'components_feed-screen.pressable.2');
  assert.equal(search.props.accessibilityRole, 'button');
  assert.equal(search.props.accessibilityLabel, '통합검색', 'screen readers hear the name of the screen it opens (QA B12-4)');
  assert.equal(nodes(search).some(node => node.props?.children === '통합검색'), false, 'no wide search box above the category chips (owner 2026-11-01)');
  const row = nodes(tree).find(node => [node.props?.children].flat(Infinity).some(child => child?.props?.analyticsId === 'feed.home'));
  const items = [row.props.children].flat(Infinity).filter(Boolean);
  const at = items.findIndex(child => nodes(child).includes(search));
  assert.ok(at > 0, 'the magnifier sits in the same top row as the logo');
  assert.equal(typeof items[at + 1]?.props?.onBusinessSwitchAvailabilityChange, 'function', 'right before the profile button');
  assert.equal(nodes(tree).some(node => node.props?.analyticsId === 'discovery.open'), false, 'no map icon stays in the header');
  assert.equal(nodes(app.list().renderItem({ item: null, index: 0 })).some(node => node.props?.analyticsId === 'discovery.open'), false, 'the rent·used map pill is gone; the map is a tab');
  assert.equal(nodes(tree).some(node => node.props?.analyticsId === 'feed.write'), false, 'web keeps its write tab');
  for (const width of [390, 430, 344]) {
    const native = screen({ os: 'ios', width });
    const write = nodes(native.render()).find(node => node.props?.analyticsId === 'feed.write');
    assert.equal(write.props.accessibilityLabel, t.tabs.write, 'screen readers still hear 글쓰기');
    assert.equal(nodes(write).some(node => node.props?.children === t.tabs.write), false, 'a round + with no words on every width (owner 2026-11-13, QA B8-1)');
    const look = Object.assign({}, ...[write.props.style({ pressed: false })].flat(Infinity).filter(Boolean));
    assert.ok(look.width >= 44 && look.minHeight >= 44 && look.width === look.minHeight && look.borderRadius >= look.width / 2, 'a 44pt+ circle');
    write.props.onPress();
    assert.equal(native.feedback.at(-1), 'reaction');
    const shown = () => nodes(native.render()).some(node => node.props?.analyticsId === 'feed.write');
    native.list().onScrollBeginDrag(); native.list().onScroll({ nativeEvent: { contentOffset: { y: 60 } } });
    assert.equal(shown(), false, 'reading down, it is off the cards (QA B8·H42-3)');
    native.list().onScroll({ nativeEvent: { contentOffset: { y: 20 } } });
    assert.equal(shown(), true, 'back up, it is there again');
  }
  // 3D: a pill's two end caps met in a lemon with a seam on the square button, under a pencil (QA new-fab-shape); the 만들기 coin and + instead.
  const clayWrite = nodes(screen({ os: 'ios', clay: true }).render()).find(node => node.props?.analyticsId === 'feed.write');
  const parts = nodes(clayWrite).map(node => node.type?.name ?? node.type);
  assert.ok(parts.includes('ClayCoinFill') && !parts.includes('ClayPillFill'), 'a round clay coin, not pill caps');
  assert.equal(nodes(clayWrite).find(node => node.type?.name === 'ClayIcon').props.clay, 'plus');
});

test('the SNS photo box shows only with a photo, starts from the setting, and its save never fails the post', async () => {
  const box = app => nodes(app.render()).find(n => n.props?.analyticsId === 'compose.photo-consent');
  const addPhoto = async app => { nodes(app.render()).find(n => n.props?.analyticsId === 'components_feed-screen.pressable.25').props.onPress(); await new Promise(setImmediate); };
  const app = screen({ createdPost: post('with-photo'), photoConsent: { on: true, consentedPosts: 0 }, consentSaves: [false] }); app.list(); app.refresh();
  app.calls[0].resolve([]); await new Promise(setImmediate);
  app.openWriter(); await new Promise(setImmediate);
  assert.equal(box(app), undefined, 'no photo, no box');
  await addPhoto(app);
  assert.equal(box(app).props.accessibilityRole, 'checkbox');
  assert.equal(box(app).props.accessibilityState.checked, true, 'the setting is the starting value');
  box(app).props.onPress();
  assert.equal(box(app).props.accessibilityState.checked, false);
  assert.equal(app.feedback.at(-1), 'selection');
  box(app).props.onPress();
  await app.publish(); await new Promise(setImmediate);
  assert.deepEqual(Array.from(app.consents), ['with-photo'], 'consent is saved for the post that went up');
  assert.equal(postUpload.getPostUpload().status, 'done', 'a missed consent save leaves the post posted');
  assert.equal(postUpload.getPostUpload().notice, 'SNS에 소개해도 된다는 체크만 저장이 안 됐어요');
  postUpload.clearPostUpload();

  const unchecked = screen({ createdPost: post('no-consent'), photoConsent: { on: false, consentedPosts: 0 } }); unchecked.list(); unchecked.refresh();
  unchecked.calls[0].resolve([]); await new Promise(setImmediate);
  unchecked.openWriter(); await new Promise(setImmediate); await addPhoto(unchecked);
  assert.equal(box(unchecked).props.accessibilityState.checked, false);
  await unchecked.publish(); await new Promise(setImmediate);
  assert.deepEqual(Array.from(unchecked.consents), [], 'an unticked box sends nothing');
  assert.equal(postUpload.getPostUpload().notice, undefined);
  postUpload.clearPostUpload();

  const older = screen({ createdPost: post('old-server'), photoConsent: null }); older.list(); older.refresh();
  older.calls[0].resolve([]); await new Promise(setImmediate);
  older.openWriter(); await new Promise(setImmediate); await addPhoto(older);
  assert.equal(box(older), undefined, 'an older server has no consent calls, so the box stays hidden');
});

test('the home category row scrolls the chosen chip into view (QA Q07)', () => {
  const app = screen();
  const row = () => nodes(app.render()).find(n => n.props?.analyticsId === 'components_feed-screen.scrollview.1');
  assert.equal(row().props.revealing, 'all');
  // QA B7-1 faded the cut end on Android; a fixed fadingEdgeLength also dimmed 전체 before any scroll (QA new-left-fade), so the hook fades only an end with more past it.
  const android = nodes(screen({ os: 'android' }).render()).find(n => n.props?.analyticsId === 'components_feed-screen.scrollview.1');
  assert.deepEqual([android.props.fade, android.props.fadingEdgeLength], [true, undefined], 'Android: no fixed fade on both ends');
  assert.equal(row().props.fade, false, 'the prop is Android only');
  const chips = nodes(row()).filter(n => typeof n.props?.onLayout === 'string').map(n => n.props.onLayout);
  assert.ok(chips.includes('layout:all') && chips.includes(`layout:${TAGS.find(tag => tag.slug === 'festival').id}`), 'every chip reports where it sits');
  nodes(row()).find(n => n.props?.analyticsId === 'components_feed-screen.pressable.3' && n.props.selected === false).props.onPress();
  assert.notEqual(row().props.revealing, 'all', 'a new choice is the chip the row brings into view');
});

test('이 장소로 글쓰기: a new draft opens with the map place in its city; a draft in progress is asked first and kept on no', () => {
  const app = screen();
  const tree = () => nodes(app.render());
  const writerOpen = () => tree().some(n => n.type === 'Modal' && n.props.visible && nodes(n).some(c => c.props?.analyticsId === 'components_feed-screen.pressable.14'));
  const body = () => tree().find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.value;
  const close = () => tree().find(n => n.props?.analyticsId === 'components_feed-screen.pressable.14').props.onPress();
  const fromMap = () => { Object.assign(app.params, { place: 'osm:way:1', placeCity: 'toronto' }); app.openWriter(); };
  const answer = text => app.alerts.at(-1)[2].find(button => button.text === text).onPress();
  fromMap();
  assert.equal(writerOpen(), true);
  assert.deepEqual(googleMapsPin(postMapBody(body()).url), { latitude: 43.6525, longitude: -79.3835 }, 'the same pin the place search attaches');
  assert.equal(postMapBody(body()).label, 'Nathan Phillips Square');
  assert.ok(tree().some(n => [n.props?.children].flat().includes('토론토')), 'the post takes the place’s city');
  assert.equal(app.params.place, undefined, 'the place is read once');
  assert.equal(app.alerts.length, 0, 'a new draft is not asked');

  tree().find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.onChangeText('쓰던 글');
  close();
  fromMap();
  assert.equal(writerOpen(), false, 'a draft in progress is asked before the writer opens');
  assert.deepEqual(app.alerts.at(-1).slice(0, 2), ['쓰던 글이 있어요', '쓰던 글에 이 장소를 붙일까요?']);
  answer('그대로 두기');
  assert.equal(writerOpen(), true);
  assert.equal(body(), '쓰던 글', 'no keeps the draft exactly');
  close();
  fromMap();
  answer('붙이기');
  assert.equal(postMapBody(body()).body, '쓰던 글');
  assert.equal(postMapBody(body()).label, 'Nathan Phillips Square');

  close();
  Object.assign(app.params, { place: 'osm:way:404', placeCity: 'toronto' });
  const before = body(), asked = app.alerts.length;
  app.openWriter();
  assert.equal(body(), before, 'a place the writer would not list attaches nothing');
  assert.equal(app.alerts.length, asked);
});

test('a short screen folds the sort line only for 부동산·구인구직·중고거래 (owner 2026-11-13, QA B12-1)', () => {
  const pick = (app, label) => nodes(app.render()).find(n => ['components_feed-screen.pressable.3', 'feed.categories.pick'].includes(n.props?.analyticsId) && nodes(n).some(c => c.props?.children === label)).props.onPress();
  for (const [height, folded] of [[731, true], [667, true], [915, false]]) {
    const app = screen({ os: 'android', height });
    assert.equal(app.sort().compact, false, `${height}: 전체 keeps its sort line`);
    for (const label of ['부동산', '구인구직', '중고거래']) { pick(app, label); assert.equal(app.sort().compact, folded, `${height} ${label}`); }
    pick(app, '맛집');
    assert.equal(app.sort().compact, false, `${height}: other boards keep it`);
  }
});

test('이 장소로 글쓰기 floats only the writer over the place, loads no feed, and the post leaves 오늘 alone (owner 2026-11-13, QA B10-2)', async () => {
  const place = { id: 'osm:way:1', cityId: 'toronto', name: 'Nathan Phillips Square', latitude: 43.6525, longitude: -79.3835 };
  const app = screen({ os: 'android', createdPost: post('from-place', { cityId: 'toronto' }), writeRequest: { place } });
  let tree = nodes(app.render());
  assert.equal(tree.some(n => n.props?.analyticsId === 'components_feed-screen.flatlist.1'), false, 'no feed is drawn behind the writer');
  assert.equal(tree.some(n => n.props?.analyticsId === 'feed.write'), false);
  app.refresh();
  assert.equal(app.calls.length, 0, 'no feed request');
  tree = nodes(app.openPlace());
  const writer = tree.find(n => n.type === 'Modal' && n.props.visible && nodes(n).some(c => c.props?.analyticsId === 'components_feed-screen.pressable.14'));
  assert.ok(writer, 'the writer is open over the screen in view');
  assert.equal(postMapBody(tree.find(n => n.props?.accessibilityLabel === t.write.bodyLabel).props.value).label, 'Nathan Phillips Square');
  tree.find(n => n.props?.analyticsId === 'components_feed-screen.pressable.14').props.onPress();
  assert.equal(nodes(app.render()).some(n => n.type === 'Modal' && n.props.visible && nodes(n).some(c => c.props?.analyticsId === 'components_feed-screen.pressable.14')), false, 'closing leaves the place where it was; nothing navigates');
  assert.deepEqual(app.routes, []);
  app.openPlace();
  assert.equal(nodes(app.render()).some(n => n.type === 'Modal' && n.props.visible), false, 'the same request does not reopen on a re-render');
  await app.publish(); await new Promise(setImmediate);
  assert.equal(postUpload.getPostUpload().status, 'done', 'the post goes up');
  assert.deepEqual(app.cityChanges, [], 'the city and 오늘 list stay as they were (no 방금 올린 글 card)');
  postUpload.getPostUpload().edit();
  assert.deepEqual(app.reopened, [null], '수정하기 reopens this writer with its draft');
  postUpload.clearPostUpload();
});
