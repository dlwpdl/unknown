import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as designSystem from '../src/constants/design-system.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function control(props) {
  const states = [], selected = [], feedback = [];
  let at = 0, all = 0;
  class Value { constructor(value) { this.value = value; } setValue(value) { this.value = value; } interpolate() { return this.value; } }
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useEffect: fn => fn(), useState(initial) { const i = at++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: value => value }, Animated: { Value, View: 'AnimatedView' } },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/hooks/use-language': { useLanguage: () => ({ tr: value => value }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/constants/design-system': designSystem,
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/components/glass-surface': { GlassSurface: 'GlassSurface' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/meetup-kind-switch.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => imports[name] ?? {} });
  const render = () => { at = 0; return exports.MeetupKindSwitch({ analyticsId: 'fixed-kind', onChange: value => selected.push(value), ...props, ...(props.all ? { onAll: () => { all++; } } : {}) }); };
  return { render, selected, feedback, all: () => all };
}

test('host unselected type has no selected tab or highlight after measurement', () => {
  const app = control({ value: null }), tree = app.render();
  nodes(tree).find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 320 } } });
  assert.equal(nodes(app.render()).some(node => node.props?.accessibilityState?.selected), false);
  assert.equal(nodes(app.render()).some(node => node.type === 'AnimatedView'), false);
  nodes(app.render()).find(node => node.props?.accessibilityRole === 'tab').props.onPress();
  assert.deepEqual(app.selected, ['once']);
});

test('discovery All is explicit without widening strict once/group changes', () => {
  const app = control({ value: 'group', all: true });
  const tabs = nodes(app.render()).filter(node => node.props?.accessibilityRole === 'tab');
  assert.equal(tabs.length, 3);
  assert.equal(tabs[2].props.accessibilityState.selected, true);
  tabs[0].props.onPress(); tabs[1].props.onPress();
  assert.equal(app.all(), 1); assert.deepEqual(app.selected, ['once']);
  const all = control({ value: null, all: true });
  const allTab = nodes(all.render()).filter(node => node.props?.accessibilityRole === 'tab')[0];
  assert.equal(allTab.props.accessibilityState.selected, true);
  allTab.props.onPress();
  assert.equal(all.all(), 1, 'An explicit All tap must reach the parent even before a saved preference finishes loading.');
});
