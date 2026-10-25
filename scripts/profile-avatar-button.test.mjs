import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function avatar({ os = 'ios', authenticated = true } = {}) {
  const routes = [], feedback = [];
  const jsx = (type, props) => ({ type, props });
  const imports = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: os }, View: 'View', StyleSheet: { create: value => value } },
    'expo-router': { useRouter: () => ({ push: value => routes.push(value) }) },
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'Symbol' },
    '@/components/analytics-controls': { Pressable: 'Pressable' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/chat-identity-switcher': { ChatIdentitySwitcher: 'ChatIdentitySwitcher' },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: authenticated, me: { nickname: '개인', photoUri: 'own-photo' } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/profile-avatar-button.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: withLanguageImports(name => {
    if (name in imports) return imports[name];
    throw Error(name);
  }) });
  return { routes, feedback, render: (props = {}) => exports.ProfileAvatarButton(props) };
}

test('every native own-avatar entry offers the existing business switcher by default', () => {
  const app = avatar(), changed = () => {};
  const tree = app.render({ onBusinessSwitchAvailabilityChange: changed });
  const switcher = nodes(tree).find(n => n.type === 'ChatIdentitySwitcher');
  assert.equal(switcher?.props.target, 'business');
  assert.equal(switcher.props.onAvailabilityChange, changed);
  const button = nodes(tree).find(n => n.type === 'Pressable');
  assert.equal(button.props.style({ pressed: false })[0].width, 44);
  assert.ok(button.props.style({ pressed: false })[0].minHeight >= 44);
  button.props.onPress();
  assert.deepEqual(app.routes, ['/profile']);
  assert.deepEqual(app.feedback, ['selection']);
  assert.equal(nodes(button).find(n => n.type === 'Image').props.source.uri, 'own-photo');
});

test('an explicit optout preserves the avatar and its personal destination', () => {
  const app = avatar(), tree = app.render({ enableBusinessSwitch: false });
  assert.equal(nodes(tree).some(n => n.type === 'ChatIdentitySwitcher'), false);
  nodes(tree).find(n => n.type === 'Pressable').props.onPress();
  assert.deepEqual(app.routes, ['/profile']);
});

test('the web avatar remains absent and a native guest keeps its normal profile sign-in entry', () => {
  assert.equal(avatar({ os: 'web' }).render(), null);
  const app = avatar({ authenticated: false }), tree = app.render();
  assert.equal(nodes(tree).some(n => n.type === 'Image'), false);
  assert.ok(nodes(tree).some(n => n.type === 'Symbol'));
  nodes(tree).find(n => n.type === 'Pressable').props.onPress();
  assert.deepEqual(app.routes, ['/profile']);
});
