import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as designSystem from '../src/constants/design-system.ts';

// The shared confirm for risky actions (QA A-set-06, A-chat-03): 취소 first, the action last in danger colour.
const compile = (file, require) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require });
  return exports;
};
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const { Colors } = compile('constants/theme.ts', name => name === 'react-native' ? { Platform: { OS: 'ios', select: values => values.default } } : {});
const luminance = color => {
  const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

function load(theme, feedback = []) {
  const button = compile('components/raised-action-button.tsx', name => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value } };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/constants/design-system') return designSystem;
    if (name === '@/components/clay') return { useClay: () => false, ClayPillFill: () => null };
    if (name === '@/hooks/use-theme') return { useTheme: () => theme };
    throw Error(name);
  });
  const sheet = compile('components/confirm-sheet.tsx', name => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value } };
    if (name === '@/components/drag-sheet') return { DragSheet: 'DragSheet' };
    if (name === '@/components/raised-action-button') return button;
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/constants/theme') return { Spacing: { two: 8, three: 16 } };
    if (name === '@/hooks/use-language') return { useLanguage: () => ({ tr: text => text }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => theme };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    throw Error(name);
  });
  return { ...button, ...sheet };
}

test('the danger action reads in the theme danger colour with readable contrast in light and dark', () => {
  for (const theme of [Colors.light, Colors.dark]) {
    const { RaisedActionButton } = load(theme);
    const touch = nodes(RaisedActionButton({ analyticsId: 'test.danger', label: '영구 탈퇴', tone: 'danger', onPress() {} })).find(node => node.type === 'Pressable');
    const style = Object.assign({}, ...touch.props.style({ pressed: false }).flat(Infinity).filter(value => value && typeof value === 'object'));
    const label = nodes(touch).find(node => node.type === 'Text');
    const color = Object.assign({}, ...[label.props.style].flat(Infinity).filter(Boolean)).color;
    assert.equal(color, theme.danger); assert.equal(style.borderColor, theme.danger);
    assert.equal(style.backgroundColor, 'transparent');
    assert.ok(contrast(color, theme.card) >= 4.5, 'danger text on the sheet stays readable');
    assert.ok(style.minHeight >= 44);
  }
});

test('the confirm sheet puts 취소 first and the action last, and locks both while busy', () => {
  const feedback = [];
  const { ConfirmSheet } = load(Colors.light, feedback);
  let closed = 0, confirmed = 0;
  const props = { visible: true, onClose: () => { closed++; }, title: '모든 기기에서 로그아웃할까요?', body: '이 휴대폰과 웹이 함께 로그아웃돼요.',
    confirmId: 'app_profile_settings.sign-out-all', confirmLabel: '모든 기기에서 로그아웃', onConfirm: () => { confirmed++; } };
  let tree = ConfirmSheet(props);
  assert.equal(tree.type, 'DragSheet'); assert.equal(tree.props.dismissible, true); assert.equal(tree.props.title, props.title);
  const actions = () => nodes(tree).filter(node => node.props?.analyticsId && node.props.label);
  assert.deepEqual(actions().map(node => node.props.label), ['취소', '모든 기기에서 로그아웃']);
  assert.equal(actions()[0].props.analyticsId, 'sheet.close'); assert.equal(actions()[1].props.analyticsId, props.confirmId);
  assert.equal(actions()[1].props.tone, 'danger');
  actions()[0].props.onPress(); assert.equal(closed, 1); assert.deepEqual(feedback, ['selection']);
  actions()[1].props.onPress(); assert.equal(confirmed, 1, 'the caller plays its own result feedback');
  tree = ConfirmSheet({ ...props, busy: true, error: '로그아웃하지 못했어요.' });
  assert.equal(tree.props.dismissible, false, 'a running action cannot be swiped away');
  assert.equal(actions()[0].props.disabled, true); assert.equal(actions()[1].props.busy, true);
  const error = nodes(tree).find(node => node.props?.accessibilityRole === 'alert');
  assert.equal(error.props.children, '로그아웃하지 못했어요.'); assert.equal(error.props.style.color, Colors.light.danger);
});
