import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { parseLanguagePreference, resolveLanguage } from '../src/i18n/language.ts';

test('the shared language provider updates web document language and leaves native documents untouched', () => {
  const code = ts.transpileModule(readFileSync(new URL('../src/hooks/use-language.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  for (const [platform, language, expected] of [['web', 'en', 'en'], ['web', 'ko', 'ko'], ['ios', 'en', 'original']]) {
    const effects = [], exported = {}, document = { documentElement: { lang: 'original' } };
    const modules = {
      react: { createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
        useCallback: fn => fn, useRef: value => ({ current: value }), useState: initial => [initial, () => {}], useEffect: fn => effects.push(fn) },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      'react-native': { Platform: { OS: platform }, I18nManager: {}, Settings: {}, AppState: { addEventListener: () => ({ remove() {} }) } },
      '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => language } },
      '@/i18n': { setActiveLanguage() {}, uiEnglishPending: () => null, translateUi: value => value, translationsFor: () => ({}) },
      '@/i18n/language': { parseLanguagePreference, resolveLanguage },
    };
    vm.runInNewContext(code, { exports: exported, document, navigator: { languages: [language] }, require: name => modules[name] });
    exported.LanguagePreferenceProvider({ initialLanguage: language, children: 'content' });
    const cleanups = effects.map(effect => effect());
    assert.equal(document.documentElement.lang, expected);
    cleanups.forEach(cleanup => cleanup?.());
  }
});
