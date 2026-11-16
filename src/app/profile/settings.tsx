import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { LanguageCard } from '@/components/language-card';
import { Pressable, ScrollView, Switch } from '@/components/analytics-controls';
import Constants from 'expo-constants';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Linking, Platform, StyleSheet, View } from 'react-native';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { FlatPressable } from '@/components/flat-pressable';
import { SymbolView } from '@/components/symbol-view';
import { IconSize } from '@/constants/design-system';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { NearbyCityCard } from '@/components/nearby-city-card';
import { ContentTranslationSettings } from '@/components/content-translation';
import { ProfileSharingCard } from '@/components/profile-overview';
import { resetStartGuide } from '@/components/start-guide';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme, useThemePreference } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { deleteMyAccount } from '@/lib/community-data';
import { CONTACT_EMAIL } from '@/lib/legal-documents';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { loadPhotoConsentSettings, setPhotoConsentDefault, type PhotoConsentSettings } from '@/lib/post-photo-consent';
import { supabase } from '@/lib/supabase';
import { adsSupported, showAdPrivacyOptions, testAds } from '@/lib/ads';

function Card({ children }: { children: ReactNode }) {
  const theme = useTheme(), clayBox = useClayBox();
  // The clay tile overhangs the card, so only the rows inside are clipped to its corners.
  if (clayBox) return <View><ClayBoxFill kind="tile" /><View style={styles.clayRows}>{children}</View></View>;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>{children}</View>;
}

// Every row that opens something ends in the same chevron (QA A-set-05: a 3D arrow and a text › were mixed).
function Chevron() {
  const theme = useTheme();
  return <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} accessible={false} />;
}

type Confirm = 'removePhoto' | 'signOut' | 'signOutAll' | 'delete' | 'deleteFinal';

