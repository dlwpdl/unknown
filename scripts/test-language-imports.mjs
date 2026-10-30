import * as dictionary from '../src/i18n/index.ts';
import * as designSystem from '../src/constants/design-system.ts';

// Screens read the translation preference directly; fixtures default to 'off' unless they supply their own hooks.
export const translationHookDefaults = {
  useTranslationPreference: () => ({ mode: 'off', ready: false, saving: false, requestMode: async () => false }),
  useTranslationVisibleIds: () => [new Set(), () => {}],
};

// Existing VM fixtures keep their Korean overrides; the real provider has separate lifecycle checks.
export function withLanguageImports(resolve) {
  const copy = () => {
    let overrides = {};
    try { overrides = resolve('@/i18n/ko'); } catch { /* This fixture did not previously use dictionary copy. */ }
    return { ...dictionary, ...overrides };
  };
  return (name) => {
    if (name === '@/constants/design-system') return designSystem;
    if (name === '@/hooks/use-language') return { useLanguage: () => ({ language: 'ko', locale: 'ko-KR', t: copy().t, tr: copy().tr }) };
    if (name === '@/i18n') return copy();
    if (name === '@/hooks/use-content-translation') {
      let given = {};
      try { given = resolve(name); } catch { /* Fixtures that never listed this module get the defaults. */ }
      return { ...translationHookDefaults, ...given };
    }
    return resolve(name);
  };
}
