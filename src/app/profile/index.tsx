import { useLanguage } from '@/hooks/use-language';
import { MerchantAccountEntry } from '@/components/merchant-account-connections';
import { ChatIdentitySwitcher } from '@/components/chat-identity-switcher';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Animated, Easing, LayoutAnimation, Platform, Share, StyleSheet, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { CITIES, TAGS } from '@/lib/mock';
import { useMembership } from '@/lib/membership-provider';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { loadMyPosts, loadProfileSummary, loadRepliesToMe, type MyPostRow, type ProfileSummary, type ReplyToMe } from '@/lib/community-data';
import { relativeTime } from '@/lib/feed-data';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const { tr, t, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { isAuthed, signInApple, signInKakao, signInGoogle, signInDev, isAuthLoading, authError, trustLevel, me, setProfilePhoto, signOut } = useAuth();
  const { membership } = useMembership();
  const unread = useUnreadCount('other');
  const { play } = useInteractionFeedback();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [segment, setSegment] = useState<'story' | 'replies' | 'listing'>('story');
  const [myPosts, setMyPosts] = useState<Record<'story' | 'listing', MyPostRow[]>>({ story: [], listing: [] });
  const [replies, setReplies] = useState<ReplyToMe[]>([]);
  const [loadedSegment, setLoadedSegment] = useState<'story' | 'replies' | 'listing' | null>(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const [segmentPosition] = useState(() => new Animated.Value(0));
  const activeSegmentIndex = segment === 'story' ? 0 : segment === 'replies' ? 1 : 2;
  const segmentLoading = loadedSegment !== segment;

  useEffect(() => {
    if (reducedMotion) { segmentPosition.setValue(activeSegmentIndex); return; }
    const animation = Animated.timing(segmentPosition, { toValue: activeSegmentIndex, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [activeSegmentIndex, reducedMotion, segmentPosition]);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void loadProfileSummary(supabase, me.id)
      .then((next) => active && setSummary(next))
      .catch(() => active && setSummary(null));
    return () => { active = false; };
  }, [isAuthed, me.id, me.cityId]);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    const request = segment === 'replies'
      ? loadRepliesToMe(supabase, me.id).then((rows) => { if (active) setReplies(rows); })
      : loadMyPosts(supabase, me.id, segment).then((rows) => { if (active) setMyPosts((current) => ({ ...current, [segment]: rows })); });
    void request.catch(() => {}).finally(() => {
      if (!active) return;
      if (!reducedMotion) {
        if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setLoadedSegment(segment);
    });
    return () => { active = false; };
  }, [isAuthed, me.id, reducedMotion, segment]);

  // 내 프로필은 L0 로그인
  if (!isAuthed)
    return (
      <>
      <Stack.Screen options={{ headerShown: false, headerRight: () => null }} />
      <LoginPanel
        reason={t.auth.reasonProfile}
        onApple={signInApple}
        onKakao={signInKakao} onGoogle={signInGoogle}
        onDevLogin={signInDev}
        loading={isAuthLoading}
        error={authError}
        onClose={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }}
      />
      </>
    );

  const cityName = CITIES.find(({ id }) => id === summary?.cityId)?.name ?? summary?.cityId ?? '';
  const membershipLabel = membership ? tr(({ free: '베이직', plus: '플러스', pro: '프로', premium: '프리미엄', admin: '관리자' } as const)[membership.tier]) : null;
  const unreadLabel = unread > 0 ? tr('새 소식 {0}', unread) : tr('새 소식 없음');

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
      if (!result.canceled && asset?.uri && asset.base64) { await setProfilePhoto(asset.uri, asset.base64); play('success'); }
    } catch {
      play('warning');
      Alert.alert(t.profile.photoErrorTitle, t.profile.photoErrorBody);
    }
  };

  const shareAppInvite = async () => {
    play('selection');
    const url = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/+$/, '');
    const message = tr('글링에서 동네 이야기와 모임을 함께 나눠요.');
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) await navigator.share({ title: tr('글링에 초대해요'), text: message, url });
        else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          window.alert(tr('초대 링크를 복사했어요.'));
        } else window.prompt(tr('초대 링크를 복사하세요'), url);
        return;
      }
      await Share.share({ title: tr('글링에 초대해요'), message: `${message}\n${url}`, url });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      play('warning');
      if (Platform.OS === 'web') window.alert(tr('초대 링크를 공유하지 못했어요. 다시 시도해 주세요.'));
      else Alert.alert(tr("공유할 수 없어요"), tr("잠시 후 다시 시도해 주세요."));
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: tr('내 프로필'), headerRight: () => (
        <View style={styles.headerActions}>
          <ChatIdentitySwitcher target="business" />
          <Pressable analyticsId="app_profile_index.invite" accessibilityRole="button" accessibilityLabel={tr('친구 초대하기')} accessibilityHint={tr('글링 초대 링크를 다른 앱으로 공유합니다')}
            onPress={() => { void shareAppInvite(); }} style={styles.headerButton}>
            <SymbolView name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }} size={22} tintColor={theme.text} />
          </Pressable>
          <Pressable analyticsId="app_profile_index.pressable.8" accessibilityRole="button" accessibilityLabel={t.profile.settings}
            onPress={() => { play('selection'); router.push('/profile/settings'); }} style={styles.headerButton}>
            <SymbolView name={{ ios: 'gearshape', android: 'settings', web: 'settings' }} size={22} tintColor={theme.text} />
          </Pressable>
        </View>
      ) }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView analyticsId="app_profile_index.scroll" contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.hero}>
          <Pressable analyticsId="app_profile_index.pressable.1"
            onPress={() => { play('selection'); void pickProfilePhoto(); }}
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
            <View pointerEvents="none" style={[styles.photoBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
              <SymbolView name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }} size={14} tintColor={theme.accentInk} />
            </View>
          </Pressable>
          <View style={styles.nickRow}>
            <ThemedText type="subtitle" style={styles.nick}>
              {me.nickname}
            </ThemedText>
            <TrustBadge trustLevel={trustLevel === 1 ? undefined : trustLevel} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t.profile.location(tr(cityName), summary?.neighborhood)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
            {t.profile.stats(summary?.posts ?? 0, summary?.likes ?? 0, summary?.meetups ?? 0)}
          </ThemedText>
        </View>

        <View style={[styles.manage, { backgroundColor: theme.backgroundElement }]}>
          {([
            [tr("멤버십"), membershipLabel, { ios: 'star.circle', android: 'stars', web: 'stars' }, false, () => router.push('/profile/membership')],
            [tr("인증 Lv{0}", (trustLevel)), trustLevel === 1 ? t.trust.short(trustLevel) : tr("등록된 단계"), { ios: 'checkmark.seal', android: 'verified', web: 'verified' }, false, () => router.push('/profile/trust')],
            [t.notifications.title, unreadLabel, { ios: 'bell', android: 'notifications', web: 'notifications' }, unread > 0, () => router.navigate('/notifications')],
            [t.profile.saved, tr("모아보기"), { ios: 'bookmark', android: 'bookmark', web: 'bookmark' }, false, () => router.push('/profile/saved')],
          ] as const).map(([label, sub, symbol, attention, onPress]) => (
            <Pressable analyticsId="app_profile_index.pressable.2" key={label} onPress={() => { play('selection'); onPress(); }} accessibilityRole="button" accessibilityLabel={`${label}, ${sub ?? ''}`}
              style={({ pressed }) => [styles.manageCell, {
                backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }], // 눌린 순간 바로 반응, 놓으면 실행
              }]}>
              <View style={styles.manageIcon}>
                <SymbolView name={symbol} size={22} weight="medium" tintColor={attention ? theme.accent : theme.navy} />
                {attention && <View style={[styles.manageDot, { backgroundColor: theme.accent, borderColor: theme.backgroundElement }]} />}
              </View>
              <ThemedText type="smallBold" style={styles.manageLabel}>{label}</ThemedText>
              <ThemedText type="small" themeColor={attention ? undefined : 'textSecondary'} style={[styles.manageSub, attention && { color: theme.accent }]}>{sub}</ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={[styles.accountMenu, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <Pressable analyticsId="profile.meetup-profile" accessibilityRole="button" accessibilityLabel={tr('모임 프로필 관리')}
            onPress={() => { play('selection'); router.push('/meetup-profile'); }}
            style={({ pressed }) => [styles.accountRow, { backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
            <View style={[styles.accountIcon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'person.crop.rectangle', android: 'badge', web: 'badge' }} size={22} tintColor={theme.navy} /></View>
            <View style={styles.accountText}><ThemedText type="smallBold">{tr('모임 프로필 관리')}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('모임 사진·소개·공개 범위를 따로 설정해요')}</ThemedText></View>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
          </Pressable>
          <Pressable analyticsId="profile.meetup-reviews" accessibilityRole="button" accessibilityLabel={tr('모임 후기와 내 매너 평가 관리')}
            onPress={() => { play('selection'); router.push('/profile/meetup-reviews'); }}
            style={({ pressed }) => [styles.accountRow, { backgroundColor: pressed ? theme.backgroundSelected : theme.card }]}>
            <View style={[styles.accountIcon, { backgroundColor: theme.backgroundElement }]}>
              <SymbolView name={{ ios: 'person.2', android: 'group', web: 'group' }} size={22} tintColor={theme.navy} />
            </View>
            <View style={styles.accountText}>
              <ThemedText type="smallBold">{tr('모임 후기 · 매너 평가')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{tr('내 후기와 매너 평가 관리')}</ThemedText>
            </View>
            <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
          </Pressable>
          <MerchantAccountEntry />
        </View>
        <View accessibilityRole="tablist" onLayout={event => setSegmentWidth(event.nativeEvent.layout.width)} style={[styles.segments, { borderBottomColor: theme.line }]}>
          {segmentWidth > 0 && <Animated.View pointerEvents="none" style={[styles.segmentIndicator, Depth.control, { width: segmentWidth / 3, backgroundColor: theme.backgroundElement, borderBottomColor: theme.accent, transform: [{ translateX: segmentPosition.interpolate({ inputRange: [0, 2], outputRange: [0, segmentWidth * 2 / 3] }) }] }]} />}
          {([['story', tr("내 글")], ['replies', tr("답글")], ['listing', tr("구해요·팔아요")]] as const).map(([key, label]) => (
            <Pressable analyticsId="app_profile_index.pressable.3" key={key} onPress={() => { play('selection'); if (key !== segment) setSegment(key); }} accessibilityRole="tab" accessibilityState={{ selected: segment === key }}
              style={({ pressed }) => [styles.segment, { opacity: pressed ? 0.65 : 1, }]}>
              <ThemedText type={segment === key ? 'smallBold' : 'small'} themeColor={segment === key ? undefined : 'textSecondary'}>{label}</ThemedText>
            </Pressable>
          ))}
        </View>
        {segmentLoading && <GlingLoader color={theme.accent} style={{ marginVertical: Spacing.three }} accessibilityLabel={tr("불러오는 중")} />}
        {!segmentLoading && <Reanimated.View key={segment} entering={reducedMotion ? FadeIn.duration(150) : FadeInDown.duration(250)}>
        {segment !== 'replies' && myPosts[segment].map((row) => (
          <Pressable analyticsId="app_profile_index.pressable.4" key={row.id} onPress={() => { play('selection'); router.push(`/post/${row.id}`); }} accessibilityRole="button" style={[styles.myPost, { borderBottomColor: theme.line }]}>
            <ThemedText type="small" themeColor="textSecondary">{tr(TAGS.find(({ id }) => id === row.tag_id)?.label ?? '')}{row.kind === 'listing' ? ` · ${t.detail.listingBadge}` : ''}{row.kind === 'listing' && row.listing_status && row.listing_status !== 'open' ? ` · ${t.detail.listingStatus[row.listing_status]}` : ''}</ThemedText>
            <ThemedText type="smallBold" style={styles.myTitle}>{row.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{visibleMeetupBody(row.body)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>{row.kind === 'listing' && row.price != null ? `${t.detail.price(Number(row.price))} · ` : ''}{tr('공감 {0} · 댓글 {1} · 저장 {2}', count(row.like_count), count(row.comment_count), count(row.save_count))} · {relativeTime(row.created_at, undefined, appLocale)}</ThemedText>
          </Pressable>
        ))}
        {segment !== 'replies' && myPosts[segment].length === 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>{segment === 'listing' ? tr("아직 올린 구해요·팔아요 글이 없어요.") : tr("아직 쓴 글이 없어요. 오늘의 한 편을 남겨보세요.")}</ThemedText>}
        {segment === 'replies' && replies.filter((reply) => !hidden('comment', reply.id, reply.author_id)).map((reply) => (
          <Pressable analyticsId="app_profile_index.pressable.5" key={reply.id} onPress={() => { play('selection'); router.push(`/post/${reply.post_id}`); }} accessibilityRole="button" style={[styles.myPost, { borderBottomColor: theme.line }]}>
            <ThemedText type="small" themeColor="textSecondary"><ThemedText type="small" themeColor="navy">{reply.author?.nickname ?? tr("이웃")}</ThemedText>{tr("님이 「")}{reply.post?.title ?? tr("내 글")}{tr("」에 ·") + " "}{relativeTime(reply.created_at, undefined, appLocale)}</ThemedText>
            <ThemedText type="small">{reply.body}</ThemedText>
            <ThemedText type="smallBold" themeColor="accent">{tr("답글 달기")}</ThemedText>
          </Pressable>
        ))}
        {segment === 'replies' && replies.length === 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>{tr("아직 내 글에 달린 답글이 없어요.")}</ThemedText>}
        </Reanimated.View>}

        <View style={[styles.menu, Depth.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
          {PROMOTIONS_PREVIEW_ENABLED && <><Pressable analyticsId="app_profile_index.pressable.6" style={styles.menuRow} accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/promotions'); }}>
            <ThemedText type="small">{tr("홍보 크레딧")}</ThemedText>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.line }]} /></>}
          <Pressable analyticsId="app_profile_index.pressable.7"
            style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            onPress={() => { play('selection'); router.push('/profile/guidelines'); }}>
            <ThemedText type="small">{t.profile.guidelines}</ThemedText>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <Pressable analyticsId="app_profile_index.pressable.9"
            style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            onPress={() => { play('selection'); Alert.alert(t.profile.signOutTitle, t.profile.signOutBody, [
              { text: t.profile.cancel, style: 'cancel' },
              { text: t.profile.signOut, style: 'destructive', onPress: () => { play('warning'); void signOut(); } },
            ]); }}>
            <ThemedText type="small" themeColor="textSecondary">{t.profile.signOut}</ThemedText>
          </Pressable>
        </View>
        </ScrollView>
      </SafeAreaView>

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { paddingHorizontal: Spacing.three, paddingBottom: TabBarHeight + Spacing.four },
  headerActions: { flexDirection: 'row' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five },
  photoButton: { width: 72, height: 72, marginBottom: Spacing.two },
  photoBadge: { position: 'absolute', bottom: -2, right: -2, width: 28, height: 28, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  nickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  nick: { flexShrink: 1, textAlign: 'center', fontSize: 24, lineHeight: 32, fontWeight: 700 },
  menu: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', marginTop: Spacing.four },
  manage: { flexDirection: 'row', borderRadius: 16, padding: Spacing.one, marginBottom: Spacing.three },
  manageCell: { flex: 1, minWidth: 0, minHeight: 88, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: Spacing.one },
  manageIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  manageDot: { position: 'absolute', top: 1, right: 1, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  manageLabel: { textAlign: 'center' },
  manageSub: { textAlign: 'center', fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  accountMenu: { borderWidth: 1, borderRadius: 16, overflow: 'hidden', marginBottom: Spacing.four },
  accountRow: { minHeight: 72, paddingHorizontal: Spacing.three, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  accountText: { flex: 1, gap: Spacing.one },
  segments: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  segmentIndicator: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 10, borderBottomWidth: 2 },
  segment: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  myPost: { paddingVertical: Spacing.three, gap: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth },
  myTitle: { fontSize: 16, lineHeight: 22 },
  emptyNote: { paddingVertical: Spacing.four, textAlign: 'center' },
  menuRow: { paddingHorizontal: Spacing.three, paddingVertical: 14 },
  divider: { height: 1, marginHorizontal: Spacing.three },
});
