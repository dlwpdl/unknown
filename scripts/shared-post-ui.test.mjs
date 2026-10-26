import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translateUi, translationsFor } from '../src/i18n/index.ts';
import { appendUniquePosts, getPostImageSource } from '../src/lib/feed-data.ts';
import { chillingSchedule } from '../src/lib/chilling.ts';
import * as sharing from '../src/lib/sharing.ts';
import * as sharedPostReturn from '../src/lib/shared-post-return.ts';
import { getOAuthCode } from '../src/lib/kakao-auth.ts';
import { hideContent, subscribeVisibility, visibilityRevision } from '../src/lib/content-visibility.ts';
import { count, t } from '../src/i18n/ko.ts';
import { uniqueHashtags } from '../src/lib/hashtags.ts';
import { postLocationUrl, postMapBody } from '../src/lib/post-maps.ts';
import { postInfoParts } from '../src/lib/post-info.ts';
import { visibleTranslationSource } from './test-meetup-source-imports.mjs';
import { splitPostPhotoCredits } from '../src/lib/post-photo-credits.ts';
import * as postLinks from '../supabase/functions/_shared/post-links.ts';
import * as postReactions from '../src/lib/post-reactions.ts';

const id = '9f100000-0000-4000-8000-000000000001';
const otherId = '9f100000-0000-4000-8000-000000000002';
const link = `https://gling.ej-entertainment.com/post?id=${id}`;
const legacyGatewayLink = `https://gling-share-preview.vercel.app/share/${id}`;
const gatewayLink = 'https://gling-share-preview.vercel.app/s/nxAAAAAAQACAAAAAAAAAAQ';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => nodes(tree).filter(node => node.type === 'Text').flatMap(node => [node.props.children].flat(Infinity)).filter(value => typeof value === 'string').join(' ');
const conversation = (conversationId, title = conversationId) => ({ id: conversationId, kind: 'direct', status: 'active', requesterId: null, groupPostId: null, meetupCategory: null,
  title, isGroupHost: false, otherUser: { id: 'peer', nickname: title, verificationLevel: 1 }, latestBody: null, latestAt: '2026-10-11T18:00:00Z' });
const page = (conversations, cursor = null) => ({ conversations, pendingCount: 0, cursor, selectedConversation: null });
const post = () => ({ id, title: '페스티벌 같이 가요', body: 'private-body-and-venue-sentinel', author: { id: 'viewer' }, tag: { slug: 'festival', label: '페스티벌' },
  room: { id: 'group', title: '함께 가요', memberCount: 1, capacity: 8, verifiedOnly: false, eventKind: 'group', cadence: '매주 토요일', applicationQuestion: 'private-question-sentinel' } });
const preview = (title = '공유 카드') => ({ id, title, kind: 'meetup', city: '밴쿠버', label: '모임', schedule: null, imagePath: null, closed: false });

