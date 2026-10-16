import * as dictionary from '../src/i18n/index.ts';

// Existing VM fixtures keep their Korean overrides; the real provider has separate lifecycle checks.
export function withLanguageImports(resolve) {
  const copy = () => {
    let overrides = {};
    try { overrides = resolve('@/i18n/ko'); } catch { /* This fixture did not previously use dictionary copy. */ }
    return { ...dictionary, ...overrides };
  };
  return (name) => {
    if (name === '@/hooks/use-language') return { useLanguage: () => ({ language: 'ko', locale: 'ko-KR', t: copy().t, tr: copy().tr }) };
    if (name === '@/i18n') return copy();
    return resolve(name);
  };
}
