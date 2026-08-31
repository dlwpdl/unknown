import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';

SplashScreen.preventAutoHideAsync();

export default function WebLayout() {
  const colorScheme = useColorScheme();
  const segments = useSegments();
  const pathname = usePathname();
  const standalone = pathname === '/'
    || segments[0] === 'admin'
    || segments[0] === 'auth'
    || segments[0] === 'post'
    || segments[0] === 'notifications';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <InteractionFeedbackProvider>
          <AnimatedSplashOverlay />
          {standalone ? <Slot /> : <AppTabs />}
        </InteractionFeedbackProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
