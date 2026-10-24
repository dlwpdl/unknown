import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getPostImageSource } from '../src/lib/feed-data.ts';

function loadGallery(page = null, width = 390, platform = 'ios') {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/post-photo-gallery.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const values = [], refs = [], effects = [], scrolls = [], feedback = [];
  let stateCall = 0, refCall = 0, effectCall = 0, pending = [], viewer = 'author';
  let windowDimensions = { width: 390, height: 844 };
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name === 'expo-image') return { Image: (props) => ({ type: 'Image', props }) };
    if (name === 'react') return {
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (initial) => refs[refCall++] ??= { current: initial },
      useState(initial) {
        const index = stateCall++;
        if (!(index in values)) values[index] = index === 0 ? width : index === 1 ? page : typeof initial === 'function' ? initial() : initial;
        return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
      },
      useEffect(callback, dependencies) {
        const index = effectCall++, previous = effects[index];
        if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) pending.push(callback);
        effects[index] = dependencies;
      },
    };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };

    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) };
    if (name === 'react-native-reanimated') return {
      __esModule: true, default: { View: 'AnimatedView' }, useReducedMotion: () => true, runOnJS: (fn) => fn,
      useSharedValue: (initial) => refs[refCall++] ??= { value: initial, get() { return this.value; }, set(value) { this.value = value; } },
      useAnimatedStyle: (fn) => Object.defineProperty({}, 'transform', { enumerable: true, get: () => fn().transform }),
    };
    if (name === 'react-native-gesture-handler') {
      const gesture = (type) => ({ type, handlers: {}, minDistance() { return this; }, averageTouches() { return this; },
        onChange(fn) { this.handlers.change = event => fn({ numberOfPointers: 1, ...event }); return this; }, onStart(fn) { this.handlers.start = fn; return this; },
        onUpdate(fn) { this.handlers.update = fn; return this; }, onFinalize(fn) { this.handlers.finalize = fn; return this; } });
      return { GestureHandlerRootView: 'GestureRoot', GestureDetector: 'GestureDetector',
        Gesture: { Pan: () => gesture('pan'), Pinch: () => gesture('pinch'), Simultaneous: (...gestures) => ({ gestures }) } };
    }
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, me: { id: viewer } }) };
    if (name === '@/lib/feed-data') return { getPostImageSource };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: (kind) => feedback.push(kind) }) };
    if (name === 'react-native') return {
      StyleSheet: { create: (value) => value, hairlineWidth: 1 }, Platform: { OS: platform }, View: 'View', Modal: 'Modal', useWindowDimensions: () => windowDimensions,
    };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable', ScrollView: 'ScrollView' };
    if (name === '@/components/themed-text') return { ThemedText: (props) => ({ type: 'ThemedText', props }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ backgroundElement: '#222231', card: '#171722', line: '#343443', accent: '#CBB9FF' }) };
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return { Gallery(props) {
    stateCall = refCall = effectCall = 0;
    pending = [];
    const tree = exports.PostPhotoGallery(props);
    for (const node of nodes(tree)) if (node.props?.ref && !node.props.ref.current) {
      node.props.ref.current = { scrollTo: (options) => scrolls.push({ id: node.props.analyticsId, ...options }), measureInWindow: callback => callback(0, 48, 390, 500) };
    }
    pending.forEach(callback => callback());
    return tree;
  }, scrolls, feedback, setViewer: (id) => { viewer = id; }, setWindowDimensions: (value) => { windowDimensions = value; } };
}

