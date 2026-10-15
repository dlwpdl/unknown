/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ThemeScheme = keyof typeof Colors;

const ThemeOverrideContext = createContext<ThemeScheme | null>(null);
const ThemePreferenceContext = createContext<{
  scheme: 'light' | 'dark';
  isSaving: boolean;
  setScheme: (scheme: 'light' | 'dark') => Promise<boolean>;
} | null>(null);
const STORAGE_KEY = 'gling.theme';

export function ThemePreferenceProvider({ children }: PropsWithChildren) {
  const [scheme, updateScheme] = useState<'light' | 'dark'>('dark');
  const [ready, setReady] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => { if (active) updateScheme(saved === 'light' ? 'light' : 'dark'); })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const setScheme = useCallback(async (next: 'light' | 'dark') => {
    if (!ready || inFlight.current) return false;
    inFlight.current = true;
    updateScheme(next);
    setSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
      return true;
    } catch {
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [ready]);

  return <ThemePreferenceContext.Provider value={{ scheme, isSaving, setScheme }}>{ready ? children : null}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  const value = useContext(ThemePreferenceContext);
  if (!value) throw new Error('ThemePreferenceProvider is required');
  return value;
}

export function ThemeOverrideProvider({
  children,
  scheme,
}: PropsWithChildren<{ scheme: ThemeScheme }>) {
  return <ThemeOverrideContext.Provider value={scheme}>{children}</ThemeOverrideContext.Provider>;
}

export function useTheme() {
  const systemScheme = useColorScheme();
  const override = useContext(ThemeOverrideContext);
  const preference = useContext(ThemePreferenceContext);
  const theme = override ?? preference?.scheme ?? (systemScheme === 'dark' ? 'dark' : 'light');

  return Colors[theme];
}
