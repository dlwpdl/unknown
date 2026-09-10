import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';
import { MembershipProvider } from '@/lib/membership-provider';

SplashScreen.preventAutoHideAsync();

export default function WebLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname().replace(/\/$/, '');
  const publicPage = pathname === '' || ['/terms', '/privacy', '/account-deletion'].some((path) => pathname.endsWith(path));
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider publicPage={publicPage}>
        <MembershipProvider>
        <InteractionFeedbackProvider>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }} />
        </InteractionFeedbackProvider>
        </MembershipProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