const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap((value) => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const hero = (tree) => nodes(tree).find(node => node.props?.analyticsId === 'components_post-photo-gallery.scrollview.1');
const thumbnails = (tree) => nodes(tree).filter(node => node.props?.analyticsId === 'post.photo.select');
const control = (tree, id) => nodes(tree).find(node => node.props?.analyticsId === `post.photo.${id}`);
const viewport = (tree) => nodes(tree).find(node => node.props?.testID === 'post-photo-viewport');
const position = (tree) => {
  const transform = nodes(tree).find(node => node.type === 'AnimatedView').props.style.transform;
  return { x: transform[0].translateX.value ?? transform[0].translateX, y: transform[1].translateY.value ?? transform[1].translateY };
};
const gesture = (tree, type) => nodes(tree).find(node => node.type === 'GestureDetector')?.props.gesture.gestures.find(item => item.type === type).handlers;
function openPortrait(gallery, props) {
  const tree = gallery.Gallery(props);
  nodes(hero(tree)).find(node => node.props?.onLoad).props.onLoad({ source: { width: 600, height: 800 } });
  control(tree, 'open').props.onPress();
  viewport(gallery.Gallery(props)).props.onLayout({ nativeEvent: { layout: { width: 390, height: 500 } } });
  return gallery.Gallery(props);
}

test('확대 후 사진을 대각선으로 끌고 가장자리에서 즉시 방향을 바꿀 수 있다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'portrait', title: '사진', imageUris: ['original'] } };
  let tree = openPortrait(gallery, props);
  gesture(tree, 'pan').change({ changeX: 100, changeY: -80 });
  assert.equal(Math.abs(position(tree).x) + Math.abs(position(tree).y), 0);
  control(tree, 'zoom').props.onPress();
  tree = gallery.Gallery(props);
  const pan = gesture(tree, 'pan');
  pan.change({ changeX: 100, changeY: -80 });
  assert.deepEqual(position(tree), { x: 100, y: -80 });
  pan.change({ changeX: 900, changeY: -920 });
  assert.deepEqual(position(tree), { x: 180, y: -250 });
  pan.change({ changeX: -10, changeY: 10 });
  assert.deepEqual(position(tree), { x: 170, y: -240 }, '경계에서도 손가락을 따라 바로 돌아온다');
  pan.change({ changeX: -30, changeY: 40 });
  assert.deepEqual(position(tree), { x: 140, y: -200 }, '다시 잡으면 마지막 위치부터 움직인다');
});

test('축소·사진 변경·닫기·뷰포트 변경은 확대 사진 위치를 초기화한다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'reset', title: '사진', imageUris: ['one', 'two'] } };
  let tree = openPortrait(gallery, props);
  const drag = () => {
    control(tree, 'zoom').props.onPress(); tree = gallery.Gallery(props);
    gesture(tree, 'pan').change({ changeX: 100, changeY: 100 });
    assert.deepEqual(position(tree), { x: 100, y: 100 });
  };
  drag();
  control(tree, 'zoom').props.onPress(); tree = gallery.Gallery(props);
  assert.deepEqual(position(tree), { x: 0, y: 0 });
  drag();
  viewport(tree).props.onLayout({ nativeEvent: { layout: { width: 600, height: 390 } } });
  tree = gallery.Gallery(props);
  assert.deepEqual(position(tree), { x: 0, y: 0 });
  nodes(tree).find(node => node.props?.accessibilityLabel === '다음 사진').props.onPress();
  tree = gallery.Gallery(props);
  assert.deepEqual(position(tree), { x: 0, y: 0 });
  gesture(tree, 'pan').change({ changeX: 100, changeY: 100 });
  assert.deepEqual(position(tree), { x: 0, y: 0 });
  control(tree, 'close').props.onPress(); tree = gallery.Gallery(props);
  assert.equal(viewport(tree), undefined);
  control(tree, 'open').props.onPress(); tree = gallery.Gallery(props);
  assert.deepEqual(position(tree), { x: 0, y: 0 });
});

test('확대 사진의 접근성 이동도 같은 경계와 피드백을 사용한다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'accessible', title: '사진', imageUris: ['one'] } };
  let tree = openPortrait(gallery, props);
  control(tree, 'zoom').props.onPress(); tree = gallery.Gallery(props);
  const pan = viewport(tree).props;
  assert.equal(pan.accessibilityActions.length, 4);
  pan.onAccessibilityAction({ nativeEvent: { actionName: 'left' } });
  pan.onAccessibilityAction({ nativeEvent: { actionName: 'up' } });
  assert.deepEqual(position(tree), { x: 180, y: 250 });
  pan.onAccessibilityAction({ nativeEvent: { actionName: 'right' } });
  assert.deepEqual(position(tree), { x: -15, y: 250 });
  assert.deepEqual(gallery.feedback.slice(-3), ['selection', 'selection', 'selection']);
});

