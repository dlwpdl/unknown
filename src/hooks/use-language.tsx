import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, I18nManager, Platform, Settings } from 'react-native';

import { setActiveLanguage, translateUi, translationsFor } from '@/i18n';
import { parseLanguagePreference, resolveLanguage, type AppLanguage, type LanguagePreference } from '@/i18n/language';

const STORAGE_KEY = 'gling.language';
const LanguageContext = createContext<{
  preference: LanguagePreference;
  language: AppLanguage;
  isSaving: boolean;
  setPreference: (next: LanguagePreference) => Promise<boolean>;
} | null>(null);

function deviceLanguages(): string[] {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') return [...navigator.languages];
    if (Platform.OS === 'ios') {
      const values = Settings.get('AppleLanguages');
      if (Array.isArray(values)) return values.filter((value): value is string => typeof value === 'string');
    }
    if (Platform.OS === 'android') {
      const { localeIdentifier } = I18nManager.getConstants() as { localeIdentifier?: string };
      if (localeIdentifier) return [localeIdentifier];
    }
  } catch { /* Older native builds fall back to the runtime locale. */ }
  return [Intl.DateTimeFormat().resolvedOptions().locale];
}

export function LanguagePreferenceProvider({ children, initialLanguage }: PropsWithChildren<{ initialLanguage?: AppLanguage }>) {
  const [selection, setSelection] = useState<{ preference: LanguagePreference; language: AppLanguage }>({ preference: 'system', language: initialLanguage ?? 'en' });
  const [ready, setReady] = useState(initialLanguage !== undefined);
  const [isSaving, setSaving] = useState(false);
  const preference = useRef<LanguagePreference>('system');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const apply = useCallback((next: LanguagePreference) => {
    const language = resolveLanguage(next, deviceLanguages());
    preference.current = next;
    setActiveLanguage(language);
    setSelection({ preference: next, language });
  }, []);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void AsyncStorage.getItem(STORAGE_KEY).catch(() => null).then((value) => {
      if (active) { apply(parseLanguagePreference(value)); setReady(true); }
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && active) apply(preference.current);
    });
    return () => { active = false; mounted.current = false; subscription.remove(); };
  }, [apply]);

  const setPreference = useCallback(async (next: LanguagePreference) => {
    if (!ready || inFlight.current) return false;
    const previous = preference.current;
    inFlight.current = true;
    setSaving(true);
    apply(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
      return true;
    } catch {
      if (mounted.current) apply(previous);
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [apply, ready]);

  return <LanguageContext.Provider value={{ ...selection, isSaving, setPreference }}>{ready ? children : null}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  // Public readers/admin exports remain Korean when they do not mount the app provider.
  const language = context?.language ?? 'ko';
  const tr = useCallback((text: string, ...values: unknown[]) => translateUi(language, text, ...values), [language]);
  return { ...context, language, t: translationsFor(language), tr, locale: language === 'ko' ? 'ko-KR' : 'en-CA' };
}
