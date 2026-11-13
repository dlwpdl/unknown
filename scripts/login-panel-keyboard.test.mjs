import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import { t } from '../src/i18n/ko.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const dark = { accent: '#CBB9FF' }, light = { accent: '#6B4FD8' };
function panel({ OS = 'android', theme = dark, frames = [] } = {}) {
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/login-panel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, __DEV__: false, process: { env: {} }, requestAnimationFrame: callback => frames.push(callback), require: withLanguageImports(name => {
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
  const frames = [], flush = () => { while (frames.length) frames.shift()(); };
  const tree = panel({ frames })({ onReviewLogin() {} });
  const scroll = nodes(tree).find(node => node.type === 'ScrollView');
  const [email, password] = nodes(tree).filter(node => node.type === 'TextInput');
  const calls = [], scrolls = () => calls.filter(([kind]) => kind === 'scrollToEnd').length;
  scroll.props.ref.current = { scrollToEnd: options => calls.push(['scrollToEnd', options.animated]) };
  password.props.ref.current = { focus: () => calls.push(['focus']) };
  scroll.props.onLayout(); flush();
  assert.deepEqual(calls, [], 'an ordinary layout leaves the scroll where the member put it');
  email.props.onFocus(); scroll.props.onLayout();
  assert.equal(scrolls(), 0, 'it waits for Android to finish placing the focused field');
  flush();
  assert.deepEqual(calls.at(-1), ['scrollToEnd', true], 'the keyboard shrinking the view shows the password and the start button too');
  assert.equal(email.props.returnKeyType, 'next');
  email.props.onSubmitEditing();
  assert.deepEqual(calls.at(-1), ['focus']);
  // '다음' moves focus while the keyboard settles again: the layout between the two fields still ends on the start button.
  const before = scrolls();
  email.props.onBlur(); scroll.props.onLayout(); password.props.onFocus(); flush();
  assert.ok(scrolls() > before);
  assert.deepEqual(calls.at(-1), ['scrollToEnd', true]);
  assert.equal(password.props.returnKeyType, 'go');
  const after = scrolls();
  password.props.onBlur(); scroll.props.onLayout(); flush();
  assert.equal(scrolls(), after, 'after leaving the form the scroll is left alone');
});

test('the admin sign-in also avoids the keyboard on Android', () => {
  const tree = panel()({ onAdminLogin() {} });
  assert.equal(nodes(tree).find(node => node.type === 'KeyboardAvoidingView').props.behavior, 'padding');
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
