import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function control(sort, byArea, extra = {}) {
  const exports = {}, events = [];
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/feed-sort-control.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Platform: { OS: 'android' }, View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: x => x, hairlineWidth: 1 } };
    if (name === '@/constants/theme') return { Spacing: { two: 8, four: 24 } };
    if (name === '@/components/selection-chip') return { SelectionChip: 'SelectionChip' };
    if (name === 'react-native-reanimated') return { useReducedMotion: () => false };
    if (name === '@/hooks/use-reveal-chip') return { useRevealChip: (selected, animated, fade) => ({ scroll: { revealing: selected, animated, fade }, chip: key => `layout:${key}` }) };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ background: 'background', backgroundElement: 'element', backgroundSelected: 'selected', accent: 'accent', accentInk: 'accent-ink', textSecondary: 'sub', line: 'line' }) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => events.push(kind) }) };
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return { tree: exports.FeedSortControl({ sort, title: '오늘 글', onChange: next => events.push(next), byArea, ...extra }), events };
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

test('중고거래 adds 동네별 as a third order with its own spoken name and description', () => {
  const { tree, events } = control('area', true);
  const buttons = nodes(tree).filter(node => node.type === 'SelectionChip');
  assert.deepEqual(buttons.map(text), ['최신순', '인기순', '동네별']);
  assert.equal(buttons[2].props.accessibilityState.selected, true);
  assert.equal(buttons[2].props.accessibilityLabel, '동네별로 묶어 보기');
  assert.match(text(tree), /글이 많은 동네부터/);
  buttons[0].props.onPress();
  assert.deepEqual(events, ['selection', 'latest']);
});

test('a short screen folds the title and description into one sideways row of orders and the view switch (QA B12-1)', () => {
  const action = { type: 'ListingViewSwitch', props: {} }, filters = { type: 'ListingFilterBar', props: {} };
  const { tree, events } = control('latest', true, { compact: true, action, children: filters });
  const all = nodes(tree);
  assert.equal(all.some(node => node.props?.accessibilityRole === 'header'), false, 'no title line');
  assert.doesNotMatch(text(tree), /새로 올라온 글부터/, 'no description line');
  const row = all.find(node => node.type === 'ScrollView');
  assert.equal(row.props.horizontal, true, 'one line that scrolls sideways instead of wrapping into two');
  assert.deepEqual(nodes(row).filter(node => node.type === 'SelectionChip').map(text), ['최신순', '인기순', '동네별']);
  // QA N-sort-row: scrolled together, the chosen view and 지도 started cut off at the right edge.
  const line = all.find(node => [node.props?.children].flat().includes(row));
  assert.ok([line.props.children].flat().includes(action) && !nodes(row).includes(action), 'the view switch shares the line, pinned beside the scrolling orders');
  assert.deepEqual([row.props.revealing, row.props.fade], ['latest', true], 'the chosen order is scrolled into view and only an end with more orders past it fades');
  assert.deepEqual(nodes(row).filter(node => node.type === 'SelectionChip').map(node => node.props.onLayout), ['layout:latest', 'layout:popular', 'layout:area']);
  assert.equal(nodes(control('area', true, { compact: true, action }).tree).find(node => node.type === 'ScrollView').props.revealing, 'area', '동네별 chosen: that chip is brought into view');
  assert.ok(all.includes(filters), 'filters stay under it');
  nodes(row).find(node => node.type === 'SelectionChip').props.onPress();
  assert.deepEqual(events, ['selection', 'latest']);
  const full = control('latest', true, { action });
  assert.equal(nodes(full.tree).some(node => node.type === 'ScrollView'), false, 'a tall screen keeps the two lines');
  assert.match(text(full.tree), /새로 올라온 글부터/);
});
