import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function rating({ score, reviewKind = 'usage', reduced = false, label, scheme = 'dark', fontScale = 1 }) {
  const animations = [], values = [], cleanups = [], played = [];
  const theme = scheme === 'dark'
    ? { accent: '#CBB9FF', line: '#222', background: '#0B0B12', card: '#171722', textSecondary: '#B7B4C3' }
    : { accent: '#6E4AA2', line: '#DFDAE9', background: '#F7F7FB', card: '#FFFFFF', textSecondary: '#625C70' };
  class Value {
    constructor(value) { this.value = value; values.push(this); }
    setValue(value) { this.value = value; }
    interpolate(config) { return config; }
  }
  const imports = {
    react: { useState: initial => [initial()], useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ fontScale }),
      Animated: { Value, View: 'AnimatedView', timing: (value, config) => { animations.push(config); return { start() {}, stop() {} }; },
        stagger: () => ({ start() {}, stop() {} }) } },
    'react-native-reanimated': { useReducedMotion: () => reduced },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/constants/theme': { Colors: { dark: { background: '#0B0B12' } } },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => played.push(kind) }) },
    '@/constants/design-system': { ControlStyles: { icon: {} }, controlPresentation: () => ({ container: {} }) },
  };
  const exports = {}, url = new URL('../src/components/merchant-rating-bar.tsx', import.meta.url);
  const source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => imports[name] ?? {}) });
  return { tree: exports.MerchantRatingBar({ score, reviewKind, label }), icon: exports.GlingRatingIcon, exports, played, theme, animations, values, cleanups };
}
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

test('inline rating marks inherit the enclosing numeric line metrics instead of the masked bar height', () => {
  const { icon, tree } = rating({ score: 9 });
  const inline = Object.assign({}, ...icon({ score: 9 }).props.style);
  assert.equal(inline.lineHeight, undefined, 'a fixed 14pt inline paragraph clips the 26pt iOS provider score');
  assert.equal(inline.width, undefined, 'inline glyphs use their natural text advance');
  const fill = nodes(tree).find(node => node.props?.testID === 'merchant-rating-fill-0');
  assert.equal(fill.props.style.height, 14, 'masked bar geometry remains unchanged');
});

test('member review bars announce the supplied meeting or chat context', () => {
  assert.equal(rating({ score: 8.7, label: '참석 확인된 만남' }).tree.props.accessibilityLabel, '참석 확인된 만남 평균 8.7점, 10점 만점');
  assert.equal(rating({ score: null, label: '대화' }).tree.props.accessibilityLabel, '대화 점수 없음');
  assert.match(rating({ score: 8 }).tree.props.accessibilityLabel, /^상품·서비스 /);
});

test('an all-review mean is rounded once and maps ten points to five fractional sparkles', () => {
  const { tree } = rating({ score: (10 + 9.5 + 7) / 3 });
  assert.match(tree.props.accessibilityLabel, /8\.8/);
  const fills = nodes(tree).filter(node => node.props?.testID?.startsWith('merchant-rating-fill-'));
  assert.equal(fills.length, 5);
  assert.deepEqual(fills.map(node => node.props.style.width), [...Array(4).fill('100%'), '40%']);
  assert.match(rating({ score: 8.35, reviewKind: 'employment' }).tree.props.accessibilityLabel, /직원 후기.*8\.4/);
});

test('each sparkle and each employment cell covers two points', () => {
  for (const [score, widths] of [[1, ['50%', '0%', '0%', '0%', '0%']], [1.5, ['75%', '0%', '0%', '0%', '0%']],
    [3, ['100%', '50%', '0%', '0%', '0%']], [8.7, ['100%', '100%', '100%', '100%', '35%']], [10, Array(5).fill('100%')]]) {
    const fills = nodes(rating({ score }).tree).filter(node => node.props?.testID?.startsWith('merchant-rating-fill-'));
    assert.deepEqual(fills.map(node => node.props.style.width), widths, String(score));
  }
  const work = nodes(rating({ score: 3, reviewKind: 'employment' }).tree).filter(node => node.props?.testID?.startsWith('merchant-rating-fill-'));
  assert.deepEqual(work.map(node => node.props.style.width), ['100%', '50%', '0%', '0%', '0%']);
});

test('empty and invalid means never look like a scored review; both kinds use the same sparkles (QA A-company-01)', () => {
  for (const score of [null, NaN, Infinity, 0, 11]) {
    const { tree, animations } = rating({ score });
    assert.match(tree.props.accessibilityLabel, /점수 없음/);
    assert.equal(animations.length, 0);
  }
  assert.ok(nodes(rating({ score: 9 }).tree).some(node => node.props?.children === '✦'));
  assert.ok(nodes(rating({ score: 9, reviewKind: 'employment' }).tree).some(node => node.props?.children === '✦'));
  assert.ok(!nodes(rating({ score: 9, reviewKind: 'employment' }).tree).some(node => node.props?.testID === 'merchant-rating-segment'));
});

test('rating motion is finite, stops on unmount, and skips movement with reduced motion', () => {
  const normal = rating({ score: 10 });
  assert.equal(normal.animations.length, 5);
  assert.equal(rating({ score: 10, reviewKind: 'employment' }).animations.length, 5);
  assert.ok(normal.animations.every(config => config.duration <= 300 && config.useNativeDriver === true));
  assert.equal(normal.cleanups.length, 1);
  normal.cleanups[0]();
  assert.ok(normal.values.every(value => value.value === 1));
  assert.equal(rating({ score: 10, reduced: true }).animations.length, 0);
});

