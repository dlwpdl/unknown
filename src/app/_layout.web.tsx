import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';

SplashScreen.preventAutoHideAsync();

export default function WebLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname().replace(/\/$/, '');
  const publicPage = pathname === '' || ['/terms', '/privacy', '/account-deletion'].some((path) => pathname.endsWith(path));
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider publicPage={publicPage}>
        <InteractionFeedbackProvider>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }} />
        </InteractionFeedbackProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
