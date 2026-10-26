import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function controls(language = 'ko') {
  const feedback = [], jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useState: value => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    '@/components/analytics-controls': { Pressable: 'Pressable', Switch: 'Switch' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/hooks/use-content-translation': {},
    '@/hooks/use-language': { useLanguage: () => ({ language }) },
    '@/hooks/use-theme': { useTheme: () => ({ text: 'light', accent: '#6E4AA2' }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/components/content-translation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    assert.ok(name in imports, name); return imports[name];
  } });
  return { render: translation => exports.TranslationControl({ translation }), feedback };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const initial = { eligible: true, ready: true, loading: false, translated: false, original: true };

test('the control reads like a quiet link: See translation, Translated · See original, Try again', () => {
  const ui = controls('en'); let calls = 0;
  const action = () => { calls++; };
  const label = state => nodes(ui.render({ ...initial, action, ...state })).find(node => node.type === 'Pressable');
  const button = label({});
  assert.equal(button.props.accessibilityLabel, 'See translation');
  assert.equal(button.props.style({ pressed: false })[0].minHeight, 44);
  button.props.onPress(); assert.equal(calls, 1); assert.deepEqual(ui.feedback, ['selection']);
  assert.equal(label({ translated: true, original: false }).props.accessibilityLabel, 'Translated · See original');
  assert.equal(label({ translated: true, original: true }).props.accessibilityLabel, 'See translation');
  assert.equal(label({ loading: true }).props.accessibilityLabel, 'Translating…');
  assert.equal(label({ error: 'TRANSLATION_UNAVAILABLE' }).props.accessibilityLabel, 'Couldn’t translate · Try again');
});

test('loading and unready states disable submission while errors keep a retry action', () => {
  const ui = controls();
  for (const state of [{ loading: true }, { ready: false }]) {
    const button = nodes(ui.render({ ...initial, ...state })).find(node => node.type === 'Pressable');
    assert.equal(button.props.disabled, true);
  }
  const tree = ui.render({ ...initial, error: 'TRANSLATION_UNAVAILABLE' });
  assert.equal(nodes(tree).find(node => node.type === 'Pressable').props.accessibilityLabel, '번역하지 못했어요 · 다시 시도');
  assert.equal(nodes(tree).find(node => node.type === 'Pressable').props.disabled, false);
  assert.equal(ui.render({ ...initial, eligible: false }), null);
});
