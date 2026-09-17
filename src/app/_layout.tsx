import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppActivity } from '@/components/app-activity';
import { ErrorBoundary } from '@/components/error-boundary';
import { NotificationObserver } from '@/components/notification-observer';
import { PushInvite } from '@/components/push-invite';
import { AuthProvider } from '@/lib/auth';
import { installErrorReporting } from '@/lib/error-reporting';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';
import { MembershipProvider } from '@/lib/membership-provider';

SplashScreen.preventAutoHideAsync();
// 렌더 트리 밖에서 난 예외도 잡으려면 화면이 뜨기 전에 걸어야 한다.
installErrorReporting();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <ErrorBoundary>
      <AuthProvider>
        <AppActivity />
        <NotificationObserver />
        <MembershipProvider>
        <InteractionFeedbackProvider>
          <AnimatedSplashOverlay />
          <Stack screenOptions={{ headerShown: false }} />
          <PushInvite />
        </InteractionFeedbackProvider>
        </MembershipProvider>
      </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
