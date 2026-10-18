import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { translationsFor } from '../src/i18n/index.ts';

function card(save = async () => true) {
  const state = [], events = [], saved = [];
  let index = 0;
  const language = { language: 'ko', preference: 'system', isSaving: false, t: translationsFor('ko'), setPreference: value => { saved.push(value); return save(value); } };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/language-card.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react') return { useState(initial) { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; } };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', Modal: 'Modal', ScrollView: 'ScrollView', StyleSheet: { create: value => value } };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === '@/components/flat-pressable') return { FlatPressable: 'FlatPressable' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/hooks/use-language') return { useLanguage: () => language };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Spacing: {} };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: value => events.push(value) }) };
    throw Error('Unexpected import: ' + name);
  } });
  return { language, events, saved, render: props => { index = 0; return exports.LanguageCard(props); } };
}
function nodes(node) {
  return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function find(tree, id) { return nodes(tree).find(node => (node.props?.analyticsId ?? node.props?.testID) === id); }
const modal = tree => nodes(tree).find(node => node.type === 'Modal');
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('compact login language control keeps all three choices and closes only after a saved choice', async () => {
  const app = card();
  let tree = app.render({ compact: true });
  assert.equal(modal(tree)?.props.visible, false);
  find(tree, 'app_language.open').props.onPress();
  tree = app.render({ compact: true });
  assert.equal(modal(tree).props.visible, true);
  assert.deepEqual(['system', 'ko', 'en'].map(value => find(tree, 'app_language.' + value).props.accessibilityRole), ['radio', 'radio', 'radio']);
  find(tree, 'app_language.en').props.onPress();
  await settle();
  assert.deepEqual(app.saved, ['en']);
  assert.equal(modal(app.render({ compact: true })).props.visible, false);
  assert.deepEqual(app.events, ['selection', 'selection']);
  assert.equal(modal(app.render({})), undefined, 'Settings keep their existing inline language choices.');
});

test('failed language persistence remains visible, and a pending save blocks repeat selection', async () => {
  const app = card(async () => false);
  find(app.render({ compact: true }), 'app_language.open').props.onPress();
  find(app.render({ compact: true }), 'app_language.en').props.onPress();
  await settle();
  const failed = app.render({ compact: true });
  assert.equal(modal(failed).props.visible, true);
  assert.ok(nodes(failed).some(node => node.props?.accessibilityRole === 'alert'));
  assert.equal(app.events.at(-1), 'warning');
  app.language.isSaving = true;
  const pending = app.render({ compact: true });
  const option = find(pending, 'app_language.ko');
  assert.equal(option.props.disabled, true);
  option.props.onPress();
  assert.deepEqual(app.saved, ['en']);
  modal(pending).props.onRequestClose();
  assert.equal(modal(app.render({ compact: true })).props.visible, false);
});