// Execute the real hooks and handlers; a keyed single-child wrapper follows normal React remount cleanup.
function mount(file, name, data = {}, props = {}) {
  let state = [], index = 0, effects = [], layouts = [], pendingPassive = [], tree, childKey, childType, disposed = false;
  const calls = [], auth = { isAuthed: true, isAuthLoading: false, me: { id: 'viewer' }, ...data.auth };
  auth.promptLogin = reason => calls.push(['login', reason]);
  const client = { auth: { exchangeCodeForSession: code => { calls.push(['exchange', code]); return data.exchange?.(code) ?? Promise.resolve({ error: null }); } },
    rpc: async (...args) => { calls.push(['rpc', ...args]); return { data: null }; } };
  const stored = new Map(); if (data.returnPath != null) stored.set(sharing.SHARED_POST_RETURN_KEY, data.returnPath);
  const nativeStored = new Map();
  const nativeStorage = {
    getItem: async key => nativeStored.get(key) ?? null,
    setItem: async (key, value) => { calls.push(['native-return-write', key]); await data.nativeSet?.(key, value); nativeStored.set(key, value); },
    removeItem: async key => { nativeStored.delete(key); },
  };
  const location = new URL(data.href ?? 'https://gling.ej-entertainment.com/auth/callback?code=test-oauth-code');
  const browser = { location, opener: data.opener ?? null, sessionStorage: {
    getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key),
  } };
  const clean = () => state.forEach(hook => hook?.cleanup?.());
  const react = {
    useState(initial) { const frame = state, slot = index++; if (!(slot in frame)) frame[slot] = typeof initial === 'function' ? initial() : initial;
      return [frame[slot], value => { frame[slot] = typeof value === 'function' ? value(frame[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useEffect(fn, deps) { const frame = state, slot = index++, previous = frame[slot];
      if (previous && deps && deps.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      frame[slot] = { deps, cleanup: previous?.cleanup }; effects.push(() => { frame[slot].cleanup?.(); frame[slot].cleanup = fn(); }); },
    useMemo(fn, deps) { const slot = index++, previous = state[slot]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) state[slot] = { value: fn(), deps }; return state[slot].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useSyncExternalStore(_subscribe, snapshot) { index++; return snapshot(); },
  };
  react.useLayoutEffect = (fn, deps) => {
    const frame = state, slot = index++, previous = frame[slot];
    if (previous && deps && deps.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    frame[slot] = { deps, cleanup: previous?.cleanup };
    layouts.push(() => { frame[slot].cleanup?.(); frame[slot].cleanup = fn(); });
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View', Modal: 'Modal', StyleSheet: { create: value => value }, Animated: { Value: class { interpolate() { return 0; } }, View: 'Animated.View' }, Easing: {}, Platform: { OS: data.os ?? 'ios' }, Alert: { alert: (...args) => calls.push(['alert', ...args]) },
      Share: { sharedAction: 'sharedAction', dismissedAction: 'dismissedAction', share: payload => { calls.push(['share', payload]); return data.share?.(payload) ?? Promise.resolve({ action: 'sharedAction' }); } } },
    'react-native-reanimated': { useReducedMotion: () => true },
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    'expo-router': { useLocalSearchParams: () => data.params ?? {}, useIsFocused: () => data.focused !== false, useFocusEffect: fn => react.useEffect(() => data.focused === false ? undefined : fn(), [fn, data.focused]), useRouter: () => ({ canGoBack: () => false, back: () => calls.push(['back']), push: path => calls.push(['navigate', path]), replace: path => calls.push(['navigate', path]) }) },
    '@react-native-async-storage/async-storage': { __esModule: true, default: nativeStorage },
    '@/lib/shared-post-return': sharedPostReturn,
    'expo-router/head': { default: 'Head' },
    '@/components/public-web/metadata': { generatePrivateMetadata: () => ({ robots: 'noindex, nofollow' }) },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' }, '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/themed-view': { ThemedView: 'View' }, '@/components/gling-loader': { GlingLoader: 'Loader' }, '@/components/state-card': { StateCard: 'StateCard' },
    '@/components/post-body': { PostBody: 'PostBody' },
    '@/components/content-translation': { TranslationControl: 'TranslationControl', TranslatedCommentBody: 'TranslatedCommentBody' },
    '@/hooks/use-content-translation': { useContentTranslation: (_kind, _id, source) => ({ display: source, translated: false, original: true }) },
    '@/lib/translation-source': { visibleTranslationSource },
    '@/lib/post-photo-credits': { splitPostPhotoCredits },
    '@/lib/post-reactions': postReactions,
    '@/lib/content-translation': { CONTENT_TRANSLATION_VIEWABILITY: { viewAreaCoveragePercentThreshold: 2, minimumViewTime: 250 } },
    '../../supabase/functions/_shared/post-links': postLinks, '@/components/post-map-link': { PostMapLink: 'PostMapLink' },
    '@/components/post-attachment-link': { PostAttachmentLink: 'PostAttachmentLink' }, '@/lib/post-info': { postInfoParts }, '@/lib/mock': { CITIES: [] },
    '@/components/report-sheet': { ReportSheet: 'ReportSheet' }, '@/components/trust-badge': { TrustBadge: 'TrustBadge' },
    '@/components/manner-summary': { MannerSummary: 'MannerSummary' },
    '@/components/post-ad-label': { PostAdLabel: 'PostAdLabel' },
    '@/components/raised-action-button': { RaisedActionButton: 'RaisedActionButton' },
    '@/constants/theme': { Depth: {}, Spacing: { one: 4, two: 8, three: 16 } }, '@/i18n/ko': { count, t },
    '@/lib/hashtags': { uniqueHashtags }, '@/lib/post-maps': { postLocationUrl, postMapBody }, '@/lib/meetup-ai': { visibleMeetupBody: body => body },
    '@/components/post-share-sheet': { PostShareSheet: 'PostShareSheet' }, '@/components/post-detail': { PostDetail: 'PostDetail' }, '@/components/shared-link-card': { SharedPreviewContent: 'SharedPreviewContent' },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/hooks/use-content-visibility': { useContentVisibility: () => data.hidden ?? unhidden },
    '@/hooks/use-chat-identity': { useChatIdentity: () => data.businessIdentity ?? null },
    '@/lib/business-chat': { startBusinessConversation: async (...args) => { calls.push(['business-start', ...args.slice(1)]); return 'business-conversation'; }, sendBusinessChatMessage: async (...args) => { calls.push(['business-send', ...args.slice(1)]); return 'business-message'; } },
    '@/lib/merchant-source': { merchantEventId: () => 'c1850000-0000-4000-8000-000000000001' },
    '@/lib/chat-identity': { chatBusinessIdentity: () => data.businessIdentity ?? null },
    '@/lib/auth': { useAuth: () => auth }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) },
    '@/lib/community-data': { recordPostShare: async () => { calls.push(['count-share']); return 1; }, loadTradeProfile: async () => null, startDirectConversation: async () => 'direct-conversation', loadConversations: (...args) => { calls.push(['inbox', ...args.slice(1)]); return data.inbox?.(...args) ?? Promise.resolve(page([conversation('chat-a')])); },
      sendDirectMessage: (...args) => { calls.push(['send', ...args.slice(1)]); return data.send?.(...args) ?? Promise.resolve('saved-message'); } },
    '@/lib/feed-data': { appendUniquePosts, getPostImageSource, loadPublicPost: (...args) => { calls.push(['full-post', args[1], auth.me.id]); return data.fullPost?.(...args) ?? Promise.resolve(post()); } },
    '@/lib/chilling': { chillingSchedule }, '@/lib/sharing': sharing, '@/lib/kakao-auth': { getOAuthCode },
    '@/lib/user-profile': { loadMannerSummary: async () => ({ meeting: { participants: 0, score: null }, chat: { participants: 0, score: null } }) },
    '@/lib/content-visibility': { subscribeVisibility, visibilityRevision },
    '@/lib/shared-link-preview': { loadSharedLinkPreview: (...args) => { calls.push(['preview', args[1], auth.me.id]); return data.preview?.(...args) ?? Promise.resolve(preview()); } },
    '@/lib/supabase': { supabase: client },
    ...data.imports,
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const resolve = withLanguageImports(key => { assert.ok(key in imports, `Known import: ${key}`); return imports[key]; });
  vm.runInNewContext(source, { exports, Date, Intl, Error, URL, window: browser, require: key => data.language && key === '@/hooks/use-language' ? { useLanguage: () => ({ t: translationsFor(data.language()), tr: (text, ...args) => translateUi(data.language(), text, ...args), locale: data.language() === 'en' ? 'en-CA' : 'ko-KR' }) } : resolve(key),
    navigator: { share: payload => { calls.push(['share', payload]); return data.share?.(payload) ?? Promise.resolve(); }, clipboard: { writeText: value => { calls.push(['copy', value]); return Promise.resolve(); } } } });
  const render = (deferPassive = false) => {
    if (!deferPassive) { const pending = pendingPassive; pendingPassive = []; pending.forEach(fn => fn()); }
    assert.equal(disposed, false); index = 0; effects = []; layouts = []; tree = exports[name](props);
    if (typeof tree?.type === 'function') {
      if (tree.type !== childType || tree.key !== childKey) { clean(); state = []; childType = tree.type; childKey = tree.key; }
      index = 0; effects = []; layouts = []; tree = tree.type(tree.props);
    }
    layouts.forEach(fn => fn());
    if (deferPassive) pendingPassive.push(...effects); else effects.forEach(fn => fn());
    return tree;
  };
  render();
  return { auth, calls, props, browser, nativeStored, focus(value) { data.focused = value; }, render, renderWithoutPassive: () => render(true), nodes: () => nodes(tree), async settle() { for (let i = 0; i < 3; i++) { await tick(); render(); } },
    unmount() { if (!disposed) { clean(); disposed = true; } } };
}
const unhidden = () => false;
const control = (harness, analyticsId) => { const found = harness.nodes().find(node => node.props?.analyticsId === analyticsId); assert.ok(found, `Missing control: ${analyticsId}`); return found; };
test('native shared-post login persists the same destination before opening login and clears it after completion', async context => {
  const ui = mount('../src/app/post/[id].tsx', 'default', { params: { id }, auth: { isAuthed: false } }); context.after(() => ui.unmount()); await ui.settle();
  await control(ui, 'shared.post.login').props.onPress(); await ui.settle();
  const key = sharing.SHARED_POST_RETURN_KEY + '.native';
  assert.equal(JSON.parse(ui.nativeStored.get(key)).path, `/post?id=${id}&invite=1`);
  assert(ui.calls.findIndex(row => row[0] === 'native-return-write') < ui.calls.findIndex(row => row[0] === 'login'));
  ui.focus(false); ui.auth.isAuthed = true; await ui.settle();
  assert.equal(ui.nativeStored.has(key), true, 'a post hidden behind OAuth must not clear the callback destination');
  ui.focus(true); await ui.settle(); assert.equal(ui.nativeStored.has(key), false);
});
test('native login keeps its original post and reports a failed destination write without opening a dead-end login', async context => {
  const ui = mount('../src/app/post/[id].tsx', 'default', { params: { id }, auth: { isAuthed: false }, nativeSet: async () => { throw Error('PRIVATE storage detail'); } }); context.after(() => ui.unmount()); await ui.settle();
  await control(ui, 'shared.post.login').props.onPress(); await ui.settle();
  assert.equal(ui.calls.filter(row => row[0] === 'login').length, 0);
  assert.match(text(ui.render()), /다시 시도/); assert.doesNotMatch(text(ui.render()), /PRIVATE/);
});
test('leaving the native shared post while its destination is being stored does not open login on another screen', async context => {
  const pending = deferred();
  const ui = mount('../src/app/post/[id].tsx', 'default', { params: { id }, auth: { isAuthed: false }, nativeSet: () => pending.promise }); context.after(() => ui.unmount()); await ui.settle();
  const write = control(ui, 'shared.post.login').props.onPress(); await tick(); ui.focus(false); ui.render(); pending.resolve(); await write; await ui.settle();
  assert.equal(ui.calls.filter(row => row[0] === 'login').length, 0);
});
test('native shared login is single-flight while the destination is being saved', async context => {
  const pending = deferred();
  const ui = mount('../src/app/post/[id].tsx', 'default', { params: { id }, auth: { isAuthed: false }, nativeSet: () => pending.promise }); context.after(() => ui.unmount()); await ui.settle();
  control(ui, 'shared.post.login').props.onPress(); control(ui, 'shared.post.login').props.onPress(); await tick();
  assert.equal(ui.calls.filter(row => row[0] === 'native-return-write').length, 1);
  pending.resolve(); await ui.settle(); assert.equal(ui.calls.filter(row => row[0] === 'login').length, 1);
});
test('a completed account switch during native destination storage never reopens the old login prompt', async context => {
  const pending = deferred();
  const ui = mount('../src/app/post/[id].tsx', 'default', { params: { id }, auth: { isAuthed: false }, nativeSet: () => pending.promise }); context.after(() => ui.unmount()); await ui.settle();
  control(ui, 'shared.post.login').props.onPress(); await tick(); ui.auth.isAuthed = true; await ui.settle();
  pending.resolve(); await ui.settle(); assert.equal(ui.calls.filter(row => row[0] === 'login').length, 0);
  assert(ui.nodes().some(node => node.type === 'PostDetail'));
});
test('a retained guest login handler cannot dispatch after the new account commits before passive cleanup', async context => {
  const ui = mount('../src/app/post/[id].tsx', 'default', { params: { id }, auth: { isAuthed: false } }); context.after(() => ui.unmount()); await ui.settle();
  const retained = control(ui, 'shared.post.login').props.onPress;
  ui.auth.isAuthed = true; ui.auth.me = { id: 'new-account' }; ui.renderWithoutPassive();
  retained(); await tick(); await tick();
  assert.equal(ui.calls.filter(row => row[0] === 'native-return-write').length, 0);
  assert.equal(ui.calls.filter(row => row[0] === 'login').length, 0);
});
test('external and forged hosts cannot trigger an internal card lookup or navigation', async context => {
  for (const url of [`https://evil.test/share/${id}`, `https://gling.ej-entertainment.com.evil.test/share/${id}`, `https://gling.ej-entertainment.com@evil.test/share/${id}`,
    `https://evil.test@gling.ej-entertainment.com/share/${id}`, `http://gling.ej-entertainment.com/share/${id}`, `https://gling.ej-entertainment.com/post?id=${id}&id=${otherId}`]) {
    const harness = mount('../src/components/shared-link-card.tsx', 'SharedLinkCard', {}, { url }); context.after(() => harness.unmount()); await harness.settle();
    assert.equal(harness.calls.filter(call => call[0] === 'preview').length, 0, url); assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0); assert.equal(harness.render(), null);
  }
});

test('a card discards the previous viewer response and routes the current meetup preview through the protected post', async context => {
  const first = deferred(), second = deferred(); let requests = 0;
  const harness = mount('../src/components/shared-link-card.tsx', 'SharedLinkCard', { preview: () => ++requests === 1 ? first.promise : second.promise }, { url: link }); context.after(() => harness.unmount());
  harness.auth.me = { id: 'another-viewer' }; harness.render(); first.resolve(preview('Old viewer response')); await harness.settle();
  assert.equal(harness.render(), null, 'old viewer response cannot become a visible card');
  second.resolve(preview('Current viewer card')); await harness.settle();
  const open = control(harness, 'chat.shared-link.open'); assert.ok(open.props.accessibilityLabel.includes('Current viewer card')); open.props.onPress();
  const destination = harness.calls.find(call => call[0] === 'navigate')[1];
  assert.equal(destination.pathname, '/post/[id]'); assert.equal(destination.params.id, id); assert.equal(destination.params.invite, '1');
});

test('a card immediately hides a reported post and discards its in-flight preview', async context => {
  const response = deferred(), data = { preview: () => response.promise, hidden: unhidden };
  const harness = mount('../src/components/shared-link-card.tsx', 'SharedLinkCard', data, { url: link }); context.after(() => harness.unmount());
  data.hidden = () => true; harness.render(); response.resolve(preview()); await harness.settle();
  assert.equal(harness.render(), null); assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0);
});

test('a blocked-author visibility revision immediately drops a card without requiring a public author id', async context => {
  const refreshed = deferred(); let requests = 0;
  const harness = mount('../src/components/shared-link-card.tsx', 'SharedLinkCard', { hidden: unhidden,
    preview: () => ++requests === 1 ? Promise.resolve(preview()) : refreshed.promise }, { url: link }); context.after(() => harness.unmount()); await harness.settle();
  assert.ok(control(harness, 'chat.shared-link.open'));
  hideContent('viewer', 'user', 'blocked-author-without-public-preview-id');
  assert.equal(harness.render(), null, 'global block revision must hide an old card before its author can be rechecked on the server');
  assert.equal(harness.calls.filter(call => call[0] === 'preview').length, 2);
  refreshed.resolve(null); await harness.settle(); assert.equal(harness.render(), null);
});

test('guest post routes keep the preview visible and request login only on an explicit press', async context => {
  const harness = mount('../src/app/post/[id].tsx', 'default', { auth: { isAuthed: false, isAuthLoading: true }, params: { id } }); context.after(() => harness.unmount());
  await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'preview').length, 1); assert.equal(harness.calls.filter(call => call[0] === 'full-post').length, 0);
  assert.equal(harness.calls.filter(call => call[0] === 'login').length, 0); assert.ok(!harness.nodes().some(node => node.type === 'PostDetail'));
  harness.auth.isAuthLoading = false; await harness.settle(); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'login').length, 0, 'auth and preview rerenders leave the guest preview unobstructed');
  assert.ok(harness.nodes().some(node => node.type === 'SharedPreviewContent'));
  control(harness, 'shared.post.login').props.onPress(); await harness.settle(); assert.equal(harness.calls.filter(call => call[0] === 'login').length, 1, 'the explicit login control opens login after retaining its destination');
});

