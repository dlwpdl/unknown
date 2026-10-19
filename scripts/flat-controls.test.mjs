import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { flatControlStyle } from '../src/lib/flat-control.ts';
import * as designSystem from '../src/constants/design-system.ts';

test('flat controls keep geometry, shape, colors and state without any raised paint', () => {
  for (const style of [
    { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, backgroundColor: '#EEEAF7' },
    { minHeight: 52, paddingHorizontal: 20, borderRadius: 999, backgroundColor: '#CBB9FF', opacity: .5 },
    { minHeight: 44, minWidth: 44, paddingLeft: 8 },
  ]) {
    const paint = flatControlStyle(style), result = { ...style, ...paint };
    assert.equal(result.boxShadow, undefined);
    assert.equal(result.shadowOpacity, 0);
    assert.equal(result.elevation, 0);
    for (const [key, value] of Object.entries(style)) assert.deepEqual(result[key], value, key);
  }
});

test('flat primary paint hides the raised bottom strip without changing its layout reservation', () => {
  const style = { minHeight: 52, padding: 12, borderRadius: 14, borderBottomWidth: 3, borderBottomColor: '#69508F', backgroundColor: '#CBB9FF' };
  const result = { ...style, ...flatControlStyle(style) };
  assert.equal(result.borderBottomWidth, 3);
  assert.equal(result.borderBottomColor, style.backgroundColor);
  assert.equal(result.minHeight, 52);
  assert.equal(result.padding, 12);
});

test('flat controls preserve meaningful thin outlines and text-tab underlines', () => {
  for (const style of [
    { borderWidth: 1, borderColor: '#AAA', borderBottomWidth: 1, borderBottomColor: '#AAA', backgroundColor: '#FFF' },
    { borderBottomWidth: 1, borderBottomColor: '#AAA', backgroundColor: '#FFF' },
    { borderBottomWidth: 2, borderBottomColor: '#CBB9FF', backgroundColor: '#EEEAF7' },
    { borderBottomWidth: 2, borderBottomColor: '#CBB9FF', backgroundColor: 'transparent' },
  ]) {
    const result = { ...style, ...flatControlStyle(style) };
    assert.equal(result.borderColor, style.borderColor);
    assert.equal(result.borderBottomColor, style.borderBottomColor);
  }
});

test('flat controls forward native refs, accessibility, disabled state, callbacks and function children without an extra layout container', () => {
  const exports = {}, flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/flat-pressable.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Pressable: 'NativePressable', Platform: { OS: 'web' }, StyleSheet: { flatten } };
    if (name === '@/lib/flat-control') return { flatControlStyle };
    throw new Error(name);
  } });
  const ref = {}, onPress = () => {}, onLongPress = () => {}, children = () => 'label';
  const element = exports.FlatPressable({ ref, onPress, onLongPress, children, disabled: true, hitSlop: 8,
    accessibilityLabel: '기존 버튼', accessibilityState: { disabled: true, busy: true },
    style: ({ pressed }) => [{ minHeight: 44, paddingHorizontal: 12 }, { opacity: pressed ? .5 : 1 }],
  });
  assert.equal(element.type, 'NativePressable');
  for (const [key, value] of Object.entries({ ref, onPress, onLongPress, children, disabled: true, hitSlop: 8 })) assert.equal(element.props[key], value);
  assert.equal(element.props.accessibilityLabel, '기존 버튼');
  assert.equal(element.props.accessibilityState.busy, true);
  for (const pressed of [false, true]) {
    const result = flatten(element.props.style({ pressed }));
    assert.equal(result.minHeight, 44);
    assert.equal(result.paddingHorizontal, 12);
    assert.equal(result.opacity, pressed ? .5 : 1);
  }
  for (const opacity of [undefined, 1]) {
    const quiet = exports.FlatPressable({ style: () => ({ minHeight: 44, opacity }) });
    assert.equal(flatten(quiet.props.style({ pressed: true })).opacity, 0.82);
    assert.equal(flatten(quiet.props.style({ pressed: false })).opacity, opacity);
  }
});


test('primary buttons retain 44/52-point targets, labels and callbacks without depth motion', () => {
  const exports = {}, flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/raised-action-button.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: x => x } };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/constants/design-system') return designSystem;
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ accent: '#CBB9FF', accentInk: '#171123' }) };
    throw new Error(name);
  } });
  let calls = 0;
  const onPress = () => { calls++; };
  for (const compact of [false, true]) {
    const tree = exports.RaisedActionButton({ analyticsId: 'primary', label: '신청하기', onPress, compact, disabled: true, busy: true });
    assert.equal(flatten(tree.props.style).paddingBottom, 2);
    const touch = tree.props.children.props.children;
    touch.props.onPress();
    assert.equal(calls, 0, 'unavailable primary actions must not invoke their caller');
    assert.equal(touch.props.disabled, true);
    assert.equal(touch.props.accessibilityState.busy, true);
    assert.equal(touch.props.children.props.children, '신청하기');
    for (const pressed of [false, true]) {
      const style = flatten(touch.props.style({ pressed }));
      assert.equal(style.minHeight, compact ? 44 : 52);
      assert.equal(style.paddingHorizontal, compact ? 16 : 20);
      assert.equal(style.transform, undefined);
      assert.equal(style.boxShadow, undefined);
    }
  }
});
