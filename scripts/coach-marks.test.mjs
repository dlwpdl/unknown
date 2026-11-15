import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
const style = node => Object.assign({}, ...[node.props?.style].flat(Infinity).filter(s => s && typeof s === 'object'));

function load() {
  const slots = [], played = [], announced = [];
  let at = 0;
  const imports = {
    react: { useState: initial => { const i = at++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'react-native': { Modal: 'Modal', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: x => x, absoluteFill: { position: 'absolute' } }, AccessibilityInfo: { announceForAccessibility: line => announced.push(line) } },
    'react-native-reanimated': { default: { View: 'ReanimatedView' }, FadeIn: { duration: () => 'fade' }, FadeInDown: { duration: () => 'fade-down' }, LinearTransition: { duration: () => 'slide' }, useReducedMotion: () => false },
    'react-native-safe-area-context': { initialWindowMetrics: { insets: { bottom: 34 } }, useSafeAreaInsets: () => ({ top: 47, bottom: 34 }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' },
    '@/components/clay': { useClay: () => false, ClayPillFill: () => null },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Colors: { dark: {} }, MaxContentWidth: 800, Spacing: { half: 2, one: 4, two: 8, three: 16, four: 24 }, TabBarHeight: 49 },
    '@/hooks/use-theme': { useTheme: () => ({ accent: 'accent', card: 'card', line: 'line', accentInk: 'ink' }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => played.push(kind) }) },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/coach-marks.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, setTimeout, clearTimeout, Promise, require: withLanguageImports(name => {
    if (name === '@/lib/behavior-analytics') return { behavior() {}, flushBehavior: async () => {} };
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return { ...exports, render: props => { at = 0; return exports.CoachMarks(props); }, played, announced };
}

// A button that has just mounted reads about 50pt low until it settles (QA I-home-03): the tour must measure after that.
const view = rect => { const born = Date.now(); return { current: { measureInWindow: done => done(rect.x, rect.y + (Date.now() - born < 100 ? 50 : 0), rect.width, rect.height) } }; };

test('the tab bar a tour points at is placed from the screen size: the middle of five tabs, above the home indicator', () => {
  const { tabTarget } = load();
  assert.deepEqual({ ...tabTarget(2, 5)({ width: 390, height: 844 }) }, { x: 156, y: 761, width: 78, height: 49 });
  // The web tab bar keeps to the content width and sits on the bottom edge.
  assert.deepEqual({ ...tabTarget(2, 5, 69, 0)({ width: 1200, height: 900 }) }, { x: 520, y: 831, width: 160, height: 69 });
});

test('each lit button gets its own band, cut halfway to the next, and the bands cover the whole screen', () => {
  const { coachBands } = load();
  const fab = { x: 320, y: 680, width: 56, height: 56 }, tab = { x: 156, y: 757, width: 78, height: 57 };
  const bands = coachBands([tab, fab], 844);
  assert.ok(bands[0].hole === fab && bands[1].hole === tab, 'top to bottom');
  assert.equal(bands[0].top, 0);
  assert.equal(bands[0].top + bands[0].height, bands[1].top, 'no gap and no double dimming between bands');
  assert.equal(bands[1].top + bands[1].height, 844);
  for (const { hole, top, height } of bands) assert.ok(hole.y >= top && hole.y + hole.height <= top + height, 'each hole stays inside its band');
});

test('the card sits under buttons in the top half and over buttons in the bottom half, so large text grows away from them', () => {
  const { coachTipPlace } = load();
  const screen = { width: 390, height: 844 }, insets = { top: 47, bottom: 34 };
  const under = coachTipPlace([{ x: 200, y: 52, width: 100, height: 52 }], screen, insets);
  assert.equal(under.top, 120);
  assert.equal(under.bottom, undefined);
  assert.equal(under.maxHeight, 844 - 104 - 16 - 34 - 8, 'stays above the bottom edge when the text is large');
  const over = coachTipPlace([{ x: 320, y: 680, width: 56, height: 56 }, { x: 156, y: 757, width: 78, height: 57 }], screen, insets);
  assert.equal(over.bottom, 844 - 680 + 16);
  assert.equal(over.top, undefined);
  assert.equal(over.maxHeight, 680 - 16 - 47 - 8, 'stays under the status bar');
  assert.equal(under.left + under.width + under.left, 390, 'centred with the screen gutter');
});

test('a tour measures its buttons once the overlay is up, skips steps with nothing on screen, then walks to the end', async () => {
  const coach = load();
  let closed = 0;
  const props = {
    visible: true, analyticsIds: { next: 'next-id', skip: 'skip-id' }, onClose: () => { closed++; },
    steps: [
      { targets: [view({ x: 250, y: 60, width: 90, height: 44 })], title: '도시', body: '도시 설명' },
      { targets: [{ current: null }], title: '없는 버튼', body: '' },
      { targets: [({ width, height }) => ({ x: width / 2 - 39, y: height - 83, width: 78, height: 49 }), view({ x: 320, y: 680, width: 48, height: 48 })], title: '아래', body: '아래 설명' },
    ],
  };
  const root = nodes(coach.render(props)).find(node => node.props?.onLayout);
  assert.ok(nodes(root).some(node => style(node).backgroundColor), 'the screen is dimmed while measuring');
  root.props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } });
  await new Promise(resolve => setTimeout(resolve, 300));

  let tree = coach.render(props);
  assert.match(text(tree), /도시 설명/);
  assert.equal(text(nodes(tree).find(node => node.props?.accessibilityLabel === '2개 중 1번째')), '1/2', 'the step with no button on screen is left out');
  const ring = nodes(tree).find(node => style(node).borderWidth === 2);
  assert.deepEqual([style(ring).left, style(ring).top, style(ring).width, style(ring).height], [246, 56, 98, 52], 'the ring hugs the measured button with a little room');
  const button = label => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label);
  assert.equal(button('건너뛰기').props.analyticsId, 'skip-id');
  button('다음').props.onPress();

  tree = coach.render(props);
  assert.equal(coach.announced.at(-1), '아래. 아래 설명', 'screen readers hear the new step');
  assert.equal(nodes(tree).filter(node => style(node).borderWidth === 2).length, 2, 'the last step lights both of its buttons');
  assert.equal(button('건너뛰기'), undefined, 'nothing left to skip on the last step');
  button('다 봤어요').props.onPress();
  assert.equal(closed, 1);
  assert.deepEqual(coach.played, ['selection', 'selection']);
});

test('a tour with none of its buttons on screen closes instead of leaving a dim screen', async () => {
  const coach = load();
  let closed = 0;
  const props = { visible: true, analyticsIds: { next: 'n', skip: 's' }, onClose: () => { closed++; }, steps: [{ targets: [{ current: null }], title: 't', body: 'b' }] };
  nodes(coach.render(props)).find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(closed, 1);
});
