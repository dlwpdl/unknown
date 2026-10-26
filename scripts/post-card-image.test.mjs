import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getPostImageSource } from '../src/lib/feed-data.ts';
import { uniqueHashtags } from '../src/lib/hashtags.ts';
import { count, t } from '../src/i18n/ko.ts';
import { googleMapsPin, googleMapsUrl, postLocationUrl, postMapBody } from '../src/lib/post-maps.ts';
import { postInfoParts } from '../src/lib/post-info.ts';
import { parseMeetupSections } from '../src/lib/meetup-sections.ts';
import { translationSource } from './test-meetup-source-imports.mjs';
import { splitPostPhotoCredits } from '../src/lib/post-photo-credits.ts';
import * as postLinks from '../supabase/functions/_shared/post-links.ts';
import * as product from '../src/lib/product-analytics.ts';

// Native image events and React state are supplied here; sizing/rendering runs the real components.
let sharedReactions;
function reactionModule() {
  if (!sharedReactions) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/post-reactions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { exports });
    sharedReactions = exports;
  }
  return sharedReactions;
}

function cardRenderer(component = 'PostCard', persistReaction = async () => {}) {
  const values = [];
  let cursor = 0;
  let viewer = 'viewer-a';
  const feedback = [];
  const openedMaps = [];
  const alerts = [];
  let mapFailure = false, translatedBody = null;
  const react = {
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useRef: (value) => ({ current: value }),
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
  };
  const modules = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-image': { Image: 'Image' },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native': { View: 'View', Modal: 'Modal', Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 390, height: 844 }), StyleSheet: { create: (value) => value, hairlineWidth: 1 }, Animated: { Value: class {}, View: 'Animated.View' },
      Linking: { openURL: (url) => { openedMaps.push(url); return mapFailure ? Promise.reject(new Error('offline')) : Promise.resolve(); } },
      Alert: { alert: (...args) => alerts.push(args) } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, useReducedMotion: () => true,
      useSharedValue: (initial) => ({ value: initial, get() { return this.value; }, set(value) { this.value = value; } }), useAnimatedStyle: (fn) => fn(), runOnJS: (fn) => fn },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureRoot', GestureDetector: 'GestureDetector', Gesture: {
      Pan: () => ({ minDistance() { return this; }, averageTouches() { return this; }, onChange() { return this; } }),
      Pinch: () => ({ onStart() { return this; }, onUpdate() { return this; }, onFinalize() { return this; } }),
      Simultaneous: (...gestures) => gestures,
    } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/post-body': { PostBody: 'PostBody' },
    '@/components/content-translation': { TranslationControl: 'TranslationControl', TranslatedCommentBody: 'TranslatedCommentBody' },
    '@/hooks/use-content-translation': { useContentTranslation: (_kind, _id, source) => ({ display: translatedBody == null ? source : { ...source, body: translatedBody }, translated: translatedBody != null, original: translatedBody == null }) },
    '@/lib/translation-source': translationSource,
    '@/lib/post-photo-credits': { splitPostPhotoCredits },
    '@/lib/content-translation': { CONTENT_TRANSLATION_VIEWABILITY: { viewAreaCoveragePercentThreshold: 2, minimumViewTime: 250 } },
    '../../supabase/functions/_shared/post-links': postLinks,
    '@/components/post-map-link': { PostMapLink: 'PostMapLink' },
    '@/components/post-attachment-link': { PostAttachmentLink: 'PostAttachmentLink' },
    '@/lib/post-info': { postInfoParts }, '@/lib/meetup-sections': { parseMeetupSections }, '@/components/meetup-sections': { MeetupSectionsView: 'MeetupSectionsView' },
    '@/lib/mock': { CITIES: [] },
    '@/components/post-pin-map': { PostPinMap: 'PostPinMap' },
    '@/components/post-share-sheet': { PostShareSheet: 'PostShareSheet' },
    '@/components/report-sheet': { ReportSheet: 'ReportSheet' },
    '@/components/trust-badge': { TrustBadge: 'TrustBadge' },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16 } },
    '@/hooks/use-theme': { useTheme: () => ({ backgroundElement: '#222231' }) },
    '@/i18n/ko': { count, t },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: viewer } }) },
    '@/lib/community-data': { togglePostReaction: (_client, postId, viewerId, kind, isOn) => persistReaction({ postId, viewerId, kind, isOn }) },
    '@/lib/feed-data': { getPostImageSource },
    '@/lib/meetup-ai': {},
    '@/lib/hashtags': { uniqueHashtags },
    '@/lib/post-maps': { googleMapsPin, googleMapsUrl, postLocationUrl, postMapBody },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: (kind) => feedback.push(kind) }) },
    '@/lib/sharing': {},
    '@/lib/product-analytics': product,
    '@/lib/supabase': { supabase: { rpc: async () => ({ error: null }) } },
  };
  const exports = {};
  const file = component === 'MerchantProfileHeader' ? 'merchant-profile-header' : component === 'PostCard' ? 'post-card' : component === 'PostMapLink' ? 'post-map-link' : component === 'PostPhotoEditor' ? 'post-photo-editor' : 'post-photo-gallery';
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  modules['@/components/post-ad-label'] = { PostAdLabel: 'PostAdLabel' };
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name === '@/lib/post-reactions') return reactionModule();
    assert.ok(name in modules, `Unexpected import: ${name}`);
    return modules[name];
  }) });
  return { render(props) { cursor = 0; return exports[component](props); }, feedback, openedMaps, alerts,
    translate: body => { translatedBody = body; }, failMap: () => { mapFailure = true; }, setViewer: (id) => { viewer = id; } };
}