test('unavailable guest previews never load full content or prompt login', async context => {
  for (const unavailable of [async () => null, async () => { throw new Error('unavailable'); }]) {
    const harness = mount('../src/app/post/[id].tsx', 'default', { auth: { isAuthed: false }, params: { id }, preview: unavailable }); context.after(() => harness.unmount()); await harness.settle();
    assert.equal(harness.calls.filter(call => call[0] === 'full-post').length, 0); assert.equal(harness.calls.filter(call => call[0] === 'login').length, 0);
    assert.ok(!harness.nodes().some(node => node.type === 'PostDetail')); assert.ok(!text(harness.render()).includes('private-body'));
  }
});

test('authenticated routes reveal the body and immediately remove the cached body on signout', async context => {
  const harness = mount('../src/app/post/[id].tsx', 'default', { params: { id } }); context.after(() => harness.unmount()); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'full-post').length, 1); assert.equal(harness.calls.filter(call => call[0] === 'preview').length, 0);
  assert.equal(harness.nodes().find(node => node.type === 'PostDetail')?.props.post.body, 'private-body-and-venue-sentinel');
  harness.auth.isAuthed = false; harness.auth.me = { id: 'guest' }; harness.render();
  assert.ok(!harness.nodes().some(node => node.type === 'PostDetail'), 'signout must hide cached content before a preview response arrives');
  assert.ok(!JSON.stringify(harness.render()).includes('private-body-and-venue-sentinel')); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'full-post').length, 1); assert.equal(harness.calls.filter(call => call[0] === 'preview').length, 1);
});

