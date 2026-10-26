import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function themedText() {
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value || {};
  const imports = {
    react: { Children: { map: (children, fn) => [children].flat().map(fn) } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: 'ios', select: value => value.ios }, Text: 'Text', StyleSheet: { create: value => value, flatten } },
    '@/constants/theme': { Fonts: {} }, '@/hooks/use-theme': { useTheme: () => ({ text: '#fff' }) },
    '@/constants/design-system': { Typography: { body: { fontSize: 16 }, supporting: { fontSize: 13 }, label: { fontSize: 13 }, screenTitle: { fontSize: 28 } } },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/components/themed-text.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {} });
  return exports.ThemedText;
}

test('display-size text caps Dynamic Type growth while body text scales freely', () => {
  const ThemedText = themedText();
  assert.equal(ThemedText({ children: '모임 정보 수정', style: { fontSize: 28 } }).props.maxFontSizeMultiplier, 1.3, 'screen titles stay within two lines');
  assert.equal(ThemedText({ children: '본문', type: 'default' }).props.maxFontSizeMultiplier, undefined, 'body text is never capped');
  assert.equal(ThemedText({ children: '제목', style: { fontSize: 28 }, maxFontSizeMultiplier: 2 }).props.maxFontSizeMultiplier, 2, 'callers can still choose their own limit');
});
