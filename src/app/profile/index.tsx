import { useLanguage } from '@/hooks/use-language';
import { ClayPillFill, useClay } from '@/components/clay';
import { ChatIdentitySwitcher } from '@/components/chat-identity-switcher';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Animated, Easing, LayoutAnimation, Platform, RefreshControl, StyleSheet, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { LoginPanel } from '@/components/login-panel';
import { ProfileRecordTiles, ProfileSavedMap } from '@/components/profile-overview';
import { PostZoomLink } from '@/components/post-zoom-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { ControlStyles, controlPresentation } from '@/constants/design-system';
import { Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { CITIES, TAGS } from '@/lib/mock';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyPosts, loadProfileSummary, loadRepliesToMe, type MyPostRow, type ProfileSummary, type ReplyToMe } from '@/lib/community-data';
import { relativeTime } from '@/lib/feed-data';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { loadProfileOverview, type ProfileOverview } from '@/lib/profile-friends';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const { tr, t, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const clay = useClay();
  const hidden = useContentVisibility();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { isAuthed, signInApple, signInKakao, signInGoogle, signInDev, isAuthLoading, authError, trustLevel, me, setProfilePhoto } = useAuth();
  const { play } = useInteractionFeedback();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [overview, setOverview] = useState<{ user: string; value: ProfileOverview | null } | null>(null);
  const [segment, setSegment] = useState<'story' | 'replies' | 'listing'>('story');
  const [myPosts, setMyPosts] = useState<Record<'story' | 'listing', MyPostRow[]>>({ story: [], listing: [] });
  const [replies, setReplies] = useState<ReplyToMe[]>([]);
  const [loadedSegment, setLoadedSegment] = useState<'story' | 'replies' | 'listing' | null>(null);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const [segmentPosition] = useState(() => new Animated.Value(0));
  const [reload, setReload] = useState(0), [pulling, setPulling] = useState(false);
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
    // A failed read just leaves the map, tiles and counts out; the rest of the profile stays usable.
    void loadProfileOverview(supabase, me.id)
      .then((value) => { if (active) setOverview({ user: me.id, value }); })
      .catch(() => { if (active) setOverview({ user: me.id, value: null }); });
    return () => { active = false; };
  }, [isAuthed, me.id, me.cityId, reload]);

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
      setLoadedSegment(segment); setPulling(false);
    });
    return () => { active = false; };
  }, [isAuthed, me.id, reducedMotion, segment, reload]);

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
  const own = overview?.user === me.id ? overview.value : null;
  const stats = [
    ['saved', own ? count(own.savedCount) : '–', tr('저장한 곳'), () => router.push({ pathname: '/profile/saved', params: { filter: 'places' } })],
    ['friends', own ? count(own.friendCount) : '–', tr('친구'), () => router.push('/profile/friends')],
    ['posts', count(summary?.posts ?? 0), tr('쓴 글'), null],
  ] as const;

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

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: tr('내 프로필'), headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable analyticsId="profile.more" accessibilityRole="button" accessibilityLabel={tr('더보기')} accessibilityHint={tr('설정, 멤버십, 알림, 계정 메뉴를 열어요')}
            onPress={() => { play('selection'); router.push('/profile/menu'); }} style={styles.headerButton}>
            <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={22} tintColor={theme.text} />
          </Pressable>
        </View>
      ) }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView analyticsId="app_profile_index.scroll" contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={pulling} tintColor={theme.accent} onRefresh={() => { play('selection'); setPulling(true); setReload(value => value + 1); }} />}>
        {own && <View style={styles.top}><ProfileSavedMap overview={own} homeCityId={summary?.cityId ?? me.cityId ?? null} /></View>}
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
            <ChatIdentitySwitcher target="business" />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t.profile.location(tr(cityName), summary?.neighborhood)}
          </ThemedText>
        </View>
        <View style={[styles.stats, { borderColor: theme.line }]}>
          {stats.map(([id, value, label, open]) => <Pressable key={id} analyticsId={`profile.stat.${id}`} accessibilityRole={open ? 'button' : 'text'} disabled={!open}
            accessibilityLabel={`${label} ${value}`} onPress={() => { if (!open) return; play('selection'); open(); }}
            style={({ pressed }) => [styles.stat, pressed && !!open && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="subtitle" style={styles.statValue}>{value}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
          </Pressable>)}
        </View>
        <View style={styles.heroActions}>
          <Pressable analyticsId="app_profile_index.invite" accessibilityRole="button" accessibilityLabel={tr('친구 초대')} accessibilityHint={tr('초대 링크와 받은 이용권을 봐요')}
            onPress={() => { play('selection'); router.push('/profile/invite'); }}
            style={({ pressed }) => [ControlStyles.action, styles.heroAction, controlPresentation(theme, { tone: 'primary', pressed, clay }).container]}>
            {clay && <ClayPillFill kind="cta" />}
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('친구 초대')}</ThemedText>
          </Pressable>
          <Pressable analyticsId="profile.edit" accessibilityRole="button" accessibilityLabel={tr('프로필 수정')} accessibilityHint={tr('닉네임, 활동 지역, 화면 모드를 바꿔요')}
            onPress={() => { play('selection'); router.push('/profile/settings'); }}
            style={({ pressed }) => [ControlStyles.action, styles.heroAction, controlPresentation(theme, { pressed, clay }).container]}>
            {clay && <ClayPillFill kind="white" />}
            <ThemedText type="smallBold">{tr('프로필 수정')}</ThemedText>
          </Pressable>
        </View>
        {!!own?.friendRequestCount && <Pressable analyticsId="profile.friend-requests" accessibilityRole="button" accessibilityLabel={tr('받은 친구 요청 {0}개', count(own.friendRequestCount))}
          onPress={() => { play('selection'); router.push('/profile/friends'); }}
          style={({ pressed }) => [styles.requests, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
          <View style={[styles.requestDot, { backgroundColor: theme.accent }]} />
          <ThemedText type="smallBold" style={styles.grow}>{tr('받은 친구 요청 {0}개', count(own.friendRequestCount))}</ThemedText>
          <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />
        </Pressable>}
        {own && <View style={styles.records}><ProfileRecordTiles overview={own} /></View>}
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
          <PostZoomLink key={row.id} id={row.id}><Pressable analyticsId="app_profile_index.pressable.4" onPress={() => play('selection')} accessibilityRole="button" style={StyleSheet.flatten([styles.myPost, { borderBottomColor: theme.line }])}>
            <ThemedText type="small" themeColor="textSecondary">{tr(TAGS.find(({ id }) => id === row.tag_id)?.label ?? '')}{row.kind === 'listing' ? ` · ${t.detail.listingBadge}` : ''}{row.kind === 'listing' && row.listing_status && row.listing_status !== 'open' ? ` · ${t.detail.listingStatus[row.listing_status]}` : ''}</ThemedText>
            <ThemedText type="smallBold" style={styles.myTitle}>{row.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{visibleMeetupBody(row.body)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>{row.kind === 'listing' && row.price != null ? `${t.detail.price(Number(row.price))} · ` : ''}{tr('공감 {0} · 댓글 {1} · 저장 {2}', count(row.like_count), count(row.comment_count), count(row.save_count))} · {relativeTime(row.created_at, undefined, appLocale)}</ThemedText>
          </Pressable></PostZoomLink>
        ))}
        {segment !== 'replies' && myPosts[segment].length === 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>{segment === 'listing' ? tr("아직 올린 구해요·팔아요 글이 없어요.") : tr("아직 쓴 글이 없어요. 오늘의 한 편을 남겨보세요.")}</ThemedText>}
        {segment === 'replies' && replies.filter((reply) => !hidden('comment', reply.id, reply.author_id)).map((reply) => (
          <PostZoomLink key={reply.id} id={reply.post_id}><Pressable analyticsId="app_profile_index.pressable.5" onPress={() => play('selection')} accessibilityRole="button" style={StyleSheet.flatten([styles.myPost, { borderBottomColor: theme.line }])}>
            <ThemedText type="small" themeColor="textSecondary"><ThemedText type="small" themeColor="navy">{reply.author?.nickname ?? tr("이웃")}</ThemedText>{tr("님이 「")}{reply.post?.title ?? tr("내 글")}{tr("」에 ·") + " "}{relativeTime(reply.created_at, undefined, appLocale)}</ThemedText>
            <ThemedText type="small">{reply.body}</ThemedText>
            <ThemedText type="smallBold" themeColor="accent">{tr("답글 달기")}</ThemedText>
          </Pressable></PostZoomLink>
        ))}
        {segment === 'replies' && replies.length === 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.emptyNote}>{tr("아직 내 글에 달린 답글이 없어요.")}</ThemedText>}
        </Reanimated.View>}

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
  hero: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  photoButton: { width: 72, height: 72, marginBottom: Spacing.two },
  photoBadge: { position: 'absolute', bottom: -2, right: -2, width: 28, height: 28, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  nickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  nick: { flexShrink: 1, textAlign: 'center', fontSize: 24, lineHeight: 32, fontWeight: 700 },
  top: { paddingTop: Spacing.three },
  stats: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.one },
  stat: { flex: 1, minWidth: 0, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 12 },
  statValue: { fontVariant: ['tabular-nums'] },
  heroActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  heroAction: { flex: 1, borderWidth: 1 },
  requests: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52, borderRadius: 14, paddingHorizontal: Spacing.three, marginTop: Spacing.three },
  requestDot: { width: 8, height: 8, borderRadius: 4 },
  grow: { flex: 1 },
  records: { marginTop: Spacing.three },
  // The gap lives here so the tabs clear the buttons even when the record tiles are not shown.
  segments: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginTop: Spacing.four },
  segmentIndicator: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 10, borderBottomWidth: 2 },
  segment: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  myPost: { paddingVertical: Spacing.three, gap: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth },
  myTitle: { fontSize: 16, lineHeight: 22 },
  emptyNote: { paddingVertical: Spacing.four, textAlign: 'center' },
});
