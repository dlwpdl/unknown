import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getPostImageSource } from '../src/lib/feed-data.ts';
import { uniqueHashtags } from '../src/lib/hashtags.ts';
import { count, t } from '../src/i18n/ko.ts';
import { googleMapsUrl, postMapBody } from '../src/lib/post-maps.ts';

// Native image events and React state are supplied here; sizing/rendering runs the real components.
function cardRenderer(component = 'PostCard') {
  const values = [];
  let cursor = 0;
  let viewer = 'viewer-a';
  const feedback = [];
  const openedMaps = [];
  const alerts = [];
  let mapFailure = false;
  const react = {
    useCallback: (callback) => callback,
    useRef: (value) => ({ current: value }),
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
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
    'react-native-reanimated': { useReducedMotion: () => true },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/post-body': { PostBody: 'PostBody' },
    '@/components/post-map-link': { PostMapLink: 'PostMapLink' },
    '@/components/report-sheet': { ReportSheet: 'ReportSheet' },
    '@/components/trust-badge': { TrustBadge: 'TrustBadge' },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16 } },
    '@/hooks/use-theme': { useTheme: () => ({ backgroundElement: '#222231' }) },
    '@/i18n/ko': { count, t },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: viewer } }) },
    '@/lib/community-data': {},
    '@/lib/feed-data': { getPostImageSource },
    '@/lib/meetup-ai': {},
    '@/lib/hashtags': { uniqueHashtags },
    '@/lib/post-maps': { googleMapsUrl, postMapBody },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: (kind) => feedback.push(kind) }) },
    '@/lib/sharing': {},
    '@/lib/supabase': {},
  };
  const exports = {};
  const file = component === 'PostCard' ? 'post-card' : component === 'PostMapLink' ? 'post-map-link' : component === 'PostPhotoEditor' ? 'post-photo-editor' : 'post-photo-gallery';
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    assert.ok(name in modules, `Unexpected import: ${name}`);
    return modules[name];
  } });
  return { render(props) { cursor = 0; return exports[component](props); }, feedback, openedMaps, alerts,
    failMap: () => { mapFailure = true; }, setViewer: (id) => { viewer = id; } };
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

test('상세 갤러리는 현재 사진을 자르지 않고 사진별 비율과 좌우 페이지를 유지한다', () => {
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
  assert.equal(style(photos[0]).aspectRatio, 0.8, '옆 장의 로드가 현재 세로 표지의 크기를 덮어쓰지 않는다');
  assert.equal(style(photos[0]).width, 300);
  const scroll = nodes(tree).find((node) => node.type === 'ScrollView');
  assert.equal(scroll.props.horizontal, true);
  assert.equal(scroll.props.pagingEnabled, true);
  scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 300 } } });
  tree = gallery.render(props);
  assert.equal(style(image(tree)).aspectRatio, 16 / 9, '좌우로 넘기면 현재 가로 사진의 원본 높이를 쓴다');
  assert.ok(nodes(tree).some((node) => JSON.stringify(node.props?.children) === '[2,"/",2]'));
  for (const [width, height] of [[0, 10], [10, 0], [NaN, 10], [10, Infinity]]) {
    nodes(tree).filter((node) => node.type === 'Image')[1].props.onLoad(loaded(width, height));
    assert.equal(style(image(gallery.render(props))).aspectRatio, 16 / 9);
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