const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap((value) => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const image = (tree) => nodes(tree).find((node) => node.type === 'Image');
const style = (node) => Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style.filter(Boolean)) : node.props.style;
const loaded = (width, height) => ({ cacheType: 'memory', source: { url: 'signed:photo', width, height, mediaType: 'image/webp', isAnimated: false } });

test('지도 버튼은 안전한 Google 링크만 열고 실패를 알린다', async () => {
  const map = cardRenderer('PostMapLink');
  assert.equal(map.render({ url: 'https://evil.test/maps' }), null);
  const tree = map.render({ url: 'https://maps.app.goo.gl/Example' });
  assert.equal(tree.props.accessibilityRole, 'link');
  tree.props.onPress();
  assert.deepEqual(map.openedMaps, ['https://maps.app.goo.gl/Example']);
  assert.deepEqual(map.feedback, ['selection']);
  map.failMap();
  tree.props.onPress();
  await new Promise(setImmediate);
  assert.deepEqual(map.feedback, ['selection', 'selection', 'warning']);
  assert.deepEqual(map.alerts, [[t.map.errorTitle, t.map.errorBody]]);
});

test('지도 카드는 같은 좌표를 미리보고 표시 이름과 공유 주소를 유지한다', () => {
  const renderer = cardRenderer('PostMapLink');
  const url = 'https://www.google.com/maps/search/?api=1&query=49.2712,-123.134';
  const tree = renderer.render({ url, label: '만나는 카페' });
  const preview = nodes(tree).find(node => node.type === 'PostPinMap');
  assert.deepEqual(preview.props.pin, { latitude: 49.2712, longitude: -123.134 });
  assert.equal(preview.props.preview, true);
  assert.ok(tree.props.accessibilityLabel.includes('만나는 카페'));
  tree.props.onPress();
  assert.equal(renderer.openedMaps[0], new URL(url).href);
});

test('지도 링크를 읽기 본문과 분리하고 글 열기 버튼 밖에 표시한다', () => {
  const card = cardRenderer();
  const tree = card.render({ post: { id: 'mapped', title: '장소 소개', body: '소개 본문\n\nGoogle 지도: https://maps.app.goo.gl/Example',
    author: { id: 'author', nickname: '작성자' }, tag: { kind: 'post', label: '비즈니스' }, likes: 0, saves: 0, comments: 0, views: 0 }, onPress() {} });
  const postButton = nodes(tree).find((node) => node.props?.analyticsId === 'components_post-card.pressable.2');
  assert.ok(nodes(postButton).some((node) => node.props?.body === '소개 본문'));
  assert.ok(!nodes(postButton).some((node) => node.type === 'PostMapLink'));
  assert.equal(nodes(tree).find((node) => node.type === 'PostMapLink').props.url, 'https://maps.app.goo.gl/Example');
});

