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

test('actual Meetups uses the common account avatar and keeps a separate guarded meetup-profile entry', () => {
  const source = ts.createSourceFile('meetups.tsx', readFileSync(new URL('../src/app/(tabs)/meetups.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let header, action, profileEntry;
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const attributes = node.openingElement.attributes.properties;
      if (attributes.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'style' && attribute.initializer?.getText(source).includes('styles.headFixed'))) header = node;
      if (attributes.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'analyticsId' && attribute.initializer?.getText(source) === '"app_tabs_meetups.pressable.2"')) profileEntry = node;
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'action') action = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(header && action && profileEntry, 'Use the actual header, My profile entry and route handler.');
  const jsx = (type, props) => ({ type, props });
  for (const isAuthed of [true, false]) {
    const exports = {}, routes = [], feedback = [], login = [];
    vm.runInNewContext(ts.transpileModule(`const ${action.getText(source)}; exports.render = () => [(${header.getText(source)}), (${profileEntry.getText(source)})];`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports, require: () => ({ jsx, jsxs: jsx }),
      View: 'View', GlassSurface: 'GlassSurface', Pressable: 'Pressable', ThemedText: 'Text', SymbolView: 'Symbol', ProfileAvatarButton: 'ProfileAvatarButton',
      styles: {}, Typography: { menu: {} }, theme: {}, compactHeader: true, city: { name: '밴쿠버' }, IconSize: { chevron: 14 },
      preferenceScope: { current: 'viewer' }, scope: 'viewer', destination: null, createDisabled: false, copy: value => value, sourceInvalid: false, sourceLabel: '', isAuthed, tr: value => value, t: { tabs: { meetups: '모임' } },
      router: { push: value => routes.push(value) }, play: value => feedback.push(value), promptLogin: value => login.push(value), setCityPicker() {},
    });
    const [head, profile] = exports.render();
    assert.ok(nodes(head).some(node => node.type === 'ProfileAvatarButton' && node.props.enableBusinessSwitch !== false), 'Common avatar includes its existing business switcher by default.');
    assert.equal(nodes(head).some(node => node.type === 'ChatIdentitySwitcher'), false, 'No duplicate manual switcher.');
    assert.equal(nodes(head).some(node => node.props?.analyticsId === 'app_tabs_meetups.pressable.2'), false);
    assert.ok(nodes(profile).some(node => node.props?.children?.includes?.('내 모임 프로필')));
    profile.props.onPress();
    assert.deepEqual(routes, isAuthed ? ['/meetup-profile'] : []);
    assert.equal(login.length, isAuthed ? 0 : 1);
    assert.deepEqual(feedback, ['selection']);
  }
});
