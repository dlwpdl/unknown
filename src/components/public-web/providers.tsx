import { DarkTheme, ThemeProvider } from 'expo-router';
import type { ReactNode } from 'react';
import { LanguagePreferenceProvider } from '@/hooks/use-language';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth';
import { CommunityCityProvider } from '@/lib/community-city';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';
import { MembershipProvider } from '@/lib/membership-provider';

export function PublicWebProviders({ children }: { children: ReactNode }) {
  return <LanguagePreferenceProvider initialLanguage="ko"><ThemeProvider value={DarkTheme}><ThemeOverrideProvider scheme="dark"><SafeAreaProvider><InteractionFeedbackProvider><AuthProvider>
    <CommunityCityProvider><MembershipProvider>{children}</MembershipProvider></CommunityCityProvider>
  </AuthProvider></InteractionFeedbackProvider></SafeAreaProvider></ThemeOverrideProvider></ThemeProvider></LanguagePreferenceProvider>;
}