test('두 손가락 확대는 1~4배를 유지하고 손가락 위치를 중심으로 확대한다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'pinch', title: '사진', imageUris: ['one'] } };
  let tree = openPortrait(gallery, props);
  const pinch = gesture(tree, 'pinch');
  assert.ok(pinch, '기존 두 손가락 확대를 유지한다');
  pinch.start({ focalX: 225, focalY: 300 });
  pinch.update({ scale: 3, focalX: 225, focalY: 300 });
  assert.deepEqual(position(tree), { x: -60, y: -100 });
  pinch.update({ scale: 10, focalX: 225, focalY: 300 });
  assert.equal(nodes(tree).find(node => node.type === 'AnimatedView').props.style.transform[2].scale, 4);
  const beforeRelease = position(tree);
  pinch.finalize(); tree = gallery.Gallery(props);
  assert.deepEqual(position(tree), beforeRelease, '손을 떼도 확대해서 보고 있던 부분을 유지한다');
  assert.equal(control(tree, 'zoom').props.accessibilityLabel, '사진 축소');
  gesture(tree, 'pinch').start({ focalX: 225, focalY: 300 });
  gesture(tree, 'pinch').update({ scale: 0.01, focalX: 225, focalY: 300 });
  gesture(tree, 'pinch').finalize(); tree = gallery.Gallery(props);
  assert.equal(control(tree, 'zoom').props.accessibilityLabel, '사진 확대');
  assert.deepEqual(position(tree), { x: 0, y: 0 });
});

test('웹에서는 키보드로 누를 수 있는 이동 버튼으로 확대 사진의 네 방향을 본다', () => {
  const gallery = loadGallery(null, 390, 'web');
  const props = { post: { id: 'keyboard', title: '사진', imageUris: ['one'] } };
  let tree = openPortrait(gallery, props);
  assert.equal(nodes(tree).filter(node => node.props?.analyticsId === 'post.photo.pan').length, 0);
  control(tree, 'zoom').props.onPress(); tree = gallery.Gallery(props);
  const buttons = nodes(tree).filter(node => node.props?.analyticsId === 'post.photo.pan');
  assert.equal(buttons.length, 4);
  buttons.find(node => node.props.accessibilityLabel === '사진 왼쪽 부분 보기').props.onPress();
  buttons.find(node => node.props.accessibilityLabel === '사진 아래쪽 부분 보기').props.onPress();
  assert.deepEqual(position(tree), { x: 180, y: -250 });
  assert.deepEqual(gallery.feedback.slice(-2), ['selection', 'selection']);
});

test('웹의 두 손가락 위치는 툴바 아래 사진 영역을 기준으로 계산한다', () => {
  const gallery = loadGallery(null, 390, 'web');
  const props = { post: { id: 'web-pinch', title: '사진', imageUris: ['one'] } };
  let tree = openPortrait(gallery, props);
  const pinch = gesture(tree, 'pinch');
  pinch.start({ focalX: 195, focalY: 298 }); pinch.update({ scale: 2, focalX: 195, focalY: 298 });
  assert.equal(Math.abs(position(tree).x) + Math.abs(position(tree).y), 0, '사진 중앙을 짚으면 중앙을 유지한다');
  pinch.finalize(); tree = gallery.Gallery(props);
  control(tree, 'zoom').props.onPress(); tree = gallery.Gallery(props);
  gesture(tree, 'pinch').start({ focalX: 225, focalY: 348 }); gesture(tree, 'pinch').update({ scale: 2, focalX: 225, focalY: 348 });
  assert.deepEqual(position(tree), { x: -30, y: -50 });
  gesture(tree, 'pinch').finalize(); tree = gallery.Gallery(props);
  assert.deepEqual(position(tree), { x: -30, y: -50 });
});

test('두 손가락 이동과 확대가 같은 기준점을 유지하고 한 손가락 이동과 겹치지 않는다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'two-finger-pan', title: '사진', imageUris: ['one'] } };
  const tree = openPortrait(gallery, props);
  gesture(tree, 'pinch').start({ focalX: 195, focalY: 250 });
  gesture(tree, 'pan').change({ changeX: 20, changeY: 40, numberOfPointers: 2 });
  gesture(tree, 'pinch').update({ scale: 2, focalX: 215, focalY: 290 });
  assert.deepEqual(position(tree), { x: 20, y: 40 });
});

test('twenty photo pages load only the current photo and its neighbours at the start, middle and end', () => {
  const post = { id: 'twenty', title: '창고', imageUris: Array.from({ length: 20 }, (_, i) => `signed:${i}`) };
  for (const index of [0, 10, 19]) {
    const { Gallery } = loadGallery({ key: JSON.stringify([post.id, 'author', post.imageUris]), index });
    const tree = Gallery({ post });
    const loaded = nodes(hero(tree)).filter(node => node.props?.source?.uri).map(node => node.props.source.uri);
    assert.deepEqual(loaded, post.imageUris.slice(Math.max(0, index - 1), Math.min(20, index + 2)));
    const scroll = nodes(tree).find(node => node.props?.analyticsId === 'components_post-photo-gallery.scrollview.1');
    assert.equal(scroll.props.children.length, 20, 'every page keeps its place for swiping');
  }
});