test('signout discards a late full-post response without exposing its body', async context => {
  const response = deferred(), harness = mount('../src/app/post/[id].tsx', 'default', { params: { id }, fullPost: () => response.promise }); context.after(() => harness.unmount());
  harness.auth.isAuthed = false; harness.auth.me = { id: 'guest' }; harness.render(); response.resolve(post()); await harness.settle();
  assert.ok(!harness.nodes().some(node => node.type === 'PostDetail')); assert.ok(!JSON.stringify(harness.render()).includes('private-body-and-venue-sentinel'));
});

test('post and share browser paths preserve the invitation return when the guest chooses login', async context => {
  for (const path of [`/share/${id}`, `/post/${id}`, `/post?id=${id}`]) {
    const harness = mount('../src/app/post/[id].tsx', 'default', { os: 'web', href: `https://gling.ej-entertainment.com${path}`, params: path.includes('?') ? { id } : {}, auth: { isAuthed: false } }); context.after(() => harness.unmount()); await harness.settle();
    assert.equal(harness.calls.find(call => call[0] === 'preview')?.[1], id); assert.equal(harness.calls.filter(call => call[0] === 'full-post').length, 0);
    assert.equal(harness.calls.filter(call => call[0] === 'login').length, 0);
    assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), null);
    control(harness, 'shared.post.login').props.onPress();
    assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), `/post?id=${id}&invite=1`);
    assert.equal(harness.calls.filter(call => call[0] === 'login').length, 1);
  }
});

