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
    'react-native': { View: 'View', Image: 'Image', StyleSheet: { create: value => value } },
    '@/components/analytics-controls': { Pressable: 'Pressable', Switch: 'Switch' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Colors: { dark: { text: 'dark' } } },
    '@/hooks/use-content-translation': {},
    '@/hooks/use-language': { useLanguage: () => ({ language }) },
    '@/hooks/use-theme': { useTheme: () => ({ text: 'light', accent: '#6E4AA2' }) },
    '@/lib/content-translation': {},
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/components/content-translation.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    if (name.endsWith('.png')) return { uri: name };
    assert.ok(name in imports, name); return imports[name];
  } });
  return { render: translation => exports.TranslationControl({ translation }), feedback };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const initial = { eligible: true, supported: true, ready: true, loading: false, translated: false, original: true };

test('translation and original states keep required branding adjacent without adding a large button', () => {
  const ui = controls('en'); let calls = 0;
  const action = () => { calls++; };
  let tree = ui.render({ ...initial, action });
  let button = nodes(tree).find(node => node.type === 'Pressable');
  assert.equal(button.props.accessibilityLabel, 'Translate with Google');
  assert.equal(button.props.style({ pressed: false })[0].minHeight, 44);
  button.props.onPress(); assert.equal(calls, 1); assert.deepEqual(ui.feedback, ['selection']);
  tree = ui.render({ ...initial, translated: true, original: false, action });
  assert.equal(nodes(tree).find(node => node.type === 'Image').props.accessibilityLabel, 'powered by Google Translate');
  tree = ui.render({ ...initial, translated: true, original: true, action });
  assert.equal(nodes(tree).find(node => node.type === 'Image'), undefined);
});

test('download preparation disables submission, unsupported builds hide the control, and errors retain a retry action', () => {
  const ui = controls();
  assert.equal(ui.render({ ...initial, supported: false }), null);
  for (const state of [{ loading: true }, { ready: false }]) {
    const button = nodes(ui.render({ ...initial, ...state })).find(node => node.type === 'Pressable');
    assert.equal(button.props.disabled, true);
  }
  const tree = ui.render({ ...initial, error: 'TRANSLATION_UNAVAILABLE' });
  assert.ok(nodes(tree).some(node => typeof node.props?.children === 'string' && node.props.children.includes('원문을 보여드려요')));
  assert.equal(nodes(tree).find(node => node.type === 'Pressable').props.disabled, false);
  assert.equal(ui.render({ ...initial, eligible: false }), null);
});
