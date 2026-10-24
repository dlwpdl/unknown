import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function control(sort) {
  const exports = {}, events = [];
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/feed-sort-control.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: x => x, hairlineWidth: 1 } };
    if (name === '@/components/selection-chip') return { SelectionChip: 'SelectionChip' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ background: 'background', backgroundElement: 'element', backgroundSelected: 'selected', accent: 'accent', accentInk: 'accent-ink', textSecondary: 'sub', line: 'line' }) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => events.push(kind) }) };
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return { tree: exports.FeedSortControl({ sort, title: '오늘 글', onChange: next => events.push(next) }), events };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? [tree.props.children].flat(Infinity).map(text).join('') : '';

test('two visible choices expose the selected native accessibility state and the seven-day scope', () => {
  for (const sort of ['latest', 'popular']) {
    const { tree } = control(sort);
    const buttons = nodes(tree).filter(node => node.type === 'SelectionChip');
    assert.deepEqual(buttons.map(text), ['최신순', '인기순']);
    assert.equal(buttons.filter(button => button.props.accessibilityState.selected).length, 1);
    assert.equal(buttons[sort === 'latest' ? 0 : 1].props.accessibilityState.selected, true);
    assert.equal(buttons[sort === 'latest' ? 0 : 1].props.selected, true);
    assert.equal(buttons[sort === 'latest' ? 0 : 1].props.children.props.style.color, 'accent-ink');
    assert.equal(buttons[sort === 'latest' ? 0 : 1].props['aria-pressed'], true);
    assert.ok(buttons.every(button => button.props.accessibilityRole === 'button'));
    assert.match(text(tree), sort === 'latest' ? /새로 올라온 글부터/ : /최근 7일.*반응이 많은 글부터/);
  }
});

test('selection uses the existing feedback hook before forwarding the chosen order', () => {
  const { tree, events } = control('latest');
  nodes(tree).filter(node => node.type === 'SelectionChip')[1].props.onPress();
  assert.deepEqual(events, ['selection', 'popular']);
});

test('sort buttons have 44px targets and the row wraps for enlarged text', () => {
  const { tree } = control('latest');
  for (const button of nodes(tree).filter(node => node.type === 'SelectionChip')) {
    const style = Object.assign({}, ...[typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style].flat(Infinity));
    assert.ok(style.minHeight >= 44 && style.minWidth >= 44);
    assert.equal(style.borderRadius, 999);
  }
  assert.ok(nodes(tree).some(node => [node.props.style].flat(Infinity).some(style => style?.flexWrap === 'wrap')));
});
