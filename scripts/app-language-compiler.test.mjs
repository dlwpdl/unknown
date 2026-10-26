import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import ts from 'typescript';
import * as dictionary from '../src/i18n/index.ts';

const require = createRequire(import.meta.url);
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(nodes)];

function compiledView(file, exportName) {
  const filename = new URL('../' + file, import.meta.url);
  const compiled = transformSync(readFileSync(filename, 'utf8'), {
    filename: filename.pathname, configFile: false, babelrc: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[require.resolve('babel-plugin-react-compiler'), { target: '19' }]],
  }).code;
  const code = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {}, caches = [], states = [];
  let cacheIndex = 0, stateIndex = 0, language;
  const theme = {}, router = {}, feedback = { play() {} };
  const location = { cityId: null, busy: false, ready: true, enabled: true, capture() {}, disable() {} };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react: { useEffect() {}, useRef: current => ({ current }), useState(initial) {
      const slot = stateIndex++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
      return [states[slot], next => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
    } },
    'react/compiler-runtime': { c(size) { return caches[cacheIndex++] ??= Array(size).fill(Symbol.for('react.memo_cache_sentinel')); } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 } },
    'expo-router': { Stack: Object.assign(() => null, { Screen: 'Screen' }), useRouter: () => router },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native-reanimated': { useReducedMotion: () => false },
    '@/components/analytics-controls': { Pressable: 'Pressable' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/constants/theme': { Depth: {}, Spacing: {} },
    '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/i18n': dictionary,
    '@/lib/interaction-feedback': { useInteractionFeedback: () => feedback },
    '@/lib/location-provider': { useCommunityLocation: () => location },
    '@/lib/mock': { CITIES: [] },
    '@/lib/promotions': { PROMOTIONS_PREVIEW_ENABLED: false },
  };
  vm.runInNewContext(code, { exports, Symbol, require: name => imports[name] ?? {} });
  return {
    render(selected) {
      dictionary.setActiveLanguage(selected);
      language = { language: selected, t: dictionary.translationsFor(selected), tr: (text, ...values) => dictionary.translateUi(selected, text, ...values), locale: selected === 'ko' ? 'ko-KR' : 'en-CA' };
      cacheIndex = 0; stateIndex = 0;
      return exports[exportName]({ settings: true });
    },
  };
}

test('compiled location copy changes Korean → English → Korean without remounting or changing location state', () => {
  const view = compiledView('src/components/nearby-city-card.tsx', 'NearbyCityCard');
  try {
    assert.ok(nodes(view.render('ko')).some(node => node.props?.children === '내 주변 소식'));
    const english = nodes(view.render('en'));
    assert.ok(english.some(node => node.props?.children === 'What’s happening nearby'));
    assert.ok(english.some(node => node.props?.accessibilityLabel === 'How we use your location'));
    assert.ok(nodes(view.render('ko')).some(node => node.props?.children === '내 주변 소식'));
  } finally { dictionary.setActiveLanguage('ko'); }
});

test('compiled native stack titles follow language changes while keeping the same routes', () => {
  const view = compiledView('src/app/profile/_layout.tsx', 'default');
  const settings = tree => nodes(tree).find(node => node.type === 'Screen' && node.props?.name === 'settings');
  try {
    assert.equal(settings(view.render('ko')).props.options.title, '설정');
    assert.equal(settings(view.render('en')).props.options.title, 'Settings');
    assert.equal(settings(view.render('ko')).props.options.title, '설정');
  } finally { dictionary.setActiveLanguage('ko'); }
});
