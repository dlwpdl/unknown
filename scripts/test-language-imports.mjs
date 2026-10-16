import * as dictionary from '../src/i18n/index.ts';

// Existing VM fixtures keep their Korean overrides; the real provider has separate lifecycle checks.
export function withLanguageImports(resolve) {
  return (name) => {
    if (name === '@/hooks/use-language') return { useLanguage: () => ({ language: 'ko', locale: 'ko-KR', t: dictionary.t, tr: dictionary.tr }) };
    if (name === '@/i18n') {
      let overrides = {};
      try { overrides = resolve('@/i18n/ko'); } catch { /* This fixture did not previously use dictionary copy. */ }
      return { ...dictionary, ...overrides };
    }
    return resolve(name);
  };
}
