import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load({ os = 'ios', screenReader = false } = {}) {
  const calls = { pushes: [], handoffs: [], listener: null };
  const Link = Object.assign(function Link() {}, { AppleZoom: 'AppleZoom' });
  const modules = {
    react: { cloneElement: (el, props) => ({ ...el, props: { ...el.props, ...props } }), useSyncExternalStore: (subscribe, get) => { subscribe(() => {}); return get(); } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': { Platform: { OS: os }, AccessibilityInfo: {
      isScreenReaderEnabled: () => ({ then: resolve => resolve(screenReader) }),
      addEventListener: (_event, listener) => { calls.listener = listener; return { remove() {} }; },
    } },
    'expo-router': { Link, useRouter: () => ({ push: href => calls.pushes.push(href) }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'me' } }) },
    '@/lib/post-open': { handOffPost: (viewer, post) => calls.handoffs.push([viewer, post.id]) },
  };
  const exported = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/components/post-zoom-link.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exported, require: name => modules[name] ?? {} });
  const card = { type: 'Pressable', props: { onPress: () => calls.pushes.push('card') } };
  return { calls, Link, render: () => exported.PostZoomLink({ id: 'p1', post: { id: 'p1' }, children: card }) };
}

test('native cards grow out of the pressed card through the zoom link', () => {
  const { render, Link } = load();
  const tree = render();
  assert.equal(tree.type, Link);
  assert.equal(tree.props.children.type, 'AppleZoom');
});

test('with a screen reader on, the card keeps its own press and opens the post with a plain push', () => {
  const { render, calls, Link } = load({ screenReader: true });
  const tree = render();
  assert.notEqual(tree.type, Link, 'no zoom source, so VoiceOver can reach the card');
  tree.props.onPress({ defaultPrevented: false });
  // The href is built inside the vm context, so compare its JSON rather than cross-realm objects.
  assert.equal(JSON.stringify(calls.pushes), JSON.stringify(['card', { pathname: '/post/[id]', params: { id: 'p1' } }]));
  assert.deepEqual(calls.handoffs, [['me', 'p1']]);
  calls.listener(false);
  assert.equal(render().type, Link, 'turning the screen reader off brings the zoom back');
});

test('a card that prevents the default press stays put', () => {
  const { render, calls } = load({ os: 'web' });
  const tree = render();
  tree.props.onPress({ defaultPrevented: true });
  assert.deepEqual(calls.pushes, ['card']);
  assert.deepEqual(calls.handoffs, []);
});