test('higher ratings glow brighter in both themes while every mark stays visible on its card', () => {
  const luminance = color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  for (const scheme of ['dark', 'light']) {
    const { icon, theme } = rating({ score: 8.2, scheme });
    const marks = Array.from({ length: 10 }, (_, i) => icon({ score: i + 1 }));
    const colors = marks.map(mark => mark.props.style[1].color);
    assert.equal(new Set(colors).size, 10);
    for (let i = 1; i < colors.length; i++) assert.ok(luminance(colors[i]) > luminance(colors[i - 1]), scheme);
    for (const mark of marks) {
      assert.equal(mark.props.children, '✦');
      assert.equal(mark.props.accessible, false);
      const foreground = luminance(mark.props.style[1].color), background = luminance(theme.card);
      assert.ok((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 3, scheme);
    }
    assert.ok(marks.at(-1).props.style[1].textShadowRadius > marks[0].props.style[1].textShadowRadius);
    for (const score of [null, NaN, Infinity, 0, 11]) assert.equal(icon({ score }).props.style[1].color, theme.line);
  }
});

test('empty marks stay visible on a white light-mode card and keep the line colour in dark mode (QA H43-6)', () => {
  const channel = value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = rgb => rgb.map(channel).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
  const hex = (color, at) => parseInt(color.slice(at, at + 2), 16);
  for (const reviewKind of ['usage', 'employment']) {
    const light = rating({ score: null, reviewKind, scheme: 'light' });
    const empties = light.tree.props.children.map(unit => unit.props.children[0]);
    const colors = empties.map(node => node.props.style[1].color);
    assert.equal(new Set(colors).size, 1);
    const color = colors[0], alpha = hex(color, 7) / 255;
    const mixed = [1, 3, 5].map(at => hex(color, at) * alpha + hex(light.theme.card, at) * (1 - alpha));
    assert.ok(1.05 / (luminance(mixed) + 0.05) >= 3, `${reviewKind} empty mark ${color} needs 3:1 on white`);
    const dark = rating({ score: null, reviewKind, scheme: 'dark' });
    const darkEmpty = dark.tree.props.children[0].props.children[0].props.style[1];
    assert.equal(darkEmpty.color, dark.theme.line);
  }
});

test('QA A-place-02: the ✦ picker reaches every 0.5 step from 1 to 10 and stays one adjustable control', () => {
  const { exports, played } = rating({ score: null });
  const next = exports.ratingPickerNext;
  assert.equal(next(null, { mark: 4 }), 8); assert.equal(next(8, { mark: 4 }), 7, 'a second tap on a full mark takes one point off');
  assert.equal(next(7, { mark: 4 }), 8); assert.equal(next(7.5, { mark: 4 }), 8);
  assert.equal(next(null, { step: 1 }), 1); assert.equal(next(null, { step: -1 }), null);
  assert.equal(next(10, { step: 1 }), 10); assert.equal(next(1, { step: -1 }), 1); assert.equal(next(8, { step: 1 }), 8.5);
  const reachable = new Set();
  for (let mark = 1; mark <= 5; mark++) for (const start of [null, mark * 2]) { const base = next(start, { mark }); reachable.add(base); reachable.add(next(base, { step: 1 })); reachable.add(next(base, { step: -1 })); }
  assert.deepEqual([...reachable].sort((a, b) => a - b), Array.from({ length: 19 }, (_, index) => 1 + index / 2));
  const picked = [];
  const picker = exports.RatingScorePicker({ value: 8.5, onChange: value => picked.push(value), label: '장소 후기 점수', testID: 'score' });
  assert.equal(picker.props.accessibilityRole, 'adjustable');
  assert.equal(picker.props.accessibilityValue.now, 8.5);
  picker.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  const fourth = nodes(picker).find(node => node.props?.testID === 'score.mark.4'), fifth = nodes(picker).find(node => node.props?.testID === 'score.mark.5');
  fourth.props.onPress();
  const fill = mark => nodes(mark).find(node => typeof node.props?.style?.[1]?.width === 'string').props.style[1].width;
  assert.equal(fill(fourth), '100%'); assert.equal(fill(fifth), '25%');
  assert.deepEqual(picked, [9, 8]); assert.deepEqual(played, ['selection', 'selection']);
  const locked = exports.RatingScorePicker({ value: 10, onChange: value => picked.push(value), label: 'x', testID: 'score', disabled: true });
  nodes(locked).find(node => node.props?.testID === 'score.mark.1').props.onPress();
  assert.deepEqual(picked, [9, 8], 'a disabled picker changes nothing');
  // Accessibility text sizes: each ✦ grows a little and its box grows with it, so nothing is clipped, and − + stay inside their 44pt targets.
  const big = rating({ score: null, fontScale: 3 }).exports.RatingScorePicker({ value: 7.5, onChange() {}, label: 'x', testID: 'score' });
  const sparkles = nodes(big).filter(node => node.type === 'Text');
  assert.ok(sparkles.length === 10 && sparkles.every(node => node.props.allowFontScaling === false), 'the glyph does not scale past its box');
  const box = nodes(big).find(node => node.props?.testID === 'score.mark.1').props.children;
  const glyph = Object.assign({}, ...sparkles[0].props.style);
  assert.equal(box.props.style.width, glyph.width); assert.equal(box.props.style.height, glyph.lineHeight);
  assert.ok(glyph.lineHeight <= 44 && glyph.fontSize > 30, 'bigger than at the default size, still inside the 44pt target');
  const plus = nodes(big).find(node => node.props?.testID === 'score.up');
  assert.ok(nodes(plus).find(node => node.type === 'SymbolView' || node.props?.size).props.size > 18);
});
