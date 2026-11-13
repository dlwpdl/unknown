import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import { t } from '../src/i18n/ko.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const dark = { accent: '#CBB9FF' }, light = { accent: '#6B4FD8' };
function panel({ OS = 'android', theme = dark } = {}) {
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/login-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, __DEV__: false, process: { env: {} }, require: withLanguageImports(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return { useRef: current => ({ current }), useState: value => [typeof value === 'function' ? value() : value, () => {}] };
    if (name === 'expo-font') return { useFonts: () => [true] };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/hooks/use-theme') return { useTheme: () => theme, ThemeOverrideProvider: 'ThemeOverrideProvider' };
    if (name === '@/constants/theme') return { Colors: { dark }, Spacing: {} };
    if (name === '@/components/clay') return { useClay: () => false, ClayPillFill: () => null };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === 'react-native') return { Platform: { OS }, StyleSheet: { create: value => value }, View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView' };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable', ScrollView: 'ScrollView' };
    if (name === 'expo-apple-authentication') return { AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { WHITE: 'white', BLACK: 'black' } };
    return new Proxy({}, { get: (_, key) => key });
  }) });
  return exports.LoginPanel;
}

test('the password form rises above the keyboard as a whole and its keys move to the next step (QA A3-1)', () => {
  const tree = panel()({ onReviewLogin() {} });
  const scroll = nodes(tree).find(node => node.type === 'ScrollView');
  const [email, password] = nodes(tree).filter(node => node.type === 'TextInput');
  const calls = [];
  scroll.props.ref.current = { scrollToEnd: options => calls.push(['scrollToEnd', options.animated]) };
  password.props.ref.current = { focus: () => calls.push(['focus']) };
  scroll.props.onLayout();
  assert.deepEqual(calls, [], 'an ordinary layout leaves the scroll where the member put it');
  email.props.onFocus(); scroll.props.onLayout();
  assert.deepEqual(calls, [['scrollToEnd', true]], 'the keyboard shrinking the view shows the password and the start button too');
  assert.equal(email.props.returnKeyType, 'next');
  email.props.onSubmitEditing();
  assert.deepEqual(calls.at(-1), ['focus']);
  email.props.onBlur(); password.props.onFocus(); scroll.props.onLayout();
  assert.equal(calls.length, 3);
  assert.equal(password.props.returnKeyType, 'go');
  password.props.onBlur(); scroll.props.onLayout();
  assert.equal(calls.length, 3, 'after leaving the form the scroll is left alone');
});

test('Sign in with Apple is white on the dark screen and black on the light one, in a plate as tall as the other buttons', () => {
  for (const [theme, style, plate] of [[dark, 'white', '#FFFFFF'], [light, 'black', '#000000']]) {
    const tree = panel({ OS: 'ios', theme })({ onApple() {}, onKakao() {}, onGoogle() {} });
    const apple = nodes(tree).find(node => node.type === 'AppleButton');
    assert.equal(apple.props.buttonStyle, style);
    assert.equal(apple.props.style.height, 44, 'iOS sizes the title from the button height');
    const wrapper = nodes(tree).find(node => node.type === 'View' && [node.props?.children].flat().includes(apple));
    assert.equal(wrapper.props.style[0].height, 56);
    assert.equal(wrapper.props.style[1].backgroundColor, plate);
  }
});