test('standalone OAuth exchanges its code once then returns to the stored invitation exactly once', async context => {
  const target = `/post?id=${id}&invite=1`, harness = mount('../src/web/auth/callback.tsx', 'default', { auth: { isAuthed: false }, returnPath: target }); context.after(() => harness.unmount()); await harness.settle();
  assert.deepEqual(harness.calls.filter(call => call[0] === 'exchange'), [['exchange', 'test-oauth-code']]); assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0);
  assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), target, 'pending exchange preserves the original invitation');
  harness.auth.isAuthed = true; await harness.settle(); await harness.settle(); control(harness, 'shared.auth.return').props.onPress();
  assert.deepEqual(harness.calls.filter(call => call[0] === 'navigate'), [['navigate', target]], 'repeated auth renders cannot replace the first return with /');
  assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), null);
});

test('OAuth callback waits for authentication loading before consuming a stored return path', async context => {
  const target = `/post?id=${id}`, harness = mount('../src/web/auth/callback.tsx', 'default', { auth: { isAuthed: true, isAuthLoading: true }, returnPath: target }); context.after(() => harness.unmount()); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0); assert.equal(harness.calls.filter(call => call[0] === 'exchange').length, 0);
  assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), target);
  harness.auth.isAuthLoading = false; await harness.settle(); assert.deepEqual(harness.calls.filter(call => call[0] === 'navigate'), [['navigate', target]]);
});

test('popup callbacks leave code exchange and invitation navigation to their opener', async context => {
  const target = `/post?id=${id}&invite=1`, harness = mount('../src/web/auth/callback.tsx', 'default', { auth: { isAuthed: false }, opener: {}, returnPath: target }); context.after(() => harness.unmount()); await harness.settle();
  harness.auth.isAuthed = true; await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'exchange').length, 0); assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0);
  assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), target);
});

test('stored external or malformed OAuth return links are rejected after login', async context => {
  for (const target of [`https://evil.test/post?id=${id}`, `//evil.test/post?id=${id}`, `/post?id=${id}&id=${otherId}`, gatewayLink, legacyGatewayLink, `https://gling-share-preview.vercel.app/post?id=${id}`]) {
    const harness = mount('../src/web/auth/callback.tsx', 'default', { auth: { isAuthed: true }, returnPath: target }); context.after(() => harness.unmount()); await harness.settle();
    assert.deepEqual(harness.calls.filter(call => call[0] === 'navigate'), [['navigate', '/']]); assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), null);
  }
});

test('failed OAuth exchange preserves the invitation and shows a retry explanation without navigating', async context => {
  const target = `/post?id=${id}&invite=1`, harness = mount('../src/web/auth/callback.tsx', 'default', { auth: { isAuthed: false }, returnPath: target,
    exchange: async () => ({ error: new Error('exchange failed') }) }); context.after(() => harness.unmount()); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'navigate').length, 0); assert.equal(harness.browser.sessionStorage.getItem(sharing.SHARED_POST_RETURN_KEY), target);
  assert.ok(text(harness.render()).includes('로그인을 완료하지 못했어요'));
});

