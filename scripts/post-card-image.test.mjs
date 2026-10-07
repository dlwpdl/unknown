import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getPostImageSource } from '../src/lib/feed-data.ts';
import { uniqueHashtags } from '../src/lib/hashtags.ts';
import { count, t } from '../src/i18n/ko.ts';

// Native image events and React state are supplied here; sizing/rendering runs the real components.
function cardRenderer(component = 'PostCard') {
  const values = [];
  let cursor = 0;
  let viewer = 'viewer-a';
  const feedback = [];
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
    'react-native': { View: 'View', StyleSheet: { create: (value) => value, hairlineWidth: 1 }, Animated: { Value: class {}, View: 'Animated.View' } },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
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
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: (kind) => feedback.push(kind) }) },
    '@/lib/sharing': {},
    '@/lib/supabase': {},
  };
  const exports = {};
  const file = component === 'PostCard' ? 'post-card' : 'post-photo-gallery';
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    assert.ok(name in modules, `Unexpected import: ${name}`);
    return modules[name];
  } });
  return { render(props) { cursor = 0; return exports[component](props); }, feedback, setViewer: (id) => { viewer = id; } };
}

const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap((value) => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const image = (tree) => nodes(tree).find((node) => node.type === 'Image');
const style = (node) => Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style.filter(Boolean)) : node.props.style;
const loaded = (width, height) => ({ cacheType: 'memory', source: { url: 'signed:photo', width, height, mediaType: 'image/webp', isAnimated: false } });

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
  const photoButton = nodes(card.render(props)).find((node) => node.props?.analyticsId === 'components_post-card.pressable.1');
  photoButton.props.onPress();
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
  assert.equal(gallery.render({ post: { ...props.post, imageUris: ['single'] } }), null);
});
