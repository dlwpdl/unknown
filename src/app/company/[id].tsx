import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { SymbolView } from 'expo-symbols';
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
import { merchantMapsUrl, merchantPhoneUrl, setSavedMerchant, setSavedMerchantNotifications, startMerchantConversation } from '@/lib/merchant-conveniences';
import { safeMerchantSourceUrl } from '@/lib/merchant-source';
import { supabase } from '@/lib/supabase';

const tabs = [{ id: 'posts', label: '게시글' }, { id: 'jobs', label: '채용' }, { id: 'reviews', label: '리뷰' }, { id: 'about', label: '소개' }] as const;
type ProfileTab = typeof tabs[number]['id'];

export default function CompanyProfileRoute() {
  const { id, review } = useLocalSearchParams<{ id: string; review?: string }>(), router = useRouter(), theme = useTheme(), { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion(), scroll = useRef<NativeScrollView>(null), tabsTop = useRef(0);
  const { me, isAuthed, isAuthLoading, promptLogin } = useAuth(), hidden = useContentVisibility();
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
  const profileRead = useRef(0), actionRequest = useRef({ key, visibility: hidden, active: false, busy: false });
  const [actionBusy, setActionBusy] = useState<{ operation: typeof actionRequest.current; kind: 'save' | 'message' | 'notifications' } | null>(null);
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [unavailableRecipient, setUnavailableRecipient] = useState<string | null>(null);
  const reviewKind = selected?.merchantId === merchantId ? selected.kind : review === 'employment' ? 'employment' : 'usage';
  const current = result?.key === key ? result : null;
  const profile = current?.profile;
  const busy = actionBusy?.operation.key === key && actionBusy.operation.visibility === hidden && actionBusy.operation.active, canMessage = profile?.can_message && unavailableRecipient !== key;
  const phoneUrl = merchantPhoneUrl(profile?.public_phone ?? ''), mapsUrl = merchantMapsUrl(profile?.address ?? '');
  const publicLinks = profile?.links?.flatMap(link => { const url = safeMerchantSourceUrl(link.url); return url ? [{ ...link, url }] : []; }) ?? [];
  const currentPosts = postResult?.key === listKey ? postResult : null, postPage = currentPosts?.page;
  const visiblePosts = postPage?.posts.filter(post => !hidden('post', post.id, post.author.id));
  const postsLoading = postBusy || !currentPosts || currentPosts.attempt !== postRevision;
  const counts = countsResult?.key === key ? countsResult.value : null;
  const ratings = ratingResult?.key === key ? ratingResult.ratings : undefined;
  const reviewCount = ratings?.usage && ratings.employment ? ratings.usage.review_count + ratings.employment.review_count : undefined;
  const displayCount = (value: number | undefined, settled: boolean) => value == null ? settled ? '—' : '…' : value.toLocaleString('ko-KR');
  useFocusEffect(useCallback(() => {
    const operation = { key, visibility: hidden, active: true, busy: false };
    actionRequest.current = operation;
    return () => { operation.active = false; };
  }, [key, hidden]));
  useFocusEffect(useCallback(() => {
    if (!merchantId || isAuthLoading) return;
    let active = true; const request = ++profileRead.current;
    void loadMerchantProfile(supabase, merchantId).then((next) => {
      if (!active || request !== profileRead.current) return;
      setResult({ key, profile: next, failed: false });
      if (next?.can_message) setUnavailableRecipient(null);
    })
      .catch(() => { if (active && request === profileRead.current) setResult((previous) => ({ key, profile: previous?.key === key ? previous.profile : null, failed: true })); });
    return () => { active = false; };
  // Saving and visibility changes revalidate the same public profile.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, isAuthLoading, key, revision, hidden]));
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
  async function requestInquiry() {
    play('selection');
    if (!isAuthed) return promptLogin('비즈니스에 문의하려면 로그인해 주세요.');
    const operation = actionRequest.current;
    if (!profile || !canMessage || operation.busy || !operation.active) return;
    operation.busy = true; setActionBusy({ operation, kind: 'message' }); setActionError(null);
    try {
      const conversationId = await startMerchantConversation(supabase, merchantId);
      if (!operation.active) return;
      play('message'); router.push({ pathname: '/chat', params: { conversationId, view: 'requests' } });
    } catch (error) {
      if (!operation.active) return;
      if (error instanceof Error && error.message.includes('MERCHANT_CONTACT_UNAVAILABLE')) setUnavailableRecipient(key);
      setActionError({ key, message: '문의를 시작하지 못했어요. 담당자 연결 상태와 네트워크를 확인해 주세요.' }); play('warning');
    } finally { operation.busy = false; if (operation.active) setActionBusy(null); }
  }
  async function toggleSaved() {
    play('selection');
    if (!isAuthed) return promptLogin('비즈니스를 저장하려면 로그인해 주세요.');
    const operation = actionRequest.current;
    if (!profile || operation.busy || !operation.active) return;
    operation.busy = true; setActionBusy({ operation, kind: 'save' }); setActionError(null);
    try {
      const saved = await setSavedMerchant(supabase, merchantId, !profile.saved);
      if (!operation.active) return;
      profileRead.current++;
      setResult(previous => previous?.key === key && previous.profile ? { ...previous, profile: { ...previous.profile, saved, notifications_enabled: saved && previous.profile.notifications_enabled } } : previous);
      setRevision(value => value + 1); play('success');
    } catch {
      if (operation.active) { setActionError({ key, message: '저장 상태를 바꾸지 못했어요. 다시 시도해 주세요.' }); play('warning'); }
    } finally { operation.busy = false; if (operation.active) setActionBusy(null); }
  }
  async function toggleNotifications() {
    play('selection');
    const operation = actionRequest.current;
    if (!isAuthed || !profile?.saved || operation.key !== key || operation.visibility !== hidden || operation.busy || !operation.active) return;
    operation.busy = true; setActionBusy({ operation, kind: 'notifications' }); setActionError(null);
    try {
      const notifications_enabled = await setSavedMerchantNotifications(supabase, merchantId, !profile.notifications_enabled);
      if (!operation.active) return;
      profileRead.current++;
      setResult(previous => previous?.key === key && previous.profile ? { ...previous, profile: { ...previous.profile, notifications_enabled } } : previous);
      setRevision(value => value + 1); play('success');
    } catch {
      if (operation.active) { setActionError({ key, message: '새 소식 설정을 바꾸지 못했어요. 다시 시도해 주세요.' }); play('warning'); }
    } finally { operation.busy = false; if (operation.active) setActionBusy(null); }
  }
  async function openContact(url: string | null) {
    play('selection'); if (!url) return;
    const operation = actionRequest.current;
    setActionError(null);
    try { await Linking.openURL(url); }
    catch { if (operation.active) { setActionError({ key, message: '연결을 열지 못했어요. 이 기기의 전화 앱이나 브라우저를 확인해 주세요.' }); play('warning'); } }
  }
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
      <ThemedText type="subtitle" numberOfLines={1} style={styles.heading}>{profile?.name ?? '비즈니스 프로필'}</ThemedText>
    </View>
    <ScrollView ref={scroll} analyticsId="company.profile" contentContainerStyle={styles.content}>
      {profile ? <>
        <MerchantProfileHeader profile={{ ...profile, services: '', address: '' }} ratings={ratings}
          onReviewPress={profile.review_post_id ? openReviews : undefined} />
        <View style={styles.actions}>
          {!!canMessage && <Pressable analyticsId="company.inquiry" accessibilityRole="button" accessibilityLabel="비즈니스 담당자에게 문의"
            accessibilityState={{ disabled: busy, busy: busy && actionBusy?.kind === 'message' }} disabled={busy}
            style={({ pressed }) => [styles.inquiry, { backgroundColor: theme.accent, opacity: busy || pressed ? 0.65 : 1 }]}
            onPress={() => void requestInquiry()}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{busy && actionBusy?.kind === 'message' ? '연결 중…' : '문의하기'}</ThemedText></Pressable>}
          <Pressable analyticsId="company.save" accessibilityRole="button" accessibilityLabel={profile.saved ? '비즈니스 저장 취소' : '비즈니스 저장'}
            accessibilityState={{ selected: profile.saved, disabled: busy, busy: busy && actionBusy?.kind === 'save' }} disabled={busy}
            style={({ pressed }) => [styles.secondaryAction, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card, opacity: busy ? 0.65 : 1 }]}
            onPress={() => void toggleSaved()}><SymbolView name={{ ios: profile.saved ? 'bookmark.fill' : 'bookmark', android: profile.saved ? 'bookmark' : 'bookmark_border', web: profile.saved ? 'bookmark' : 'bookmark_border' }} size={17} tintColor={theme.accent} />
            <ThemedText type="smallBold" themeColor="accent">{busy && actionBusy?.kind === 'save' ? '저장 중…' : profile.saved ? '저장됨' : '저장'}</ThemedText></Pressable>
          {isAuthed && profile.saved && <Pressable analyticsId="company.notifications" accessibilityRole="button" accessibilityLabel="새 소식 받기"
            accessibilityState={{ selected: profile.notifications_enabled, disabled: busy, busy: busy && actionBusy?.kind === 'notifications' }} disabled={busy}
            style={({ pressed }) => [styles.secondaryAction, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card, opacity: busy ? 0.65 : 1 }]}
            onPress={() => void toggleNotifications()}><SymbolView name={{ ios: profile.notifications_enabled ? 'bell.fill' : 'bell', android: profile.notifications_enabled ? 'notifications' : 'notifications_none', web: profile.notifications_enabled ? 'notifications' : 'notifications_none' }} size={17} tintColor={theme.accent} />
            <ThemedText type="smallBold" themeColor="accent">{busy && actionBusy?.kind === 'notifications' ? '설정 중…' : profile.notifications_enabled ? '새 소식 받는 중' : '새 소식 받기'}</ThemedText></Pressable>}
        </View>
        {!canMessage && <View style={styles.statePhoto}>
          <ThemedText type="small" themeColor="textSecondary">앱에서 연결할 수 있는 담당자가 없어요.{!phoneUrl && !publicLinks.length ? ' 공개 연락처도 아직 등록되지 않았어요.' : ' 등록된 공개 연락처를 이용해 주세요.'}</ThemedText>
          <View style={styles.actions}>
            {!!phoneUrl && <Pressable analyticsId="company.contact.phone" accessibilityRole="link" accessibilityLabel={`비즈니스 공개 전화 ${profile.public_phone}`} style={styles.button} onPress={() => void openContact(phoneUrl)}><ThemedText themeColor="accent">전화하기</ThemedText></Pressable>}
            {publicLinks.map((link, index) => <Pressable key={link.url} analyticsId={`company.contact.source.${index}`} accessibilityRole="link" accessibilityLabel={`${link.label} 공개 링크 열기`} style={styles.button} onPress={() => void openContact(link.url)}><ThemedText themeColor="accent">{link.label} ›</ThemedText></Pressable>)}
          </View>
        </View>}
        {actionError?.key === key && <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite">{actionError.message}</ThemedText>}
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
            <Pressable analyticsId="company.posts.about" accessibilityRole="button" style={styles.button} onPress={() => selectTab('about')}><ThemedText themeColor="accent">비즈니스 소개 보기</ThemedText></Pressable>
          </View>}
          {postPage?.has_more && <Pressable analyticsId="company.posts.more" accessibilityRole="button" disabled={postsLoading} style={styles.button}
            onPress={() => void morePosts()}><ThemedText themeColor="accent">{tab === 'posts' ? '게시글' : '채용 공고'} 더 보기</ThemedText></Pressable>}
        </View>}
        {tab === 'about' && <View style={styles.panel}>
          <ThemedText type="subtitle">{profile.name} 소개</ThemedText>
          <ThemedText>{profile.services || '등록된 소개가 없어요.'}</ThemedText>
          {[['업종', profile.industry], ['지역', profile.city_name], ['주소', profile.address], ['전화', profile.public_phone], ['영업시간', profile.business_hours]].filter(([, value]) => !!value).map(([label, value]) =>
            <View key={label} style={styles.aboutRow}><ThemedText type="small" themeColor="textSecondary" style={styles.aboutLabel}>{label}</ThemedText><ThemedText type="small" style={styles.aboutValue}>{value}</ThemedText></View>)}
          <View style={styles.actions}>
            {!!phoneUrl && <Pressable analyticsId="company.about.phone" accessibilityRole="link" accessibilityLabel={`공개 전화 ${profile.public_phone}`} style={styles.button} onPress={() => void openContact(phoneUrl)}><ThemedText themeColor="accent">전화하기</ThemedText></Pressable>}
            {!!mapsUrl && <Pressable analyticsId="company.about.maps" accessibilityRole="link" accessibilityLabel="등록된 주소를 Google 지도에서 보기" style={styles.button} onPress={() => void openContact(mapsUrl)}><ThemedText themeColor="accent">길찾기</ThemedText></Pressable>}
            {publicLinks.map((link, index) => <Pressable key={link.url} analyticsId={`company.about.source.${index}`} accessibilityRole="link" accessibilityLabel={`${link.label} 공개 링크 열기`} style={styles.button} onPress={() => void openContact(link.url)}><ThemedText themeColor="accent">{link.label} ›</ThemedText></Pressable>)}
          </View>
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
        <ThemedText type="subtitle">{isAuthLoading || merchantId && !current ? '프로필을 불러오는 중…' : current?.failed ? '프로필을 불러오지 못했어요' : '공개된 비즈니스 프로필이 없어요'}</ThemedText>
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
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inquiry: { flexGrow: 1, minHeight: 44, minWidth: 44, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  secondaryAction: { flexDirection: 'row', gap: 8, minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
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