export default function SettingsScreen() {
  const { tr, t } = useLanguage();
  const theme = useTheme();
  const { scheme, design, isSaving: themeSaving, setScheme, setDesign } = useThemePreference();
  const router = useRouter();
  const { expectSignOut, isAuthed, isAuthLoading, me, prepareAppleAccountDeletion, setProfilePhoto, signOut } = useAuth();
  const { hapticsEnabled, play, setHapticsEnabled, setSoundEnabled, soundEnabled } = useInteractionFeedback();
  const { manage } = useMembership();
  const [deleting, setDeleting] = useState(false);
  // One confirm sheet for every risky account action (QA A-set-06): the action sits on the right in danger colour.
  // The kind outlives the open flag so the sheet keeps its words while it slides away.
  const [confirm, setConfirm] = useState<Confirm>('signOut'), [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? CONTACT_EMAIL;
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');

  if (isAuthLoading) return <GlingLoader color={theme.accent} style={{ flex: 1 }} />;
  if (!isAuthed) return <Redirect href="/profile" />;

  const ask = (next: Confirm) => { play('selection'); setConfirmError(''); setConfirm(next); setConfirmOpen(true); };
  const closeConfirm = () => { if (!confirmBusy && !deleting) setConfirmOpen(false); };
  const leave = () => { if (router.canGoBack()) router.back(); else router.replace('/'); };

  const removePhoto = () => { play('warning'); setConfirmOpen(false); void setProfilePhoto(null); };

  const signOutHere = () => { play('warning'); setConfirmOpen(false); signOut(); leave(); };

  const signOutEverywhere = async () => {
    if (confirmBusy) return;
    play('warning'); setConfirmBusy(true); setConfirmError('');
    // Leave only once every session is revoked; a failed revoke stays here and says so, so a stolen session is never thought ended.
    if (!(await signOut('global'))) { setConfirmBusy(false); setConfirmError(t.auth.signOutError); return; }
    setConfirmBusy(false); setConfirmOpen(false);
    leave();
  };

  const openSupport = () => {
    if (!supportEmail) return Alert.alert(t.profile.supportUnavailableTitle, t.profile.supportUnavailableBody);
    void Linking.openURL(`mailto:${supportEmail}?subject=${encodeURIComponent(t.profile.supportSubject)}`);
  };

  const deleteAccount = async () => {
    if (deleting) return;
    setDeleting(true); setConfirmError('');
    try {
      const appleAuthorizationCode = await prepareAppleAccountDeletion();
      expectSignOut(true);
      await deleteMyAccount(supabase, appleAuthorizationCode);
      play('warning');
      await signOut();
      router.replace('/');
    } catch {
      expectSignOut(false);
      play('warning');
      setConfirmError(`${t.profile.deleteErrorTitle}. ${t.profile.deleteErrorBody}`);
    } finally {
      setDeleting(false);
    }
  };

  const sheet = confirm === 'removePhoto' ? { title: t.profile.removePhotoTitle, body: t.profile.removePhotoBody, id: 'app_profile_settings.pressable.6', label: t.profile.remove, run: removePhoto }
    : confirm === 'signOut' ? { title: t.profile.signOutTitle, body: t.profile.signOutBody, id: 'app_profile_settings.pressable.7', label: t.profile.signOut, run: signOutHere }
    : confirm === 'signOutAll' ? { title: t.profile.signOutAllTitle, body: t.profile.signOutAllBody, id: 'app_profile_settings.sign-out-all', label: t.profile.signOutAll, run: () => void signOutEverywhere() }
    : confirm === 'delete' ? { title: t.profile.deleteTitle, body: t.profile.deleteWarning, id: 'app_profile_settings.pressable.8', label: t.profile.deleteContinue, run: () => { play('selection'); setConfirm('deleteFinal'); } }
    : { title: t.profile.deleteFinalTitle, body: t.profile.deleteFinalBody, id: 'app_profile_settings.pressable.8', label: t.profile.deleteConfirm, run: () => void deleteAccount() };

  const pressedRow = ({ pressed }: { pressed: boolean }) => [styles.navRow, pressed && { backgroundColor: theme.backgroundSelected }];
  const divider = <View style={[styles.divider, { backgroundColor: theme.line }]} />;
  const section = (title: string) => <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>{title}</ThemedText>;
  const themeSwitch = (analyticsId: string, label: string, hint: string, note: string, value: boolean, change: (on: boolean) => Promise<boolean>) => <View style={styles.row}>
    <View style={styles.navCopy}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>
    </View>
    <Switch analyticsId={analyticsId} value={value} disabled={themeSaving} accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{ disabled: themeSaving, busy: themeSaving }} hitSlop={7}
      onValueChange={(enabled) => {
        play('selection');
        void change(enabled).then((saved) => {
          if (!saved) { play('warning'); Alert.alert(t.profile.appearanceSaveErrorTitle, t.profile.appearanceSaveErrorBody); }
        });
      }} />
  </View>;

  return (
    <KeyboardScreen><ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView analyticsId="app_profile_settings.scrollview.1" contentContainerStyle={styles.content}>
          {/* QA A-set-01: what people change most comes first (language, display, notifications); the account form has its own screen. */}
          <LanguageCard />
          <ContentTranslationSettings />

          {section(tr("화면과 소리"))}
          {/* The switch is the one place to choose (QA H43-1·F34-1): a checked preview row above it read as a second, one-option picker. */}
          <Card>
            {themeSwitch('app_profile_settings.switch.theme', t.profile.darkMode, t.profile.darkModeHint, t.profile.darkModeNote, scheme === 'dark', on => setScheme(on ? 'dark' : 'light'))}
            {/* The web is always flat, so the switch would do nothing there. */}
            {Platform.OS !== 'web' && <>{divider}{themeSwitch('app_profile_settings.switch.design', t.profile.clayDesign, t.profile.clayDesignHint, t.profile.clayDesignNote, design === '3d', on => setDesign(on ? '3d' : '2d'))}</>}
            {divider}
            <View style={styles.row}>
              <ThemedText type="small" style={styles.navCopy}>{t.profile.soundEffects}</ThemedText>
              <Switch analyticsId="app_profile_settings.switch.1" value={soundEnabled} accessibilityLabel={t.profile.soundEffects}
                onValueChange={(enabled) => { play('selection'); setSoundEnabled(enabled); }} />
            </View>
            {divider}
            <View style={styles.row}>
              <ThemedText type="small" style={styles.navCopy}>{t.profile.haptics}</ThemedText>
              <Switch analyticsId="app_profile_settings.switch.2" value={hapticsEnabled} accessibilityLabel={t.profile.haptics}
                onValueChange={(enabled) => { play('selection'); setHapticsEnabled(enabled); }} />
            </View>
          </Card>
          <ThemedText type="small" themeColor="textSecondary" style={styles.inset}>{t.profile.feedbackNote}</ThemedText>

          {section(tr("알림"))}
          <Card>
            <Pressable analyticsId="app_profile_settings.pressable.1" accessibilityRole="button" style={pressedRow} onPress={() => { play('selection'); router.push('/profile/notifications'); }}>
              <View style={styles.navCopy}><ThemedText type="smallBold">{tr("알림 설정")}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr("댓글·메시지·모임 소식 선택")}</ThemedText></View>
              <Chevron />
            </Pressable>
          </Card>

          {section(t.profile.account)}
          <Card>
            <Pressable analyticsId="profile.edit" accessibilityRole="button" style={pressedRow} onPress={() => { play('selection'); router.push('/profile/account'); }}>
              <View style={styles.navCopy}><ThemedText type="smallBold">{tr("닉네임·계정 정보")}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{me.nickname}</ThemedText></View>
              <Chevron />
            </Pressable>
          </Card>

          {section(tr("공개 범위"))}
          <ProfileSharingCard />
          <PhotoConsentCard />

          {section(tr("위치 및 지역"))}
          <NearbyCityCard settings />

          {section(tr("도움말 및 정책"))}
          <Card>
            <Pressable analyticsId="settings.start-guide.reset" accessibilityRole="button" style={pressedRow}
              onPress={() => { play('selection'); void resetStartGuide().then(() => router.navigate('/')); }}>
              <View style={styles.navCopy}><ThemedText type="smallBold">{tr("처음 안내 다시 보기")}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr("홈에 시작하기 세 단계가 다시 나오고, 화면 둘러보기도 바로 열려요")}</ThemedText></View><Chevron />
            </Pressable>
            {divider}
            <Pressable analyticsId="app_profile_settings.pressable.3" onPress={() => { play('selection'); openSupport(); }} accessibilityRole="link" style={pressedRow}>
              <View style={styles.navCopy}><ThemedText type="smallBold">{t.profile.support}</ThemedText><ThemedText type="small" themeColor="textSecondary">{supportEmail ?? t.profile.supportNeedsSetup}</ThemedText></View><Chevron />
            </Pressable>
            {divider}
            <Pressable analyticsId="app_profile_settings.pressable.4" onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/terms`); }} accessibilityRole="link" style={pressedRow}>
              <ThemedText type="smallBold" style={styles.navCopy}>{tr("이용약관")}</ThemedText><Chevron />
            </Pressable>
            {divider}
            <Pressable analyticsId="app_profile_settings.pressable.5" onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/privacy`); }} accessibilityRole="link" style={pressedRow}>
              <ThemedText type="smallBold" style={styles.navCopy}>{tr("개인정보처리방침")}</ThemedText><Chevron />
            </Pressable>
            {adsSupported && !testAds && <>{divider}
              <Pressable analyticsId="app_profile_settings.pressable.2" accessibilityRole="button" style={pressedRow} onPress={() => {
                play('selection');
                void showAdPrivacyOptions().then((shown) => {
                  if (!shown) Alert.alert(tr("광고 개인정보 설정"), tr(Platform.OS === 'ios'
                    ? "변경할 Google 광고 동의 설정이 없거나, iPhone에서 추적을 허용하지 않은 상태입니다. 추적 허용은 기기의 설정 > 개인정보 보호 및 보안 > 추적에서 변경할 수 있습니다. 글링은 개인 맞춤 광고를 요청하지 않습니다."
                    : "현재 지역에서 변경할 광고 동의 설정이 없습니다. 글링은 개인 맞춤 광고를 요청하지 않습니다."));
                }).catch(() => Alert.alert(tr("광고 설정을 열지 못했어요"), tr("잠시 후 다시 시도해 주세요.")));
              }}><ThemedText type="smallBold" style={styles.navCopy}>{tr("광고 개인정보 설정")}</ThemedText><Chevron /></Pressable>
            </>}
          </Card>

          {section(tr("계정 관리"))}
          <Card>
            {me.photoUri && <><Pressable analyticsId="app_profile_settings.pressable.6" onPress={() => ask('removePhoto')} accessibilityRole="button" style={pressedRow}>
              <ThemedText type="smallBold" style={styles.navCopy}>{t.profile.removePhoto}</ThemedText><Chevron />
            </Pressable>{divider}</>}
            <Pressable analyticsId="app_profile_settings.pressable.7" onPress={() => ask('signOut')} accessibilityRole="button" style={pressedRow}>
              <ThemedText type="smallBold" style={styles.navCopy}>{t.profile.signOut}</ThemedText><Chevron />
            </Pressable>
            {divider}
            <Pressable analyticsId="app_profile_settings.sign-out-all" onPress={() => ask('signOutAll')} accessibilityRole="button" style={pressedRow}>
              <ThemedText type="smallBold" style={styles.navCopy}>{t.profile.signOutAll}</ThemedText><Chevron />
            </Pressable>
            {divider}
            <Pressable analyticsId="app_profile_settings.pressable.8" onPress={() => ask('delete')} disabled={deleting} accessibilityRole="button" accessibilityState={{ disabled: deleting, busy: deleting }} style={({ pressed }) => [styles.navRow, { opacity: deleting ? 0.55 : 1 }, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={[styles.navCopy, { color: theme.danger }]}>{deleting ? t.profile.deleting : t.profile.deleteAccount}</ThemedText><Chevron />
            </Pressable>
          </Card>

          <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
            {tr("글링") + " "}{Constants.expoConfig?.version ?? '1.0.0'}
          </ThemedText>
        </ScrollView>
        <ConfirmSheet visible={confirmOpen} onClose={closeConfirm} title={sheet.title} body={sheet.body}
          confirmId={sheet.id} confirmLabel={sheet.label} onConfirm={sheet.run} cancelLabel={t.profile.cancel}
          busy={confirmBusy || deleting} error={confirmError}>
          {confirm === 'delete' && <FlatPressable testID="settings.delete.manage-subscription" accessibilityRole="button" onPress={() => { play('selection'); void manage(); }} style={styles.link}>
            <ThemedText type="smallBold" themeColor="accent">{tr("구독 관리")}</ThemedText>
          </FlatPressable>}
        </ConfirmSheet>
      </SafeAreaView>
    </ThemedView></KeyboardScreen>
  );
}

