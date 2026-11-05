import { useLanguage } from '@/hooks/use-language';
import { PageHeader } from '@/components/page-header';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Alert, DeviceEventEmitter, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { DragSheet } from '@/components/drag-sheet';
import { FriendButton, ProfileRecordTiles, ProfileSavedMap } from '@/components/profile-overview';
import { ReportSheet } from '@/components/report-sheet';
import { MannerSummary } from '@/components/manner-summary';
import { TrustBadge } from '@/components/trust-badge';
import { PostDetail } from '@/components/post-detail';
import { PostZoomLink } from '@/components/post-zoom-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SavedEntryButton, useSavedEntry } from '@/components/saved-entry';
import { ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { useTranslationVisibleIds } from '@/hooks/use-content-translation';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { appendUniquePosts } from '@/lib/feed-data';
import { applyPostChange, POST_CHANGED_EVENT, type PostChange } from '@/lib/post-open';
import { loadPublicUserActivity, loadPublicUserProfile, type PublicUserProfile } from '@/lib/user-profile';
import { blockUser } from '@/lib/community-data';
import { loadProfileOverview, type ProfileOverview } from '@/lib/profile-friends';
import { supabase } from '@/lib/supabase';
import { CITIES } from '@/lib/mock';
import type { Post } from '@/lib/types';

// 글·댓글 작성자를 눌렀을 때 여는 프로필 화면. 이 사람이 지금까지 쓴 글만 모아 보여준다.
export default function AuthorPostsRoute() {
  const { tr, t, locale: appLocale } = useLanguage();
  const { id } = useLocalSearchParams<{ id: string; nickname?: string }>();
  const authorId = typeof id === 'string' ? id : '';
  const { isAuthed, me } = useAuth();
  const viewerScope = isAuthed ? me.id : 'guest';
  const router = useRouter();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const [state, setState] = useState<{ key: string; posts: Post[]; hasMore: boolean } | null>(null);
  const [profile, setProfile] = useState<{ key: string; value: PublicUserProfile | null } | null>(null);
  const [kind, setKind] = useState<'story' | 'listing'>('story'), [retry, setRetry] = useState(0);
  const [more, setMore] = useState(false), pending = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ key: string; post: Post } | null>(null);
  const [overview, setOverview] = useState<{ key: string; value: ProfileOverview | null } | null>(null), [overviewRevision, setOverviewRevision] = useState(0);
  const [menu, setMenu] = useState<'open' | 'report' | null>(null), afterMenu = useRef<(() => void) | null>(null);
  const [visiblePostIds, setVisiblePostIds] = useTranslationVisibleIds();
  const trackTranslationPosts = useCallback(({ viewableItems }: { viewableItems: { item: Post }[] }) =>
    setVisiblePostIds(viewableItems.map(({ item }) => item.id)), [setVisiblePostIds]);

  const requestKey = `${authorId}:${viewerScope}:${kind}:${retry}`;
  const current = state?.key === requestKey ? state : null;
  const hasMore = current?.hasMore ?? false;
  const loading = Boolean(authorId) && !current && failed !== requestKey;
  const { play } = useInteractionFeedback();
  const goBack = () => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/'); };

  useEffect(() => {
    if (!authorId) return;
    let active = true;
    void Promise.all([loadPublicUserActivity(supabase, authorId, kind, null, viewerScope), loadPublicUserProfile(supabase, authorId)])
      .then(([posts, value]) => { if (active) { setState({ key: requestKey, posts, hasMore: posts.length === 30 }); setProfile({ key: requestKey, value }); } })
      .catch(() => { if (active) setFailed(requestKey); });
    return () => { active = false; };
  }, [authorId, kind, requestKey, viewerScope, hidden]);

  // Map, counts and the friend button. A failed read leaves them out without hiding the posts.
  const overviewKey = `${authorId}:${viewerScope}:${overviewRevision}`;
  useEffect(() => {
    if (!authorId) return;
    let active = true;
    void loadProfileOverview(supabase, authorId).then(value => { if (active) setOverview({ key: overviewKey, value }); })
      .catch(() => { if (active) setOverview({ key: overviewKey, value: null }); });
    return () => { active = false; };
  }, [authorId, overviewKey, hidden]);

  async function loadMore() {
    const last = current?.posts.at(-1);
    if (!last?.createdAt || pending.current || !hasMore) return;
    pending.current = true; setMore(true); play('selection');
    try {
      const next = await loadPublicUserActivity(supabase, authorId, kind, { createdAt: last.createdAt, id: last.id }, viewerScope);
      setState(previous => previous?.key === requestKey ? { ...previous, posts: appendUniquePosts(previous.posts, next), hasMore: next.length === 30 } : previous);
    } catch { setFailed(requestKey); play('warning'); }
    finally { pending.current = false; setMore(false); }
  }

  // 글 화면에서 고치거나 지운 글, 바뀐 댓글·조회 수를 이 사람의 글 목록에 바로 반영한다.
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(POST_CHANGED_EVENT, (change: PostChange) =>
      setState(prev => prev ? { ...prev, posts: applyPostChange(prev.posts, change) } : prev));
    return () => listener.remove();
  }, []);

  const posts = (current?.posts ?? []).filter(post => !hidden('post', post.id, post.author.id));
  const publicProfile = profile?.key === requestKey && !hidden('user', authorId) ? profile.value : null;
  const saved = useSavedEntry({ kind: 'user', id: authorId }, !!publicProfile);
  const shownOverview = publicProfile && overview?.key === overviewKey ? overview.value : null;
  const closeMenu = (then?: () => void) => { afterMenu.current = then ?? null; setMenu(null); };
  const confirmBlock = () => {
    if (!publicProfile || !isAuthed) return;
    Alert.alert(t.report.block(publicProfile.nickname), t.report.blockBody, [
      { text: t.profile.cancel, style: 'cancel', onPress: () => play('selection') },
      { text: t.chat.block, style: 'destructive', onPress: () => {
        void blockUser(supabase, me.id, authorId).then(() => { play('warning'); Alert.alert(t.chat.blockDone); goBack(); })
          .catch(() => { play('warning'); Alert.alert(t.chat.blockError); });
      } },
    ]);
  };
  const shownDetail = detail?.key === requestKey && !hidden('post', detail.post.id, detail.post.author.id) ? detail.post : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <PageHeader title={tr("사용자 프로필")} analyticsId="app_user_[id].pressable.1" right={publicProfile ? <Pressable analyticsId="user.more" accessibilityRole="button" accessibilityLabel={tr('더보기')} accessibilityHint={tr('프로필 저장, 신고, 차단')}
          onPress={() => { play('selection'); setMenu('open'); }}
          style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
          <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={IconSize.toolbar} tintColor={theme.text} />
        </Pressable> : undefined} />
        {current && <ThemedText type="small" themeColor="textSecondary" style={styles.count}>{t.authorPosts.count(count(posts.length))}</ThemedText>}
        {!!saved.error && <ThemedText type="small" accessibilityRole="alert" style={styles.saveError}>{saved.error}</ThemedText>}


        {loading ? (
          <View style={styles.center}>
            <GlingLoader color={theme.accent} accessibilityLabel={t.authorPosts.loading} />
          </View>
        ) : (
          <FlatList
            onViewableItemsChanged={trackTranslationPosts}
            viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY}
            data={posts}
            keyExtractor={(post) => post.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={publicProfile ? <View style={styles.profile}>
              {shownOverview && <ProfileSavedMap overview={shownOverview} homeCityId={publicProfile.cityId} />}
              <View style={styles.identity}>
                <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle" style={{ color: theme.accent }}>{publicProfile.nickname[0]}</ThemedText></View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}><View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}><ThemedText type="subtitle" style={{ flexShrink: 1 }}>{publicProfile.nickname}</ThemedText><TrustBadge verified={publicProfile.verificationLevel >= 2} trustLevel={publicProfile.verificationLevel === 3 ? 3 : publicProfile.verificationLevel === 2 ? 2 : undefined} /></View><ThemedText type="small" themeColor="textSecondary">{publicProfile.neighborhood ?? tr(CITIES.find(city => city.id === publicProfile.cityId)?.name ?? publicProfile.cityId)}{" " + tr("· 가입") + " "}{new Date(publicProfile.memberSince).toLocaleDateString(appLocale)}</ThemedText></View>
              </View>
              <View style={[styles.stats, { borderColor: theme.line }]}>
                {([[shownOverview?.savedCount, tr('저장한 곳')], [shownOverview?.friendCount, tr('친구')], [publicProfile.storyCount + publicProfile.listingCount, tr('쓴 글')]] as const).map(([value, label]) => <View key={label} style={styles.stat}><ThemedText type="subtitle">{value == null ? '–' : count(value)}</ThemedText><ThemedText type="small" themeColor="textSecondary">{label}</ThemedText></View>)}
              </View>
              {shownOverview && <FriendButton overview={shownOverview} nickname={publicProfile.nickname}
                onChanged={next => setOverview(previous => previous?.key === overviewKey && previous.value ? { ...previous, value: { ...previous.value, ...next } } : previous)} />}
              <MannerSummary summary={publicProfile.manner} />
              {publicProfile.completedCount > 0 && <ThemedText type="small" themeColor="textSecondary">{tr('거래 완료 {0}건', count(publicProfile.completedCount))}</ThemedText>}
              {shownOverview && <ProfileRecordTiles overview={shownOverview} />}
              <ThemedText type="small" themeColor="textSecondary">{tr("공개한 글 이력이에요. 거래 완료는 작성자가 표시한 상태이며 실제 거래·신원 인증을 보장하지 않아요.")}</ThemedText>
        <View style={[styles.segments, { borderBottomColor: theme.line }]} accessibilityRole="tablist">
          {(['story', 'listing'] as const).map(value => <Pressable analyticsId={`user.activity.${value}`} key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }}
            onPress={() => { play('selection'); setKind(value); setDetail(null); }} style={[styles.segment, kind === value && { borderBottomColor: theme.accent, borderBottomWidth: 2 }]}>
            <ThemedText type="smallBold">{value === 'story' ? tr("오늘") : tr("구해요·팔아요")}</ThemedText>
          </Pressable>)}
        </View>
            </View> : undefined}

            // Signed in, the card grows the post out of itself (owner 2026-11-02); guests keep the in-place login gate.
            renderItem={({ item }) => isAuthed ? <PostZoomLink id={item.id} post={item}><PostCard post={item} translationVisible={visiblePostIds.has(item.id)} /></PostZoomLink>
              : <PostCard post={item} translationVisible={visiblePostIds.has(item.id) && !detail} onPress={() => setDetail({ key: requestKey, post: item })} />}
            ListEmptyComponent={(
              <View style={styles.message}>
                <ThemedText type="subtitle">{failed === requestKey ? t.authorPosts.errorTitle : t.authorPosts.emptyTitle}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {failed === requestKey ? t.authorPosts.errorBody : t.authorPosts.emptyBody}
                </ThemedText>
              </View>
            )}
            ListFooterComponent={<View style={styles.profile}>
              {failed === requestKey && <Pressable analyticsId="user.activity.retry" accessibilityRole="button" onPress={() => { play('selection'); setRetry(n => n + 1); }} style={styles.segment}><ThemedText type="small">{tr("다시 불러오기")}</ThemedText></Pressable>}
              {hasMore && <Pressable analyticsId="user.activity.more" accessibilityRole="button" accessibilityState={{ disabled: more }} disabled={more} onPress={() => void loadMore()} style={styles.segment}><ThemedText type="smallBold">{more ? tr("불러오는 중…") : tr("이전 글 더 보기")}</ThemedText></Pressable>}
            </View>}
          />
        )}
      </SafeAreaView>

      <DragSheet visible={!!publicProfile && menu === 'open'} onClose={() => closeMenu()} onDismissed={() => { const then = afterMenu.current; afterMenu.current = null; then?.(); }}>
        {publicProfile && <View style={styles.menu}>
          <View style={[styles.menuRow, { borderBottomColor: theme.line }]}>
            <View style={styles.menuText}><ThemedText type="smallBold">{tr('프로필 저장')}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('나만 보는 저장 목록에 넣어요')}</ThemedText></View>
            <SavedEntryButton entry={saved} kind="user" analyticsId="save.user" />
          </View>
          {isAuthed && me.id !== authorId && <>
            <Pressable analyticsId="user.menu.report" accessibilityRole="button" onPress={() => { play('selection'); closeMenu(() => setMenu('report')); }}
              style={({ pressed }) => [styles.menuRow, { borderBottomColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">{t.report.title(publicProfile.nickname)}</ThemedText>
            </Pressable>
            <Pressable analyticsId="user.menu.block" accessibilityRole="button" onPress={() => { play('selection'); closeMenu(confirmBlock); }}
              style={({ pressed }) => [styles.menuRow, { borderBottomColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" style={{ color: theme.danger }}>{t.report.block(publicProfile.nickname)}</ThemedText>
            </Pressable>
          </>}
        </View>}
      </DragSheet>
      {publicProfile && menu === 'report' && <ReportSheet visible targetType="user" targetId={authorId} reportedUserId={authorId} reportedNickname={publicProfile.nickname}
        onClose={() => { setMenu(null); setOverviewRevision(value => value + 1); }} />}

      {/* Guests only: signing in changes the viewer scope and closes this gate. */}
      {shownDetail && <PostDetail key={`${viewerScope}:${shownDetail.id}`} post={shownDetail} onClose={() => setDetail(null)} />}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  count: { paddingHorizontal: 16, paddingBottom: 8, textAlign: 'center' },
  saveError: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  profile: { gap: 16, marginBottom: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 64, height: 64, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 16 },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  segments: { flexDirection: 'row', borderBottomWidth: 1, marginBottom: 0 },
  segment: { minHeight: 44, flexGrow: 1, alignItems: 'center', paddingHorizontal: 16, justifyContent: 'center' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { gap: 6, alignItems: 'center' },
  menu: { paddingBottom: 8 },
  menuRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  menuText: { flex: 1, minWidth: 0, gap: 2 },
});
