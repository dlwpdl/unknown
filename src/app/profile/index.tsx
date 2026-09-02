import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { PostCard } from '@/components/post-card';
import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadProfileSummary, loadSavedPosts, type ProfileSummary } from '@/lib/community-data';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAuthed, signInApple, signInKakao, signInDev, isAuthLoading, authError, trustLevel, me, setProfilePhoto } = useAuth();
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedDetail, setSavedDetail] = useState<Post | null>(null);
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState(false);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void loadProfileSummary(supabase, me.id)
      .then((next) => active && setSummary(next))
      .catch(() => active && setSummary(null));
    return () => { active = false; };
  }, [isAuthed, me.id]);

  const refreshSaved = useCallback(async () => {
    if (!isAuthed) return;
    setSavedLoading(true);
    setSavedError(false);
    try {
      setSavedPosts(await loadSavedPosts(supabase));
    } catch {
      setSavedError(true);
    } finally {
      setSavedLoading(false);
    }
  }, [isAuthed]);

  // 내 프로필은 L0 로그인
  if (!isAuthed)
    return (
      <LoginPanel
        reason={t.auth.reasonProfile}
        onApple={signInApple}
        onKakao={signInKakao}
        onDevLogin={signInDev}
        loading={isAuthLoading}
        error={authError}
      />
    );

  const cityName = CITIES.find(({ id }) => id === summary?.cityId)?.name ?? summary?.cityId ?? '';

  const pickProfilePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset?.uri && asset.base64) await setProfilePhoto(asset.uri, asset.base64);
    } catch {
      Alert.alert(t.profile.photoErrorTitle, t.profile.photoErrorBody);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.hero}>
          <Pressable
            onPress={pickProfilePhoto}
            accessibilityRole="button"
            accessibilityLabel={t.profile.changePhoto}
            style={styles.photoButton}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              {me.photoUri ? (
                <Image source={{ uri: me.photoUri }} style={styles.avatarImage} contentFit="cover" transition={120} />
              ) : (
                <ThemedText type="subtitle" style={{ color: theme.navy }}>
                  {me.nickname[0]}
                </ThemedText>
              )}
            </View>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {t.profile.changePhoto}
            </ThemedText>
          </Pressable>
          <View style={styles.nickRow}>
            <ThemedText type="subtitle" style={styles.nick}>
              {me.nickname}
            </ThemedText>
            <TrustBadge trustLevel={trustLevel === 1 ? undefined : trustLevel} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t.profile.location(cityName, summary?.neighborhood)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
            {t.profile.stats(summary?.posts ?? 0, summary?.likes ?? 0, summary?.meetups ?? 0)}
          </ThemedText>
        </View>

        <View style={[styles.menu, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <Pressable style={styles.menuRow} accessibilityRole="button" onPress={() => router.push('/notifications')}>
            <ThemedText type="small">{t.notifications.title}</ThemedText>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <Pressable
            style={styles.menuRow}
            accessibilityRole="button"
            onPress={() => {
              setSavedOpen(true);
              void refreshSaved();
            }}>
            <ThemedText type="small">{t.profile.saved}</ThemedText>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <Pressable
            style={styles.menuRow}
            accessibilityRole="button"
            onPress={() => router.push('/profile/guidelines')}>
            <ThemedText type="small">{t.profile.guidelines}</ThemedText>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <Pressable
            style={styles.menuRow}
            accessibilityRole="button"
            onPress={() => router.push('/profile/settings')}>
            <ThemedText type="small">{t.profile.settings}</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal
        visible={savedOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSavedOpen(false)}>
        <ThemedView style={{ flex: 1 }}>
          <View style={[styles.sheetHead, { borderBottomColor: theme.line }]}>
            <ThemedText type="smallBold">{t.profile.saved}</ThemedText>
            <Pressable onPress={() => setSavedOpen(false)} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {t.detail.close}
              </ThemedText>
            </Pressable>
          </View>
          <FlatList
            data={savedPosts}
            keyExtractor={(p) => p.id}
            contentContainerStyle={styles.savedList}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.two + 2 }} />}
            ListEmptyComponent={
              savedLoading ? (
                <ActivityIndicator color={theme.accent} accessibilityLabel={t.profile.savedLoading} />
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.savedEmpty}>
                  {savedError ? t.profile.savedError : t.profile.savedEmpty}
                </ThemedText>
              )
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => setSavedDetail(item)} accessibilityRole="button">
                <PostCard post={item} />
              </Pressable>
            )}
          />
          <Modal
            visible={!!savedDetail}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setSavedDetail(null)}>
            {savedDetail && <PostDetail post={savedDetail} onClose={() => setSavedDetail(null)} />}
          </Modal>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three, paddingBottom: TabBarHeight },
  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five },
  photoButton: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  avatar: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nick: { fontSize: 24, lineHeight: 32, fontWeight: 700 },
  menu: { borderWidth: 1, borderRadius: 12 },
  menuRow: { paddingHorizontal: Spacing.three, paddingVertical: 14 },
  divider: { height: 1, marginHorizontal: Spacing.three },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 14, borderBottomWidth: 1 },
  savedList: { padding: Spacing.three },
  savedEmpty: { textAlign: 'center', paddingTop: Spacing.five },
});
