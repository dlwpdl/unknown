import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { deleteMyAccount } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, isAuthLoading, me, setProfilePhoto, signOut } = useAuth();
  const { hapticsEnabled, play, setHapticsEnabled, setSoundEnabled, soundEnabled } = useInteractionFeedback();
  const [deleting, setDeleting] = useState(false);
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://dlwpdl.github.io/gling').replace(/\/$/, '');

  if (isAuthLoading) return <ActivityIndicator color={theme.accent} style={{ flex: 1 }} />;
  if (!isAuthed) return <Redirect href="/profile" />;

  const removePhoto = () =>
    Alert.alert(t.profile.removePhotoTitle, t.profile.removePhotoBody, [
      { text: t.profile.cancel, style: 'cancel' },
      { text: t.profile.remove, style: 'destructive', onPress: () => void setProfilePhoto(null) },
    ]);

  const confirmSignOut = () =>
    Alert.alert(t.profile.signOutTitle, t.profile.signOutBody, [
      { text: t.profile.cancel, style: 'cancel' },
      {
        text: t.profile.signOut,
        style: 'destructive',
        onPress: () => {
          signOut();
          router.back();
        },
      },
    ]);

  const openSupport = () => {
    if (!supportEmail) return Alert.alert(t.profile.supportUnavailableTitle, t.profile.supportUnavailableBody);
    void Linking.openURL(`mailto:${supportEmail}?subject=${encodeURIComponent(t.profile.supportSubject)}`);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteMyAccount(supabase, me.id);
      await signOut();
      router.replace('/');
    } catch {
      Alert.alert(t.profile.deleteErrorTitle, t.profile.deleteErrorBody);
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(t.profile.deleteTitle, t.profile.deleteWarning, [
      { text: t.profile.cancel, style: 'cancel' },
      {
        text: t.profile.deleteContinue,
        style: 'destructive',
        onPress: () => Alert.alert(t.profile.deleteFinalTitle, t.profile.deleteFinalBody, [
          { text: t.profile.cancel, style: 'cancel' },
          { text: t.profile.deleteConfirm, style: 'destructive', onPress: () => void deleteAccount() },
        ]),
      },
    ]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.content}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t.profile.account}
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={styles.row}>
              <ThemedText type="small">{t.profile.nickname}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{me.nickname}</ThemedText>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <View style={styles.row}>
              <ThemedText type="small">{t.profile.area}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.profile.location('', null)}</ThemedText>
            </View>
          </View>

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t.profile.feedback}
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={styles.row}>
              <ThemedText type="small">{t.profile.soundEffects}</ThemedText>
              <Switch
                value={soundEnabled}
                onValueChange={setSoundEnabled}
                accessibilityLabel={t.profile.soundEffects}
                trackColor={{ false: theme.line, true: theme.accent }}
                ios_backgroundColor={theme.line}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <View style={styles.row}>
              <ThemedText type="small">{t.profile.haptics}</ThemedText>
              <Switch
                value={hapticsEnabled}
                onValueChange={(enabled) => {
                  play('selection');
                  setHapticsEnabled(enabled);
                }}
                accessibilityLabel={t.profile.haptics}
                trackColor={{ false: theme.line, true: theme.accent }}
                ios_backgroundColor={theme.line}
              />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t.profile.feedbackNote}
          </ThemedText>

          <Pressable onPress={openSupport} accessibilityRole="link" style={[styles.action, { borderColor: theme.line }]}>
            <ThemedText type="smallBold">{t.profile.support}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{supportEmail ?? t.profile.supportNeedsSetup}</ThemedText>
          </Pressable>

          <Pressable onPress={() => void Linking.openURL(`${publicSiteUrl}/terms`)} accessibilityRole="link" style={[styles.action, { borderColor: theme.line }]}>
            <ThemedText type="smallBold">이용약관</ThemedText>
          </Pressable>

          <Pressable onPress={() => void Linking.openURL(`${publicSiteUrl}/privacy`)} accessibilityRole="link" style={[styles.action, { borderColor: theme.line }]}>
            <ThemedText type="smallBold">개인정보처리방침</ThemedText>
          </Pressable>

          {me.photoUri && (
            <Pressable
              onPress={removePhoto}
              accessibilityRole="button"
              style={[styles.action, { borderColor: theme.line }]}>
              <ThemedText type="small">{t.profile.removePhoto}</ThemedText>
            </Pressable>
          )}

          <Pressable
            onPress={confirmSignOut}
            accessibilityRole="button"
            style={[styles.action, { borderColor: theme.line }]}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {t.profile.signOut}
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={confirmDelete}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityState={{ disabled: deleting, busy: deleting }}
            style={[styles.action, { borderColor: theme.accent, opacity: deleting ? 0.55 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {deleting ? t.profile.deleting : t.profile.deleteAccount}
            </ThemedText>
          </Pressable>

          <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
            {t.profile.version}
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: TabBarHeight + Spacing.four, gap: Spacing.three },
  card: { borderWidth: 1, borderRadius: 12 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, padding: Spacing.three },
  divider: { height: 1, marginHorizontal: Spacing.three },
  action: { borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  version: { textAlign: 'center', marginTop: Spacing.three },
});