test('피드 사진 전체를 원본 비율로 표시하고 글·사진·뷰어 변경에 이전 크기를 쓰지 않는다', () => {
  const card = cardRenderer();
  let opened = 0;
  let props = { post: { id: 'post-1', title: 'VIFF', body: '본문', author: { id: 'author', nickname: '작성자' }, tag: { kind: 'post', label: '페스티벌' }, imagePaths: ['owner/one.webp'], imageUris: ['signed:photo'], likes: 0, saves: 0, comments: 0, views: 0 }, onPress: () => { opened++; }, flat: true };
  let photo = image(card.render(props));
  assert.equal(photo.props.contentFit, 'contain', '로드 전에도 글자를 잘라내지 않는다');
  for (const [width, height, ratio] of [[1080, 1350, 0.8], [1080, 810, 4 / 3], [1920, 1080, 16 / 9]]) {
    photo.props.onLoad(loaded(width, height));
    photo = image(card.render(props));
    assert.equal(style(photo).aspectRatio, ratio, '원본 비율에 맞춰 높이를 정하므로 여백도 자르기도 없다');
  }
  for (const [width, height] of [[0, 10], [10, 0], [NaN, 10], [10, Infinity]]) {
    photo.props.onLoad(loaded(width, height));
    assert.equal(style(image(card.render(props))).aspectRatio, 16 / 9);
  }
  props = { ...props, post: { ...props.post, id: 'post-2' } };
  photo = image(card.render(props));
  assert.notEqual(style(photo).aspectRatio, 16 / 9);
  photo.props.onLoad(loaded(1080, 1350));
  assert.equal(style(image(card.render(props))).aspectRatio, 0.8);
  props = { ...props, post: { ...props.post, imageUris: ['signed:changed'] } };
  photo = image(card.render(props));
  assert.notEqual(style(photo).aspectRatio, 0.8);
  photo.props.onLoad(loaded(1080, 1350));
  card.setViewer('viewer-b');
  photo = image(card.render(props));
  assert.notEqual(style(photo).aspectRatio, 0.8);
  assert.equal(photo.props.source.cacheKey, 'post-image:viewer-b:owner/one.webp');
  const postButton = nodes(card.render(props)).find((node) => node.props?.analyticsId === 'components_post-card.pressable.2');
  postButton.props.onPress();
  assert.equal(opened, 1);
  assert.deepEqual(card.feedback, ['selection']);
  photo.props.onError({ error: 'unavailable' });
  assert.equal(image(card.render(props)), undefined, '깨진 사진의 기존 오류 처리를 유지한다');
  props = { ...props, post: { ...props.post, imageUris: ['signed:recovered'] } };
  assert.ok(image(card.render(props)));
  assert.equal(image(card.render({ ...props, hidePhoto: true })), undefined);
});

test('상세 갤러리는 사진을 자르지 않고 고정 비율과 좌우 페이지를 유지한다', () => {
  const gallery = cardRenderer('PostPhotoGallery');
  let props = { post: { id: 'post-1', title: 'VIFF', imageUris: ['signed:cover', 'signed:landscape'] } };
  let tree = gallery.render(props);
  tree.props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  let photos = nodes(gallery.render(props)).filter((node) => node.type === 'Image');
  assert.equal(photos[0].props.contentFit, 'contain', '상세 표지의 도시와 제목을 자르지 않는다');
  photos[0].props.onLoad(loaded(1080, 1350));
  photos[1].props.onLoad(loaded(1920, 1080));
  tree = gallery.render(props);
  photos = nodes(tree).filter((node) => node.type === 'Image');
  assert.equal(style(photos[0]).aspectRatio, 4 / 3, '세로 표지를 불러와도 표시 영역의 높이를 유지한다');
  assert.equal(style(photos[0]).width, 300);
  const scroll = nodes(tree).find((node) => node.type === 'ScrollView');
  assert.equal(scroll.props.horizontal, true);
  assert.equal(scroll.props.pagingEnabled, true);
  scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 300 } } });
  tree = gallery.render(props);
  assert.equal(style(image(tree)).aspectRatio, 4 / 3, '가로 사진으로 넘겨도 표시 영역의 높이를 유지한다');
  assert.ok(nodes(tree).some((node) => JSON.stringify(node.props?.children) === '[2,"/",2]'));
  for (const [width, height] of [[0, 10], [10, 0], [NaN, 10], [10, Infinity]]) {
    nodes(tree).filter((node) => node.type === 'Image')[1].props.onLoad(loaded(width, height));
    assert.equal(style(image(gallery.render(props))).aspectRatio, 4 / 3);
  }
  props = { post: { ...props.post, id: 'post-2', imageUris: ['signed:new', 'signed:new2'] } };
  tree = gallery.render(props);
  assert.equal(style(image(tree)).aspectRatio, 4 / 3, '재사용된 글에 이전 사진 크기를 쓰지 않는다');
  assert.ok(nodes(tree).some((node) => JSON.stringify(node.props?.children) === '[1,"/",2]'));
  image(tree).props.onLoad(loaded(1080, 1350));
  props = { post: { ...props.post, imageUris: ['signed:replacement', 'signed:new2'] } };
  assert.equal(style(image(gallery.render(props))).aspectRatio, 4 / 3, '같은 글의 source 변경도 이전 크기를 쓰지 않는다');
  assert.ok(image(gallery.render({ post: { ...props.post, imageUris: ['single'] } })), '한 장 사진도 상세에서 보인다');
});

