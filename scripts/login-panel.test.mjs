import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs } from 'react/jsx-runtime';
import { t } from '../src/i18n/ko.ts';

test('iOS and Android public login omit review access while the explicit review form remains usable', () => {
  for (const [OS, dev] of [['ios', false], ['android', false], ['web', false], ['web', true]]) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL('../src/components/login-panel.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { exports, __DEV__: dev, process: { env: {} }, require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs };
      if (name === 'react') return { useCallback: fn => fn, useState: value => [typeof value === 'function' ? value() : value, () => {}] };
      if (name === 'expo-router') return { useFocusEffect() {} };
      if (name === 'react-native-reanimated') return { useReducedMotion: () => false };
      if (name === 'expo-font') return { useFonts: () => [true] };
      if (name === '@/i18n/ko') return { t };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
      if (name === '@/constants/theme') return { Colors: { dark: {} }, Spacing: {}, Depth: { card: {}, control: {} } };
      if (name === 'react-native') return { Platform: { OS }, StyleSheet: { create: value => value }, Animated: { Value: class { interpolate() { return 1; } }, View: 'AnimatedView' }, View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView' };
      if (name === 'expo-apple-authentication') return { AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 1 } };
      return new Proxy({}, { get: (_, key) => key });
    } });
    const props = { onApple() {}, onKakao() {}, onGoogle() {} };
    const publicTree = JSON.stringify(exports.LoginPanel(props));
    assert.ok(publicTree.includes(t.auth.kakao));
    assert.ok(publicTree.includes(t.auth.google));
    assert.ok(publicTree.includes('모임을 찾아요'), 'social login shows the welcome headline');
    assert.ok(!publicTree.includes(t.auth.reviewLoginTitle), OS);
    assert.ok(!publicTree.includes('TextInput'), OS);
    const reviewTree = JSON.stringify(exports.LoginPanel({ onReviewLogin() {} }));
    assert.ok(reviewTree.includes(t.auth.reviewLoginTitle));
    assert.ok(reviewTree.includes(t.auth.reviewEmail));
    assert.ok(reviewTree.includes(t.auth.reviewLoginCta));
    assert.ok(!reviewTree.includes('모임을 찾아요'), 'review credentials keep a focused form');
    const adminTree = JSON.stringify(exports.LoginPanel({ onGoogle() {}, onAdminLogin() {} }));
    assert.ok(adminTree.includes(t.auth.google), 'Google login remains visible in development');
    assert.ok(!adminTree.includes(t.auth.kakao), 'admin preview is not a Kakao login');
    assert.equal(adminTree.includes('샘플 화면 미리보기'), false, 'admin does not offer a sample preview');
  }
});
