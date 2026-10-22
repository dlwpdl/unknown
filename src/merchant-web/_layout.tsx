import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';

export default function MerchantWebLayout() {
  return <ThemeProvider value={DarkTheme}><ThemeOverrideProvider scheme="dark"><SafeAreaProvider>
    <InteractionFeedbackProvider><AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider></InteractionFeedbackProvider>
  </SafeAreaProvider></ThemeOverrideProvider></ThemeProvider>;
}