test('상세 사진을 누르면 원본 전체 화면을 열고 확대·닫기·페이지 이동이 동작한다', () => {
  const gallery = cardRenderer('PostPhotoGallery');
  const props = { post: { id: 'photos', title: '내 사진', imageUris: ['original:portrait', 'original:landscape'] } };
  gallery.render(props).props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  let tree = gallery.render(props);
  const open = nodes(tree).find(n => n.props?.accessibilityLabel === '내 사진 사진 1 크게 보기');
  assert.ok(open, '모든 상세 사진에 탭 행동이 있다');
  open.props.onPress();
  tree = gallery.render(props);
  const modal = nodes(tree).find(n => n.type === 'Modal');
  assert.equal(modal.props.visible, true);
  assert.ok(nodes(modal).some(n => n.type === 'Image' && n.props.source.uri === 'original:portrait' && n.props.contentFit === 'contain'));
  nodes(modal).find(n => n.props?.accessibilityLabel === '사진 확대').props.onPress();
  tree = gallery.render(props);
  assert.ok(nodes(tree).some(n => n.props?.accessibilityLabel === '사진 축소'));
  nodes(tree).find(n => n.props?.accessibilityLabel === '다음 사진').props.onPress();
  tree = gallery.render(props);
  assert.ok(nodes(tree).some(n => n.type === 'Image' && n.props.source.uri === 'original:landscape'));
  nodes(tree).find(n => n.type === 'Modal').props.onRequestClose();
  assert.ok(!nodes(gallery.render(props)).some(n => n.type === 'Modal'));
  assert.ok(gallery.feedback.length >= 4);
});


test('사진 순서 변경은 표지를 바꾸고 개별 제거·양끝 비활성을 유지한다', () => {
  const editor = cardRenderer('PostPhotoEditor');
  let props = { images: [{ path: 'author/first.webp', uri: 'first' }, { path: 'author/second.webp', uri: 'second' }, { uri: 'new', base64: 'AQ==', mimeType: 'image/webp' }], disabled: false,
    onChange: images => { props = { ...props, images }; } };
  let tree = editor.render(props);
  assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === '사진 1 앞으로 이동').props.disabled, true);
  nodes(tree).find(n => n.props?.accessibilityLabel === '사진 2 앞으로 이동').props.onPress();
  assert.deepEqual(Array.from(props.images, p => p.uri), ['second', 'first', 'new']);
  tree = editor.render(props);
  assert.ok(nodes(tree).some(n => n.props?.children?.join?.('') === '1 · 표지 사진'));
  nodes(tree).find(n => n.props?.accessibilityLabel === '사진 2 제거').props.onPress();
  assert.deepEqual(Array.from(props.images, p => p.uri), ['second', 'new']);
  tree = editor.render({ ...props, disabled: true });
  assert.ok(nodes(tree).filter(n => n.type === 'Pressable').every(n => n.props.disabled));
  assert.deepEqual(editor.feedback, ['selection', 'selection']);
});


