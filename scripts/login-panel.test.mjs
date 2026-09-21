import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { jsx, jsxs } from 'react/jsx-runtime';
import { t } from '../src/i18n/ko.ts';

test('iOS and Android public login omit review access while the explicit review form remains usable', () => {
  for (const OS of ['ios', 'android']) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL('../src/components/login-panel.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { exports, __DEV__: false, process: { env: {} }, require(name) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs };
      if (name === 'react') return { useState: value => [value, () => {}] };
      if (name === 'expo-font') return { useFonts: () => [true] };
      if (name === '@/i18n/ko') return { t };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === '@/constants/theme') return { Spacing: {} };
      if (name === 'react-native') return { Platform: { OS }, StyleSheet: { create: value => value }, useColorScheme: () => 'light', View: 'View', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView' };
      if (name === 'expo-apple-authentication') return { AppleAuthenticationButton: 'AppleButton', AppleAuthenticationButtonType: { SIGN_IN: 0 }, AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 1 } };
      return new Proxy({}, { get: (_, key) => key });
    } });
    const props = { onApple() {}, onKakao() {}, onGoogle() {} };
    const publicTree = JSON.stringify(exports.LoginPanel(props));
    assert.ok(publicTree.includes(t.auth.kakao));
    assert.ok(publicTree.includes(t.auth.google));
    assert.ok(!publicTree.includes(t.auth.reviewLoginTitle), OS);
    assert.ok(!publicTree.includes('TextInput'), OS);
    const reviewTree = JSON.stringify(exports.LoginPanel({ onReviewLogin() {} }));
    assert.ok(reviewTree.includes(t.auth.reviewLoginTitle));
    assert.ok(reviewTree.includes(t.auth.reviewEmail));
    assert.ok(reviewTree.includes(t.auth.reviewLoginCta));
  }
});
