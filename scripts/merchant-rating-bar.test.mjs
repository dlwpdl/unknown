import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function rating({ score, reviewKind = 'usage', reduced = false }) {
  const animations = [], values = [], cleanups = [];
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
    '@/hooks/use-theme': { useTheme: () => ({ accent: '#CBB9FF', line: '#222', background: '#0B0B12' }) },
  };
  const exports = {}, url = new URL('../src/components/merchant-rating-bar.tsx', import.meta.url);
  const source = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {} });
  return { tree: exports.MerchantRatingBar({ score, reviewKind }), animations, values, cleanups };
}
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

test('an all-review mean is rounded once to one decimal and maps to ten exact fractional units', () => {
  const { tree } = rating({ score: (10 + 9.5 + 7) / 3 });
  assert.match(tree.props.accessibilityLabel, /8\.8/);
  const fills = nodes(tree).filter(node => node.props?.testID?.startsWith('merchant-rating-fill-'));
  assert.equal(fills.length, 10);
  assert.deepEqual(fills.map(node => node.props.style.width), [...Array(8).fill('100%'), '80%', '0%']);
  assert.match(rating({ score: 8.35, reviewKind: 'employment' }).tree.props.accessibilityLabel, /근무.*8\.4/);
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
  assert.equal(normal.animations.length, 10);
  assert.ok(normal.animations.every(config => config.duration <= 300 && config.useNativeDriver === true));
  assert.equal(normal.cleanups.length, 1);
  normal.cleanups[0]();
  assert.ok(normal.values.every(value => value.value === 1));
  assert.equal(rating({ score: 10, reduced: true }).animations.length, 0);
});