test('translated cards preserve original photo credits and each attachment exactly once', () => {
  const card = cardRenderer();
  const credit = '\n\n사진 출처·이용 조건\nPhoto by Sam · https://unsplash.com/photos/example';
  const url = 'https://www.instagram.com/p/Example/';
  const body = postLinks.withPostAttachments('Hello neighbours' + credit, [url]);
  card.translate('이웃 여러분 안녕하세요');
  const tree = card.render({ post: { id: 'credited', title: 'Hello', body,
    author: { id: 'author', nickname: '작성자' }, tag: { kind: 'post', label: '라이프' }, likes: 0, saves: 0, comments: 0, views: 0 } });
  const displayed = nodes(tree).find(node => node.type === 'PostBody').props.body;
  assert.ok(displayed.includes('이웃 여러분 안녕하세요'));
  assert.ok(displayed.includes(credit), 'photo license attribution must survive translation');
  assert.equal(displayed.split(url).length - 1, 1, 'attached account links remain unchanged and are not duplicated');
  assert.ok(body.startsWith('Hello neighbours'), 'translation never changes the source post');
});


test('Today and detail share a like, its pending state and rollback before another toggle', async () => {
  const calls = [];
  let resolve, reject;
  const persist = args => { calls.push(args); return new Promise((yes, no) => { resolve = yes; reject = no; }); };
  const post = { id: 'like-sync-post', title: '같은 글', body: '본문', author: { id: 'author', nickname: '이웃' }, tag: { label: '일상' }, likes: 4, saves: 0, shares: 0, likedByMe: false, savedByMe: false };
  const feed = cardRenderer('PostCard', persist), detail = cardRenderer('PostCard', persist);
  const like = renderer => nodes(renderer.render({ post })).find(node => node.props?.analyticsId === 'components_post-card.pressable.7');
  const first = like(feed).props.onPress();
  assert.equal(like(detail).props.accessibilityState.selected, true, 'Opening detail immediately must see the optimistic feed like.');
  assert.equal(like(detail).props.disabled, true, 'Both copies block another request until persistence finishes.');
  await like(detail).props.onPress();
  assert.equal(calls.length, 1);
  resolve(); await first;
  assert.equal(like(detail).props.disabled, false);
  const second = like(detail).props.onPress();
  assert.equal(calls[1].isOn, true, 'Detail removes the existing reaction instead of inserting a duplicate.');
  assert.equal(like(feed).props.accessibilityState.selected, false);
  assert.equal(like(feed).props.accessibilityLabel, t.feed.likes(4));
  reject(new Error('offline')); await second;
  assert.equal(like(feed).props.accessibilityState.selected, true, 'Failure rolls back every surface.');
  assert.equal(like(detail).props.accessibilityState.selected, true);
  assert.equal(like(feed).props.accessibilityLabel, t.feed.likes(5));
  feed.setViewer('different-viewer');
  assert.equal(like(feed).props.accessibilityState.selected, false, 'A different account does not inherit the first account reaction.');
  assert.equal(like(feed).props.accessibilityLabel, t.feed.likes(4));
  feed.setViewer('viewer-a');
  const retry = like(detail).props.onPress(); resolve(); await retry;
  assert.equal(like(feed).props.accessibilityState.selected, false);
  assert.equal(like(feed).props.accessibilityLabel, t.feed.likes(4));
  feed.setViewer('different-viewer');
  assert.equal(like(feed).props.accessibilityState.selected, false);
  assert.equal(like(feed).props.accessibilityLabel, t.feed.likes(4));
  assert.equal(detail.alerts.length, 1);
});

