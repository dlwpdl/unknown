import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { CITIES } from '@/lib/mock';
import { generateNickname } from '@/lib/nickname';
import { supabase } from '@/lib/supabase';

export type CompletedProfile = {
  id: string;
  nickname: string;
  city_id: string;
  avatar_path: string | null;
  photoUri: string | null;
};

export function ProfileOnboarding({
  visible,
  userId,
  socialNickname,
  socialPhoto,
  reactivating = false,
  onComplete,
}: {
  visible: boolean;
  userId: string;
  socialNickname?: string;
  socialPhoto: string | null;
  reactivating?: boolean;
  onComplete: (profile: CompletedProfile) => void;
}) {
  const theme = useTheme();
  const initialNickname = normalizedNickname(socialNickname) ?? generateNickname('ko');
  const [nickname, setNickname] = useState(initialNickname);
  const [cityId, setCityId] = useState('vancouver');
  const [photoUri, setPhotoUri] = useState<string | null>(socialPhoto);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const cleanNickname = nickname.trim();
    if (cleanNickname.length < 2 || cleanNickname.length > 20) {
      setError(t.onboarding.errorNickname);
      return;
    }

    setSaving(true);
    setError(null);
    let avatarPath: string | null = null;
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

      const created = reactivating
        ? await supabase.rpc('reactivate_profile', { p_nickname: cleanNickname, p_city_id: cityId })
        : await supabase.from('profiles').insert({
            id: userId,
            nickname: cleanNickname,
            city_id: cityId,
            avatar_path: avatarPath,
          });
      if (created.error) {
        setError(created.error.code === '23505' ? t.onboarding.errorDuplicate : t.onboarding.errorGeneric);
        return;
      }
      if (reactivating && avatarPath) {
        const avatar = await supabase.from('profiles').update({ avatar_path: avatarPath }).eq('id', userId);
        if (avatar.error) throw avatar.error;
      }
      onComplete({ id: userId, nickname: cleanNickname, city_id: cityId, avatar_path: avatarPath, photoUri });
    } catch {
      setError(t.onboarding.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => {}}>
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.onboarding.step}</ThemedText>
            <View style={styles.copy}>
              <ThemedText type="title" style={styles.title}>{t.onboarding.title}</ThemedText>
              <ThemedText themeColor="textSecondary">{t.onboarding.body}</ThemedText>
            </View>

            <View style={styles.photoSection}>
              <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
                ) : (
                  <ThemedText type="subtitle" style={{ color: theme.navy }}>{nickname.trim()[0] ?? '글'}</ThemedText>
                )}
              </View>
              <View style={styles.photoActions}>
                <Pressable onPress={() => void pickPhoto()} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.line }]}>
                  <ThemedText type="smallBold">{t.onboarding.choosePhoto}</ThemedText>
                </Pressable>
                {(socialNickname || socialPhoto) && (
                  <Pressable onPress={useSocialProfile} accessibilityRole="button" style={[styles.smallButton, { borderColor: theme.line }]}>
                    <ThemedText type="smallBold">{t.onboarding.useSocial}</ThemedText>
                  </Pressable>
                )}
                <Pressable onPress={() => { setPhotoUri(null); setPhotoBase64(null); }} accessibilityRole="button">
                  <ThemedText type="small" themeColor="textSecondary">{t.onboarding.removePhoto}</ThemedText>
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
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
                <Pressable onPress={() => setNickname(generateNickname('ko'))} accessibilityRole="button" style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{t.onboarding.koreanRandom}</ThemedText>
                </Pressable>
                <Pressable onPress={() => setNickname(generateNickname('en'))} accessibilityRole="button" style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{t.onboarding.englishRandom}</ThemedText>
                </Pressable>
              </View>
            </View>

            <View style={styles.field}>
              <ThemedText type="smallBold">{t.onboarding.city}</ThemedText>
              <View style={styles.cityRow}>
                {CITIES.filter(({ state }) => state === 'open').map((city) => {
                  const selected = city.id === cityId;
                  return (
                    <Pressable
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
            </View>

            {!!error && <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.accent }}>{error}</ThemedText>}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.line, backgroundColor: theme.background }]}>
            <Pressable
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              style={[styles.submit, { backgroundColor: theme.accent, opacity: saving ? 0.65 : 1 }]}>
              {saving && <ActivityIndicator color={theme.accentInk} />}
              <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                {saving ? t.onboarding.saving : t.onboarding.submit}
              </ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
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
  footer: { padding: Spacing.three, borderTopWidth: 1 },
  submit: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderRadius: 10 },
});
