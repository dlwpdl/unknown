import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function rating({ score, reviewKind = 'usage', reduced = false, label, scheme = 'dark' }) {
  const animations = [], values = [], cleanups = [];
  const theme = scheme === 'dark'
    ? { accent: '#CBB9FF', line: '#222', background: '#0B0B12', card: '#171722' }
    : { accent: '#6E4AA2', line: '#DFDAE9', background: '#F7F7FB', card: '#FFFFFF' };
  class Value {
    constructor(value) { this.value = value; values.push(this); }
    setValue(value) { this.value = value; }
    interpolate(config) { return config; }
  }
  const imports = {
    react: { useState: initial => [initial()], useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value, absoluteFill: {} },
      Animated: { Value, View: 'AnimatedView', timing: (value, config) => { animations.push(config); return { start() {}, stop() {} }; },
        stagger: () => ({ start() {}, stop() {} }) } },
    'react-native-reanimated': { useReducedMotion: () => reduced },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/constants/theme': { Colors: { dark: { background: '#0B0B12' } } },
  };
  const exports = {}, url = new URL('../src/components/merchant-rating-bar.tsx', import.meta.url);
  const source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => imports[name] ?? {}) });
  return { tree: exports.MerchantRatingBar({ score, reviewKind, label }), icon: exports.GlingRatingIcon, theme, animations, values, cleanups };
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
  assert.match(rating({ score: 8.35, reviewKind: 'employment' }).tree.props.accessibilityLabel, /근무.*8\.4/);
});

test('each sparkle covers two points while employment retains ten one-point segments', () => {
  for (const [score, widths] of [[1, ['50%', '0%', '0%', '0%', '0%']], [1.5, ['75%', '0%', '0%', '0%', '0%']],
    [3, ['100%', '50%', '0%', '0%', '0%']], [8.7, ['100%', '100%', '100%', '100%', '35%']], [10, Array(5).fill('100%')]]) {
    const fills = nodes(rating({ score }).tree).filter(node => node.props?.testID?.startsWith('merchant-rating-fill-'));
    assert.deepEqual(fills.map(node => node.props.style.width), widths, String(score));
  }
  const work = nodes(rating({ score: 3, reviewKind: 'employment' }).tree).filter(node => node.props?.testID?.startsWith('merchant-rating-fill-'));
  assert.deepEqual(work.map(node => node.props.style.width), [...Array(3).fill('100%'), ...Array(7).fill('0%')]);
});

test('empty and invalid means never look like a scored review; work uses a bar and usage sparkles', () => {
  for (const score of [null, NaN, Infinity, 0, 11]) {
    const { tree, animations } = rating({ score });
    assert.match(tree.props.accessibilityLabel, /점수 없음/);
    assert.equal(animations.length, 0);
  }
  assert.ok(nodes(rating({ score: 9 }).tree).some(node => node.props?.children === '✦'));
  assert.ok(nodes(rating({ score: 9, reviewKind: 'employment' }).tree).some(node => node.props?.testID === 'merchant-rating-segment'));
});

test('rating motion is finite, stops on unmount, and skips movement with reduced motion', () => {
  const normal = rating({ score: 10 });
  assert.equal(normal.animations.length, 5);
  assert.equal(rating({ score: 10, reviewKind: 'employment' }).animations.length, 10);
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