test('a same-frame double press sends one request and server counts reconcile after the selected flag catches up', async () => {
  const reactions = reactionModule();
  let writes = 0, resolve;
  const persist = () => { writes++; return new Promise(yes => { resolve = yes; }); };
  let updates = 0;
  const stop = reactions.subscribePostReactions(() => updates++);
  const first = reactions.changePostReaction('fast-viewer', 'fast-post', 'like', { isOn: false, count: 0 }, persist);
  await reactions.changePostReaction('fast-viewer', 'fast-post', 'like', { isOn: false, count: 0 }, persist);
  assert.equal(writes, 1);
  reactions.syncPostReactions('fast-viewer', 'fast-post', { isOn: false, count: 0 }, { isOn: false, count: 0 });
  assert.equal(reactions.postReactionsSnapshot('fast-viewer', 'fast-post').like.count, 1);
  resolve(); await first;
  reactions.syncPostReactions('fast-viewer', 'fast-post', { isOn: false, count: 0 }, { isOn: false, count: 0 });
  assert.equal(reactions.postReactionsSnapshot('fast-viewer', 'fast-post').like.isOn, true, 'An old feed snapshot cannot erase a successful mutation.');
  reactions.syncPostReactions('fast-viewer', 'fast-post', { isOn: true, count: 8 }, { isOn: false, count: 0 });
  assert.equal(reactions.postReactionsSnapshot('fast-viewer', 'fast-post').like.count, 8);
  assert.equal(updates, 3);
  stop();
});
test('business author uses its logo, report target and business fallback after photo failure',()=>{
 const card=cardRenderer();let opened=0;
 const post={id:'business-post',title:'합성 안내',body:'비즈니스 본문',author:{id:'business',nickname:'지모코',verified:false},business:{id:'business',name:'지모코',avatarUri:'opaque-logo'},tag:{kind:'post',label:'라이프'},likes:0,saves:0,comments:0,views:0};
 const render=()=>card.render({post,onAuthor:()=>{opened++;}});
 const logo=image(render());assert.equal(logo.props.source.uri,'opaque-logo');
 const report=nodes(render()).find(n=>n.type==='ReportSheet');assert.equal(report.props.reportedUserId,undefined);assert.equal(report.props.reportedBusinessId,'business');
 const author=nodes(render()).find(n=>n.props?.analyticsId==='components_post-card.pressable.4');
 author.props.onPress();assert.equal(opened,1);assert.ok(card.feedback.includes('reaction'));
 logo.props.onError();assert.equal(image(render()),undefined);
 assert.ok(nodes(render()).some(n=>n.type==='ThemedText' && n.props.children==='지'));
 post.business.avatarUri='opaque-logo-v2';assert.equal(image(render()).props.source.uri,'opaque-logo-v2');
});

test('profile logo/banner failures retain only the business fallback and recover on new images',()=>{
 const renderer=cardRenderer('MerchantProfileHeader');
 const profile={name:'지모코',city_name:'밴쿠버',industry:'카페',services:'',address:'',links:[],avatarUri:'logo',bannerUri:'banner'};
 const render=()=>renderer.render({profile});
 let images=nodes(render()).filter(n=>n.type==='Image');assert.equal(images.length,2);
 images.forEach(n=>n.props.onError());assert.equal(nodes(render()).filter(n=>n.type==='Image').length,0);
 assert.ok(nodes(render()).some(n=>n.type==='ThemedText'&&n.props.children==='지'));
 profile.avatarUri='new-logo';assert.equal(nodes(render()).find(n=>n.type==='Image').props.source.uri,'new-logo');
});

test('글 상세는 📍 주소·링크를 정보 카드로, 본문을 문단으로, 출처를 접어서 보여주고 반응 줄을 숨긴다', () => {
  const card = cardRenderer();
  const body = '첫 문단이에요.\n둘째 문단이에요.\n📍 847 Denman St, Vancouver\n\nhttps://www.instagram.com/handsonyvr/\n사진: Cody Briggs';
  const tree = card.render({ post: { id: 'detail', title: 'HANDSON', body, cityId: 'vancouver',
    author: { id: 'author', nickname: '작성자' }, tag: { kind: 'post', label: '맛집' }, likes: 0, saves: 0, comments: 0, views: 104 }, postDetail: true });
  const bodyNode = nodes(tree).find(node => node.props?.paragraphs && node.props.body !== '');
  assert.deepEqual(bodyNode.props.paragraphs, ['첫 문단이에요.', '둘째 문단이에요.']);
  const map = nodes(tree).find(node => node.type === 'PostMapLink');
  assert.equal(map.props.label, '847 Denman St, Vancouver');
  assert.ok(new URL(map.props.url).searchParams.get('query').startsWith('847 Denman St'));
  assert.deepEqual(nodes(tree).filter(node => node.type === 'PostAttachmentLink').map(node => [node.props.url, node.props.row]), [['https://www.instagram.com/handsonyvr/', true]]);
  assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'post.detail.credits'));
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'components_post-card.pressable.7'), 'likes move to the bottom bar');
});
