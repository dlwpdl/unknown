import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';
import { MembershipProvider } from '@/lib/membership-provider';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <AuthProvider>
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
