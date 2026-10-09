import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

function render(platform, props) {
  const source = readFileSync(new URL('../src/components/themed-text.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return { Text: 'Text', StyleSheet: { create: value => value }, Platform: { OS: platform, select: values => values[platform] ?? values.default } };
    if (name === '@/constants/theme') return { Fonts: { mono: 'monospace' } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ text: '#fff' }) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports.ThemedText(props).props;
}

test('iPhone uses native Hangul word wrapping without changing the original text', () => {
  const children = 'OFY,OFT 크런치 프로틴 쉐이크 프리런칭';
  const props = render('ios', { children, numberOfLines: 2, selectable: true });
  assert.equal(props.lineBreakStrategyIOS, 'hangul-word');
  assert.equal(props.children, children);
  assert.equal(props.numberOfLines, 2);
  assert.equal(props.selectable, true);
  assert.equal(render('ios', { children, lineBreakStrategyIOS: 'none' }).lineBreakStrategyIOS, 'none');
});

test('Android keeps Hangul syllables together but preserves spaces, line breaks, URLs and link elements', () => {
  const original = '지금 프리런칭 중이에요.\n한국어 https://example.com/a?q=1#part AI 2026';
  const link = React.createElement('Text', { onPress() {}, accessibilityLabel: '원본 링크' }, '행사 링크');
  const children = [original, link, 7];
  const props = render('android', { children });
  assert.notEqual(props.children[0], original, 'Hangul must gain nonbreaking boundaries');
  assert.equal(props.children[0].replaceAll('\u2060', ''), original);
  assert.ok(props.children[0].includes('프\u2060리\u2060런\u2060칭'));
  assert.ok(props.children[0].includes(' https://example.com/a?q=1#part AI 2026'));
  assert.equal(props.children[1].type, link.type);
  assert.equal(props.children[1].props, link.props);
  assert.equal(props.children[2], 7);
  assert.equal(render('android', { children: original }).accessibilityLabel, original);
  assert.equal(render('android', { children: original, accessibilityLabel: '직접 지정한 안내' }).accessibilityLabel, '직접 지정한 안내');
});

test('React Native web keeps words together with emergency wrapping for long addresses', () => {
  const children = '지금 프리런칭 https://example.com/long-address';
  const props = render('web', { children });
  const style = Object.assign({}, ...props.style.flat(Infinity).filter(Boolean));
  assert.equal(style.wordBreak, 'keep-all');
  assert.equal(style.overflowWrap, 'anywhere');
  assert.equal(props.children, children);
});
