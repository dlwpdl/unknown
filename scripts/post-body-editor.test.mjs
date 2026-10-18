import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { withLanguageImports } from './test-language-imports.mjs';
import * as links from '../supabase/functions/_shared/post-links.ts';
import * as maps from '../src/lib/post-maps.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function editor(initial = {}) {
  const slots = [], feedback = [], exports = {};
  let at = 0, captured, props = { value: '', ...initial };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useState: initial => { const i = at++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; }, useRef: value => ({ current: value }), useMemo: fn => fn(), useEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', TextInput: 'TextInput', Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, StyleSheet: { create: value => value } },
    'react-native-reanimated': { useReducedMotion: () => true },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 20 }) },
    '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/post-maps': maps,
    '../../supabase/functions/_shared/post-links': links,
  };
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/components/post-body-editor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: withLanguageImports(name => name in imports ? imports[name] : new Proxy({}, { get: (_, key) => String(key) })) });
  return {
    feedback,
    render(extra = {}) { at = 0; props = { ...props, ...extra }; return exports.PostBodyEditor(props); },
    layout() { return captured; },
    compose(extra = {}) { return this.render({ ...extra, renderLayout: parts => { captured = parts; return jsx('ComposerLayout', { children: [parts.input, parts.attachments, parts.actions] }); } }); },
  };
}

test('composer layout receives the real editor and existing attachment actions without duplicating them', () => {
  const app = editor();
  const tree = app.compose();
  assert.ok(app.layout(), 'composer must be able to place attachment controls in its fixed toolbar');
  assert.equal(app.layout().input.type, 'TextInput');
  for (const id of ['post.attachment.add', 'post.location.add']) assert.equal(nodes(tree).filter(n => n.props?.analyticsId === id).length, 1);
  const link = nodes(app.layout().actions).find(n => n.props?.analyticsId === 'post.attachment.add');
  link.props.onPress();
  assert.ok(nodes(app.compose()).some(n => n.type === 'Modal' && n.props.visible), 'same action opens existing URL/SNS flow');
  assert.deepEqual(app.feedback, ['selection']);
});

test('relocated editor keeps links and map pins while changing only the visible body', () => {
  const value = maps.withPostMap(links.withPostAttachments('전의 본문', ['https://example.com/menu']), 'https://www.google.com/maps/search/?api=1&query=49.2827%2C-123.1207', '밴쿠버');
  let saved;
  const app = editor({ value, onChangeText: text => { saved = text; } });
  app.compose();
  app.layout().input.props.onChangeText('수정한 본문');
  const mapped = maps.postMapBody(saved);
  assert.equal(mapped.url, maps.postMapBody(value).url);
  assert.deepEqual(links.splitPostAttachments(mapped.body), { body: '수정한 본문', urls: ['https://example.com/menu'] });
});

test('default post/merchant editors keep their controls and compose respects read-only and location policy', () => {
  const app = editor();
  assert.ok(nodes(app.render()).some(n => n.props?.analyticsId === 'post.attachment.add'));
  app.compose({ editable: false, allowLocation: false });
  const actions = nodes(app.layout().actions);
  assert.equal(actions.find(n => n.props?.analyticsId === 'post.attachment.add').props.disabled, true);
  assert.ok(!actions.some(n => n.props?.analyticsId === 'post.location.add'));
  assert.equal(app.layout().input.props.editable, false);
});
