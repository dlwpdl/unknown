/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { createContext, createElement, type PropsWithChildren, useContext } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ThemeScheme = keyof typeof Colors;

const ThemeOverrideContext = createContext<ThemeScheme | null>(null);

export function ThemeOverrideProvider({
  children,
  scheme,
}: PropsWithChildren<{ scheme: ThemeScheme }>) {
  return createElement(ThemeOverrideContext.Provider, { value: scheme }, children);
}

export function useTheme() {
  const systemScheme = useColorScheme();
  const override = useContext(ThemeOverrideContext);
  const theme = override ?? (systemScheme === 'dark' ? 'dark' : 'light');

  return Colors[theme];
}
