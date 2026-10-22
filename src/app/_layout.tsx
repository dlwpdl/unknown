import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Appearance } from 'react-native';
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
import { ThemePreferenceProvider, useTheme, useThemePreference } from '@/hooks/use-theme';
import { LanguagePreferenceProvider } from '@/hooks/use-language';
import { ContentTranslationProvider } from '@/hooks/use-content-translation';

void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: false });
// 렌더 트리 밖에서 난 예외도 잡으려면 화면이 뜨기 전에 걸어야 한다.
installErrorReporting();

export default function TabLayout() {
  return <LanguagePreferenceProvider><ThemePreferenceProvider><AppLayout /></ThemePreferenceProvider></LanguagePreferenceProvider>;
}

function AppLayout() {
  const reducedMotion = useReducedMotion();
  const { scheme } = useThemePreference();
  const theme = useTheme();
  const navigationTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  useEffect(() => {
    Appearance.setColorScheme(scheme);
    void SystemUI.setBackgroundColorAsync(theme.background).catch(() => {});
  }, [scheme, theme.background]);
  return (
    <ThemeProvider value={{ ...navigationTheme, colors: { ...navigationTheme.colors, primary: theme.accent, background: theme.background, card: theme.card, text: theme.text, border: theme.line, notification: theme.accent } }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ErrorBoundary>
      {/* 피드백은 AuthProvider가 띄우는 로그인 패널에서도 필요하므로 가장 바깥에 둔다. */}
      <InteractionFeedbackProvider>
      <AppUpdateGate>
      <AuthProvider>
        <ContentTranslationProvider>
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
        </ContentTranslationProvider>
      </AuthProvider>
      </AppUpdateGate>
      </InteractionFeedbackProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
