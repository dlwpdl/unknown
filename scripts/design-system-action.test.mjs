import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as designSystem from '../src/constants/design-system.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function render(props, reducedMotion = false) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/components/raised-action-button.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value } };
    if (name === 'react-native-reanimated') return { useReducedMotion: () => reducedMotion };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/constants/design-system') return designSystem;
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ accent: '#cbb9ff', accentInk: '#171123', text: '#f6f3f0', card: '#171722', line: '#34343f', backgroundSelected: '#343443' }) };
    throw Error(name);
  }});
  return nodes(exports.RaisedActionButton({ analyticsId: 'test.action', label: '저장', ...props })).find(node => node.type === 'Pressable');
}

test('shared action blocks busy/disabled execution and announces its real state', () => {
  for (const state of [{ busy: true }, { disabled: true }]) {
    let calls = 0;
    const button = render({ ...state, onPress: () => { calls++; } });
    button.props.onPress();
    assert.equal(calls, 0);
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.accessibilityState.disabled, true);
    assert.equal(button.props.accessibilityLabel, '저장');
  }
});

test('shared action invokes the caller once without injecting duplicate feedback', () => {
  let calls = 0;
  const button = render({ onPress: () => { calls++; } });
  button.props.onPress();
  assert.equal(calls, 1);
});