// 공식 SNS 사진 소개 (owner 2026-11-04 G4). 처음 값은 꺼짐이고 새 글 동의 칸의 처음 값이 된다. 끄면 서버가 전에 한 동의도
// 모두 거둔다. 꺼 둔 채 글마다 체크한 사람은 스위치가 이미 꺼져 있으니, 그 글이 남아 있으면 취소 줄을 따로 보여 준다.
function PhotoConsentCard() {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback(), { me } = useAuth();
  const [state, setState] = useState<{ user: string; value?: PhotoConsentSettings | null; busy: boolean; error: string }>();
  const current = state?.user === me.id ? state : undefined;
  useEffect(() => {
    let active = true;
    void loadPhotoConsentSettings(supabase).then(value => { if (active) setState({ user: me.id, value, busy: false, error: '' }); })
      .catch(() => { if (active) setState({ user: me.id, busy: false, error: tr('설정을 불러오지 못했어요. 잠시 후 다시 열어 주세요.') }); });
    return () => { active = false; };
  }, [me.id, tr]);
  if (current?.value === null) return null; // 구서버: 동의 칸이 없다
  const value = current?.value, busy = !!current?.busy, disabled = !value || busy;
  const label = tr('공식 SNS 소개 미리 체크하기');
  const change = async (on: boolean) => {
    if (!current || !value || busy) return;
    play('selection'); setState({ ...current, value: { ...value, on }, busy: true, error: '' });
    try { setState({ user: me.id, value: await setPhotoConsentDefault(supabase, on), busy: false, error: '' }); play('success'); }
    catch { setState({ user: me.id, value, busy: false, error: tr('바꾸지 못했어요. 다시 시도해 주세요.') }); play('warning'); }
  };
  return <>
    <Card>
      <View style={styles.row}>
        <View style={styles.navCopy}>
          <ThemedText type="smallBold">{label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('사진을 붙인 새 글에 ‘이 사진을 글링 공식 SNS에 소개해도 돼요’가 미리 체크돼요. 끄면 지금까지 해 둔 체크가 모두 풀려요. 다시 켜도 돌아오지 않아요.')}</ThemedText>
        </View>
        <Switch analyticsId="profile.settings.photo-consent" value={value?.on ?? false} disabled={disabled} onValueChange={on => void change(on)}
          accessibilityLabel={label} accessibilityState={{ disabled, busy }} />
      </View>
      {value && !value.on && value.consentedPosts > 0 && <>
        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <Pressable analyticsId="profile.settings.photo-consent.withdraw" accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled, busy }}
          onPress={() => void change(false)} style={({ pressed }) => [styles.navRow, { opacity: busy ? 0.55 : 1 }, pressed && { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" style={[styles.navCopy, { color: theme.danger }]}>{tr('SNS 소개를 허락한 글 {0}개 모두 취소하기', value.consentedPosts)}</ThemedText>
        </Pressable>
      </>}
    </Card>
    {!!current?.error && <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>{current.error}</ThemedText>}
  </>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: TabBarHeight + Spacing.four, gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.three, marginLeft: Spacing.one },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  clayRows: { borderRadius: 16, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, padding: Spacing.three },
  navRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  navCopy: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  version: { textAlign: 'center', marginTop: Spacing.three },
  inset: { marginLeft: Spacing.one },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
