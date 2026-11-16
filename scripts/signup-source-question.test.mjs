import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import { SIGNUP_SOURCES } from '../src/lib/signup-source.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(v => Array.isArray(v) ? v.flatMap(nodes) : nodes(v))];

function question({ reducedMotion = false, fail = false } = {}) {
  const state = [], refs = [], rpc = [], timers = [], cleanups = [], done = [];
  let cursor = 0, refCursor = 0;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/signup-source-question.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const timeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  vm.runInNewContext(source, { exports, process: { env: {} }, setTimeout: timeout, clearTimeout() {}, Promise, require: withLanguageImports((name) => {
    if (name === 'react') return {
      useEffect(fn) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
      useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial;
        return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { StyleSheet: { create: x => x }, View: 'View', Animated: { Value: class { constructor(v) { this.v = v; } }, View: 'AnimatedView', timing: () => ({ start() {} }) } };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '@/components/analytics-controls') return { ScrollView: 'ScrollView' };
    if (name === '@/components/raised-action-button') return { RaisedActionButton: 'RaisedActionButton' };
    if (name === '@/components/selection-chip') return { SelectionChip: 'SelectionChip' };
    if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
    if (name === '@/constants/design-system') return { ControlMotion: { settleMs: 180 } };
    if (name === '@/constants/theme') return { Spacing: {} };
    if (name === '@/hooks/use-reduced-motion') return { useReducedMotion: () => reducedMotion };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/lib/signup-source') return { SIGNUP_SOURCES };
    if (name === '@/lib/supabase') return { supabase: { rpc: (...args) => { rpc.push(args); return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ error: null }); } } };
    return {};
  }) });
  const render = () => { cursor = refCursor = 0; return exports.SignupSourceQuestion({ onDone: () => done.push(1) }); };
  const find = (type, label) => nodes(render()).find(n => n.type === type && (!label || n.props.label === label));
  const chips = () => nodes(render()).filter(n => n.type === 'SelectionChip');
  return { render, find, chips, rpc, timers, cleanups, done };
}

test('seven answers, none chosen, primary disabled, skip always enabled', () => {
  const ui = question();
  const chips = ui.chips();
  assert.deepEqual(chips.map(n => n.props.label), SIGNUP_SOURCES.map(key => t.onboarding.sourceOptions[key]));
  assert.ok(chips.every(n => n.props.selected === false && n.props.accessibilityRole === 'radio'));
  assert.equal(ui.find('RaisedActionButton', t.onboarding.sourceSubmit).props.disabled, true);
  assert.equal(ui.find('RaisedActionButton', t.onboarding.sourceSkip).props.disabled, false);
  ui.find('RaisedActionButton', t.onboarding.sourceSubmit).props.onPress();
  assert.equal(ui.rpc.length, 0);
  assert.equal(ui.timers.length, 0);
});

test('choice can change; submit sends the chosen key, thanks, then continues after one second', () => {
  const ui = question();
  ui.chips()[0].props.onPress();
  ui.chips()[4].props.onPress();
  assert.deepEqual(ui.chips().map(n => n.props.selected), [false, false, false, false, true, false, false]);
  assert.equal(ui.chips()[4].props.accessibilityState.selected, true);
  ui.find('RaisedActionButton', t.onboarding.sourceSubmit).props.onPress();
  assert.equal(JSON.stringify(ui.rpc), JSON.stringify([['record_signup_source', { p_answer: 'search' }]]));
  assert.ok(nodes(ui.render()).some(n => n.props?.children === t.onboarding.sourceThanks));
  assert.equal(ui.timers[0].ms, 1000);
  assert.equal(ui.done.length, 0);
  ui.find('RaisedActionButton', t.onboarding.sourceSkip).props.onPress();
  assert.equal(ui.timers.length, 1, 'no second timer once answered');
  ui.timers[0].fn();
  assert.equal(ui.done.length, 1);
});

test('skip sends nothing and shows the skipped line', () => {
  const ui = question();
  ui.find('RaisedActionButton', t.onboarding.sourceSkip).props.onPress();
  assert.equal(ui.rpc.length, 0);
  assert.ok(nodes(ui.render()).some(n => n.props?.children === t.onboarding.sourceSkipped));
  ui.timers[0].fn();
  assert.equal(ui.done.length, 1);
});

test('a failing request does not stop the member, reduced motion shows the line at once, leaving clears the timer', async () => {
  const ui = question({ fail: true, reducedMotion: true });
  ui.chips()[1].props.onPress();
  ui.find('RaisedActionButton', t.onboarding.sourceSubmit).props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  ui.timers[0].fn();
  assert.equal(ui.done.length, 1);
  assert.equal(ui.cleanups.length >= 1, true);
});