test('사진을 불러오거나 가로·세로·정사각 사진을 넘겨도 갤러리 영역은 고정된다', () => {
  for (const width of [320, 390, 768]) {
    const gallery = loadGallery(null, width);
    const props = { post: { id: 'mixed-ratios', title: '사진', imageUris: ['landscape', 'portrait', 'square'] } };
    for (const [index, dimensions] of [[0, [1600, 900]], [1, [600, 1200]], [2, [1000, 1000]]]) {
      let tree = gallery.Gallery(props);
      const photo = nodes(hero(tree)).filter(node => node.props?.onLoad)[index];
      photo.props.onLoad({ source: { width: dimensions[0], height: dimensions[1] } });
      hero(tree).props.onScroll({ nativeEvent: { contentOffset: { x: index * width } } });
      tree = gallery.Gallery(props);
      for (const image of nodes(hero(tree)).filter(node => node.props?.onLoad)) {
        assert.equal(image.props.style.width, width);
        assert.equal(image.props.style.aspectRatio, 4 / 3, '사진의 원본 비율이 갤러리 높이를 바꾸지 않는다');
        assert.equal(image.props.contentFit, 'contain', '사진 전체를 비율을 유지하며 보여준다');
      }
    }
  }
});

test('사진이 한 장이어도 상세 갤러리에서 원본을 보여준다', () => {
  const { Gallery } = loadGallery();
  assert.ok(nodes(Gallery({ post: { id: 'post-1', imageUris: ['signed:one'] } })).some(n => n.props?.source?.uri === 'signed:one'));
});

test('여러 장이면 가로 갤러리와 장수 표시를 만든다', () => {
  const { Gallery } = loadGallery();
  const tree = Gallery({ post: { id: 'post-1', title: '주말 등산', imageUris: ['signed:one', 'signed:two', 'signed:three'] } });
  assert.ok(tree);
  const scroll = nodes(tree).find((node) => node.props?.analyticsId === 'components_post-photo-gallery.scrollview.1');
  assert.ok(scroll, '갤러리는 가로 스크롤을 쓴다');
  assert.equal(scroll.props.horizontal, true);
  assert.equal(scroll.props?.pagingEnabled, true);
  assert.equal((scroll.props.children ?? []).length, 3);
  const label = (node) => Array.isArray(node.props?.children) ? node.props.children.join('') : String(node.props?.children);
  assert.ok(nodes(tree).some((node) => label(node) === '1/3'), '장수 표시가 있어야 한다');
});

test('화면 폭을 알기 전에는 큰 이미지를 그리지 않는다', () => {
  const { Gallery } = loadGallery(null, 0);
  assert.equal(hero(Gallery({ post: { id: 'post-1', imageUris: ['a', 'b'] } })), undefined);
});

test('20장 썸네일은 작은 이미지를 사용하고 마지막 선택과 전체 화면 원본을 연결한다', () => {
  const gallery = loadGallery();
  const post = { id: 'twenty', title: '창고', imageUris: Array.from({ length: 20 }, (_, i) => `original:${i}`), imageThumbs: Array.from({ length: 20 }, (_, i) => `thumb:${i}`) };
  let tree = gallery.Gallery({ post });
  const strip = nodes(tree).find(node => node.props?.analyticsId === 'post.photo.thumbnails');
  assert.equal(strip?.props.horizontal, true);
  assert.equal(strip.props.style?.height, 72, '앱의 세로 목록 안에서도 작은 사진 줄의 높이를 확보한다');
  assert.equal(strip.props.style?.flexShrink, 0, '큰 사진 때문에 작은 사진 줄이 접히지 않는다');
  assert.equal(thumbnails(tree).length, 20);
  assert.deepEqual(nodes(strip).filter(node => node.props?.source?.uri).map(node => node.props.source.uri), post.imageThumbs);
  thumbnails(tree)[19].props.onPress();
  tree = gallery.Gallery({ post });
  assert.equal(thumbnails(tree)[19].props.accessibilityState.selected, true);
  assert.match(thumbnails(tree)[19].props.accessibilityLabel, /선택됨/);
  assert.equal(thumbnails(tree)[0].props.accessibilityState.selected, false);
  assert.ok(gallery.scrolls.some(call => call.id === 'components_post-photo-gallery.scrollview.1' && call.x === 19 * 390 && call.animated === false));
  assert.ok(gallery.scrolls.some(call => call.id === 'post.photo.thumbnails' && call.x > 1000));
  assert.deepEqual(gallery.feedback, ['selection']);
  nodes(tree).find(node => node.props?.accessibilityLabel === '창고 사진 20 크게 보기').props.onPress();
  const modal = nodes(gallery.Gallery({ post })).find(node => node.type === 'Modal');
  assert.equal(nodes(modal).find(node => node.props?.source?.uri).props.source.uri, 'original:19');
});

