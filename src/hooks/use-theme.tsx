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
  design: '2d' | '3d';
  isSaving: boolean;
  setScheme: (scheme: 'light' | 'dark') => Promise<boolean>;
  setDesign: (design: '2d' | '3d') => Promise<boolean>;
} | null>(null);
const STORAGE_KEY = 'gling.theme', DESIGN_KEY = 'gling.design';

export function ThemePreferenceProvider({ children }: PropsWithChildren) {
  const [scheme, updateScheme] = useState<'light' | 'dark'>('dark');
  const [design, updateDesign] = useState<'2d' | '3d'>('3d');
  const [ready, setReady] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(STORAGE_KEY).then((saved) => { if (active) updateScheme(saved === 'light' ? 'light' : 'dark'); }).catch(() => {}),
      AsyncStorage.getItem(DESIGN_KEY).then((saved) => { if (active && saved === '2d') updateDesign('2d'); }).catch(() => {}),
    ]).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const save = useCallback(async (key: string, value: string, apply: () => void) => {
    if (!ready || inFlight.current) return false;
    inFlight.current = true;
    apply();
    setSaving(true);
    try {
      await AsyncStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [ready]);
  const setScheme = useCallback((next: 'light' | 'dark') => save(STORAGE_KEY, next, () => updateScheme(next)), [save]);
  const setDesign = useCallback((next: '2d' | '3d') => save(DESIGN_KEY, next, () => updateDesign(next)), [save]);

  return <ThemePreferenceContext.Provider value={{ scheme, design, isSaving, setScheme, setDesign }}>{ready ? children : null}</ThemePreferenceContext.Provider>;
}

export function useThemePreference() {
  const value = useContext(ThemePreferenceContext);
  if (!value) throw new Error('ThemePreferenceProvider is required');
  return value;
}

/** The member's 2D·3D choice (owner 2026-11-06). 3D unless they turned it off. */
export function useDesign() {
  return useContext(ThemePreferenceContext)?.design ?? '3d';
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
