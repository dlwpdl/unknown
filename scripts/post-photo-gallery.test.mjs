import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function loadGallery() {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/post-photo-gallery.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const scrolls = [];
  let stateCall = 0;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'expo-image') return { Image: (props) => ({ type: 'Image', props }) };
    // 첫 상태는 화면 폭이다. 측정된 폭(390)을 바로 넣어 스크롤이 그려진 트리를 확인한다.
    if (name === 'react') return { useCallback: (fn) => fn, useState: (initial) => [stateCall++ === 0 ? 390 : typeof initial === 'function' ? initial() : initial, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { StyleSheet: { create: (value) => value, hairlineWidth: 1 }, View: 'View' };
    if (name === '@/components/analytics-controls') return { ScrollView: (props) => { scrolls.push(props); return { type: 'ScrollView', props }; } };
    if (name === '@/components/themed-text') return { ThemedText: (props) => ({ type: 'ThemedText', props }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ backgroundElement: '#eee', card: '#fff', line: '#ddd' }) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { Gallery: exports.PostPhotoGallery, scrolls: () => scrolls };
}

const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap((value) => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

test('사진이 한 장이면 갤러리를 만들지 않는다', () => {
  const { Gallery } = loadGallery();
  assert.equal(Gallery({ post: { id: 'post-1', imageUris: ['signed:one'] } }), null);
});

test('여러 장이면 가로 갤러리와 장수 표시를 만든다', () => {
  const { Gallery } = loadGallery();
  const tree = Gallery({ post: { id: 'post-1', title: '주말 등산', imageUris: ['signed:one', 'signed:two', 'signed:three'] } });
  assert.ok(tree);
  const scroll = nodes(tree).find((node) => node.props?.analyticsId === 'components_post-photo-gallery.scrollview.1');
  assert.ok(scroll, '갤러리는 가로 스크롤을 쓴다');
  assert.equal(scroll.props.horizontal, true);
  assert.equal(scroll.props?.pagingEnabled, true);
  assert.equal((scroll.props.children ?? []).length, 3);
  const label = (node) => Array.isArray(node.props?.children) ? node.props.children.join('') : String(node.props?.children);
  assert.ok(nodes(tree).some((node) => label(node) === '1/3'), '장수 표시가 있어야 한다');
});

test('화면 폭을 알기 전에는 이미지를 그리지 않는다', () => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/post-photo-gallery.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'expo-image') return { Image: (props) => ({ type: 'Image', props }) };
    if (name === 'react') return { useCallback: (fn) => fn, useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { StyleSheet: { create: (value) => value, hairlineWidth: 1 }, View: 'View' };
    if (name === '@/components/analytics-controls') return { ScrollView: (props) => ({ type: 'ScrollView', props }) };
    if (name === '@/components/themed-text') return { ThemedText: (props) => ({ type: 'ThemedText', props }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({ backgroundElement: '#eee', card: '#fff', line: '#ddd' }) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const tree = exports.PostPhotoGallery({ post: { id: 'post-1', imageUris: ['a', 'b'] } });
  assert.equal(nodes(tree).filter((node) => node.type === 'Image').length, 0);
});
