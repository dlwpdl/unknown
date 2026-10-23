import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { MannerSummary } from '@/components/manner-summary';
import { TrustBadge } from '@/components/trust-badge';
import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SavedEntryButton, useSavedEntry } from '@/components/saved-entry';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { appendUniquePosts } from '@/lib/feed-data';
import { loadPublicUserActivity, loadPublicUserProfile, type PublicUserProfile } from '@/lib/user-profile';
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
  const [visiblePostIds, setVisiblePostIds] = useState<Set<string>>(new Set());
  const trackTranslationPosts = useCallback(({ viewableItems }: { viewableItems: { item: Post }[] }) =>
    setVisiblePostIds(new Set(viewableItems.map(({ item }) => item.id))), []);

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

  const updateViewCount = useCallback((postId: string, views: number) => {
    setState((prev) => prev ? { ...prev, posts: prev.posts.map((post) => post.id === postId ? { ...post, views } : post) } : prev);
  }, []);

  const posts = (current?.posts ?? []).filter(post => !hidden('post', post.id, post.author.id));
  const publicProfile = profile?.key === requestKey && !hidden('user', authorId) ? profile.value : null;
  const saved = useSavedEntry({ kind: 'user', id: authorId }, !!publicProfile);
  const shownDetail = detail?.key === requestKey && !hidden('post', detail.post.id, detail.post.author.id) ? detail.post : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable analyticsId="app_user_[id].pressable.1"
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t.authorPosts.back}
            style={({ pressed }) => [styles.backButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
            <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
          </Pressable>
          <View style={styles.heading}>
            <ThemedText type="smallBold" style={{ fontSize: 16 }}>{tr("사용자 프로필")}</ThemedText>
            {current && (
              <ThemedText type="small" themeColor="textSecondary">
                {t.authorPosts.count(count(posts.length))}
              </ThemedText>
            )}
          </View>
          {publicProfile && <SavedEntryButton entry={saved} kind="user" analyticsId="save.user" />}
        </View>
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
            ListHeaderComponent={publicProfile && <View style={styles.profile}>
              <View style={styles.identity}>
                <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle" style={{ color: theme.accent }}>{publicProfile.nickname[0]}</ThemedText></View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}><View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}><ThemedText type="subtitle" style={{ flexShrink: 1 }}>{publicProfile.nickname}</ThemedText><TrustBadge verified={publicProfile.verificationLevel >= 2} trustLevel={publicProfile.verificationLevel === 3 ? 3 : publicProfile.verificationLevel === 2 ? 2 : undefined} /></View><ThemedText type="small" themeColor="textSecondary">{publicProfile.neighborhood ?? tr(CITIES.find(city => city.id === publicProfile.cityId)?.name ?? publicProfile.cityId)}{" " + tr("· 가입") + " "}{new Date(publicProfile.memberSince).toLocaleDateString(appLocale)}</ThemedText></View>
              </View>
              <View style={[styles.stats, { borderColor: theme.line }]}>
                {([[publicProfile.storyCount, tr('오늘')], [publicProfile.listingCount, tr('구해요·팔아요')], [publicProfile.completedCount, tr('거래 완료')]] as const).map(([value, label]) => <View key={label} style={styles.stat}><ThemedText type="subtitle">{count(value)}</ThemedText><ThemedText type="small" themeColor="textSecondary">{label}</ThemedText></View>)}
              </View>
              <MannerSummary summary={publicProfile.manner} />
              <ThemedText type="small" themeColor="textSecondary">{tr("공개한 글 이력이에요. 거래 완료는 작성자가 표시한 상태이며 실제 거래·신원 인증을 보장하지 않아요.")}</ThemedText>
        <View style={[styles.segments, { borderBottomColor: theme.line }]} accessibilityRole="tablist">
          {(['story', 'listing'] as const).map(value => <Pressable analyticsId={`user.activity.${value}`} key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }}
            onPress={() => { play('selection'); setKind(value); setDetail(null); }} style={[styles.segment, kind === value && { borderBottomColor: theme.accent, borderBottomWidth: 2 }]}>
            <ThemedText type="smallBold">{value === 'story' ? tr("오늘") : tr("구해요·팔아요")}</ThemedText>
          </Pressable>)}
        </View>
            </View>}

            renderItem={({ item }) => (
              <PostCard post={item} translationVisible={visiblePostIds.has(item.id) && !detail} onPress={() => setDetail({ key: requestKey, post: item })} />
            )}
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

      {shownDetail && (
        <PostDetail
          key={`${viewerScope}:${shownDetail.id}`}
          post={shownDetail}
          onViewCountChange={updateViewCount}
          onClose={() => setDetail(null)}
          onPostRemoved={(postId) => setState((prev) => prev ? { ...prev, posts: prev.posts.filter((post) => post.id !== postId) } : prev)}
          onPostChanged={(saved) => {
            setState(prev => prev ? { ...prev, posts: prev.posts.map(post => post.id === saved.id ? saved : post) } : prev);
            setDetail({ key: requestKey, post: saved });
          }}
          onCommentCountChange={(comments) => setState((prev) => prev
            ? { ...prev, posts: prev.posts.map((post) => post.id === shownDetail.id ? { ...post, comments } : post) }
            : prev)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, flexDirection: 'row', alignItems: 'center' },
  backButton: { alignSelf: 'flex-start', minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, minWidth: 0, gap: 2, paddingBottom: 4 },
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
});
