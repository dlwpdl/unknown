import { Redirect } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { PersonalInfoCard } from '@/components/personal-info-card';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

/** Nickname and the private account form, moved off the long Settings list (QA A-set-01, A-prof-02). */
export default function AccountScreen() {
  const theme = useTheme();
  const { isAuthed, isAuthLoading, me } = useAuth();
  if (isAuthLoading) return <GlingLoader color={theme.accent} style={{ flex: 1 }} />;
  if (!isAuthed) return <Redirect href="/profile" />;
  return <KeyboardScreen><ThemedView style={styles.container}>
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* The form used to live in the Settings scroll, so its scroll depth keeps that target. */}
      <ScrollView analyticsId="app_profile_settings.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <PersonalInfoCard userId={me.id} nickname={me.nickname} />
      </ScrollView>
    </SafeAreaView>
  </ThemedView></KeyboardScreen>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: TabBarHeight + Spacing.four, gap: Spacing.two },
});
