import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function appFiles(directory, includeAll = false) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!includeAll && (entry.name === 'admin' || entry.name === 'gling-loader.tsx')) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? appFiles(path, includeAll) : /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

test('사용자 앱의 로딩은 글링 로고 로더 하나로 표시한다', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  for (const file of [...appFiles(join(root, 'app')), ...appFiles(join(root, 'components'))]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bActivityIndicator\b/, file);
  }
});

test('사용자 앱과 관리자 화면에 옛 글링 로고 참조가 남지 않는다', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  for (const file of [...appFiles(join(root, 'app'), true), ...appFiles(join(root, 'components'), true)]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:gling-(?:mark|lockup|wordmark|app-icon|favicon)(?:-v1)?|gling-night-loader-ring)\.(?:png|svg)/, file);
  }
});

test('the shared capsule uses the white logo on fixed dark colors and keeps reduced-motion status visible', () => {
  const source = readFileSync(new URL('../src/components/gling-loader.tsx', import.meta.url), 'utf8');
  const dark = { card: '#171722', text: '#F6F3F0', textSecondary: '#B7B4C3', line: '#343443' }, light = { card: '#fff' };
  const element = (type, props) => ({ type, props });
  for (const theme of [light, dark]) for (const reduced of [false, true]) {
    const exports = {}, modules = {
      react: { useEffect() {}, useState: fn => [fn()] },
      'react/jsx-runtime': { jsx: element, jsxs: element },
      'react-native': { View: 'View', Image: 'Image', Text: 'Text', ActivityIndicator: 'ActivityIndicator', Animated: { Value: class {} }, StyleSheet: { create: value => value } },
      'react-native-reanimated': { useReducedMotion: () => reduced },
      '@/hooks/use-language': { useLanguage: () => ({ tr: value => value }) }, '@/hooks/use-theme': { useTheme: () => theme },
      '@/constants/theme': { Colors: { dark, light } },
    };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, require: name => name.startsWith('@/assets/') ? name : modules[name],
    });
    const tree = exports.GlingLoader({ variant: 'capsule', accessibilityLabel: '지도 결과 불러오는 중' });
    assert.equal(Object.assign({}, ...tree.props.style.filter(Boolean)).backgroundColor, '#171722');
    assert.equal(tree.props.accessibilityRole, 'progressbar');
    assert.ok(tree.props.children.find(node => node.type === 'Image').props.source.endsWith('gling-night-wordmark.png'));
    const spinner = tree.props.children.find(node => node.type === 'ActivityIndicator');
    assert.equal(spinner.props.animating, !reduced);
    assert.equal(spinner.props.hidesWhenStopped, false);
    assert.equal(tree.props.children.find(node => node.type === 'Text').props.style.color, '#F6F3F0');
  }
});