test('스와이프와 화면 폭 변경이 같은 선택 사진을 유지한다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'photos', title: '사진', imageUris: ['one', 'two', 'three'] } };
  hero(gallery.Gallery(props)).props.onScroll({ nativeEvent: { contentOffset: { x: 780 } } });
  let tree = gallery.Gallery(props);
  assert.equal(thumbnails(tree)[2]?.props.accessibilityState.selected, true);
  tree.props.onLayout({ nativeEvent: { layout: { width: 600 } } });
  tree = gallery.Gallery(props);
  assert.equal(thumbnails(tree)[2].props.accessibilityState.selected, true);
  assert.equal(gallery.scrolls.filter(call => call.id === 'components_post-photo-gallery.scrollview.1').at(-1).x, 1200);
  hero(tree).props.onScroll({ nativeEvent: { contentOffset: { x: -60 } } });
  tree = gallery.Gallery(props);
  assert.equal(thumbnails(tree)[0].props.accessibilityState.selected, true);
  hero(tree).props.onScroll({ nativeEvent: { contentOffset: { x: 9000 } } });
  assert.equal(thumbnails(gallery.Gallery(props))[2].props.accessibilityState.selected, true);
});

test('an already-open photo viewer preserves its selected original through window and available-frame resizing', () => {
  const gallery = loadGallery(null, 0);
  const props = { post: { id: 'resize-open', title: 'Resize photos', imageUris: ['one', 'two', 'three'] } };
  // Child layout frames are independent fixture inputs, not native safe-area predictions.
  const layouts = [
    { window: { width: 466, height: 678 }, frame: 434, viewport: { width: 434, height: 500 }, image: [375, 500], maxHeight: 372.9, offset: 868 },
    { window: { width: 951, height: 669 }, frame: 919, viewport: { width: 919, height: 491 }, image: [368.25, 491], maxHeight: 367.95, offset: 1838 },
    { window: { width: 669, height: 951 }, frame: 637, viewport: { width: 637, height: 773 }, image: [579.75, 773], maxHeight: 520, offset: 1274 },
    { window: { width: 466, height: 678 }, frame: 434, viewport: { width: 434, height: 500 }, image: [375, 500], maxHeight: 372.9, offset: 868 },
  ];
  gallery.setWindowDimensions(layouts[0].window);
  let tree = gallery.Gallery(props);
  tree.props.onLayout({ nativeEvent: { layout: { width: layouts[0].frame } } });
  tree = gallery.Gallery(props);
  thumbnails(tree)[2].props.onPress(); tree = gallery.Gallery(props);
  const selectedImage = nodes(hero(tree)).find(node => node.props?.accessibilityLabel === 'Resize photos 사진 3');
  selectedImage.props.onLoad({ source: { width: 600, height: 800 } });
  nodes(hero(tree)).find(node => node.props?.accessibilityLabel === 'Resize photos 사진 3 크게 보기').props.onPress();
  tree = gallery.Gallery(props);
  const opened = nodes(tree).find(node => node.type === 'Modal');
  assert.equal(opened?.props.visible, true);

  for (const layout of layouts) {
    gallery.setWindowDimensions(layout.window);
    tree = gallery.Gallery(props);
    assert.ok(viewport(tree), 'Resizing does not close an already-open viewer');
    tree.props.onLayout({ nativeEvent: { layout: { width: layout.frame } } });
    viewport(tree).props.onLayout({ nativeEvent: { layout: layout.viewport } });
    tree = gallery.Gallery(props);
    assert.equal(thumbnails(tree)[2].props.accessibilityState.selected, true);
    assert.equal(thumbnails(tree).filter(node => node.props.accessibilityState.selected).length, 1);
    const modal = nodes(tree).find(node => node.type === 'Modal');
    assert.equal(modal?.props.visible, true);
    const original = nodes(modal).find(node => node.props?.source?.uri);
    assert.equal(original.props.source.uri, 'three');
    assert.deepEqual([original.props.style.width, original.props.style.height], layout.image);
    const inline = nodes(hero(tree)).find(node => node.props?.accessibilityLabel === 'Resize photos 사진 3');
    assert.equal(inline.props.style.width, layout.frame, 'Use the reported gallery frame, not window width');
    assert.ok(Math.abs(inline.props.style.maxHeight - layout.maxHeight) < 1e-9, 'Inline height responds to the current window height');
    assert.equal(gallery.scrolls.filter(call => call.id === 'components_post-photo-gallery.scrollview.1').at(-1).x, layout.offset);
  }
  control(tree, 'close').props.onPress(); tree = gallery.Gallery(props);
  assert.equal(viewport(tree), undefined);
  assert.equal(thumbnails(tree)[2].props.accessibilityState.selected, true, 'Closing returns to the same selected photo');
  assert.equal(gallery.scrolls.filter(call => call.id === 'components_post-photo-gallery.scrollview.1').at(-1).x, 868);
});

