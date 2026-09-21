import { behavior, flushBehavior } from '@/lib/behavior-analytics';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PersonalInfoFields, type PersonalInfoDraft } from '@/components/personal-info-fields';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { CITIES } from '@/lib/mock';
import { generateNickname } from '@/lib/nickname';
import { PERSONAL_INFO_NOTICE, PERSONAL_INFO_VERSION, validatePersonalInfo } from '@/lib/personal-info';
import { supabase } from '@/lib/supabase';

export type CompletedProfile = {
  id: string;
  nickname: string;
  city_id: string;
  avatar_path: string | null;
  photoUri: string | null;
  ai_safety_consent_at: string;
};

type ExistingProfile = Pick<CompletedProfile, 'nickname' | 'city_id' | 'avatar_path' | 'photoUri'>;

const CONSENT_VERSION = '2026-09-02';

export function ProfileOnboarding({
  visible,
  userId,
  socialNickname,
  socialPhoto,
  existingProfile,
  onComplete,
}: {
  visible: boolean;
  userId: string;
  socialNickname?: string;
  socialPhoto: string | null;
  existingProfile?: ExistingProfile | null;
  onComplete: (profile: CompletedProfile) => void;
}) {
  const theme = useTheme();
  const initialNickname = existingProfile?.nickname ?? normalizedNickname(socialNickname) ?? generateNickname('ko');
  const [nickname, setNickname] = useState(initialNickname);
  const [cityId, setCityId] = useState(existingProfile?.city_id ?? 'vancouver');
  const [photoUri, setPhotoUri] = useState<string | null>(existingProfile?.photoUri ?? socialPhoto);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [aiAccepted, setAiAccepted] = useState(false);
  const [expandedConsent, setExpandedConsent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personalInfo, setPersonalInfo] = useState<PersonalInfoDraft>({ fullName: '', dateOfBirth: '', accepted: false });
  const active = useRef(true);
  const savingLock = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const consentOnly = existingProfile != null;
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');
  const requiredAccepted = termsAccepted && privacyAccepted && aiAccepted;
  const allAccepted = requiredAccepted && (consentOnly || personalInfo.accepted);
  const someAccepted = termsAccepted || privacyAccepted || aiAccepted || (!consentOnly && personalInfo.accepted);
  const allChecked = allAccepted ? true : someAccepted ? 'mixed' : false;
  const toggleAll = () => {
    if (saving) return;
    const checked = !allAccepted;
    setTermsAccepted(checked);
    setPrivacyAccepted(checked);
    setAiAccepted(checked);
    if (!consentOnly) setPersonalInfo((current) => ({ ...current, accepted: checked }));
    setError(null);
  };
  const consentItems = [
    { id: 'terms', label: '[필수] 이용약관', checked: termsAccepted, change: setTermsAccepted, url: `${publicSiteUrl}/terms` },
    { id: 'privacy', label: '[필수] 개인정보 수집·이용', checked: privacyAccepted, change: setPrivacyAccepted, url: `${publicSiteUrl}/privacy` },
    { id: 'ai', label: '[필수] 외부 AI(OpenAI) 안전 처리', checked: aiAccepted, change: setAiAccepted,
      details: `${t.onboarding.consentLabel} 모든 게시글·댓글·대화가 안전 분석 대상이며, 권한 있는 관리자가 안전 운영을 위해 확인할 수 있습니다.` },
    ...(!consentOnly ? [{ id: 'personal', label: '[선택] 이름·생년월일 수집·이용', checked: personalInfo.accepted,
      change: (checked: boolean) => setPersonalInfo((current) => ({ ...current, accepted: checked })),
      details: PERSONAL_INFO_NOTICE }] : []),
  ];

  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri || !asset.base64) throw new Error('PHOTO_NOT_AVAILABLE');
      setPhotoUri(asset.uri);
      setPhotoBase64(asset.base64);
      setError(null);
    } catch {
      setError(t.onboarding.photoError);
    }
  };

  const useSocialProfile = () => {
    setNickname(normalizedNickname(socialNickname) ?? nickname);
    setPhotoUri(socialPhoto);
    setPhotoBase64(null);
    setError(null);
  };

  const save = async () => {
    if (savingLock.current) return;
    const cleanNickname = nickname.trim();
    if (!requiredAccepted) {
      setError(t.onboarding.errorConsent);
      return;
    }
    if (cleanNickname.length < 2 || cleanNickname.length > 20) {
      setError(t.onboarding.errorNickname);
      return;
    }
    const fullName = !consentOnly && personalInfo.accepted ? personalInfo.fullName.trim() : '';
    const dateOfBirth = !consentOnly && personalInfo.accepted ? personalInfo.dateOfBirth.trim() : '';
    const personalInfoError = consentOnly ? null : validatePersonalInfo(fullName, dateOfBirth);
    if (personalInfoError) { setError(personalInfoError); return; }

    savingLock.current = true;
    setSaving(true);
    setError(null);
    let avatarPath: string | null = existingProfile?.avatar_path ?? null;
    try {
      if (photoBase64) {
        avatarPath = `${userId}/avatar.jpg`;
        const upload = await supabase.storage.from('avatars').upload(
          avatarPath,
          decodeBase64(photoBase64),
          { contentType: 'image/jpeg', upsert: true },
        );
        if (upload.error) throw upload.error;
      }

      if (!active.current) return;
      const created = await supabase.rpc(consentOnly ? 'create_profile_with_consent' : 'create_profile_with_personal_info', {
        p_nickname: cleanNickname,
        p_city_id: cityId,
        p_avatar_path: avatarPath,
        p_version: CONSENT_VERSION,
        ...(!consentOnly ? {
          p_full_name: fullName || null,
          p_date_of_birth: dateOfBirth || null,
          p_personal_info_version: fullName ? PERSONAL_INFO_VERSION : null,
          p_user_id: userId,
        } : {}),
      });
      if (!active.current) return;
      if (created.error) {
        setError(created.error.code === '23505' ? t.onboarding.errorDuplicate : t.onboarding.errorGeneric);
        return;
      }
      behavior('success', consentOnly ? 'consent_complete' : 'signup_complete');
      void flushBehavior();
      onComplete({
        id: userId,
        nickname: cleanNickname,
        city_id: cityId,
        avatar_path: avatarPath,
        photoUri,
        ai_safety_consent_at: new Date().toISOString(),
      });
    } catch {
      if (active.current) setError(t.onboarding.errorGeneric);
    } finally {
      savingLock.current = false;
      if (active.current) setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => {}}>
      <SafeAreaProvider style={[styles.screen, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView analyticsId="components_profile-onboarding.scrollview.1" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.onboarding.step}</ThemedText>
            <View style={styles.copy}>
              <ThemedText type="title" style={styles.title}>{consentOnly ? t.onboarding.consentTitle : t.onboarding.title}</ThemedText>
              <ThemedText themeColor="textSecondary">{consentOnly ? t.onboarding.consentBody : t.onboarding.body}</ThemedText>
            </View>

            {!consentOnly && <View style={styles.photoSection}>
              <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
                ) : (
                  <ThemedText type="subtitle" style={{ color: theme.navy }}>{nickname.trim()[0] ?? '글'}</ThemedText>
                )}
              </View>
              <View style={styles.photoActions}>
                <Pressable analyticsId="components_profile-onboarding.pressable.1" onPress={() => void pickPhoto()} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.line }]}>
                  <ThemedText type="smallBold">{t.onboarding.choosePhoto}</ThemedText>
                </Pressable>
                {(socialNickname || socialPhoto) && (
                  <Pressable analyticsId="components_profile-onboarding.pressable.2" onPress={useSocialProfile} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.line }]}>
                    <ThemedText type="smallBold">{t.onboarding.useSocial}</ThemedText>
                  </Pressable>
                )}
                <Pressable analyticsId="components_profile-onboarding.pressable.3" onPress={() => { setPhotoUri(null); setPhotoBase64(null); }} accessibilityRole="button">
                  <ThemedText type="small" themeColor="textSecondary">{t.onboarding.removePhoto}</ThemedText>
                </Pressable>
              </View>
            </View>}

            {!consentOnly && <View style={styles.field}>
              <ThemedText type="smallBold">{t.onboarding.nickname}</ThemedText>
              <TextInput
                value={nickname}
                onChangeText={setNickname}
                maxLength={20}
                autoCapitalize="none"
                placeholder={t.onboarding.nicknamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                style={[styles.nicknameInput, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]}
              />
              <View style={styles.randomActions}>
                <Pressable analyticsId="components_profile-onboarding.pressable.4" onPress={() => setNickname(generateNickname('ko'))} accessibilityRole="button" style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{t.onboarding.koreanRandom}</ThemedText>
                </Pressable>
                <Pressable analyticsId="components_profile-onboarding.pressable.5" onPress={() => setNickname(generateNickname('en'))} accessibilityRole="button" style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{t.onboarding.englishRandom}</ThemedText>
                </Pressable>
              </View>
            </View>}

            {!consentOnly && <View style={styles.field}>
              <ThemedText type="smallBold">{t.onboarding.city}</ThemedText>
              <View style={styles.cityRow}>
                {CITIES.filter(({ state }) => state === 'open').map((city) => {
                  const selected = city.id === cityId;
                  return (
                    <Pressable analyticsId="components_profile-onboarding.pressable.6"
                      key={city.id}
                      onPress={() => setCityId(city.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.cityButton, { backgroundColor: selected ? theme.accent : theme.backgroundElement }]}>
                      <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.text }}>{city.name}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>}

            {!consentOnly && <PersonalInfoFields showConsent={false} value={personalInfo} disabled={saving} onChange={(value) => { setPersonalInfo(value); setError(null); }} />}

            <View style={[styles.consents, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <Pressable analyticsId="components_profile-onboarding.pressable.7" onPress={toggleAll} disabled={saving} accessibilityRole="checkbox"
                accessibilityLabel={consentOnly ? '모두 동의' : '모두 동의, 선택 항목 포함'} aria-checked={allChecked}
                accessibilityState={{ checked: allChecked, disabled: saving }}
                {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault: () => void }) => { if (event.key === ' ') { event.preventDefault(); toggleAll(); } } } : {})}
                style={[styles.consent, styles.allConsent, { borderBottomColor: theme.line }]}>
                <View aria-hidden accessibilityElementsHidden style={[styles.checkbox, { backgroundColor: someAccepted ? theme.accent : 'transparent', borderColor: someAccepted ? theme.accent : theme.line }]}>
                  {someAccepted && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{allAccepted ? '✓' : '−'}</ThemedText>}
                </View>
                <ThemedText type="smallBold" style={styles.consentText}>모두 동의{!consentOnly && <ThemedText type="small" themeColor="textSecondary"> (선택 포함)</ThemedText>}</ThemedText>
              </Pressable>
              {consentItems.map((item) => {
                const toggle = () => { if (!saving) { item.change(!item.checked); setError(null); } };
                const expanded = expandedConsent === item.id;
                return <View key={item.id}>
                  <View style={styles.consentRow}>
                    <Pressable analyticsId="components_profile-onboarding.pressable.8" onPress={toggle} disabled={saving} accessibilityRole="checkbox" accessibilityLabel={item.label}
                      aria-checked={item.checked} accessibilityState={{ checked: item.checked, disabled: saving }}
                      {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; preventDefault: () => void }) => { if (event.key === ' ') { event.preventDefault(); toggle(); } } } : {})}
                      style={styles.consent}>
                      <View aria-hidden accessibilityElementsHidden style={[styles.checkbox, { backgroundColor: item.checked ? theme.accent : 'transparent', borderColor: item.checked ? theme.accent : theme.line }]}>
                        {item.checked && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}
                      </View>
                      <ThemedText type="small" style={styles.consentText}>{item.label}</ThemedText>
                    </Pressable>
                    {'url' in item ? <Pressable analyticsId="components_profile-onboarding.pressable.9" accessibilityRole="link" accessibilityLabel={`${item.label} 자세히 보기`}
                      onPress={() => { if (item.url) void Linking.openURL(item.url); }} style={styles.detailButton}>
                      <ThemedText type="small" themeColor="textSecondary">보기 ↗</ThemedText>
                    </Pressable> : <Pressable analyticsId="components_profile-onboarding.pressable.10" accessibilityRole="button" accessibilityLabel={`${item.label} 자세히 ${expanded ? '접기' : '보기'}`}
                      accessibilityState={{ expanded }} aria-expanded={expanded}
                      onPress={() => setExpandedConsent(expanded ? null : item.id)} style={styles.detailButton}>
                      <ThemedText type="small" themeColor="textSecondary">{expanded ? '접기 ∧' : '보기 ∨'}</ThemedText>
                    </Pressable>}
                  </View>
                  {'details' in item && expanded && <ThemedText type="small" themeColor="textSecondary" style={styles.consentDetails}>{item.details}</ThemedText>}
                </View>;
              })}
            </View>
            <ThemedText type="small" themeColor="textSecondary">{consentOnly ? '필수 항목에 동의하면 계속 이용할 수 있어요.' : '필수 항목에 동의하면 가입할 수 있어요. 이름·생년월일 입력과 동의는 선택이에요.'}</ThemedText>

            {!!error && <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.accent }}>{error}</ThemedText>}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.line, backgroundColor: theme.background }]}>
            <Pressable analyticsId="components_profile-onboarding.pressable.11"
              onPress={() => void save()}
              disabled={saving || !requiredAccepted}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving || !requiredAccepted, busy: saving }}
              style={[styles.submit, { backgroundColor: theme.accent, opacity: saving || !requiredAccepted ? 0.5 : 1 }]}>
              {saving && <ActivityIndicator color={theme.accentInk} />}
              <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                {saving ? t.onboarding.saving : consentOnly ? t.onboarding.consentSubmit : t.onboarding.submit}
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function normalizedNickname(value?: string) {
  const nickname = value?.trim();
  return nickname && nickname.length >= 2 ? nickname.slice(0, 20) : null;
}

function decodeBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.five },
  copy: { gap: Spacing.two },
  title: { fontSize: 32, lineHeight: 39, fontWeight: 700 },
  photoSection: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  photoActions: { flex: 1, alignItems: 'flex-start', gap: Spacing.two },
  smallButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  field: { gap: Spacing.two },
  nicknameInput: { minHeight: 60, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 10, fontSize: 22, fontWeight: 700 },
  randomActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { minHeight: 40, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: 999 },
  cityRow: { flexDirection: 'row', gap: Spacing.two },
  cityButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.four, borderRadius: 8 },
  consents: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three },
  consentRow: { flexDirection: 'row', alignItems: 'center' },
  consent: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  allConsent: { flex: 0, minHeight: 56, borderBottomWidth: 1, marginBottom: Spacing.one },
  detailButton: { minWidth: 48, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
  consentDetails: { paddingBottom: Spacing.three, lineHeight: 20 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  consentText: { flex: 1 },
  footer: { padding: Spacing.three, borderTopWidth: 1 },
  submit: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderRadius: 10 },
});
