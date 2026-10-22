import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WebNightColors } from '@/constants/theme';
import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';
import { CommunityCityProvider } from '@/lib/community-city';
import { MembershipProvider } from '@/lib/membership-provider';

export default function PublicWebLayout() {
  return <ThemeProvider value={DarkTheme}><ThemeOverrideProvider scheme="dark"><SafeAreaProvider><InteractionFeedbackProvider><AuthProvider>
    <CommunityCityProvider><MembershipProvider><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: WebNightColors.background } }} /></MembershipProvider></CommunityCityProvider>
  </AuthProvider></InteractionFeedbackProvider></SafeAreaProvider></ThemeOverrideProvider></ThemeProvider>;
}
