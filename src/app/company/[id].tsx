import { ControlMotion, ControlStyles, IconSize, controlPresentation } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { SymbolView } from '@/components/symbol-view';
import { Animated, Platform, Share, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageHeader } from '@/components/page-header';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { usePublicWebshop, WebshopBanner, WebshopComparisonSheet, WebshopOrderButton } from '@/components/business-webshop';
import { DragSheet } from '@/components/drag-sheet';
import { GlingLoader } from '@/components/gling-loader';
import { MerchantProfileHeader } from '@/components/merchant-profile-header';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { MerchantReviews } from '@/components/merchant-reviews';
import { ReportSheet } from '@/components/report-sheet';
import { SavedEntryButton, useSavedEntry } from '@/components/saved-entry';
import { ClayBoxFill, ClayControlFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { chatBusinessIdentity } from '@/lib/chat-identity';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { appendUniquePosts, getPostImageSource } from '@/lib/feed-data';
import { loadMerchantProfile, loadMerchantProfilePosts, type MerchantProfile, type MerchantProfilePostPage } from '@/lib/merchant-profile';
import { loadMerchantReviews, type MerchantReviewKind, type MerchantReviewPage } from '@/lib/merchant-reviews';
import { merchantMapsUrl, merchantPhoneUrl, setSavedMerchantNotifications, startMerchantConversation } from '@/lib/merchant-conveniences';
import { safeMerchantSourceUrl } from '@/lib/merchant-source';
import { placeMapRoute } from '@/lib/discovery';
import { loadMerchantSaves, type MerchantSaves } from '@/lib/profile-friends';
import { publicCompanyUrl } from '@/lib/public-seo';
import { loadCityBusinessLinks } from '@/lib/webshops';
import { supabase } from '@/lib/supabase';
import { localizeBusinessDisclosure } from '@/lib/translation-source';

// A business with no linked post has no reviews yet; its two rating rows still show as empty.
const NO_REVIEWS = { usage: { rating_average: null, review_count: 0 }, employment: { rating_average: null, review_count: 0 } };
const tabs = [{ id: 'about', label: '소개' }, { id: 'posts', label: '소식' }, { id: 'jobs', label: '채용' }, { id: 'reviews', label: '후기' }] as const;
type ProfileTab = typeof tabs[number]['id'];

export default function CompanyProfileRoute() {
  const { tr, locale: appLocale } = useLanguage();
  const { id, review } = useLocalSearchParams<{ id: string; review?: string }>(), router = useRouter(), theme = useTheme(), clay = useClay(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion(), scroll = useRef<ScrollViewInstance>(null), tabsTop = useRef(0);
  const { me, isAuthed, isAuthLoading, promptLogin } = useAuth(), hidden = useContentVisibility();
  const business = useChatIdentity();
  const merchantId = typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : '';
  const key = `${merchantId}:${isAuthLoading ? 'loading' : isAuthed ? me.id : 'guest'}`;
  const [reviewVisited, setReviewVisited] = useState<string | null>(review ? key : null);
  const [result, setResult] = useState<{ key: string; profile: MerchantProfile | null; failed: boolean } | null>(null), [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{ merchantId: string; kind: MerchantReviewKind } | null>(null), [reviewRevision, setReviewRevision] = useState(0);
  const [ratingResult, setRatingResult] = useState<{ key: string; ratings: Record<MerchantReviewKind, Pick<MerchantReviewPage, 'rating_average' | 'review_count'> | null> } | null>(null);
  const [tabResult, setTabResult] = useState<{ merchantId: string; tab: ProfileTab } | null>(null);
  // R2-11: a business profile opens on its news; review links still open reviews.
  const tab = tabResult?.merchantId === merchantId ? tabResult.tab : review ? 'reviews' : 'posts';
  const postKind = tab === 'jobs' ? 'jobs' : 'posts', listKey = `${key}:${postKind}`;
  const [postResult, setPostResult] = useState<{ key: string; page: MerchantProfilePostPage | null; failed: boolean; attempt: number } | null>(null);
  const [countsResult, setCountsResult] = useState<{ key: string; value: Pick<MerchantProfilePostPage, 'post_count' | 'job_count'> | null } | null>(null);
  const [postRevision, setPostRevision] = useState(0), [postBusy, setPostBusy] = useState(false);
  const postRequest = useRef({ active: false, reading: false });
  const profileRead = useRef(0), actionRequest = useRef({ key, visibility: hidden, active: false, busy: false });
  const [actionBusy, setActionBusy] = useState<{ operation: typeof actionRequest.current; kind: 'message' | 'notifications' } | null>(null);
  const [actionError, setActionError] = useState<{ key: string; message: string } | null>(null);
  const [unavailableRecipient, setUnavailableRecipient] = useState<string | null>(null);
  const [saves, setSaves] = useState<{ key: string; value: MerchantSaves | null } | null>(null);
  const [mapPlace, setMapPlace] = useState<{ key: string; placeKey: string | null } | null>(null);
  const [menu, setMenu] = useState<{ key: string; view: 'open' | 'report' } | null>(null), afterMenu = useRef<(() => void) | null>(null);
  const reviewKind = selected?.merchantId === merchantId ? selected.kind : review === 'employment' ? 'employment' : 'usage';
  const current = result?.key === key ? result : null;
  const profile = current?.profile;
  // B1: the same 가 보고 싶어요·가 봤어요 sheet as a place; its state is the canonical saved item for this business.
  const saved = useSavedEntry(merchantId ? { kind: 'merchant', id: merchantId } : null, !!profile), isSaved = !!saved.state?.saved;
  // An unsave drops the 새 소식 받기 choice with it, as the server does (adjusted while rendering, so no extra pass).
  if (saved.state?.saved === false && profile?.notifications_enabled) setResult(previous => previous?.profile ? { ...previous, profile: { ...previous.profile, notifications_enabled: false } } : previous);
  const webshop = usePublicWebshop(supabase, profile?.id, `${key}:${revision}`);
  const [orderMerchant, setOrderMerchant] = useState<string | null>(null);
  const orderOpen = orderMerchant === merchantId;
  const busy = actionBusy?.operation.key === key && actionBusy.operation.visibility === hidden && actionBusy.operation.active, canMessage = profile?.can_message && unavailableRecipient !== key;
  const phoneUrl = merchantPhoneUrl(profile?.public_phone ?? ''), mapsUrl = merchantMapsUrl(profile?.address ?? '');
  const publicLinks = profile?.links?.flatMap(link => { const url = safeMerchantSourceUrl(link.url); return url ? [{ ...link, url }] : []; }) ?? [];
  const currentPosts = postResult?.key === listKey ? postResult : null, postPage = currentPosts?.page;
  const visiblePosts = postPage?.posts.filter(post => !hidden('post', post.id, post.author.id));
  const postsLoading = postBusy || !currentPosts || currentPosts.attempt !== postRevision;
  const counts = countsResult?.key === key ? countsResult.value : null;
  const ratings = ratingResult?.key === key ? ratingResult.ratings : undefined;
  const reviewCount = ratings?.usage && ratings.employment ? ratings.usage.review_count + ratings.employment.review_count : undefined;
  const displayCount = (value: number | undefined, settled: boolean) => value == null ? settled ? '—' : '…' : value.toLocaleString(appLocale);
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
  // Who saved it and similar places; nothing shows when the server has no real saves.
  useEffect(() => {
    if (!profile?.id || isAuthLoading) return;
    let active = true;
    void loadMerchantSaves(supabase, merchantId).then(value => { if (active) setSaves({ key, value }); }).catch(() => { if (active) setSaves({ key, value: null }); });
    return () => { active = false; };
  }, [profile?.id, isAuthLoading, merchantId, key, revision, hidden]);
  // R2-14: 위치 보기 opens the business's own pin on the Gling map when it is linked to one.
  useEffect(() => {
    if (!profile?.city_id || isAuthLoading) return;
    let active = true;
    void loadCityBusinessLinks(supabase, profile.city_id).then(links => {
      if (active) setMapPlace({ key, placeKey: Object.entries(links).find(([, id]) => id === merchantId)?.[0] ?? null });
    }).catch(() => { if (active) setMapPlace({ key, placeKey: null }); });
    return () => { active = false; };
  }, [profile?.city_id, isAuthLoading, merchantId, key]);
  // Every tab switch fades the shown panel in, including the kept-mounted reviews panel. Opacity only, so it also runs with reduced motion.
  const [panelFade] = useState(() => new Animated.Value(1));
  useLayoutEffect(() => {
    panelFade.setValue(0);
    const fade = Animated.timing(panelFade, { toValue: 1, duration: ControlMotion.settleMs, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [panelFade, tab]);
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
    if (!profile || !canMessage || business?.id === merchantId || operation.busy || !operation.active || (chatBusinessIdentity(me.id)?.id ?? null) !== (business?.id ?? null)) return;
    operation.busy = true; setActionBusy({ operation, kind: 'message' }); setActionError(null);
    try {
      const conversationId = await startMerchantConversation(supabase, merchantId, business?.id ?? null);
      if (!operation.active || (chatBusinessIdentity(me.id)?.id ?? null) !== (business?.id ?? null)) return;
      play('message'); router.push({ pathname: '/chat', params: { conversationId, view: 'direct', ...(business ? { businessId: business.id } : {}) } });
    } catch (error) {
      if (!operation.active) return;
      if (error instanceof Error && error.message.includes('MERCHANT_CONTACT_UNAVAILABLE')) setUnavailableRecipient(key);
      setActionError({ key, message: '문의를 시작하지 못했어요. 담당자 연결 상태와 네트워크를 확인해 주세요.' }); play('warning');
    } finally { operation.busy = false; if (operation.active) setActionBusy(null); }
  }
  async function toggleNotifications() {
    play('selection');
    const operation = actionRequest.current;
    if (!isAuthed || !profile || !isSaved || operation.key !== key || operation.visibility !== hidden || operation.busy || !operation.active) return;
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
  const glingPlace = mapPlace?.key === key ? mapPlace.placeKey : null;
  const shownSaves = saves?.key === key ? saves.value : null;
  const intro = profile ? ([[tr('분위기'), profile.intro_vibe], [tr('뭘 시킬까'), profile.intro_order], [tr('팁'), profile.intro_tip]] as const).filter(([, value]) => !!value) : [];
  function openLocation() {
    if (profile && glingPlace) { play('selection'); router.push(placeMapRoute({ id: glingPlace, cityId: profile.city_id })); }
    else void openContact(mapsUrl);
  }
  const closeMenu = (then?: () => void) => { afterMenu.current = then ?? null; setMenu(null); };
  async function shareProfile() {
    const url = publicCompanyUrl(merchantId);
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) await navigator.share({ url });
        else { await navigator.clipboard.writeText(url); setActionError({ key, message: '프로필 링크를 복사했어요.' }); }
      } else await Share.share({ message: url });
      play('success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setActionError({ key, message: '공유하지 못했어요. 다시 눌러주세요.' }); play('warning');
    }
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
  return <KeyboardScreen><ThemedView style={styles.page}><SafeAreaView style={styles.page} edges={['left', 'right']}>
    <PageHeader title={tr("비즈니스 프로필")} analyticsId="company.back" right={profile ? <View style={styles.headerActions}>
          <SavedEntryButton entry={saved} kind="place" analyticsId="company.save" onBeen={() => openReviews('usage')} />
          <Pressable analyticsId="company.more" accessibilityRole="button" accessibilityLabel={tr('더보기')} accessibilityHint={tr('공유, 신고')}
            style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}
            onPress={() => { play('selection'); setMenu({ key, view: 'open' }); }}>
            <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={IconSize.toolbar} tintColor={theme.text} />
          </Pressable>
    </View> : undefined} />
    <ScrollView ref={scroll} analyticsId="company.profile" contentContainerStyle={styles.content}>
      {profile ? <>
        <MerchantProfileHeader profile={{ ...profile, services: '', address: '' }} ratings={profile.review_post_id ? ratings : NO_REVIEWS}
          onReviewPress={openReviews} />
        {!!counts?.job_count && <Pressable analyticsId="company.hiring" accessibilityRole="button" style={styles.hiring}
          onPress={() => { selectTab('jobs'); scroll.current?.scrollTo({ y: tabsTop.current, animated: !reducedMotion }); }}>
          <ThemedText type="small" themeColor="accent">{tr('• 채용 중 · {0}건 ›', counts.job_count.toLocaleString(appLocale))}</ThemedText>
        </Pressable>}
        {!!profile.services && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{profile.services.split(/\r?\n/, 1)[0]}</ThemedText>}
        {webshop.shop && <WebshopBanner shop={webshop.shop} onPress={() => setOrderMerchant(merchantId)} />}
        {webshop.failed && <Pressable analyticsId="webshop.retry" accessibilityRole="button" style={[styles.button, clay && styles.clayPad]} onPress={() => { play('selection'); webshop.retry(); }}>{clay && <ClayPillFill kind="white" />}<ThemedText type="small" themeColor="accent">{tr("웹샵 정보를 다시 확인해주세요")}</ThemedText></Pressable>}
        <View style={styles.actions}>

          {isAuthed && isSaved && <Pressable analyticsId="company.notifications" accessibilityRole="button" accessibilityLabel={tr("새 소식 받기")}
            accessibilityState={{ selected: profile.notifications_enabled, disabled: busy, busy: busy && actionBusy?.kind === 'notifications' }} disabled={busy}
            style={({ pressed }) => [styles.secondaryAction, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : theme.card, opacity: busy ? 0.65 : 1 }]}
            onPress={() => void toggleNotifications()}><SymbolView name={{ ios: profile.notifications_enabled ? 'bell.fill' : 'bell', android: profile.notifications_enabled ? 'notifications' : 'notifications_none', web: profile.notifications_enabled ? 'notifications' : 'notifications_none' }} size={17} tintColor={theme.accent} />
            <ThemedText type="smallBold" themeColor="accent">{busy && actionBusy?.kind === 'notifications' ? tr("설정 중…") : profile.notifications_enabled ? tr("새 소식 받는 중") : tr("새 소식 받기")}</ThemedText></Pressable>}
        </View>
        {!canMessage && <View style={styles.statePhoto}>
          <ThemedText type="small" themeColor="textSecondary">{tr("앱에서 연결할 수 있는 담당자가 없어요.")}{!phoneUrl && !publicLinks.length ? tr(" 공개 연락처도 아직 등록되지 않았어요.") : tr(" 등록된 공개 연락처를 이용해 주세요.")}</ThemedText>
          <View style={styles.actions}>
            {!!phoneUrl && <Pressable analyticsId="company.contact.phone" accessibilityRole="link" accessibilityLabel={tr("비즈니스 공개 전화 {0}", (profile.public_phone))} style={[styles.button, clay && styles.clayPad]} onPress={() => void openContact(phoneUrl)}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("전화하기")}</ThemedText></Pressable>}
            {publicLinks.map((link, index) => <Pressable key={link.url} analyticsId={`company.contact.source.${index}`} accessibilityRole="link" accessibilityLabel={tr("{0} 공개 링크 열기", (link.label))} style={[styles.button, clay && styles.clayPad]} onPress={() => void openContact(link.url)}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{link.label} ›</ThemedText></Pressable>)}
          </View>
        </View>}
        {actionError?.key === key && <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite">{tr(actionError.message)}</ThemedText>}
        {!!saved.error && <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite">{saved.error}</ThemedText>}
        {(profile.imageLoadFailed || current?.failed) && <View style={styles.statePhoto}>
          <ThemedText type="small" themeColor="textSecondary">{tr("사진을 다시 불러오지 못했어요. 비즈니스 정보와 저장된 사진은 유지돼요.")}</ThemedText>
          <Pressable analyticsId="company.photo.retry" accessibilityRole="button" style={[styles.button, clay && styles.clayPad]}
            onPress={() => { play('selection'); setRevision((value) => value + 1); }}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("사진 다시 확인")}</ThemedText></Pressable>
        </View>}
        {!!shownSaves && (shownSaves.saverCount > 0 || shownSaves.friends.length > 0) && <View style={[styles.box, clayBox ? styles.clayCard : { backgroundColor: theme.backgroundElement }]}>
          {clayBox && <ClayBoxFill kind="tile" />}
          <ThemedText type="smallBold">{tr('저장한 사람 {0}명', shownSaves.saverCount.toLocaleString(appLocale))}{shownSaves.weekCount > 0 ? ` · ${tr('이번 주 +{0}', shownSaves.weekCount.toLocaleString(appLocale))}` : ''}</ThemedText>
          {shownSaves.firstIsMe && <ThemedText type="smallBold" themeColor="accent">{tr('내가 처음 저장했어요')}</ThemedText>}
          {shownSaves.friends.length > 0 ? <View style={styles.actions}>
            {shownSaves.friends.map(friend => <Pressable key={friend.id} analyticsId="company.saves.friend" accessibilityRole="link" accessibilityLabel={tr('{0} 프로필 보기', friend.nickname)}
              onPress={() => { play('selection'); router.push({ pathname: '/user/[id]', params: { id: friend.id, nickname: friend.nickname } }); }}
              style={({ pressed }) => [ControlStyles.pill, styles.chip, clay && styles.clayPad, controlPresentation(theme, { pressed, clay }).container]}>
              {clay && <ClayControlFill />}
              <ThemedText type="small">{friend.first ? tr('{0}님이 처음 저장', friend.nickname) : tr('{0}님이 저장', friend.nickname)}</ThemedText>
            </Pressable>)}
          </View> : <ThemedText type="small" themeColor="textSecondary">{tr('친구가 저장하면 여기에 이름이 보여요. 다른 사람은 숫자로만 보여요.')}</ThemedText>}
        </View>}
        {intro.length > 0 && <View style={styles.introBlock}>
          {intro.map(([label, value]) => <View key={label} style={styles.aboutRow}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.aboutLabel}>{label}</ThemedText>
            <ThemedText type="small" style={styles.aboutValue}>{value}</ThemedText>
          </View>)}
        </View>}
        <View onLayout={event => { tabsTop.current = event.nativeEvent.layout.y; }} style={[styles.tabs, { borderBottomColor: theme.line }]} accessibilityRole="tablist">
          {tabs.map(item => {
            const count = item.id === 'posts' ? displayCount(counts?.post_count, !!currentPosts?.failed || countsResult?.key === key)
              : item.id === 'jobs' ? displayCount(counts?.job_count, !!currentPosts?.failed || countsResult?.key === key)
              : item.id === 'reviews' && profile.review_post_id ? displayCount(reviewCount, ratingResult?.key === key) : null;
            return <Pressable key={item.id} analyticsId={`company.tab.${item.id}`} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}
              accessibilityLabel={count == null ? tr(item.label) : tr('{0} {1}건', tr(item.label), count)} style={[styles.tab, { borderBottomColor: tab === item.id ? theme.accent : 'transparent' }]}
              onPress={() => selectTab(item.id)}>
              <ThemedText type="smallBold" themeColor={tab === item.id ? 'accent' : 'textSecondary'}>{tr(item.label)}</ThemedText>
              {count != null && <ThemedText style={styles.tabCount} themeColor={tab === item.id ? 'accent' : 'textSecondary'}>{count}</ThemedText>}
            </Pressable>;
          })}
        </View>
        {(tab === 'posts' || tab === 'jobs') && <Animated.View style={[styles.panel, { opacity: panelFade }]}>
          <View style={styles.panelTitle}><ThemedText type="subtitle">{tab === 'posts' ? tr("최근 게시글") : tr("함께할 사람을 찾고 있어요")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{tr("최신순")}</ThemedText></View>
          {postsLoading && <GlingLoader color={theme.accent} accessibilityLabel={tr("글 불러오는 중")} />}
          {currentPosts?.failed && <View style={styles.statePhoto}><ThemedText type="small">{tr("글을 불러오지 못했어요.")}</ThemedText>
            <Pressable analyticsId="company.posts.retry" accessibilityRole="button" disabled={postsLoading} style={[styles.button, clay && styles.clayPad]}
              onPress={() => { if (postPage?.has_more) void morePosts(); else { play('selection'); setPostRevision(value => value + 1); } }}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("다시 불러오기")}</ThemedText></Pressable></View>}
          {visiblePosts?.map(post => {
            const source = getPostImageSource(post, isAuthed ? me.id : 'guest');
            return <Pressable key={post.id} analyticsId="company.post" accessibilityRole="link" accessibilityLabel={tr("{0} 전체 보기", (post.title))}
              style={[styles.post, { borderBottomColor: theme.line }]} onPress={() => { play('selection'); router.push({ pathname: '/post/[id]', params: { id: post.id } }); }}>
              <View style={styles.postText}><ThemedText type="small" themeColor="textSecondary">{tab === 'jobs' ? tr("모집 중") : tr(post.tag.label)} · {post.createdAtLabel}</ThemedText>
                <ThemedText type="smallBold" numberOfLines={2}>{post.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{localizeBusinessDisclosure(post.body, tr)}</ThemedText></View>
              {source ? <Image source={source} contentFit="cover" transition={ControlMotion.settleMs} style={styles.postImage} accessibilityLabel={tr("{0} 사진", (post.title))} /> : <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>}
            </Pressable>;
          })}
          {!postsLoading && !currentPosts?.failed && (!postPage || !visiblePosts?.length) && <View style={styles.state}>
            <ThemedText type="smallBold">{!postPage ? tr("현재 공개된 글을 볼 수 없어요") : tab === 'posts' ? tr("아직 게시글이 없어요") : tr("현재 모집 중인 공고가 없어요")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{tr("새 글이 등록되면 여기에서 볼 수 있어요.")}</ThemedText>
            <Pressable analyticsId="company.posts.about" accessibilityRole="button" style={[styles.button, clay && styles.clayPad]} onPress={() => selectTab('about')}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("비즈니스 소개 보기")}</ThemedText></Pressable>
          </View>}
          {postPage?.has_more && <Pressable analyticsId="company.posts.more" accessibilityRole="button" disabled={postsLoading} style={[styles.button, clay && styles.clayPad]}
            onPress={() => void morePosts()}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tab === 'posts' ? tr('게시글 더 보기') : tr('채용 공고 더 보기')}</ThemedText></Pressable>}
        </Animated.View>}
        {tab === 'about' && <Animated.View style={[styles.panel, { opacity: panelFade }]}>
          <ThemedText type="subtitle">{tr('{0} 소개', profile.name)}</ThemedText>
          <ThemedText>{profile.services || tr("등록된 소개가 없어요.")}</ThemedText>
          {[[tr("업종"), profile.industry && tr(profile.industry)], [tr("지역"), profile.city_name && tr(profile.city_name)], [tr("주소"), profile.address], [tr("전화"), profile.public_phone], [tr("영업시간"), profile.business_hours]].filter(([, value]) => !!value).map(([label, value]) =>
            <View key={label} style={styles.aboutRow}><ThemedText type="small" themeColor="textSecondary" style={styles.aboutLabel}>{label}</ThemedText><ThemedText type="small" style={styles.aboutValue}>{value}</ThemedText></View>)}
          <View style={styles.actions}>
            {!!phoneUrl && <Pressable analyticsId="company.about.phone" accessibilityRole="link" accessibilityLabel={tr("공개 전화 {0}", (profile.public_phone))} style={[styles.button, clay && styles.clayPad]} onPress={() => void openContact(phoneUrl)}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("전화하기")}</ThemedText></Pressable>}
            {(!!glingPlace || !!mapsUrl) && <Pressable analyticsId="company.about.maps" accessibilityRole="link" accessibilityLabel={glingPlace ? tr("글링 지도에서 위치 보기") : tr("등록된 주소를 Google 지도에서 보기")} style={[styles.button, clay && styles.clayPad]} onPress={openLocation}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("길찾기")}</ThemedText></Pressable>}
            {publicLinks.map((link, index) => <Pressable key={link.url} analyticsId={`company.about.source.${index}`} accessibilityRole="link" accessibilityLabel={tr("{0} 공개 링크 열기", (link.label))} style={[styles.button, clay && styles.clayPad]} onPress={() => void openContact(link.url)}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{link.label} ›</ThemedText></Pressable>)}
          </View>
        </Animated.View>}
        {tab === 'reviews' && !profile.review_post_id && <Animated.View style={[styles.panel, { opacity: panelFade }]}>
          <ThemedText type="smallBold">{tr("아직 표시할 후기가 없어요")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr("공개된 후기는 이곳에서 확인할 수 있어요.")}</ThemedText>
        </Animated.View>}
        {(tab === 'reviews' || reviewVisited === key) && profile.review_post_id && <Animated.View
          style={[styles.panel, { opacity: panelFade }, tab !== 'reviews' && { display: 'none' }]} accessibilityElementsHidden={tab !== 'reviews'}
          importantForAccessibility={tab !== 'reviews' ? 'no-hide-descendants' : 'auto'}>
          <View style={styles.reviewTabs} accessibilityLabel={tr("리뷰 종류")}>
            {(['usage', 'employment'] as const).map(kind => <Pressable key={kind} analyticsId={`company.reviews.${kind}`} accessibilityRole="button"
              accessibilityState={{ selected: kind === reviewKind }} style={[styles.reviewTab, clay ? styles.clayPad : { borderColor: kind === reviewKind ? theme.accent : theme.line, backgroundColor: kind === reviewKind ? theme.card : theme.background }]}
              onPress={() => { play('selection'); setSelected({ merchantId, kind }); }}>
              {clay && <ClayPillFill kind={kind === reviewKind ? 'on' : 'white'} />}
              <ThemedText type="smallBold" themeColor={kind === reviewKind ? 'accent' : 'textSecondary'} style={clay && kind === reviewKind ? { color: theme.accentInk } : undefined}>{kind === 'usage' ? tr("상품·서비스 후기") : tr("직원 후기")} {displayCount(ratings?.[kind]?.review_count, ratingResult?.key === key)}</ThemedText>
            </Pressable>)}
          </View>
          <MerchantReviews postId={profile.review_post_id} reviewKind={reviewKind} onChanged={() => setReviewRevision(value => value + 1)} />
        </Animated.View>}
        {!!shownSaves?.similar.length && <View style={styles.panel}>
          <ThemedText type="subtitle">{tr('같이 저장된 곳')}</ThemedText>
          {shownSaves.similar.map((place, index) => <Pressable key={place.merchantId} analyticsId="company.similar" accessibilityRole="link" accessibilityLabel={tr('{0} 비즈니스 프로필 보기', place.name)}
            onPress={() => { play('selection'); router.push({ pathname: '/company/[id]', params: { id: place.merchantId } }); }}
            style={({ pressed }) => [styles.similar, { borderBottomColor: theme.line, opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText type="smallBold" themeColor="accent" style={styles.rank}>{index + 1}</ThemedText>
            <View style={styles.postText}>
              <ThemedText type="smallBold" numberOfLines={1}>{place.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{place.weekCount > 0 ? tr('저장 {0} · 이번 주 +{1}', place.saverCount.toLocaleString(appLocale), place.weekCount.toLocaleString(appLocale)) : tr('저장 {0}', place.saverCount.toLocaleString(appLocale))}</ThemedText>
            </View>
            <ThemedText themeColor="textSecondary" accessible={false}>›</ThemedText>
          </Pressable>)}
        </View>}
      </> : <View style={styles.state}>
        {isAuthLoading || merchantId && !current ? <GlingLoader color={theme.accent} accessibilityLabel={tr("프로필 불러오는 중")} />
          : <ThemedText type="subtitle">{current?.failed ? tr("프로필을 불러오지 못했어요") : tr("공개된 비즈니스 프로필이 없어요")}</ThemedText>}
        {current?.failed && <Pressable analyticsId="company.retry" accessibilityRole="button" style={[styles.button, clay && styles.clayPad]}
          onPress={() => { play('selection'); setRevision((value) => value + 1); }}>{clay && <ClayPillFill kind="white" />}<ThemedText themeColor="accent">{tr("다시 불러오기")}</ThemedText></Pressable>}
      </View>}
    </ScrollView>
    {profile && (webshop.shop || canMessage && business?.id !== merchantId || mapsUrl || glingPlace) && <SafeAreaView edges={['bottom']} style={[styles.inquiryBar, { borderTopColor: theme.line, backgroundColor: theme.background }]}>
      {webshop.shop && <WebshopOrderButton shop={webshop.shop} onPress={() => setOrderMerchant(merchantId)} />}
      <View style={styles.footerActions}>
        {!!canMessage && business?.id !== merchantId && <Pressable analyticsId="company.inquiry" accessibilityRole="button" accessibilityLabel={tr("비즈니스 담당자에게 문의")}
          accessibilityState={{ disabled: busy, busy: busy && actionBusy?.kind === 'message' }} disabled={busy}
          style={({ pressed }) => [styles.inquiry, clay && styles.clayInquiry, { flex: 1, borderColor: clay ? 'transparent' : theme.line, backgroundColor: clay ? 'transparent' : webshop.shop ? theme.card : theme.accent, opacity: busy ? 0.45 : pressed ? 0.82 : 1 }]}
          onPress={() => void requestInquiry()}>{clay && <ClayPillFill kind={webshop.shop ? 'white' : 'cta'} />}<ThemedText type="smallBold" style={{ color: webshop.shop ? theme.text : theme.accentInk }}>{busy && actionBusy?.kind === 'message' ? tr("연결 중…") : tr("문의하기")}</ThemedText></Pressable>}
        {(!!mapsUrl || !!glingPlace) && <Pressable analyticsId="company.location" accessibilityRole="link" accessibilityLabel={glingPlace ? tr("글링 지도에서 위치 보기") : tr("위치 보기")} style={({ pressed }) => [styles.inquiry, clay && styles.clayInquiry, { flex: 1, backgroundColor: clay ? 'transparent' : theme.card, borderColor: clay ? 'transparent' : theme.line, opacity: pressed ? 0.82 : 1 }]} onPress={openLocation}>{clay && <ClayPillFill kind="white" />}<ThemedText type="smallBold">{tr("위치 보기")}</ThemedText></Pressable>}
      </View>
    </SafeAreaView>}
    <DragSheet visible={!!profile && menu?.key === key && menu.view === 'open'} onClose={() => closeMenu()} onDismissed={() => { const then = afterMenu.current; afterMenu.current = null; then?.(); }}>
      {profile && <View style={styles.menu}>
        <Pressable analyticsId="company.menu.share" accessibilityRole="button" onPress={() => { play('selection'); closeMenu(() => void shareProfile()); }}
          style={({ pressed }) => [styles.menuRow, { borderBottomColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
          <SymbolView name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }} size={20} tintColor={theme.text} />
          <ThemedText type="smallBold">{tr('프로필 공유')}</ThemedText>
        </Pressable>
        {isAuthed && !!profile.review_post_id && business?.id !== merchantId && <Pressable analyticsId="company.menu.report" accessibilityRole="button" onPress={() => { play('selection'); closeMenu(() => setMenu({ key, view: 'report' })); }}
          style={({ pressed }) => [styles.menuRow, { borderBottomColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
          <SymbolView name={{ ios: 'flag', android: 'flag', web: 'flag' }} size={20} tintColor={theme.danger} />
          <ThemedText type="smallBold" style={{ color: theme.danger }}>{tr('{0} 신고하기', profile.name)}</ThemedText>
        </Pressable>}
      </View>}
    </DragSheet>
    {profile?.review_post_id && menu?.key === key && menu.view === 'report' && <ReportSheet visible targetType="post" targetId={profile.review_post_id} reportedBusinessId={merchantId}
      reportedNickname={profile.name} onClose={() => { setMenu(null); setRevision(value => value + 1); }} />}
    {profile && webshop.shop && <WebshopComparisonSheet key={merchantId} client={supabase} shop={webshop.shop} name={profile.name} visible={orderOpen} onClose={() => setOrderMerchant(null)} />}
  </SafeAreaView></ThemedView></KeyboardScreen>;
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clayPad: { overflow: 'visible', paddingHorizontal: 18, borderWidth: 0 }, clayInquiry: { overflow: 'visible', paddingHorizontal: 24 },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  inquiryBar: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, gap: 10 },
  footerActions: { flexDirection: 'row', gap: 8 },
  inquiry: { minHeight: 48, minWidth: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  secondaryAction: { flexDirection: 'row', gap: 8, minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 22, paddingBottom: 48, gap: 22 },
  state: { minHeight: 240, justifyContent: 'center', alignItems: 'center', gap: 16 },
  statePhoto: { gap: 8 },
  hiring: { alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, minHeight: 48, minWidth: 44, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2 },
  tabCount: { fontSize: 12, lineHeight: 18 },
  panel: { gap: 20 },
  panelTitle: { flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  post: { flexDirection: 'row', gap: 12, alignItems: 'center', borderBottomWidth: 1, paddingVertical: 20, minHeight: 80 },
  postText: { flex: 1, gap: 6 },
  postImage: { width: 64, height: 64, borderRadius: 8 },
  aboutRow: { flexDirection: 'row', gap: 12 },
  aboutLabel: { width: 60 },
  aboutValue: { flex: 1 },
  reviewTabs: { flexDirection: 'row', gap: 8 },
  clayCard: { backgroundColor: 'transparent', overflow: 'visible' },
  box: { borderRadius: 14, padding: 16, gap: 10 },
  chip: { borderWidth: 1 },
  introBlock: { gap: 10 },
  similar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12, borderBottomWidth: 1 },
  rank: { width: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
  menu: { paddingBottom: 8 },
  menuRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  reviewTab: { minWidth: 72, minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
});
