import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useReducedMotion } from 'react-native-reanimated';

import { AppUpdateGate } from '@/components/app-update-gate';
import { AppActivity } from '@/components/app-activity';
import { ErrorBoundary } from '@/components/error-boundary';
import { NotificationObserver } from '@/components/notification-observer';
import { PushInvite } from '@/components/push-invite';
import { AuthProvider } from '@/lib/auth';
import { CommunityCityProvider } from '@/lib/community-city';
import { installErrorReporting } from '@/lib/error-reporting';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';
import { MembershipProvider } from '@/lib/membership-provider';
import { ThemeOverrideProvider } from '@/hooks/use-theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: false });
// 렌더 트리 밖에서 난 예외도 잡으려면 화면이 뜨기 전에 걸어야 한다.
installErrorReporting();

export default function TabLayout() {
  const reducedMotion = useReducedMotion();
  return (
    <ThemeProvider value={DarkTheme}>
      <ThemeOverrideProvider scheme="dark">
      <StatusBar style="light" />
      <ErrorBoundary>
      {/* 피드백은 AuthProvider가 띄우는 로그인 패널에서도 필요하므로 가장 바깥에 둔다. */}
      <InteractionFeedbackProvider>
      <AppUpdateGate>
      <AuthProvider>
        <CommunityCityProvider>
        <AppActivity />
        <NotificationObserver />
        <MembershipProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="meetup-create" options={{ animation: reducedMotion ? 'none' : 'slide_from_bottom' }} />
          </Stack>
          <PushInvite />
        </MembershipProvider>
        </CommunityCityProvider>
      </AuthProvider>
      </AppUpdateGate>
      </InteractionFeedbackProvider>
      </ErrorBoundary>
      </ThemeOverrideProvider>
    </ThemeProvider>
  );
}
