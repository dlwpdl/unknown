import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { StyleSheet, View, type ScrollView as NativeScrollView } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { MerchantProfileHeader } from '@/components/merchant-profile-header';
import { MerchantReviews } from '@/components/merchant-reviews';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { appendUniquePosts, getPostImageSource } from '@/lib/feed-data';
import { loadMerchantProfile, loadMerchantProfilePosts, type MerchantProfile, type MerchantProfilePostPage } from '@/lib/merchant-profile';
import { loadMerchantReviews, type MerchantReviewKind, type MerchantReviewPage } from '@/lib/merchant-reviews';
import { supabase } from '@/lib/supabase';

const tabs = [{ id: 'posts', label: '게시글' }, { id: 'jobs', label: '채용' }, { id: 'reviews', label: '리뷰' }, { id: 'about', label: '소개' }] as const;
type ProfileTab = typeof tabs[number]['id'];

export default function CompanyProfileRoute() {
  const { id, review } = useLocalSearchParams<{ id: string; review?: string }>(), router = useRouter(), theme = useTheme(), { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion(), scroll = useRef<NativeScrollView>(null), tabsTop = useRef(0);
  const { me, isAuthed, isAuthLoading } = useAuth(), hidden = useContentVisibility();
  const merchantId = typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : '';
  const key = `${merchantId}:${isAuthLoading ? 'loading' : isAuthed ? me.id : 'guest'}`;
  const [reviewVisited, setReviewVisited] = useState<string | null>(review ? key : null);
  const [result, setResult] = useState<{ key: string; profile: MerchantProfile | null; failed: boolean } | null>(null), [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{ merchantId: string; kind: MerchantReviewKind } | null>(null), [reviewRevision, setReviewRevision] = useState(0);
  const [ratingResult, setRatingResult] = useState<{ key: string; ratings: Record<MerchantReviewKind, Pick<MerchantReviewPage, 'rating_average' | 'review_count'> | null> } | null>(null);
  const [tabResult, setTabResult] = useState<{ merchantId: string; tab: ProfileTab } | null>(null);
  const tab = tabResult?.merchantId === merchantId ? tabResult.tab : review ? 'reviews' : 'posts';
  const postKind = tab === 'jobs' ? 'jobs' : 'posts', listKey = `${key}:${postKind}`;
  const [postResult, setPostResult] = useState<{ key: string; page: MerchantProfilePostPage | null; failed: boolean; attempt: number } | null>(null);
  const [countsResult, setCountsResult] = useState<{ key: string; value: Pick<MerchantProfilePostPage, 'post_count' | 'job_count'> | null } | null>(null);
  const [postRevision, setPostRevision] = useState(0), [postBusy, setPostBusy] = useState(false);
  const postRequest = useRef({ active: false, reading: false });
  const reviewKind = selected?.merchantId === merchantId ? selected.kind : review === 'employment' ? 'employment' : 'usage';
  const current = result?.key === key ? result : null;
  const profile = current?.profile;
  const currentPosts = postResult?.key === listKey ? postResult : null, postPage = currentPosts?.page;
  const visiblePosts = postPage?.posts.filter(post => !hidden('post', post.id, post.author.id));
  const postsLoading = postBusy || !currentPosts || currentPosts.attempt !== postRevision;
  const counts = countsResult?.key === key ? countsResult.value : null;
  const ratings = ratingResult?.key === key ? ratingResult.ratings : undefined;
  const reviewCount = ratings?.usage && ratings.employment ? ratings.usage.review_count + ratings.employment.review_count : undefined;
  const displayCount = (value: number | undefined, settled: boolean) => value == null ? settled ? '—' : '…' : value.toLocaleString('ko-KR');
  useEffect(() => {
    if (!merchantId || isAuthLoading) return;
    let active = true;
    void loadMerchantProfile(supabase, merchantId).then((next) => { if (active) setResult({ key, profile: next, failed: false }); })
      .catch(() => { if (active) setResult((previous) => ({ key, profile: previous?.key === key ? previous.profile : null, failed: true })); });
    return () => { active = false; };
  }, [merchantId, isAuthLoading, key, revision, hidden]);
  useEffect(() => {
    if (!profile?.review_post_id || isAuthLoading) return;
    let active = true;
    void Promise.allSettled((['usage', 'employment'] as const).map(kind => loadMerchantReviews(supabase, profile.review_post_id!, 0, kind))).then(pages => {
      if (!active) return;
      const summaries = pages.map(page => page.status === 'fulfilled' && page.value
        ? { rating_average: page.value.rating_average, review_count: page.value.review_count } : null);
      setRatingResult({ key, ratings: { usage: summaries[0], employment: summaries[1] } });
    });
    return () => { active = false; };
  }, [profile?.review_post_id, isAuthLoading, key, reviewRevision, hidden]);
  useEffect(() => {
    if (!profile?.id || isAuthLoading) return;
    const operation = { active: true, reading: false };
    postRequest.current = operation;
    void loadMerchantProfilePosts(supabase, merchantId, postKind, 0, isAuthed ? me.id : 'guest').then(page => {
      if (!operation.active) return;
      setPostResult({ key: listKey, page, failed: false, attempt: postRevision });
      setCountsResult({ key, value: page ? { post_count: page.post_count, job_count: page.job_count } : null });
    }).catch(() => {
      if (operation.active) setPostResult(previous => ({ key: listKey, page: previous?.key === listKey ? previous.page : null, failed: true, attempt: postRevision }));
    }).finally(() => { if (operation.active) setPostBusy(false); });
    return () => { operation.active = false; };
  }, [profile?.id, isAuthLoading, isAuthed, me.id, merchantId, key, listKey, postKind, postRevision, hidden]);
  const selectTab = (next: ProfileTab) => { play('selection'); if (next === 'reviews') setReviewVisited(key); setTabResult({ merchantId, tab: next }); };
  const openReviews = (kind: MerchantReviewKind) => {
    setReviewVisited(key);
    setSelected({ merchantId, kind });
    setTabResult({ merchantId, tab: 'reviews' });
    scroll.current?.scrollTo({ y: tabsTop.current, animated: !reducedMotion });
  };
  async function morePosts() {
    const operation = postRequest.current;
    if (!postPage?.has_more || postsLoading || operation.reading) return;
    operation.reading = true; setPostBusy(true); play('selection');
    try {
      const next = await loadMerchantProfilePosts(supabase, merchantId, postKind, postPage.nextOffset, isAuthed ? me.id : 'guest');
      if (!operation.active) return;
      if (!next) throw new Error('MERCHANT_POSTS_READ_FAILED');
      setPostResult(previous => previous?.key === listKey && previous.page ? { key: listKey, page: { ...next, posts: appendUniquePosts(previous.page.posts, next.posts) }, failed: false, attempt: postRevision } : previous);
      setCountsResult({ key, value: { post_count: next.post_count, job_count: next.job_count } });
      play('success');
    } catch {
      if (operation.active) { setPostResult(previous => previous?.key === listKey ? { ...previous, failed: true } : previous); play('warning'); }
    } finally { operation.reading = false; if (operation.active) setPostBusy(false); }
  }
  return <ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
    <View style={[styles.header, { borderBottomColor: theme.line }]}>
      <Pressable analyticsId="company.back" accessibilityRole="button" accessibilityLabel="뒤로 가기" style={styles.button}
        onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/'); }}><ThemedText type="subtitle">‹</ThemedText></Pressable>
      <ThemedText type="subtitle" numberOfLines={1} style={styles.heading}>{profile?.name ?? '업체 프로필'}</ThemedText>
    </View>
    <ScrollView ref={scroll} analyticsId="company.profile" contentContainerStyle={styles.content}>
      {profile ? <>
        <MerchantProfileHeader profile={{ ...profile, services: '', address: '' }} ratings={ratings}
          onReviewPress={profile.review_post_id ? openReviews : undefined} />
        {(profile.imageLoadFailed || current?.failed) && <View style={styles.statePhoto}>
          <ThemedText type="small" themeColor="textSecondary">사진을 다시 불러오지 못했어요. 업체 정보와 저장된 사진은 유지돼요.</ThemedText>
          <Pressable analyticsId="company.photo.retry" accessibilityRole="button" style={styles.button}
            onPress={() => { play('selection'); setRevision((value) => value + 1); }}><ThemedText themeColor="accent">사진 다시 확인</ThemedText></Pressable>
        </View>}
        {!!profile.services && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{profile.services.split(/\r?\n/, 1)[0]}</ThemedText>}
        {!!counts?.job_count && <Pressable analyticsId="company.hiring" accessibilityRole="button" style={styles.hiring}
          onPress={() => { selectTab('jobs'); scroll.current?.scrollTo({ y: tabsTop.current, animated: !reducedMotion }); }}>
          <ThemedText type="small" themeColor="accent">• 채용 중 · {counts.job_count.toLocaleString('ko-KR')}건 ›</ThemedText>
        </Pressable>}
        <View onLayout={event => { tabsTop.current = event.nativeEvent.layout.y; }} style={[styles.tabs, { borderBottomColor: theme.line }]} accessibilityRole="tablist">
          {tabs.map(item => {
            const count = item.id === 'posts' ? displayCount(counts?.post_count, !!currentPosts?.failed || countsResult?.key === key)
              : item.id === 'jobs' ? displayCount(counts?.job_count, !!currentPosts?.failed || countsResult?.key === key)
              : item.id === 'reviews' ? displayCount(reviewCount, ratingResult?.key === key) : null;
            return <Pressable key={item.id} analyticsId={`company.tab.${item.id}`} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
              accessibilityLabel={`${item.label}${count == null ? '' : ` ${count}건`}`} style={[styles.tab, { borderBottomColor: tab === item.id ? theme.accent : 'transparent' }]}
              onPress={() => selectTab(item.id)}>
              <ThemedText type="smallBold" themeColor={tab === item.id ? 'accent' : 'textSecondary'}>{item.label}</ThemedText>
              {count != null && <ThemedText style={styles.tabCount} themeColor={tab === item.id ? 'accent' : 'textSecondary'}>{count}</ThemedText>}
            </Pressable>;
          })}
        </View>
        {(tab === 'posts' || tab === 'jobs') && <View style={styles.panel}>
          <View style={styles.panelTitle}><ThemedText type="subtitle">{tab === 'posts' ? '최근 게시글' : '함께할 사람을 찾고 있어요'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">최신순</ThemedText></View>
          {postsLoading && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{tab === 'posts' ? '게시글' : '채용 공고'}을 불러오는 중…</ThemedText>}
          {currentPosts?.failed && <View style={styles.statePhoto}><ThemedText type="small">글을 불러오지 못했어요.</ThemedText>
            <Pressable analyticsId="company.posts.retry" accessibilityRole="button" disabled={postsLoading} style={styles.button}
              onPress={() => { if (postPage?.has_more) void morePosts(); else { play('selection'); setPostRevision(value => value + 1); } }}><ThemedText themeColor="accent">다시 불러오기</ThemedText></Pressable></View>}
          {visiblePosts?.map(post => {
            const source = getPostImageSource(post, isAuthed ? me.id : 'guest');
            return <Pressable key={post.id} analyticsId={`company.post.${post.id}`} accessibilityRole="link" accessibilityLabel={`${post.title} 전체 보기`}
              style={[styles.post, { borderBottomColor: theme.line }]} onPress={() => { play('selection'); router.push({ pathname: '/post/[id]', params: { id: post.id } }); }}>
              <View style={styles.postText}><ThemedText type="small" themeColor="textSecondary">{tab === 'jobs' ? '모집 중' : post.tag.label} · {post.createdAtLabel}</ThemedText>
                <ThemedText type="smallBold" numberOfLines={2}>{post.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{post.body}</ThemedText></View>
              {source ? <Image source={source} contentFit="cover" style={styles.postImage} accessibilityLabel={`${post.title} 사진`} /> : <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>}
            </Pressable>;
          })}
          {!postsLoading && !currentPosts?.failed && (!postPage || !visiblePosts?.length) && <View style={styles.state}>
            <ThemedText type="smallBold">{!postPage ? '현재 공개된 글을 볼 수 없어요' : tab === 'posts' ? '아직 게시글이 없어요' : '현재 모집 중인 공고가 없어요'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">새 글이 등록되면 여기에서 볼 수 있어요.</ThemedText>
            <Pressable analyticsId="company.posts.about" accessibilityRole="button" style={styles.button} onPress={() => selectTab('about')}><ThemedText themeColor="accent">업체 소개 보기</ThemedText></Pressable>
          </View>}
          {postPage?.has_more && <Pressable analyticsId="company.posts.more" accessibilityRole="button" disabled={postsLoading} style={styles.button}
            onPress={() => void morePosts()}><ThemedText themeColor="accent">{tab === 'posts' ? '게시글' : '채용 공고'} 더 보기</ThemedText></Pressable>}
        </View>}
        {tab === 'about' && <View style={styles.panel}>
          <ThemedText type="subtitle">{profile.name} 소개</ThemedText>
          <ThemedText>{profile.services || '등록된 소개가 없어요.'}</ThemedText>
          {[['업종', profile.industry], ['지역', profile.city_name], ['주소', profile.address]].filter(([, value]) => !!value).map(([label, value]) =>
            <View key={label} style={styles.aboutRow}><ThemedText type="small" themeColor="textSecondary" style={styles.aboutLabel}>{label}</ThemedText><ThemedText type="small" style={styles.aboutValue}>{value}</ThemedText></View>)}
        </View>}
        {(tab === 'reviews' || reviewVisited === key) && profile.review_post_id && <View
          style={[styles.panel, tab !== 'reviews' && { display: 'none' }]} accessibilityElementsHidden={tab !== 'reviews'}
          importantForAccessibility={tab !== 'reviews' ? 'no-hide-descendants' : 'auto'}>
          <View style={styles.reviewTabs} accessibilityLabel="리뷰 종류">
            {(['usage', 'employment'] as const).map(kind => <Pressable key={kind} analyticsId={`company.reviews.${kind}`} accessibilityRole="button"
              accessibilityState={{ selected: kind === reviewKind }} style={[styles.reviewTab, { borderColor: kind === reviewKind ? theme.accent : theme.line, backgroundColor: kind === reviewKind ? theme.card : theme.background }]}
              onPress={() => { play('selection'); setSelected({ merchantId, kind }); }}>
              <ThemedText type="smallBold" themeColor={kind === reviewKind ? 'accent' : 'textSecondary'}>{kind === 'usage' ? '이용' : '근무'} {displayCount(ratings?.[kind]?.review_count, ratingResult?.key === key)}</ThemedText>
            </Pressable>)}
          </View>
          <MerchantReviews postId={profile.review_post_id} reviewKind={reviewKind} onChanged={() => setReviewRevision(value => value + 1)} />
        </View>}
      </> : <View style={styles.state}>
        <ThemedText type="subtitle">{isAuthLoading || merchantId && !current ? '프로필을 불러오는 중…' : current?.failed ? '프로필을 불러오지 못했어요' : '공개된 업체 프로필이 없어요'}</ThemedText>
        {current?.failed && <Pressable analyticsId="company.retry" accessibilityRole="button" style={styles.button}
          onPress={() => { play('selection'); setRevision((value) => value + 1); }}><ThemedText themeColor="accent">다시 불러오기</ThemedText></Pressable>}
      </View>}
    </ScrollView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  heading: { flex: 1 },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  state: { minHeight: 240, justifyContent: 'center', alignItems: 'center', gap: 16 },
  statePhoto: { gap: 8 },
  hiring: { alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, minHeight: 48, minWidth: 44, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 },
  tabCount: { fontSize: 12, lineHeight: 18 },
  panel: { gap: 16 },
  panelTitle: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  post: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, paddingVertical: 20, minHeight: 80 },
  postText: { flex: 1, gap: 6 },
  postImage: { width: 64, height: 64, borderRadius: 8 },
  aboutRow: { flexDirection: 'row', gap: 12 },
  aboutLabel: { width: 60 },
  aboutValue: { flex: 1 },
  reviewTabs: { flexDirection: 'row', gap: 8 },
  reviewTab: { minWidth: 72, minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
});
