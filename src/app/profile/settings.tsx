import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { LanguageCard } from '@/components/language-card';
import { Pressable, ScrollView, Switch } from '@/components/analytics-controls';
import Constants from 'expo-constants';
import { Redirect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { NearbyCityCard } from '@/components/nearby-city-card';
import { ContentTranslationSettings } from '@/components/content-translation';
import { PersonalInfoCard } from '@/components/personal-info-card';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme, useThemePreference } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { deleteMyAccount } from '@/lib/community-data';
import { CONTACT_EMAIL } from '@/lib/legal-documents';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';
import { adsSupported, showAdPrivacyOptions, testAds } from '@/lib/ads';

export default function SettingsScreen() {
  const { tr, t } = useLanguage();
  const theme = useTheme();
  const { scheme, isSaving: themeSaving, setScheme } = useThemePreference();
  const router = useRouter();
  const { isAuthed, isAuthLoading, me, prepareAppleAccountDeletion, setProfilePhoto, signOut } = useAuth();
  const { hapticsEnabled, play, setHapticsEnabled, setSoundEnabled, soundEnabled } = useInteractionFeedback();
  const { manage } = useMembership();
  const [deleting, setDeleting] = useState(false);
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? CONTACT_EMAIL;
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');

  if (isAuthLoading) return <GlingLoader color={theme.accent} style={{ flex: 1 }} />;
  if (!isAuthed) return <Redirect href="/profile" />;

  const removePhoto = () =>
    Alert.alert(t.profile.removePhotoTitle, t.profile.removePhotoBody, [
      { text: t.profile.cancel, style: 'cancel' },
      { text: t.profile.remove, style: 'destructive', onPress: () => { play('warning'); void setProfilePhoto(null); } },
    ]);

  const confirmSignOut = () =>
    Alert.alert(t.profile.signOutTitle, t.profile.signOutBody, [
      { text: t.profile.cancel, style: 'cancel' },
      {
        text: t.profile.signOut,
        style: 'destructive',
        onPress: () => {
          play('warning');
          signOut();
          if (router.canGoBack()) router.back();
          else router.replace('/');
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
      const appleAuthorizationCode = await prepareAppleAccountDeletion();
      await deleteMyAccount(supabase, appleAuthorizationCode);
      play('warning');
      await signOut();
      router.replace('/');
    } catch {
      play('warning');
      Alert.alert(t.profile.deleteErrorTitle, t.profile.deleteErrorBody);
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(t.profile.deleteTitle, t.profile.deleteWarning, [
      { text: t.profile.cancel, style: 'cancel' },
      { text: tr("구독 관리"), onPress: () => void manage() },
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
        <ScrollView analyticsId="app_profile_settings.scrollview.1" contentContainerStyle={styles.content}>
          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{t.profile.account}</ThemedText>
          <PersonalInfoCard userId={me.id} nickname={me.nickname} />
          <LanguageCard />
          <ContentTranslationSettings />

          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{t.profile.appearance}</ThemedText>
          <View style={[styles.card, styles.appearanceCard, { backgroundColor: theme.card, borderColor: theme.accent }]}>
            <View style={[styles.appearancePreview, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.previewPair} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {[Colors.light, Colors.dark].map((palette, index) => <View key={index} style={[styles.previewPage, { backgroundColor: palette.background, borderColor: palette.line }]}>
                  {[0, 1, 2].map((line) => <View key={line} style={[styles.previewLine, { backgroundColor: palette.accent }]} />)}
                </View>)}
              </View>
              <View style={styles.navCopy}>
                <ThemedText type="smallBold">{scheme === 'dark' ? t.profile.darkMode : t.profile.lightMode}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t.profile.appearancePreview}</ThemedText>
              </View>
              <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={20} tintColor={theme.accent} />
            </View>
            <View style={styles.appearanceRow}>
              <View style={styles.navCopy}>
                <ThemedText type="smallBold">{t.profile.darkMode}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t.profile.darkModeNote}</ThemedText>
              </View>
              <Switch analyticsId="app_profile_settings.switch.theme"
                value={scheme === 'dark'}
                disabled={themeSaving}
                accessibilityLabel={t.profile.darkMode}
                accessibilityHint={t.profile.darkModeHint}
                accessibilityState={{ disabled: themeSaving, busy: themeSaving }}
                hitSlop={7}
                trackColor={{ false: '#837B91', true: theme.accent }}
                thumbColor={scheme === 'dark' ? theme.accentInk : '#FFFFFF'}
                ios_backgroundColor="#837B91"
                onValueChange={(enabled) => {
                  play('selection');
                  void setScheme(enabled ? 'dark' : 'light').then((saved) => {
                    if (!saved) Alert.alert(t.profile.appearanceSaveErrorTitle, t.profile.appearanceSaveErrorBody);
                  });
                }}
              />
            </View>
          </View>

          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{tr("알림")}</ThemedText>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <Pressable analyticsId="app_profile_settings.pressable.1" accessibilityRole="button" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]} onPress={() => { play('selection'); router.push('/profile/notifications'); }}>
              <View style={styles.navCopy}><ThemedText type="smallBold">{tr("알림 설정")}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr("댓글·메시지·모임 소식 선택")}</ThemedText></View>
              <ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
          </View>

          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{tr("위치 및 지역")}</ThemedText>
          <NearbyCityCard settings />

          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{t.profile.feedback}</ThemedText>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={styles.row}>
              <ThemedText type="small">{t.profile.soundEffects}</ThemedText>
              <Switch analyticsId="app_profile_settings.switch.1"
                value={soundEnabled}
                onValueChange={(enabled) => { play('selection'); setSoundEnabled(enabled); }}
                accessibilityLabel={t.profile.soundEffects}
                trackColor={{ false: theme.line, true: theme.accent }}
                ios_backgroundColor={theme.line}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <View style={styles.row}>
              <ThemedText type="small">{t.profile.haptics}</ThemedText>
              <Switch analyticsId="app_profile_settings.switch.2"
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

          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{tr("도움말 및 정책")}</ThemedText>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <Pressable analyticsId="app_profile_settings.pressable.3" onPress={() => { play('selection'); openSupport(); }} accessibilityRole="link" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <View style={styles.navCopy}><ThemedText type="smallBold">{t.profile.support}</ThemedText><ThemedText type="small" themeColor="textSecondary">{supportEmail ?? t.profile.supportNeedsSetup}</ThemedText></View><ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable analyticsId="app_profile_settings.pressable.4" onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/terms`); }} accessibilityRole="link" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={styles.navCopy}>{tr("이용약관")}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable analyticsId="app_profile_settings.pressable.5" onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/privacy`); }} accessibilityRole="link" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={styles.navCopy}>{tr("개인정보처리방침")}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
            {adsSupported && !testAds && <><View style={[styles.divider, { backgroundColor: theme.line }]} />
              <Pressable analyticsId="app_profile_settings.pressable.2" accessibilityRole="button" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]} onPress={() => {
                play('selection');
                void showAdPrivacyOptions().then((shown) => {
                  if (!shown) Alert.alert(tr("광고 개인정보 설정"), tr(Platform.OS === 'ios'
                    ? "변경할 Google 광고 동의 설정이 없거나, iPhone에서 추적을 허용하지 않은 상태입니다. 추적 허용은 기기의 설정 > 개인정보 보호 및 보안 > 추적에서 변경할 수 있습니다. 글링은 개인 맞춤 광고를 요청하지 않습니다."
                    : "현재 지역에서 변경할 광고 동의 설정이 없습니다. 글링은 개인 맞춤 광고를 요청하지 않습니다."));
                }).catch(() => Alert.alert(tr("광고 설정을 열지 못했어요"), tr("잠시 후 다시 시도해 주세요.")));
              }}><ThemedText type="smallBold" style={styles.navCopy}>{tr("광고 개인정보 설정")}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText></Pressable>
            </>}
          </View>

          <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{tr("계정 관리")}</ThemedText>
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            {me.photoUri && <><Pressable analyticsId="app_profile_settings.pressable.6" onPress={() => { play('selection'); removePhoto(); }} accessibilityRole="button" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={styles.navCopy}>{t.profile.removePhoto}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable><View style={[styles.divider, { backgroundColor: theme.line }]} /></>}
            <Pressable analyticsId="app_profile_settings.pressable.7" onPress={() => { play('selection'); confirmSignOut(); }} accessibilityRole="button" style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={styles.navCopy}>{t.profile.signOut}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <Pressable analyticsId="app_profile_settings.pressable.8" onPress={() => { play('selection'); confirmDelete(); }} disabled={deleting} accessibilityRole="button" accessibilityState={{ disabled: deleting, busy: deleting }} style={({ pressed }) => [styles.navRow, { opacity: deleting ? 0.55 : 1 }, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={[styles.navCopy, { color: theme.accent }]}>{deleting ? t.profile.deleting : t.profile.deleteAccount}</ThemedText><ThemedText themeColor="textSecondary">›</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
            {tr("글링") + " "}{Constants.expoConfig?.version ?? '1.0.0'}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: TabBarHeight + Spacing.four, gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.three, marginLeft: Spacing.one },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  appearanceCard: { padding: 14, borderRadius: 16, gap: Spacing.two },
  appearancePreview: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: 12 },
  previewPair: { flexDirection: 'row', gap: 3 },
  previewPage: { width: 21, height: 48, borderWidth: 1, borderRadius: 5, padding: 3, justifyContent: 'center', gap: 3 },
  previewLine: { height: 3, borderRadius: 2 },
  appearanceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, padding: Spacing.three },
  navRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  navCopy: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  version: { textAlign: 'center', marginTop: Spacing.three },
});
