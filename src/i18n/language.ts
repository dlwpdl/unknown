export type AppLanguage = 'ko' | 'en';
export type LanguagePreference = 'system' | AppLanguage;

export function parseLanguagePreference(value: unknown): LanguagePreference {
  return value === 'ko' || value === 'en' ? value : 'system';
}

export function resolveLanguage(preference: LanguagePreference, deviceLanguages: readonly string[]): AppLanguage {
  if (preference !== 'system') return preference;
  for (const locale of deviceLanguages) {
    const language = locale.toLowerCase().split(/[-_]/)[0];
    if (language === 'ko' || language === 'en') return language;
  }
  return 'en';
}