test('the exported PostDetail guest wrapper renders only a login gate and never loads comments or the supplied body', async context => {
  const requests = [], components = ['TicketmasterSourceLink','MerchantSourceLink','MerchantReviews','MeetupReviews','PostPoll','PostCard','PostBodyEditor','PostPhotoGallery','PostPhotoEditor','PostPhotoCredits','ChillingHostProfile','ReportSheet','TrustBadge','UserSheet'];
  const imports = Object.fromEntries(components.map(name => [`@/components/${name.replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`)}`, { [name]: name }]));
  Object.assign(imports, {
    'expo-image-picker': {}, '@/constants/theme': { Depth: {}, Spacing: {} }, '@/i18n/ko': { t: {}, count: () => '' },
    '@/lib/comment-list': {}, '@/lib/comment-threads': { loadCommentThreadPage: () => requests.push('comments'), loadCommentThreadContext: () => requests.push('comment-context') },
    '@/lib/image-upload': {}, '@/lib/post-photo-credits': {}, '@/lib/post-image-picker': {}, '@/lib/meetup-ai': {}, '@/lib/mock': { CITIES: [] }, '@/lib/promotions': {}, '../../supabase/functions/_shared/ticketmaster': {},
    '@/lib/meetup-destination': { splitPlaceMeetupBody: () => { throw Error('Guest must not parse supplied body'); } }, '@/lib/discovery': {}, '@/constants/design-system': {},
  });
  const harness = mount('../src/components/post-detail.tsx', 'PostDetail', { auth: { isAuthed: false }, imports }, { post: post(), onClose() {} }); context.after(() => harness.unmount()); await harness.settle();
  assert.deepEqual(requests, []); assert.equal(harness.calls.filter(call => call[0] === 'full-post').length, 0);
  assert.equal(harness.calls.filter(call => call[0] === 'rpc').length, 0, 'guest gate never requests private review or poll data');
  assert.ok(!harness.nodes().some(node => ['MerchantReviews', 'MeetupReviews', 'PostPoll'].includes(node.type)), 'guest gate does not mount review or voting controls');
  assert.ok(!JSON.stringify(harness.render()).includes('private-body-and-venue-sentinel'));
  const gate = harness.nodes().find(node => node.type === 'StateCard'); assert.ok(gate); gate.props.onAction(); assert.equal(harness.calls.filter(call => call[0] === 'login').length, 1);
});


test('native and web PostCard share controls open the connected share sheet with the correct post/account', async context => {
  for (const os of ['ios', 'web']) {
    const item = { ...post(), author: { id: 'viewer', nickname: '이웃' }, likes: 0, saves: 0, comments: 0, createdAtLabel: '방금' };
    const harness = mount('../src/components/post-card.tsx', 'PostCard', { os }, { post: item }); context.after(() => harness.unmount());
    control(harness, 'components_post-card.pressable.10').props.onPress(); await harness.settle();
    const sheet = harness.nodes().find(node => node.type === 'PostShareSheet'); assert.ok(sheet, `${os} share is connected`);
    assert.equal(sheet.key, `${id}:viewer`); assert.equal(sheet.props.post, item); assert.equal(sheet.props.visible, true);
    assert.equal(harness.calls.filter(call => call[0] === 'share' || call[0] === 'count-share').length, 0, 'opening the sheet neither sends nor counts a share');
    sheet.props.onShared(); await harness.settle(); assert.equal(harness.calls.filter(call => call[0] === 'count-share').length, 1);
    sheet.props.onClose(); harness.render(); assert.ok(!harness.nodes().some(node => node.type === 'PostShareSheet'));
  }
});

test('guest PostCard share control requests login before any share sheet or outbound call', async context => {
  const item = { ...post(), author: { id: 'viewer', nickname: '이웃' }, likes: 0, saves: 0, comments: 0, createdAtLabel: '방금' };
  const harness = mount('../src/components/post-card.tsx', 'PostCard', { auth: { isAuthed: false } }, { post: item }); context.after(() => harness.unmount());
  control(harness, 'components_post-card.pressable.10').props.onPress(); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'login').length, 1);
  assert.ok(!harness.nodes().some(node => node.type === 'PostShareSheet')); assert.equal(harness.calls.filter(call => call[0] === 'share' || call[0] === 'send').length, 0);
});

test('web profile sheets retain direct chat and reporting while removing unsupported full-profile routes', async context => {
  const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', { os: 'web' }, { user: { id: 'neighbor', nickname: '이웃' }, onClose() {} }); context.after(() => harness.unmount()); await harness.settle();
  assert.ok(harness.nodes().some(node => node.type === 'MannerSummary'), 'public member summary remains available inline');
  assert.ok(!harness.nodes().some(node => ['components_user-sheet.pressable.3','components_user-sheet.pressable.7'].includes(node.props?.analyticsId)));
  control(harness, 'components_user-sheet.pressable.4').props.onPress(); await harness.settle();
  assert.equal(harness.calls.find(call => call[0] === 'navigate')[1].pathname, '/chat');
  assert.ok(control(harness, 'components_user-sheet.pressable.5'));
  const self = mount('../src/components/user-sheet.tsx', 'UserSheet', { os: 'web' }, { user: { id: 'viewer', nickname: '나', mine: true }, onClose() {} }); context.after(() => self.unmount());
  assert.ok(!self.nodes().some(node => node.props?.analyticsId === 'components_user-sheet.pressable.3'));
});

test('native profile sheets preserve full-profile destinations', async context => {
  for (const mine of [false, true]) {
    const harness = mount('../src/components/user-sheet.tsx', 'UserSheet', {}, { user: { id: 'viewer', nickname: '이웃', mine }, onClose() {} }); context.after(() => harness.unmount());
    control(harness, mine ? 'components_user-sheet.pressable.3' : 'components_user-sheet.pressable.7').props.onPress();
    const route = harness.calls.find(call => call[0] === 'navigate')[1];
    assert.equal(mine ? route : route.pathname, mine ? '/profile' : '/user/[id]');
    if (!mine) assert.equal(route.params.id, 'viewer');
  }
});

function sheet(context, data = {}) {
  const shared = [], closed = [], props = { post: post(), visible: true, onClose: () => closed.push(true), onShared: () => shared.push(true) };
  const harness = mount('../src/components/post-share-sheet.tsx', 'PostShareSheet', data, props);
  context.after(() => harness.unmount()); return { harness, shared, closed };
}

test('existing share notices switch languages without repeating a copy or send', async context => {
  for (const send of [false, true]) {
    let language = 'en';
    const title = '서울 모임';
    const { harness, shared } = sheet(context, { os: 'web', language: () => language, inbox: async () => page([conversation('chat-a', title)]) });
    await harness.settle();
    await control(harness, send ? 'post.share.conversation' : 'post.share.copy').props.onPress();
    await harness.settle();
    const key = send ? '{0} 대화로 보냈어요.' : '링크를 복사했어요.';
    const expected = selected => translateUi(selected, key, ...(send ? [title] : []));
    assert.ok(text(harness.render()).includes(expected('en')));
    language = 'ko'; assert.ok(text(harness.render()).includes(expected('ko')));
    language = 'en'; assert.ok(text(harness.render()).includes(expected('en')));
    assert.equal(shared.length, 1);
    assert.equal(harness.calls.filter(call => call[0] === (send ? 'send' : 'copy')).length, 1);
    assert.equal(harness.calls.filter(call => call[0] === 'inbox').length, 1);
  }
});

test('share sheet stays over the post and keeps external sharing, status and approval outside the recipient scroll', async context => {
  const { harness } = sheet(context); await harness.settle();
  assert.equal(harness.nodes().find(node => node.type === 'Modal').props.transparent, true);
  const scroll = control(harness, 'post.share.sheet');
  assert.ok(!nodes(scroll).some(node => node.props?.analyticsId === 'post.share.external'), 'external sharing remains available when recipients scroll');
  assert.ok(!text(scroll).includes('참여 신청과 모임장 승인이 필요해요'), 'approval notice stays visible');
  control(harness, 'post.share.conversation').props.onPress(); await harness.settle();
  assert.ok(!text(control(harness, 'post.share.sheet')).includes('chat-a 대화로 보냈어요.'), 'send result stays outside recipient scroll');
  assert.ok(text(harness.render()).includes('chat-a 대화로 보냈어요.'));
});

test('share recipients announce the full conversation title and send status without exposing message snippets', async context => {
  const title = '이번 주말 토론토에서 작은 전시를 같이 보고 천천히 걸어요', group = { ...conversation('group-chat', title), kind: 'group', latestBody: 'private-message-snippet' };
  const { harness } = sheet(context, { inbox: async () => page([group]) }); await harness.settle();
  const send = control(harness, 'post.share.conversation');
  assert.ok(send.props.accessibilityLabel.includes(title)); assert.ok(send.props.accessibilityLabel.includes('대화로 보내기'));
  assert.ok(text(send).includes('모임 대화')); assert.ok(!JSON.stringify(send).includes('private-message-snippet'));
  send.props.onPress(); await harness.settle();
  assert.ok(control(harness, 'post.share.conversation').props.accessibilityLabel.includes('전송 완료'));
});

test('share sheet loading, empty and failed inboxes keep native external sharing and distinguish their states', async context => {
  for (const [kind, inbox] of [['pending', () => new Promise(() => {})], ['empty', async () => page([])], ['error', async () => { throw new Error('offline'); }]]) {
    const { harness } = sheet(context, { inbox }); await harness.settle();
    assert.ok(harness.nodes().some(node => node.type === 'StateCard' && node.props.kind === kind), kind);
    assert.equal(control(harness, 'post.share.external').props.disabled, false);
    assert.ok(!harness.nodes().some(node => node.props?.analyticsId === 'post.share.copy'), 'copy remains web-only');
    if (kind === 'error') { assert.equal(control(harness, 'post.share.retry').props.disabled, false); }
  }
});

test('sharing a link confirms delivery without claiming that a post or meetup was created', async context => {
  for (const [action, data] of [['post.share.external', {}], ['post.share.copy', { os: 'web' }], ['post.share.conversation', {}]]) {
    const { harness, shared } = sheet(context, data); await harness.settle();
    control(harness, action).props.onPress(); await harness.settle();
    assert.equal(shared.length, 1);
    assert.ok(harness.calls.some(([name, kind]) => name === 'feedback' && kind === 'message'));
    assert.ok(!harness.calls.some(([name, kind]) => name === 'feedback' && ['success', 'meetup', 'postPublished', 'meetupCreated'].includes(kind)));
  }
});

test('internal sharing blocks double taps, sends only title and owned link, and counts a verified send once', async context => {
  const response = deferred(), { harness, shared, closed } = sheet(context, { send: () => response.promise }); await harness.settle();
  const send = control(harness, 'post.share.conversation'); send.props.onPress(); send.props.onPress();
  harness.nodes().find(node => node.type === 'Modal').props.onRequestClose();
  assert.equal(closed.length, 0, 'back/escape cannot dismiss an in-flight send before busy state renders');
  assert.equal(harness.calls.filter(call => call[0] === 'send').length, 1);
  const outbound = harness.calls.find(call => call[0] === 'send'); assert.equal(outbound[1], 'chat-a');
  assert.ok(outbound[2].includes('페스티벌 같이 가요')); assert.equal(outbound[2].split('\n').at(-1), gatewayLink); assert.ok(!outbound[2].includes('private-'));
  response.resolve('saved-message'); await harness.settle();
  assert.equal(shared.length, 1); assert.equal(control(harness, 'post.share.conversation').props.disabled, true);
  control(harness, 'post.share.conversation').props.onPress(); await harness.settle();
  assert.equal(harness.calls.filter(call => call[0] === 'send').length, 1, 'completed conversation cannot be sent twice');
});

test('an uncertain send stays blocked across reopening and gives an exact chat-check action', async context => {
  const { harness, shared } = sheet(context, { send: async () => { throw new Error('lost response'); } }); await harness.settle();
  control(harness, 'post.share.conversation').props.onPress(); await harness.settle();
  assert.equal(shared.length, 0); assert.equal(control(harness, 'post.share.conversation').props.disabled, true);
  control(harness, 'post.share.conversation').props.onPress();
  harness.props.visible = false; harness.render(); harness.props.visible = true; await harness.settle();
  assert.equal(control(harness, 'post.share.conversation').props.disabled, true);
  assert.equal(harness.calls.filter(call => call[0] === 'send').length, 1);
  const check = harness.nodes().find(node => node.type === 'Pressable' && !node.props.disabled && /대화.*(?:확인|보기)/.test(text(node)));
  assert.ok(check, 'uncertain recipient needs an enabled action to inspect the chat'); check.props.onPress();
  const destination = harness.calls.find(call => call[0] === 'navigate')?.[1];
  assert.equal(destination?.pathname, '/chat'); assert.equal(destination?.params?.conversationId, 'chat-a');
  assert.equal(harness.calls.filter(call => call[0] === 'send').length, 1, 'checking the chat never retries the message automatically');
});

test('a send without a saved message id is uncertain rather than counted as successful', async context => {
  const { harness, shared } = sheet(context, { send: async () => null }); await harness.settle();
  control(harness, 'post.share.conversation').props.onPress(); await harness.settle();
  assert.equal(shared.length, 0); assert.equal(control(harness, 'post.share.conversation').props.disabled, true);
  assert.ok(!harness.calls.some(call => call[0] === 'feedback' && call[1] === 'success'));
});

test('dismissing the native share sheet neither counts a share nor emits success feedback', async context => {
  const { harness, shared } = sheet(context, { share: async () => ({ action: 'dismissedAction' }) }); await harness.settle();
  control(harness, 'post.share.external').props.onPress(); await harness.settle();
  assert.equal(shared.length, 0); assert.equal(control(harness, 'post.share.external').props.disabled, false);
  assert.ok(!harness.calls.some(call => call[0] === 'feedback' && call[1] === 'success'));
});

test('native external sharing passes a safe preview message and counts only a completed share', async context => {
  const { harness, shared } = sheet(context); await harness.settle();
  control(harness, 'post.share.external').props.onPress(); await harness.settle();
  const payload = harness.calls.find(call => call[0] === 'share')[1];
  assert.equal(payload.url, gatewayLink); assert.equal(payload.message.split('\n').at(-1), gatewayLink); assert.equal(payload.title, '페스티벌 같이 가요'); assert.ok(!JSON.stringify(payload).includes('private-')); assert.equal(shared.length, 1);
});

test('cancelled browser sharing keeps the sheet usable without counting a share', async context => {
  const abort = new Error('cancelled'); abort.name = 'AbortError';
  const { harness, shared } = sheet(context, { os: 'web', share: async () => { throw abort; } }); await harness.settle();
  control(harness, 'post.share.external').props.onPress(); await harness.settle();
  assert.equal(shared.length, 0); assert.equal(control(harness, 'post.share.external').props.disabled, false);
  assert.ok(!harness.calls.some(call => call[0] === 'feedback' && ['success', 'warning'].includes(call[1])));
});

for (const kind of ['internal', 'external']) for (const change of ['account switch', 'post switch', 'unmount']) {
  test(`${kind} sharing ignores a late completion after ${change}`, async context => {
    const response = deferred(), data = kind === 'internal' ? { send: () => response.promise } : { share: () => response.promise };
    const { harness, shared } = sheet(context, data); await harness.settle();
    control(harness, kind === 'internal' ? 'post.share.conversation' : 'post.share.external').props.onPress();
    if (change === 'unmount') harness.unmount();
    else { if (change === 'account switch') harness.auth.me = { id: 'another-viewer' }; else harness.props.post = { ...post(), id: otherId }; harness.render(); }
    response.resolve(kind === 'internal' ? 'saved-message' : { action: 'sharedAction' }); await tick(); await tick();
    assert.equal(shared.length, 0, 'old work must not update the current viewer/post share counter');
    assert.ok(!harness.calls.some(call => call[0] === 'feedback' && call[1] === 'success'));
  });
}

test('conversation pagination uses the existing cursor, deduplicates rows and prevents overlapping pages', async context => {
  const next = deferred(), cursor = { id: 'chat-a', createdAt: '2026-10-11T18:00:00Z', status: 'active' };
  const { harness } = sheet(context, { inbox: (_client, _viewer, _filter, before) => before ? next.promise : Promise.resolve(page([conversation('chat-a')], cursor)) }); await harness.settle();
  const more = control(harness, 'post.share.more'); more.props.onPress(); more.props.onPress();
  const loads = harness.calls.filter(call => call[0] === 'inbox'); assert.equal(loads.length, 2); assert.equal(loads[1][1], 'viewer'); assert.equal(loads[1][2], 'all');
  assert.deepEqual(loads[1][3], cursor);
  await harness.settle();
  assert.equal(control(harness, 'post.share.close').props.disabled, true, 'pending pagination shows its existing close guard');
  assert.equal(control(harness, 'post.share.external').props.disabled, true, 'pending pagination shows its existing external-share guard');
  next.resolve(page([conversation('chat-a'), conversation('chat-b')])); await harness.settle();
  const recipients = harness.nodes().filter(node => node.props?.analyticsId === 'post.share.conversation');
  assert.equal(recipients.length, 2); assert.ok(!harness.nodes().some(node => node.props?.analyticsId === 'post.share.more'));
  assert.equal(control(harness, 'post.share.external').props.disabled, false);
});

test('switching accounts immediately removes old recipients while the new inbox loads', async context => {
  const next = deferred(), { harness } = sheet(context, { inbox: (_client, viewer) => viewer === 'viewer' ? Promise.resolve(page([conversation('private-old-chat')])) : next.promise }); await harness.settle();
  assert.equal(harness.nodes().filter(node => node.props?.analyticsId === 'post.share.conversation').length, 1);
  harness.auth.me = { id: 'another-viewer' }; harness.render();
  assert.equal(harness.nodes().filter(node => node.props?.analyticsId === 'post.share.conversation').length, 0, 'old inbox must disappear before the new request completes');
  next.resolve(page([conversation('new-chat')])); await harness.settle();
  assert.ok(!text(harness.render()).includes('private-old-chat')); assert.ok(text(harness.render()).includes('new-chat'));
});



test('web OS sharing and link copy use only owned title/link metadata, never private body/location', async context => {
  for (const action of ['post.share.external', 'post.share.copy']) {
    const { harness, shared } = sheet(context, { os: 'web' }); await harness.settle();
    control(harness, action).props.onPress(); await harness.settle();
    const call = harness.calls.find(call => call[0] === (action.endsWith('copy') ? 'copy' : 'share')); assert.ok(call);
    const outbound = JSON.stringify(call[1]); assert.equal(typeof call[1] === 'string' ? call[1] : call[1].url, gatewayLink); assert.ok(!outbound.includes('private-'));
    assert.equal(shared.length, 1);
  }
});

test('host invites and closed meetups share a link while preserving join application and approval', async context => {
  const { harness } = sheet(context); await harness.settle();
  assert.ok(text(harness.render()).includes('내 모임에 초대하기'));
  harness.props.post = { ...harness.props.post, room: { ...harness.props.post.room, closed: true } }; await harness.settle();
  assert.ok(text(harness.render()).includes('모집 마감'));
  assert.ok(text(harness.render()).includes('참여 신청과 모임장 승인이 필요해요'));
  control(harness, 'post.share.conversation').props.onPress(); await harness.settle();
  const outbound = harness.calls.find(call => call[0] === 'send'); assert.equal(outbound[2].split('\n').at(-1), gatewayLink); assert.ok(!outbound[2].includes('private-'));
  assert.equal(harness.calls.filter(call => call[0] === 'send').length, 1);
  assert.ok(!harness.nodes().some(node => /바로 참여|즉시 참여|자동 가입/.test(node.props?.accessibilityLabel ?? '')));
});


test('web chat preview opens the hosted flat post route and keeps the invitation flag', async context => {
  for (const url of [link, gatewayLink, legacyGatewayLink]) {
    const harness = mount('../src/components/shared-link-card.tsx', 'SharedLinkCard', { os: 'web' }, { url }); context.after(() => harness.unmount()); await harness.settle();
    control(harness, 'chat.shared-link.open').props.onPress();
    assert.equal(harness.calls.find(call => call[0] === 'navigate')[1], `/post?id=${id}&invite=1`);
  }
});
