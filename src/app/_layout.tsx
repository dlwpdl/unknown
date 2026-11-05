import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { ShareIntentProvider } from 'expo-share-intent';
import { useEffect } from 'react';
import { Appearance, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { AppUpdateGate } from '@/components/app-update-gate';
import { AppActivity } from '@/components/app-activity';
import { AppBadgeSync } from '@/components/app-badge-sync';
import { ErrorBoundary } from '@/components/error-boundary';
import { LiveBubbleBar, LiveNotice } from '@/components/live-bubble-bar';
import { NotificationObserver } from '@/components/notification-observer';
import { PushInvite } from '@/components/push-invite';
import { PostUploadCard } from '@/components/post-upload-card';
import { SharedImport } from '@/components/shared-import';
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
  // The share-intent provider sits outside the others, as the package asks; the web layout has no share sheet.
  return <ShareIntentProvider><LanguagePreferenceProvider><ThemePreferenceProvider><AppLayout /></ThemePreferenceProvider></LanguagePreferenceProvider></ShareIntentProvider>;
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
        <AppBadgeSync />
        <SharedImport />
        <MembershipProvider>
          {/* 내 말풍선이 떠 있으면 모든 화면 위에 막대가 붙는다 (동네 말풍선 지도, owner 2026-11-05). Screens get their own
            safe-area provider so they start below the bar instead of under it; with no bar it measures the same insets as before. */}
          <View style={{ flex: 1 }}>
            <LiveBubbleBar />
            <SafeAreaProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="meetup-create" options={{ animation: reducedMotion ? 'none' : 'slide_from_bottom' }} />
              </Stack>
            </SafeAreaProvider>
          </View>
          {/* Opens only right after a first comment, post, meetup request or meetup creation. */}
          <PushInvite />
          {/* 글쓰기 창을 닫은 뒤에도 올리기를 앱 맨 위에서 보여 준다 (owner 2026-11-04 ③). */}
          <PostUploadCard />
          <LiveNotice />
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