test('원본이 없는 위치를 건너뛰어도 썸네일과 원본이 같은 사진을 가리킨다', () => {
  const { Gallery } = loadGallery();
  const tree = Gallery({ post: { id: 'missing', imageUris: ['one', undefined, 'three'], imageThumbs: ['small-one', 'unavailable', 'small-three'] } });
  assert.deepEqual(thumbnails(tree).flatMap(node => nodes(node).filter(child => child.props?.source?.uri).map(child => child.props.source.uri)), ['small-one', 'small-three']);
});

test('계정·글·사진 변경은 이전 선택과 열려 있던 원본 뷰어를 초기화한다', () => {
  const gallery = loadGallery();
  let props = { post: { id: 'photos', title: '사진', imageUris: ['one', 'two'] } };
  thumbnails(gallery.Gallery(props))[1]?.props.onPress();
  let tree = gallery.Gallery(props);
  nodes(tree).find(node => node.props?.accessibilityLabel === '사진 사진 2 크게 보기').props.onPress();
  assert.ok(nodes(gallery.Gallery(props)).some(node => node.type === 'Modal'));
  gallery.setViewer('another-viewer');
  tree = gallery.Gallery(props);
  assert.equal(thumbnails(tree)[0]?.props.accessibilityState.selected, true);
  assert.ok(!nodes(tree).some(node => node.type === 'Modal'));
  assert.ok(nodes(hero(tree)).filter(node => node.props?.source).every(node => node.props.source.cacheKey.startsWith('post-image:another-viewer:')));
  for (const post of [{ ...props.post, id: 'other' }, { ...props.post, imageUris: ['replacement', 'two'] }]) {
    thumbnails(gallery.Gallery(props))[1].props.onPress();
    props = { post };
    assert.equal(thumbnails(gallery.Gallery(props))[0].props.accessibilityState.selected, true);
  }
});

test('사진 한 장에는 불필요한 썸네일 줄을 만들지 않고 빈 글은 갤러리를 생략한다', () => {
  const { Gallery } = loadGallery();
  assert.equal(thumbnails(Gallery({ post: { id: 'one', imageUris: ['one'] } })).length, 0);
  assert.equal(Gallery({ post: { id: 'empty', imageUris: [] } }), null);
});

test('썸네일이 없는 기존 20장 글도 보이는 작은 사진 범위만 원본으로 폴백한다', () => {
  const gallery = loadGallery();
  const props = { post: { id: 'legacy', imageUris: Array.from({ length: 20 }, (_, i) => `original:${i}`) } };
  let tree = gallery.Gallery(props);
  const requested = (value) => new Set(nodes(value).filter(node => node.props?.source?.uri).map(node => node.props.source.uri));
  assert.ok(requested(tree).size <= 8, '화면 밖 20장 원본을 한꺼번에 요청하지 않는다');
  nodes(tree).find(node => node.props?.analyticsId === 'post.photo.thumbnails').props.onScroll({ nativeEvent: { contentOffset: { x: 1080 } } });
  tree = gallery.Gallery(props);
  const strip = nodes(tree).find(node => node.props?.analyticsId === 'post.photo.thumbnails');
  const shown = [...requested(strip)];
  assert.ok(shown.includes('original:19'), '끝으로 스크롤하면 끝 사진을 보여준다');
  assert.ok(!shown.includes('original:0'), '보이지 않는 원본은 작은 사진에서도 요청하지 않는다');
  assert.ok(shown.length <= 8);
  thumbnails(tree)[19].props.onPress();
  assert.equal(thumbnails(gallery.Gallery(props))[19].props.accessibilityState.selected, true);
});
