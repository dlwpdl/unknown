import { KeyboardScreen } from '@/components/keyboard-screen';
import { NewcomerProgressCard } from '@/components/newcomer';
import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView, FlatList } from '@/components/analytics-controls';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import Reanimated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, useScrollToTop } from 'expo-router';
import {
  Alert,
  Animated,
  DeviceEventEmitter,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
  type FlatList as NativeFlatList,
  type ViewInstance,
} from 'react-native';
import { requestPushPrompt } from '@/lib/push-prompt';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { todayLabel } from '@/components/daily-chip';
import { CityPicker } from '@/components/city-picker';
import { useMyOpenMeetupRequests } from '@/components/chilling-host-profile';
import { FeedAd } from '@/components/feed-ad';
import { FeedSortControl } from '@/components/feed-sort-control';
import { GlassSurface } from '@/components/glass-surface';
import { LocalEventsCarousel } from '@/components/local-events-carousel';
import { CityPopularPlaces } from '@/components/city-popular-places';
import { adsSupported, feedAdPosition } from '@/lib/ads';
import { MyMeetups } from '@/components/my-meetups';
import { PostCard } from '@/components/post-card';
import { BusinessNewsCard } from '@/components/business-news-card';
import { ListingCard, type DetailedPost } from '@/components/listing-card';
import { ListingFields } from '@/components/listing-fields';
import { ListingFilterBar, ListingMapScreen, ListingModeSwitch, ListingViewSwitch } from '@/components/listing-browse';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PostBodyEditor } from '@/components/post-body-editor';
import { PollDraftFields } from '@/components/poll-draft-fields';
import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { BusinessWriter } from '@/components/business-writer';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ClayBoxFill, ClayIcon, ClayPillFill, useClay, useClayBox, type ClayName } from '@/components/clay';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { StartGuide } from '@/components/start-guide';
import { WeeklyRanking } from '@/components/weekly-ranking';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { PostZoomLink } from '@/components/post-zoom-link';
import { useScreenGlow } from '@/components/screen-glow';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { ControlMetrics, ControlMotion, ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useRevealChip } from '@/hooks/use-reveal-chip';
import { useAuth } from '@/lib/auth';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { useTranslationVisibleIds } from '@/hooks/use-content-translation';
import { useCommunityCity } from '@/lib/community-city';
import type { LocationFix } from '@/lib/location';
import { useCommunityLocation } from '@/lib/location-provider';
import { isShortNote, MAX_AI_IMAGES, parseAiDraftResponse, withDraftFields, type DraftField } from '@/lib/ai-draft';
import {
  createCommunityPost,
  loadListingQuota,
  getCommunityActionError,
  isContentRejected,
  isFirstPost,
  loadTrendingHashtags,
  MEETUPS_CHANGED_EVENT,
  requestMeetupJoin,
} from '@/lib/community-data';
import { appendUniquePosts, limitBusinessPosts, loadPublicFeed, loadPublicPost, pinJustPosted, todayRowsAfter, writeFabOverIntro, type FeedSort, type JustPosted } from '@/lib/feed-data';
import { addHashtag, canonicalizeHashtag, getSuggestedHashtags, hasAdLabel, MAX_HASHTAGS, parseHashtags, toggleAdLabel } from '@/lib/hashtags';
import { canAddPostImage, MAX_POST_IMAGES } from '@/lib/image-upload';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { normalizePoll, type PollDraft } from '@/lib/post-polls';
import { loadPhotoConsentSettings, savePostPhotoConsent } from '@/lib/post-photo-consent';
import { clearPostUpload, getPostUpload, savedByEarlierTry, startPostUpload, type UploadPhoto } from '@/lib/post-upload';
import { CITIES, TAGS } from '@/lib/mock';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { googleMapsPin, googlePinUrl, postMapBody, withPlacePin, withPostMap } from '@/lib/post-maps';
import { composePlace, type CityPlace } from '@/lib/city-places';
import {
  BUSINESS_VIEW_KEY, emptyListingDraft, isListingCategory, LISTING_VIEW_KEY, listingFiltersActive, listingFromDraft, matchesListingFilters, NO_LISTING_FILTERS, parseListingView, withListingLead,
  type ListingCategory, type ListingDraft, type ListingFilters, type ListingView,
} from '@/lib/listing-details';
import { findNeighborhood, neighborhoodName } from '@/lib/neighborhoods';
import { supabase } from '@/lib/supabase';
import type { DailyQuota, Post, PostKind, Tag } from '@/lib/types';
import { applyPostChange, handOffPost, POST_CHANGED_EVENT, type PostChange } from '@/lib/post-open';
import { splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';



// 전체 · 라이프 · 맛집 · 비즈니스 · 페스티벌 · 부동산 · 정착, the rest in 더보기 (owner 2026-11-01).
const PRIMARY_TAGS: (number | null)[] = [null, 1, 4, 17, 16, 14, 12];
const TAG_ART: Record<string, ClayName> = { all: 'chip_all', 1: 'chip_life', 4: 'chip_dining', 17: 'chip_business', 16: 'chip_festival', 14: 'chip_housing', 12: 'chip_settlement' };
const TAG_HINTS: Record<string, string> = {
  housing: '렌트·매매·쉐어 구하기', jobs: '알바·채용·구직', used: '물건 사고팔기', settlement: '비자·PR·보험·은행',
  food: '식당·카페 후기와 추천', meetup: '같이 할 사람 찾기', life: '일상 이야기·잡담', business: '한인 가게 소식',
  festival: '행사·공연·축제', education: '학교·학원·유학', shopping: '세일·장보기 정보', travel: '근교·여행 후기',
};

export default function FeedScreen({ meetupsOnly = false }: { meetupsOnly?: boolean }) {
  const { tr, t, language, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const myRequests = useMyOpenMeetupRequests();
  const reducedMotion = useReducedMotion();
  const { fontScale, width: viewportWidth } = useWindowDimensions();
  const [hasBusinessSwitch, setHasBusinessSwitch] = useState(false);
  const expandedHeader = fontScale > 1.2 || (hasBusinessSwitch && viewportWidth < 380);
  const router = useRouter();
  const { compose, hashtag, place: placeParam, placeCity } = useLocalSearchParams<{ compose?: string; hashtag?: string; place?: string; placeCity?: string }>();
  const { isAuthed, isAuthLoading, promptLogin, me, isAdmin } = useAuth();
  const business = useChatIdentity();
  const [businessWriting, setBusinessWriting] = useState(false);
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const bottomClear = insets.bottom + TabBarHeight; // 탭바 + 홈 인디케이터 실측 높이
  // 글쓰기 탭 대신 떠 있는 버튼 (owner 2026-11-01 A안). 웹은 아래 탭에 글쓰기가 그대로 있다.
  const clay = useClay(), clayBox = useClayBox();
  const writeFab = Platform.OS !== 'web' && !meetupsOnly;
  const writeFabCompact = viewportWidth < 380; // 폴드 바깥 화면 같은 좁은 폭에서는 + 하나만
  // 머리 카드(처음 안내·새로 온 멤버)가 버튼 자리에 있으면 글자를 가리니 비켜 준다 (1.4.8 QA "모임 보기"). 카드가 지나가면 다시 나온다.
  const [writeFabAside, setWriteFabAside] = useState(false);
  // 실측: iOS 탭 화면의 insets.bottom은 이미 탭바까지 포함(탭마다 SafeAreaProvider), 안드로이드 탭 내용은 탭바 위에서 끝난다.
  const [posts, setPosts] = useState<Post[]>([]);
  const [justPosted, setJustPosted] = useState<JustPosted<Post> | null>(null);
  const [visibleFeedIds, setVisibleFeedIds] = useTranslationVisibleIds();
  const [visibleSearchIds, setVisibleSearchIds] = useTranslationVisibleIds();
  const trackTranslationFeed = useCallback(({ viewableItems }: { viewableItems: { item: Post | Post[] | null }[] }) =>
    setVisibleFeedIds(viewableItems.flatMap(({ item }) => Array.isArray(item) ? item.map(post => post.id) : item ? [item.id] : [])), [setVisibleFeedIds]);
  const trackTranslationSearch = useCallback(({ viewableItems }: { viewableItems: { item: Post }[] }) =>
    setVisibleSearchIds(viewableItems.map(({ item }) => item.id)), [setVisibleSearchIds]);
  const { city, setCity } = useCommunityCity();
  const location = useCommunityLocation();
  const [draftCity, setDraftCity] = useState(city);
  const draftLocation = useRef<(LocationFix & { userId: string }) | null>(null);
  const writerRevision = useRef(0);
  const [writerPanel, setWriterPanel] = useState<'city' | 'category' | 'kind' | 'more' | null>(null);
  const [writerOptionsOpen, setWriterOptionsOpen] = useState(false);
  const [cityPicker, setCityPicker] = useState(false);
  const [cityPicks, setCityPicks] = useState(0); // 위쪽 도시 버튼으로 고른 횟수: 처음 안내의 '내 도시 고르기'를 채운다(QA Q17)
  const [writing, setWriting] = useState(false);
  const photoTiles = useRef<(ViewInstance | null)[]>([]);
  const [photosLaunched, setPhotosLaunched] = useState(false); // 위 카드로 날아간 사진은 닫히는 창에서 숨긴다
  const [tag, setTag] = useState<Tag>(TAGS[0]);
  const [postKind, setPostKind] = useState<PostKind>('story');
  const [priceInput, setPriceInput] = useState('');
  const [listingDraft, setListingDraft] = useState<{ category: ListingCategory; draft: ListingDraft } | null>(null);
  const [listingTried, setListingTried] = useState(false);
  const [listingFilters, setListingFilters] = useState<ListingFilters>(NO_LISTING_FILTERS);
  const [listingView, setListingView] = useState<ListingView>('list');
  const [businessView, setBusinessView] = useState<ListingView>('list');
  const [listingMap, setListingMap] = useState(false);
  const [listingQuota, setListingQuota] = useState<DailyQuota | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pollDraft, setPollDraft] = useState<PollDraft | null>(null);
  const hasDraftText = !!title.trim() || !!splitPostAttachments(body).body.trim();
  // 부동산·구인구직·중고거래 listings get category fields; the summary line also goes into the body for older apps.
  const writerListing = postKind === 'listing' && isListingCategory(tag.slug) ? tag.slug as ListingCategory : null;
  const writerListingDraft = writerListing ? listingDraft?.category === writerListing ? listingDraft.draft : { ...emptyListingDraft(writerListing), price: priceInput } : null;
  const writerListingResult = writerListing && writerListingDraft ? listingFromDraft(writerListing, writerListingDraft, { title: title.trim(), cityId: draftCity.id }, language) : null;
  const [hashtagInput, setHashtagInput] = useState('');
  const [draftImages, setDraftImages] = useState<PreparedImage[]>([]);
  // 공식 SNS 소개 동의 칸(사진을 붙였을 때만 보인다). null: 아직 모르거나 구서버라 칸을 숨긴다.
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [aiFields, setAiFields] = useState<DraftField[]>([]);
  const [aiNote, setAiNote] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const aiUndo = useRef<{ title: string; body: string; tag: Tag; hashtagInput: string; postKind: PostKind; priceInput: string } | null>(null);
  const writesNew = !hasDraftText || isShortNote(title, splitPostAttachments(body).body);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  // 카드의 작성자를 누르면 글을 열지 않고 바로 미니 프로필로 간다.
  const openAuthor = (post: Post) => {
    if (post.business) { router.push({ pathname: '/company/[id]', params: { id: post.business.id } }); return; }
    if (post.room) { router.push({ pathname: '/meetup-profile', params: { postId: post.id } }); return; }
    setSheetUser({ id: post.author.id, nickname: post.author.nickname, neighborhood: post.author.neighborhood, verified: post.author.verified, trustLevel: post.author.trustLevel, mine: post.author.id === me.id });
  };
  const [pendingPostId, setPendingPostId] = useState<string | null>(null); // 로그인 후 이어서 열 글
  const [tagFilter, setTagFilter] = useState<number | null>(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null); // 카테고리 칩
  const categoryRow = useRevealChip(String(tagFilter ?? 'all'), !reducedMotion);
  const [feedSort, setFeedSort] = useState<FeedSort>('latest');
  const activeSort = meetupsOnly ? 'latest' : feedSort;
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [feedOpacity] = useState(() => new Animated.Value(1));
  const [chipLift] = useState(() => new Animated.Value(1));
  const [categorySheet, setCategorySheet] = useState(false);
  const feedListRef = useRef<NativeFlatList<Post | Post[] | null>>(null);
  const feedIntroHeight = useRef(0);
  const feedOffset = useRef(0);
  const [sortStuck, setSortStuck] = useState(false);
  const feedViewportHeight = useRef(0);
  const placeWriteFab = () => setWriteFabAside(writeFabOverIntro({ introHeight: feedIntroHeight.current, offset: feedOffset.current, viewport: feedViewportHeight.current, bottom: (Platform.OS === 'ios' ? insets.bottom : 0) + Spacing.three, height: ControlMetrics.action }));
  const glow = useScreenGlow(!meetupsOnly);
  const [listAt, setListAt] = useState({ x: 0, y: 0, top: 0 }); // 글 목록이 화면 왼쪽 위에서 떨어진 자리(안쪽 x·y + 목록 top)
  const scrollToResults = useRef(false);
  useScrollToTop(feedListRef);
  const filterTransition = useRef<number | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const searchSelection = useRef<Post | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [rankingRefresh, setRankingRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [trendingTags, setTrendingTags] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<Post[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [joinPost, setJoinPost] = useState<Post | null>(null);
  const [joinMessage, setJoinMessage] = useState('');
  const [joining, setJoining] = useState(false);
  const viewerScope = isAuthed ? me.id : 'guest';
  const feedKey = `${viewerScope}:${city.id}:${tagFilter ?? 'all'}:${activeSort}`;
  const [loadedFeedKey, setLoadedFeedKey] = useState<string | null>(null);
  // Wait for the session/profile before the first load so a signed-in launch does not load a guest/default-city feed first.
  const feedReady = !isAuthLoading || loadedFeedKey !== null;
  const [loadedFeedCityId, setLoadedFeedCityId] = useState<string | null>(null);
  const [feedError, setFeedError] = useState(false);
  const feedRevision = useRef(0);
  const feedCursorPost = useRef<Post | undefined>(undefined);
  const feedRequest = useRef<{ key: string; revision: number; promise: Promise<void> } | null>(null);
  const loadingMoreRef = useRef<number | null>(null);
  const searchRevision = useRef(0);
  const cancelFeedRequests = useCallback(() => { feedRevision.current++; setLoadingMore(false); }, []);

  const refreshFeed = useCallback(() => {
    if (feedRequest.current?.key === feedKey && feedRequest.current.revision === feedRevision.current) {
      return feedRequest.current.promise;
    }
    const revision = ++feedRevision.current;
    loadingMoreRef.current = null;
    setLoadingMore(false);
    const promise = loadPublicFeed(supabase, city.id, tagFilter, null, null, { viewerScope, sort: activeSort })
      .then((next) => {
        if (revision !== feedRevision.current) return;
        feedCursorPost.current = next.at(-1);
        setPosts(next);
        setHasMore(next.length === 30);
        setFeedError(false);
      })
      .catch((error) => {
        if (revision === feedRevision.current) {
          feedCursorPost.current = undefined;
          setPosts([]);
          setHasMore(false);
          setFeedError(true);
        }
        throw error;
      })
      .finally(() => {
        if (feedRequest.current?.promise === promise) feedRequest.current = null;
        if (revision === feedRevision.current) { setLoadedFeedKey(feedKey); setLoadedFeedCityId(city.id); }
        if (revision === feedRevision.current && filterTransition.current === tagFilter) {
          filterTransition.current = undefined;
          setCategoryLoading(false);
          if (reducedMotion) feedOpacity.setValue(1);
          else requestAnimationFrame(() => Animated.timing(feedOpacity, { toValue: 1, duration: 190, easing: Easing.out(Easing.quad), useNativeDriver: true }).start());
        }
      });
    feedRequest.current = { key: feedKey, revision, promise };
    return promise;
  }, [activeSort, city.id, feedKey, feedOpacity, reducedMotion, tagFilter, viewerScope]);

  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void refreshFeed().catch(() => {}));
    return () => listener.remove();
  }, [refreshFeed]);
  // 글 화면(/post/[id])에서 고치거나 지운 글, 바뀐 댓글·조회 수를 돌아오기 전에 목록에 반영한다.
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(POST_CHANGED_EVENT, (change: PostChange) => {
      setPosts(current => applyPostChange(current, change));
      setJustPosted(current => { const [post] = current ? applyPostChange([current.post], change) : []; return current && post ? { ...current, post } : null; });
      setSearchResults(current => applyPostChange(current, change));
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!feedReady) return;
    feedCursorPost.current = undefined;
    void refreshFeed().catch(() => {
      // Visibility must come from the server; never fall back to unfiltered seed posts.
    });
    return cancelFeedRequests;
  }, [cancelFeedRequests, feedReady, refreshFeed]);

  const cityOpen = city.state === 'open';
  const cityPosts = (meetupsOnly ? posts : pinJustPosted(posts, justPosted, viewerScope)).filter((p) => p.cityId === city.id && !hidden('listed_post', p.id, p.author.id));
  const feedData = useMemo(
    () =>
      cityOpen
        ? tagFilter == null && !meetupsOnly ? limitBusinessPosts(cityPosts)
          : cityPosts.filter((p) => (tagFilter == null || p.tag.id === tagFilter) && (!meetupsOnly || !p.room?.closed))
        : [],
    [cityOpen, cityPosts, meetupsOnly, tagFilter],
  );

  const showFeedSort = cityOpen && !meetupsOnly;
  const businessCategory = !meetupsOnly && TAGS.find(item => item.id === tagFilter)?.slug === 'business';
  const listingCategory = !meetupsOnly && isListingCategory(TAGS.find(item => item.id === tagFilter)?.slug) ? TAGS.find(item => item.id === tagFilter)!.slug as ListingCategory : null;
  const listingPosts = useMemo(() => {
    if (!listingCategory || !listingFiltersActive(listingFilters)) return feedData;
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return feedData.filter(post => matchesListingFilters(post, listingFilters, today));
  }, [feedData, listingCategory, listingFilters]);
  const usedGrid = listingCategory === 'used' && listingView === 'grid';
  const businessGrid = businessCategory && businessView === 'grid';
  // 중고거래·비즈니스 grid: two tiles per list row so the sticky header and paging keep working.
  const feedRows: (Post | Post[])[] = usedGrid || businessGrid
    ? listingPosts.reduce<Post[][]>((rows, post, index) => (index % 2 ? rows[rows.length - 1].push(post) : rows.push([post]), rows), [])
    : listingPosts;
  const feedLoading = categoryLoading || loadedFeedKey !== feedKey;
  const cityLoading = cityOpen && !meetupsOnly && loadedFeedCityId !== city.id;
  // Places and festivals take turns between posts in '전체' (owner 2026-11-03, 11-04), so the city cover no longer waits for them.
  const showTodaySections = cityOpen && !meetupsOnly && tagFilter == null;
  const todayRows = (index: number) => showTodaySections && todayRowsAfter(index, feedRows.length, at => feedAdPosition(at, feedRows.length)).map(({ kind, page }) => kind === 'places'
    ? <CityPopularPlaces key={`places-${page}`} cityId={city.id} page={page} />
    : <LocalEventsCarousel key={`festivals-${page}`} cityId={city.id} page={page} refreshKey={rankingRefresh} cityLoading={cityLoading} />);

  // 검색: 제목·내용·닉네임·동네·해시태그 부분일치 ('#' 입력은 무시)
  // 영문 동네명도 매칭 (Coquitlam → 코퀴틀람) — 표기 파편화 방지
  const q = query.replace(/#/g, '').trim().toLowerCase();
  const canonicalQuery = canonicalizeHashtag(q).toLocaleLowerCase();
  const selectedFilterTag = tagFilter == null ? null : TAGS.find((item) => item.id === tagFilter);
  const popularTags = useMemo(
    () => getSuggestedHashtags(cityPosts, selectedFilterTag, 10, trendingTags),
    [cityPosts, selectedFilterTag, trendingTags],
  );
  const writerHashtags = useMemo(() => getSuggestedHashtags(cityPosts, tag, 8), [cityPosts, tag]);
  const selectedHashtags = parseHashtags(hashtagInput);

  useEffect(() => {
    let active = true;
    void loadTrendingHashtags(supabase, city.id, tagFilter)
      .then((next) => active && setTrendingTags(next))
      .catch(() => active && setTrendingTags([]));
    return () => { active = false; };
  }, [city.id, tagFilter]);

  useEffect(() => {
    const revision = ++searchRevision.current;
    if (!searching || !q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadPublicFeed(supabase, city.id, null, canonicalQuery, null, {
        viewerScope,
        signal: controller.signal,
      })
        .then((next) => { if (revision === searchRevision.current) setSearchResults(next); })
        .catch(() => { if (!controller.signal.aborted && revision === searchRevision.current) setSearchResults([]); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [canonicalQuery, city.id, q, searching, viewerScope]);


  const searchHint = tr('{0}에서 집·일자리·중고 찾기', tr(city.name));
  const openSearch = (initial?: string) => {
    router.push({ pathname: '/search', params: { ...(initial ? { query: initial } : {}), ...(meetupsOnly ? { kind: 'meetup' } : {}) } });
  };

  useEffect(() => {
    if (meetupsOnly || !hashtag) return;
    router.setParams({ hashtag: undefined });
    if (typeof hashtag !== 'string' || !/^[\p{L}\p{M}\p{N}_-]{1,64}$/u.test(hashtag)) return;
    queueMicrotask(() => {
      setQuery(`#${canonicalizeHashtag(hashtag)}`);
      setSearchResults([]);
      setTagFilter(null);
      setSearching(true);
    });
  }, [hashtag, meetupsOnly, router]);

  // 게스트는 피드만 훑고, 상세·글쓰기·참여는 로그인 후 사용한다.
  const openDetail = (post: Post) => {
    if (!isAuthed) {
      setPendingPostId(post.id); // 로그인 성공하면 이어서 열기
      return promptLogin(t.auth.reasonDetail);
    }
    handOffPost(me.id, post);
    router.push({ pathname: '/post/[id]', params: { id: post.id } });
  };
  // 로그인했으면 카드를 감싼 PostZoomLink가 누른 카드에서 글을 키워 연다(owner 2026-11-02). 게스트 카드는 그대로 로그인 창을 띄운다.
  const zoomCard = (post: Post, card: ReactElement<{ onPress?: () => void }>) => isAuthed ? <PostZoomLink key={post.id} id={post.id} post={post}>{card}</PostZoomLink> : card;
  const pressCard = (post: Post) => { if (!isAuthed) openDetail(post); };
  const weeklyRanking = cityOpen && !meetupsOnly && tagFilter == null && <WeeklyRanking cityId={city.id} refreshKey={rankingRefresh} linked={isAuthed} onOpen={async (postId) => {
    // Only guests reach here (signed-in rows are links). Comments are members-only since 2026-10-26, so loading the
    // post first failed with an alert; ask for login and let the detail load it, including the not-found state.
    setPendingPostId(postId);
    promptLogin(t.auth.reasonDetail);
  }} />;
  const animateLayout = () => {
    if (reducedMotion) return;
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };
  const changeWriterPanel = (panel: typeof writerPanel) => {
    animateLayout();
    setWriterPanel(panel);
  };
  const changeTagFilter = (next: number | null) => {
    play('reaction');
    if (next === tagFilter) return;
    cancelFeedRequests();
    scrollToResults.current = true;
    if (!reducedMotion) {
      chipLift.stopAnimation();
      chipLift.setValue(0.88);
      Animated.spring(chipLift, { toValue: 1, damping: 13, stiffness: 230, mass: 0.75, useNativeDriver: true }).start();
    }
    feedOpacity.stopAnimation();
    filterTransition.current = next;
    feedOpacity.setValue(0);
    setCategoryLoading(true);
    setListingFilters(NO_LISTING_FILTERS);
    setListingMap(false);
    setTagFilter(next);
  };
  const changeFeedSort = (next: FeedSort) => {
    if (next === feedSort) return;
    cancelFeedRequests();
    scrollToResults.current = true;
    feedOpacity.stopAnimation();
    feedOpacity.setValue(0);
    filterTransition.current = tagFilter;
    setCategoryLoading(true);
    setFeedSort(next);
  };

  const changeListingView = (next: ListingView) => {
    setListingView(next);
    AsyncStorage.setItem(LISTING_VIEW_KEY, next).catch(() => {});
  };
  const changeBusinessView = (next: ListingView) => {
    setBusinessView(next);
    AsyncStorage.setItem(BUSINESS_VIEW_KEY, next).catch(() => {});
  };
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LISTING_VIEW_KEY).then(value => { if (active) setListingView(parseListingView(value)); }).catch(() => {});
    AsyncStorage.getItem(BUSINESS_VIEW_KEY).then(value => { if (active) setBusinessView(parseListingView(value)); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // 로그인 직후 보려던 글을 이어서 연다.
  useEffect(() => {
    // No hand-off: the guest copy lacks the member view (likes, meetup details), so the detail loads it fresh.
    if (isAuthed && pendingPostId) {
      const timer = setTimeout(() => {
        router.push({ pathname: '/post/[id]', params: { id: pendingPostId } });
        setPendingPostId(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAuthed, pendingPostId, router]);
  const showActionError = useCallback((code: keyof typeof t.actionErrors) => {
    const message = t.actionErrors[code];
    Alert.alert(message.title, message.body, [
      { text: t.write.cancel, style: 'cancel' },
      ...(message.membership ? [{ text: tr("멤버십 보기"), onPress: () => { setWriting(false); setJoinPost(null); router.push('/profile/membership'); } }] : []),
    ]);
  }, [router, t, tr]);

  const onJoin = (post: Post) => {
    play('selection');
    if (!isAuthed) return promptLogin(t.auth.reasonJoinLogin);
    if (post.room?.closed) return showActionError('MEETUP_CLOSED');
    if (post.author.id === me.id) return Alert.alert(t.chat.ownMeetupTitle, t.chat.ownMeetupBody);
    if (post.room?.eventKind || myRequests[post.id]) {
      router.push({ pathname: '/meetup-join', params: { postId: post.id } });
      return;
    }
    setJoinMessage('');
    setJoinPost(post);
  };

  const submitJoin = async () => {
    if (!joinPost || joining) return;
    setJoining(true);
    try {
      await requestMeetupJoin(supabase, joinPost.id, joinMessage);
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      requestPushPrompt('meetup_request');
      // The ring says it was sent; the slot rule moved into the sheet so nothing pops on top of it (owner 2026-11-08).
      play('meetupRequested');
      setJoinPost(null);
      setJoinMessage('');
    } catch (error) {
      play('warning');
      const code = getCommunityActionError(error);
      if (code) showActionError(code);
      else Alert.alert(t.chat.startErrorTitle, t.chat.startErrorBody);
    } finally {
      setJoining(false);
    }
  };

  const stillUploading = useCallback(() => {
    play('warning');
    Alert.alert(tr("아직 올리는 중이에요"), tr("지금 올리는 글이 다 올라가면 바로 쓸 수 있어요."));
  }, [play, tr]);

  // The writer opens here once openWriter's checks pass. A map place goes in as if it were picked in the writer's place search, with its city.
  const showWriter = useCallback((fresh: boolean, place: CityPlace | null) => {
    setPhotosLaunched(false);
    void loadListingQuota(supabase).then(setListingQuota).catch(() => {});
    const revision = ++writerRevision.current;
    draftLocation.current = null;
    // 새 초안은 설정 값으로 다시 시작한다. 쓰던 초안은 고른 값을 그대로 둔다. 불러오기 전에는 칸이 안 보여 누를 수 없다.
    if (fresh || photoConsent === null) void loadPhotoConsentSettings(supabase).then(saved => setPhotoConsent(current => current ?? saved?.on ?? null)).catch(() => {});
    if (fresh) {
      setPhotoConsent(null);
      setDraftCity(city);
      // Writing from 부동산·구인구직·중고거래 starts in that category with its fields.
      const listingTag = !place && listingCategory && TAGS.find(item => item.slug === listingCategory);
      if (listingTag) { setTag(listingTag); setPostKind('listing'); }
      // 모임 and listing posts take no place, so a new draft with one starts as 라이프.
      if (place && (tag.kind === 'meetup' || writerListing)) { setTag(TAGS[0]); setPostKind('story'); }
    }
    if (place) { setDraftCity(CITIES.find(item => item.id === place.cityId)!); setBody(withPlacePin(fresh ? '' : body, place)); }
    setWriterPanel(null);
    setWriterOptionsOpen(false);
    setWriting(true);
    void location.capture().then((fix) => {
      if (revision !== writerRevision.current) return;
      draftLocation.current = fix;
    });
  }, [city, location, body, photoConsent, listingCategory, tag, writerListing]);

  const openWriter = useCallback((place?: CityPlace | null) => {
    play('reaction');
    if (!isAuthed) return promptLogin(t.auth.reasonWrite);
    // Acting as a business, the writer offers only business post types (owner 2026-10-25, option A).
    if (business) { setBusinessWriting(true); return; }
    if (writing) return;
    // 한 번에 하나만 올린다. 실패한 글은 초안 그대로 이 창에 있으니 카드만 치운다.
    const upload = getPostUpload();
    if (upload?.status === 'uploading') { stillUploading(); return; }
    if (upload?.status === 'failed') clearPostUpload();
    const fresh = !title.trim() && !body.trim() && !hashtagInput.trim() && draftImages.length === 0 && !pollDraft;
    if (!place || fresh) return showWriter(fresh, place ?? null);
    // '이 장소로 글쓰기' (owner 2026-11-11) over a draft in progress: the draft keeps its text and the place joins only after a yes, asked before the writer opens.
    const pin = googleMapsPin(postMapBody(body, { preserveWhitespace: true }).url ?? ''), keep = () => { play('selection'); showWriter(false, null); };
    if (pin && pin.latitude === place.latitude && pin.longitude === place.longitude && draftCity.id === place.cityId) return showWriter(false, null);
    if (tag.kind === 'meetup' || writerListing) return Alert.alert(tr('쓰던 글이 있어요'), tr('지금 쓰는 글 종류에는 장소를 붙일 수 없어요.'), [{ text: tr('확인'), onPress: keep }]);
    try { withPlacePin(body, place); } catch { play('warning'); return Alert.alert(t.write.validationTitle, t.write.bodyTooLong, [{ text: tr('확인'), onPress: keep }]); }
    Alert.alert(tr('쓰던 글이 있어요'), tr(pin ? '쓰던 글의 장소를 이 장소로 바꿀까요?' : '쓰던 글에 이 장소를 붙일까요?'), [
      { text: tr('그대로 두기'), style: 'cancel', onPress: keep },
      { text: tr(pin ? '바꾸기' : '붙이기'), onPress: () => { play('success'); showWriter(false, place); } },
    ]);
  }, [isAuthed, promptLogin, business, writing, draftCity, title, body, hashtagInput, draftImages, pollDraft, play, t, tr, stillUploading, tag, writerListing, showWriter]);

  useEffect(() => {
    if (!writing) { writerRevision.current++; draftLocation.current = null; }
  }, [writing]);


  useEffect(() => {
    if (compose !== '1') return;
    const place = placeParam ? composePlace(placeCity, placeParam) : null;
    router.setParams({ compose: undefined, place: undefined, placeCity: undefined });
    queueMicrotask(() => openWriter(place));
  }, [compose, placeParam, placeCity, openWriter, router]);

  const pickDraftImage = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(t.write.photoPermissionTitle, t.write.photoPermissionBody);
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: source === 'library',
        orderedSelection: source === 'library',
        selectionLimit: Math.max(1, MAX_POST_IMAGES - draftImages.length),
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const assets = (result.assets ?? []).slice(0, Math.max(1, MAX_POST_IMAGES - draftImages.length));
      const prepared: PreparedImage[] = [];
      for (const asset of assets) {
        if (!asset?.uri) continue;
        const mimeType = asset.mimeType ?? 'image/jpeg';
        if (!isSupportedImage(mimeType)) {
          Alert.alert(t.write.photoErrorTitle, t.write.photoUnsupported);
          continue;
        }
        try {
          prepared.push(await preparePostImage(asset, { withThumb: true }));
        } catch (cause) {
          Alert.alert(t.write.photoErrorTitle, cause instanceof Error && cause.message === 'IMAGE_TOO_LARGE' ? t.write.photoTooLarge : t.write.photoErrorBody);
        }
      }
      if (prepared.length === 0) return;
      setDraftImages((current) => [...current, ...prepared].slice(0, MAX_POST_IMAGES));
      setAiDraftReady(false);
    } catch {
      Alert.alert(t.write.photoErrorTitle, t.write.photoErrorBody);
    }
  };

  const createAiDraft = async () => {
    const titleHint = title.trim();
    const mapped = postMapBody(body);
    const attached = splitPostAttachments(mapped.body);
    const bodyHint = attached.body.trim();
    if ((draftImages.length === 0 && !titleHint && !bodyHint) || creatingDraft) return;
    setCreatingDraft(true);
    setAiNote(null);
    try {
      const { data, error } = await supabase.functions.invoke('draft-post', {
        body: {
          cityName: draftCity.name,
          selectedCategory: tag.slug,
          titleHint: titleHint || undefined,
          bodyHint: bodyHint || undefined,
          language,
          ...(draftImages.length ? { images: draftImages.slice(0, MAX_AI_IMAGES).map(({ base64, mimeType }) => ({ imageBase64: base64, mimeType })) } : {}),
        },
      });
      if (error) throw error;
      const draft = parseAiDraftResponse(data);
      aiUndo.current ??= { title, body, tag, hashtagInput, postKind, priceInput };
      const nextTag = TAGS.find(({ slug }) => slug === draft.categorySlug && (isAdmin || slug !== 'business')) ?? tag;
      setTag(nextTag);
      setAiFields(draft.fields);
      if (draft.price != null && nextTag.slug === 'used') { setPostKind('listing'); setPriceInput(String(draft.price)); }
      const notes = [
        nextTag.id !== tag.id ? tr("{0} 카테고리로 옮겼어요.", tr(nextTag.label)) : '',
        draft.looksLikeBusiness && !isAdmin ? tr("가게 소식은 비즈니스 프로필로 바꿔서 올리면 가게 이름으로 나가요.") : '',
        draft.remaining != null && draft.remaining <= 2 ? tr("오늘 AI 초안은 {0}번 남았어요.", draft.remaining) : '',
      ].filter(Boolean);
      if (notes.length) setAiNote({ tone: 'info', text: notes.join(' ') });
      setTitle(draft.title);
      setBody(withPostMap(withPostAttachments(draft.body, attached.urls), mapped.url ?? '', mapped.label));
      setHashtagInput(current => parseHashtags(`${hasAdLabel(parseHashtags(current)) ? 'AD ' : ''}${draft.hashtags.join(' ')}`).map(hashtag => `#${hashtag}`).join(' '));
      setAiDraftReady(true);
    } catch (cause) {
      const code = await (cause as { context?: Response })?.context?.json?.().then((value: { error?: { code?: string } }) => value?.error?.code).catch(() => null);
      play('warning');
      setAiNote({ tone: 'warn', text: code === 'DAILY_LIMIT_REACHED'
        ? tr("오늘 AI 초안 5번을 다 썼어요. 내일 다시 쓸 수 있어요. 적어 둔 메모와 사진은 그대로 있어요.")
        : tr("초안을 만들지 못했어요. 횟수는 줄지 않았고, 적어 둔 메모와 사진은 그대로 있어요.") });
    } finally {
      setCreatingDraft(false);
    }
  };

  const undoAiDraft = () => {
    const before = aiUndo.current;
    if (!before) return;
    setTitle(before.title); setBody(before.body); setTag(before.tag); setHashtagInput(before.hashtagInput); setPostKind(before.postKind); setPriceInput(before.priceInput);
    aiUndo.current = null;
    setAiFields([]);
    setAiNote(null);
    setAiDraftReady(false);
  };

  const submit = async () => {
    if (tag.kind === 'meetup') {
      setWriting(false);
      router.push('/meetup-create');
      return;
    }
    if (!title.trim() || (!body.trim() && !writerListingResult)) {
      Alert.alert(t.write.validationTitle, t.write.validationBody);
      return;
    }
    if (submitting) return;
    if (writerListingResult?.missing.length) {
      play('warning');
      setListingTried(true);
      Alert.alert(tr('빠진 항목이 있어요'), tr('표시된 항목을 채워 주세요.'));
      return;
    }
    let poll: PollDraft | undefined;
    try { poll = postKind === 'story' && pollDraft ? normalizePoll(pollDraft) : undefined; }
    catch {
      play('warning');
      Alert.alert(tr("투표를 확인해 주세요"), tr("질문과 보기를 모두 적어 주세요. 같은 보기는 넣을 수 없어요."));
      return;
    }
    let postBody: string;
    try {
      const area = writerListingResult && findNeighborhood(draftCity.id, writerListingResult.details.area);
      // Listings carry only the neighborhood centre, never a typed or tapped point.
      postBody = writerListingResult
        ? withPostMap(withListingLead(writerListingResult.details.lead!, postMapBody(withDraftFields(body, aiFields)).body), area ? googlePinUrl(area) : '', area ? neighborhoodName(area, language) : undefined)
        : withPostMap(withDraftFields(body, aiFields), '');
    }
    catch (error) {
      play('warning');
      Alert.alert(t.write.validationTitle, error instanceof Error && error.message === 'INVALID_MAP_LINK' ? t.write.mapInvalid : t.write.bodyTooLong);
      return;
    }
    if (getPostUpload()?.status === 'uploading') { stillUploading(); return; }
    setSubmitting(true);
    const revision = feedRevision.current;
    const hashtags = parseHashtags(hashtagInput);
    const fix = draftLocation.current; // 창이 닫히면 비워지니 지금 잡아 둔다
    const consent = photoConsent === true && draftImages.length > 0;
    const input = {
      userId: me.id,
      cityId: draftCity.id,
      tag,
      title: title.trim(),
      body: postBody,
      hashtags,
      images: draftImages.map(({ base64, mimeType, thumbBase64, width, height }) => ({ base64, mimeType, thumbBase64, width, height })),
      kind: postKind,
      poll,
      price: writerListingResult ? writerListingResult.price : postKind === 'listing' && priceInput.trim() ? Number(priceInput.replace(/[^0-9.]/g, '')) : null,
      listingDetails: writerListingResult?.details,
    };
    // 글쓰기 창은 바로 닫히고 위 카드가 이 일을 끝까지 보여 준다. 초안은 다 올라간 뒤에만 비운다.
    const send = async (retry: boolean) => {
      let created: { id: string | null; post: Post | null } = { id: null, post: null };
      try {
        created = await createCommunityPost(supabase, input);
      } catch (error) {
        if (!savedByEarlierTry(error, retry)) {
          setSubmitting(false);
          play('warning');
          const actionError = getCommunityActionError(error);
          if (actionError) showActionError(actionError);
          else if (isContentRejected(error)) Alert.alert(t.safety.contentBlockedTitle, t.safety.contentBlockedBody);
          throw error;
        }
      }
      setSubmitting(false);
      const post = created.post;
      // 올리는 동안 목록을 새로 고쳐도 위치 기록은 글에 붙인다(계정이 바뀌면 record가 스스로 거른다).
      if (created.id) void location.record(fix, created.id);
      if (revision === feedRevision.current) {
        setCity(draftCity);
        if (post && !meetupsOnly) setJustPosted({ post, at: Date.now(), viewer: viewerScope });
        if (post && activeSort === 'latest') setPosts((prev) => [post, ...prev.filter(({ id }) => id !== created.id)]);
        else if (draftCity.id === city.id && (meetupsOnly || tagFilter == null)) void refreshFeed().catch(() => {});
        setTagFilter(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null);
      }
      if (post?.room) DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      requestPushPrompt(post?.room ? 'meetup_create' : 'post');
      setTitle('');
      setBody('');
      setPollDraft(null);
      setHashtagInput('');
      setDraftImages([]);
      setAiDraftReady(false);
      setAiFields([]);
      setAiNote(null);
      aiUndo.current = null;
      setPostKind('story');
      setPriceInput('');
      setListingDraft(null);
      setListingTried(false);
      // 첫 글이면 다 올라간 카드가 전면 축하를 띄운다. 세지 못하거나 3초 안에 답이 없으면 평소처럼 카드만.
      const first = !post?.room && await Promise.race([isFirstPost(supabase, input.userId).catch(() => false), new Promise<boolean>(done => setTimeout(() => done(false), 3000))]);
      // 글은 이미 올라갔다. 동의가 저장되지 않으면 실패로 돌리지 않고 다 올라간 카드에 한 줄로만 알린다.
      if (consent && !(created.id && await savePostPhotoConsent(supabase, created.id))) return { notice: tr('SNS에 소개해도 된다는 체크만 저장이 안 됐어요'), first };
      return { first };
    };
    // 위 카드로 날아갈 앞의 세 장이 지금 화면 어디 있는지 잰다. 못 재면 날지 않고 카드에만 쌓인다.
    const photos = await Promise.all(draftImages.slice(0, 3).map((image, index) => new Promise<UploadPhoto>((resolve) => {
      const tile = photoTiles.current[index];
      if (!tile || reducedMotion) return resolve({ uri: image.uri });
      const timer = setTimeout(() => resolve({ uri: image.uri }), 120);
      tile.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ uri: image.uri, from: width > 0 ? { x, y, width, height } : undefined }); });
    })));
    if (!startPostUpload({ owner: me.id, title: input.title, photoCount: draftImages.length, photos, send })) {
      setSubmitting(false);
      stillUploading();
      return;
    }
    setPhotosLaunched(photos.some(({ from }) => from));
    setWriting(false);
  };

  const loadMorePosts = async () => {
    if (feedRequest.current || feedLoading || loadingMoreRef.current === feedRevision.current || !hasMore || searching) return;
    const last = feedCursorPost.current;
    if (!last?.createdAt) return;
    const revision = feedRevision.current;
    loadingMoreRef.current = revision;
    setLoadingMore(true);
    try {
      const next = await loadPublicFeed(
        supabase,
        city.id,
        tagFilter,
        null,
        { createdAt: last.createdAt, id: last.id, sortAt: last.sortAt, popularityScore: last.popularityScore, rankingAsOf: last.rankingAsOf },
        { viewerScope, sort: activeSort },
      );
      if (revision !== feedRevision.current) return;
      feedCursorPost.current = next.at(-1);
      setPosts((current) => appendUniquePosts(current, next));
      setHasMore(next.length === 30);
    } catch {
      if (revision === feedRevision.current) Alert.alert(tr("글을 더 불러오지 못했어요"), tr("잠시 후 다시 시도해 주세요."));
    } finally {
      if (loadingMoreRef.current === revision) {
        loadingMoreRef.current = null;
        if (revision === feedRevision.current) setLoadingMore(false);
      }
    }
  };

  // 첫 로딩·도시 변경은 목록 가운데, 카테고리·정렬 변경은 칩 바로 아래에 로고를 띄운다. 목록 맨 아래 로더는 화면 밖이라 안 보였다 (owner 2026-11-02).
  const loadingCover = cityLoading ? 'page' : cityOpen && feedLoading && !meetupsOnly ? 'list' : null;
  // 오늘 탭 배경 빛 (owner 2026-11-03 "시안헤더에 그라데이션으로 컬러 들어간거 우리 헤더에도" + "전체 본문에도 살짝", 두 테마).
  // 화면에 고정되고 글은 그 위로 지나간다. 글을 가려야 하는 곳(위에 붙은 정렬 줄, 불러오기 덮개)은 불투명이라
  // 목록 자리에서 본 같은 빛을 다시 그려 헤더·본문과 끊김 없이 잇는다.
  const measureList = (next: Partial<typeof listAt>) => setListAt(current => ({ ...current, ...next }));
  const screenGlow = glow.image();
  const listGlow = glow.image(listAt.x, listAt.y + listAt.top);
  const glowOn = screenGlow != null;
  const feedState = cityOpen && feedLoading ? <View style={styles.categoryLoading}>{meetupsOnly && <GlingLoader color={theme.accent} accessibilityLabel={tr("글 불러오는 중")} />}</View> : (
    cityOpen ? (
      feedError && feedData.length === 0 ? (
        <StateCard kind="error" title={tr("글을 불러오지 못했어요")} body={tr("연결을 확인하고 다시 시도해 주세요.")} actionLabel={tr("다시 시도")} onAction={() => { play('selection'); void refreshFeed().catch(() => {}); }} />
      ) : feedData.length > 0 && listingPosts.length === 0 ? (
        <View style={styles.soon}>
          <ThemedText accessibilityRole="header" style={styles.soonTitle}>{tr('조건에 맞는 글이 없어요')}</ThemedText>
          <Pressable analyticsId="listing.filters.reset" onPress={() => { play('selection'); setListingFilters(NO_LISTING_FILTERS); }} accessibilityRole="button" style={({ pressed }) => [styles.soonCta, !clay && Depth.control, clay && styles.clayCta, { backgroundColor: clay ? 'transparent' : theme.accent, borderBottomColor: theme.accentDepth, opacity: pressed ? 0.82 : 1 }]}>
            {clay && <ClayPillFill kind="cta" />}
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('조건 모두 지우기')}</ThemedText>
          </Pressable>
        </View>
      ) : feedData.length === 0 ? (
        <View style={styles.soon}>
          <ThemedText accessibilityRole="header" style={styles.soonTitle}>{meetupsOnly ? t.feed.meetupEmptyTitle : activeSort === 'popular' ? tr("최근 7일 글이 아직 없어요") : t.feed.emptyTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.soonBody}>{meetupsOnly ? t.feed.meetupEmptyBody : activeSort === 'popular' ? tr("최신순에서 다른 이야기도 둘러보세요.") : t.feed.emptyBody}</ThemedText>
          <Pressable analyticsId="components_feed-screen.pressable.6" onPress={() => openWriter()} accessibilityRole="button" style={({ pressed }) => [styles.soonCta, !clay && Depth.control, clay && styles.clayCta, { backgroundColor: clay ? 'transparent' : theme.accent, borderBottomColor: theme.accentDepth, }]}>
            {clay && <ClayPillFill kind="cta" />}
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{t.feed.write}</ThemedText>
          </Pressable>
        </View>
      ) : null
    ) : (
      <View style={styles.soon}>
        <ThemedText type="subtitle" style={styles.soonTitle}>
          {t.feed.soonTitle(city.name)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.soonBody}>
          {t.feed.soonBody}
        </ThemedText>
        <Pressable analyticsId="components_feed-screen.pressable.7"
          onPress={() => { play('selection'); setCityPicker(true); }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.soonCta, !clay && Depth.control, clay && styles.clayCta, { backgroundColor: clay ? 'transparent' : theme.accent, borderBottomColor: theme.accentDepth, }]}>
          {clay && <ClayPillFill kind="cta" />}
          <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
            {t.feed.soonCta}
          </ThemedText>
        </Pressable>
      </View>
    )
  );

  return (
    <TabContent style={[styles.container, screenGlow != null && { backgroundImage: screenGlow }]}
      onLayout={glow.onLayout}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}><View style={styles.safeArea} onLayout={({ nativeEvent: { layout } }) => measureList({ x: layout.x, y: layout.y })}>
        <View style={[styles.headRow, expandedHeader && styles.headRowLarge]}>
          <Pressable analyticsId="feed.home" accessibilityRole="button" accessibilityLabel={`${t.appName}, ${t.tabs.today}`}
            onPress={() => { play('selection'); router.navigate('/'); }} style={[styles.homeButton, expandedHeader && styles.homeButtonLarge]}>
            {/* Black clay on light screens, white clay on dark ones (owner 6aa0942b). */}
            <Image source={theme === Colors.dark ? require('@/assets/brand/gling-3d-wordmark-dark.png') : require('@/assets/brand/gling-3d-wordmark.png')} style={[styles.wordmark, (viewportWidth < 380 || fontScale > 1.2) && styles.wordmarkCompact]} contentFit="contain" accessible={false} />
          </Pressable>
          <GlassSurface tone="control" clay="white" interactive style={[styles.cityGlass, expandedHeader && styles.cityGlassLarge]}><Pressable analyticsId="components_feed-screen.pressable.1"
            onPress={() => { play('reaction'); setCityPicker(true); }} accessibilityRole="button"
            accessibilityLabel={`${tr(city.name)}, ${t.feed.cityPickerTitle}`}
            style={({ pressed }) => [styles.cityButton, clay && styles.cityButtonClay, controlPresentation(theme, { pressed, reducedMotion, clay }).container]}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.city}>{tr(city.name)}</ThemedText>
            <ClayIcon clay="chevron" name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} tintColor={theme.text} />
          </Pressable></GlassSurface>
          {/* 검색칸이 카테고리 줄과 겹쳐 보여 프로필 옆 돋보기로 (owner 2026-11-01); 읽어 주기 이름에 찾는 것을 남김. */}
          <View style={styles.iconGlass}><Pressable analyticsId="components_feed-screen.pressable.2"
            onPress={() => { play('selection'); openSearch(); }} accessibilityRole="button" accessibilityLabel={searchHint} accessibilityHint={tr('검색 화면이 열려요')}
            style={({ pressed }) => [styles.iconButton, controlPresentation(theme, { tone: 'ghost', pressed, reducedMotion }).container]}>
            <ClayIcon clay="search" claySize={26} name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.toolbar} tintColor={theme.text} />
          </Pressable></View>
          <ProfileAvatarButton onBusinessSwitchAvailabilityChange={setHasBusinessSwitch} />
        </View>
        {cityOpen && !meetupsOnly && (
          <View style={styles.categoryHead}>
            <GlassSurface tone="control" clay="tray" style={styles.chipGlass}><ScrollView analyticsId="components_feed-screen.scrollview.1" {...categoryRow.scroll} horizontal showsHorizontalScrollIndicator={false} style={clay && styles.chipClip} contentContainerStyle={styles.chipBar}>
              {/* 처음 보이는 칩: PRIMARY_TAGS (owner 2026-11-01 순서); 나머지는 '더보기' 시트. */}
              {[...PRIMARY_TAGS, ...(tagFilter != null && !PRIMARY_TAGS.includes(tagFilter) ? [tagFilter] : [])].map((id) => {
                const label = id == null ? t.feed.filterAll : tr(TAGS.find((tg) => tg.id === id)!.label);
                const active = tagFilter === id;
                return (
                  <Animated.View key={id ?? 'all'} onLayout={categoryRow.chip(String(id ?? 'all'))} style={active && { borderRadius: 999, transform: [{ scale: chipLift }] }}><SelectionChip analyticsId="components_feed-screen.pressable.3"
                    selected={active}
                    onPress={() => changeTagFilter(id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.filterChip, clay && styles.clayChip, { borderBottomColor: 'transparent' }]}>
                    {TAG_ART[id ?? 'all'] && <ClayIcon clay={TAG_ART[id ?? 'all']} claySize={22} size={22} />}
                    <ThemedText type="smallBold" style={{ color: active ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
                  </SelectionChip></Animated.View>
                );
              })}
              <Pressable analyticsId="feed.categories.more" accessibilityRole="button" accessibilityLabel={tr('카테고리 전체 보기')}
                onPress={() => { play('selection'); setCategorySheet(true); }}
                style={({ pressed }) => [styles.filterChip, { flexDirection: 'row', gap: 4, borderBottomColor: 'transparent', backgroundColor: pressed ? theme.backgroundSelected : clay ? 'transparent' : theme.backgroundElement }]}>
                <ThemedText type="smallBold" themeColor="accent">{tr('더보기')}</ThemedText>
                <ClayIcon clay="chevron" name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={IconSize.chevron} tintColor={theme.accent} />
              </Pressable>
            </ScrollView></GlassSurface>
          </View>
        )}
        <View style={styles.feedArea} onLayout={({ nativeEvent: { layout } }) => { measureList({ top: layout.y }); feedViewportHeight.current = layout.height; placeWriteFab(); }}><FlatList analyticsId="components_feed-screen.flatlist.1" ref={feedListRef}
          onScroll={glowOn || writeFab ? ({ nativeEvent }) => {
            feedOffset.current = nativeEvent.contentOffset.y;
            const stuck = feedOffset.current >= feedIntroHeight.current - 0.5;
            if (stuck !== sortStuck) setSortStuck(stuck);
            placeWriteFab();
          } : undefined}
          scrollEventThrottle={16}
          accessibilityElementsHidden={loadingCover != null} importantForAccessibility={loadingCover ? 'no-hide-descendants' : 'auto'}
          onViewableItemsChanged={trackTranslationFeed}
          viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY}
          data={[null, ...(showFeedSort ? [null] : []), ...(feedLoading ? [] : feedRows)]}
          stickyHeaderIndices={showFeedSort ? [1] : undefined}
          onContentSizeChange={() => {
            if (!feedLoading && scrollToResults.current) {
              scrollToResults.current = false;
              feedListRef.current?.scrollToOffset({ offset: feedIntroHeight.current, animated: !reducedMotion });
            }
          }}
          onEndReached={() => void loadMorePosts()}
          onEndReachedThreshold={0.4}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setRankingRefresh((current) => current + 1);
            void refreshFeed().catch(() => Alert.alert(t.feed.refreshErrorTitle, t.feed.refreshErrorBody)).finally(() => setRefreshing(false));
          }}
          keyExtractor={(p, index) => Array.isArray(p) ? `grid:${p[0].id}` : p?.id ?? (index === 0 ? 'journal-intro' : 'feed-sort')}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomClear + Spacing.three + (writeFab ? ControlMetrics.action + Spacing.three : 0) }]}
          ItemSeparatorComponent={({ leadingItem }) => leadingItem == null ? null : <View style={{ height: (businessCategory && !businessGrid) || (listingCategory && !usedGrid) ? 0 : Spacing.four }} />}
          ListFooterComponent={loadingMore ? <ThemedText type="small" themeColor="textSecondary" style={styles.loadingMore}>{t.feed.loadingMore}</ThemedText>
            : !feedLoading && showTodaySections && !feedRows.length ? <>{feedState}{todayRows(-1)}</> : feedState ?? undefined}
          renderItem={({ item, index }) => item == null && index === 1 && showFeedSort ? (
            <FeedSortControl sort={activeSort} title={businessCategory ? tr('새 소식') : selectedFilterTag ? tr("{0} 글", tr(selectedFilterTag.label)) : tr("오늘 글")} onChange={changeFeedSort}
              style={[styles.sortBar, glowOn && (sortStuck ? { backgroundImage: listGlow } : { backgroundColor: 'transparent' })]}
              action={businessCategory ? <Pressable analyticsId="business.directory.open" accessibilityRole="button" accessibilityLabel={tr('비즈니스 찾기')}
                onPress={() => { play('selection'); router.push('/businesses'); }}
                style={({ pressed }) => [ControlStyles.pill, { flexDirection: 'row', gap: Spacing.two }, clay && styles.clayPad, controlPresentation(theme, { tone: 'ghost', pressed, clay }).container]}>
                {clay && <ClayPillFill kind="white" />}
                <SymbolView name={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} size={IconSize.inline} tintColor={theme.accent} />
                <ThemedText type="smallBold" themeColor="accent">{tr('비즈니스 찾기')}</ThemedText>
                <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.accent} />
              </Pressable> : listingCategory && listingCategory !== 'jobs' ? <ListingModeSwitch mode="list" onChange={mode => setListingMap(mode === 'map')} /> : undefined}>
              {listingCategory && <ListingFilterBar category={listingCategory} cityId={city.id} filters={listingFilters} onChange={setListingFilters}
                view={listingView} onView={changeListingView} />}
              {businessCategory && <ListingViewSwitch view={businessView} onView={changeBusinessView} />}
            </FeedSortControl>
          ) : item == null ? (
            <View style={[styles.header, !meetupsOnly && styles.todayHeader]} onLayout={event => {
              feedIntroHeight.current = event.nativeEvent.layout.height;
              setSortStuck(feedOffset.current >= feedIntroHeight.current - 0.5);
              placeWriteFab();
            }}>
              {/* 오늘 탭은 날짜 줄 없이 바로 많이 읽은 글 (owner 2026-11-03 "공간낭비"). 모임 탭 제목 줄은 그대로. */}
              {meetupsOnly && <View style={styles.journalIntro}>
                <View style={styles.journalStatusRow}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.journalDate}>{todayLabel(appLocale)}</ThemedText>
                </View>
                <ThemedText accessibilityRole="header" style={styles.journalTitle}>{t.feed.meetupTitle}</ThemedText>
              </View>}
              {/* 이번 주 많이 읽은 글(탑10)은 카테고리 바로 아래, 다른 섹션보다 먼저 (owner 2026-10-30). */}
              {!feedLoading && weeklyRanking}
              {!meetupsOnly && <StartGuide cityName={city.name} cityPicks={cityPicks} onPickCity={() => setCityPicker(true)} onOpenMeetups={() => router.navigate('/meetups')} />}
              {!meetupsOnly && isAuthed && <NewcomerProgressCard />}
              {meetupsOnly && <>
                <MyMeetups onOpen={async (postId) => {
                  const post = await loadPublicPost(supabase, postId);
                  if (!post) throw new Error('POST_NOT_FOUND');
                  openDetail(post);
                }} />
                {cityOpen && <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{t.meetup.discover}</ThemedText>}
              </>}
            </View>
          ) : (
            Array.isArray(item) ? <Animated.View style={[styles.listingGrid, { opacity: feedOpacity }]}>
              {item.map(post => businessGrid ? zoomCard(post, <BusinessNewsCard key={post.id} variant="tile" post={post} onPress={() => pressCard(post)} onAuthor={() => openAuthor(post)}
                translationVisible={visibleFeedIds.has(post.id) && !searching && !writing} />)
                : post.listingDetails ? zoomCard(post, <ListingCard key={post.id} variant="tile" post={post as DetailedPost} onPress={() => pressCard(post)} />)
                : <View key={post.id} style={styles.flexText}>{zoomCard(post, <PostCard flat post={post} onPress={() => pressCard(post)} onJoin={() => void onJoin(post)} joinStatus={myRequests[post.id]} onHashtag={openSearch} onAuthor={() => openAuthor(post)} />)}</View>)}
              {item.length === 1 && <View style={styles.flexText} />}
            </Animated.View> :
            <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 5) * 65).duration(360)}><Animated.View style={{ opacity: feedOpacity }}>{zoomCard(item, listingCategory && item.listingDetails ? <ListingCard
              post={item as DetailedPost} onPress={() => pressCard(item)} /> : businessCategory ? <BusinessNewsCard
              post={item} onPress={() => pressCard(item)} onAuthor={() => openAuthor(item)}
              translationVisible={visibleFeedIds.has(item.id) && !searching && !writing} /> : <PostCard
              flat
              feed={!meetupsOnly}
              post={item}
              translationVisible={visibleFeedIds.has(item.id) && !searching && !writing}
              onPress={() => pressCard(item)}
              onJoin={() => void onJoin(item)}
              joinStatus={myRequests[item.id]}
              onHashtag={openSearch}
              onAuthor={() => openAuthor(item)}
            />)}{!meetupsOnly && adsSupported && (Platform.OS !== 'web' || (!isAuthed && !feedError && !writing && !searching)) && feedAdPosition(index - (showFeedSort ? 2 : 1), feedRows.length) && <FeedAd key={`ad-after-${item.id}`} />}
              {todayRows(index - (showFeedSort ? 2 : 1))}</Animated.View></Reanimated.View>
          )}
        />
        {/* 덮개가 아래 회색 자리표시와 이전 글을 가리고, 다 불러오면 서서히 걷힌다. 첫 화면은 덮개째 바로 그린다. */}
        {loadingCover && <Reanimated.View entering={reducedMotion || loadingCover === 'page' ? undefined : FadeIn.duration(ControlMotion.pressMs)}
          exiting={reducedMotion ? undefined : FadeOut.duration(ControlMotion.settleMs)}
          style={[styles.loadingCover, loadingCover === 'page' && [styles.loadingCoverPage, { paddingBottom: bottomClear }], { backgroundColor: theme.background, backgroundImage: listGlow }]}>
          <GlingLoader color={theme.accent} accessibilityLabel={loadingCover === 'page' ? tr("{0} 소식 불러오는 중", tr(city.name)) : tr("글 불러오는 중")} />
        </Reanimated.View>}</View>
        {writeFab && !writeFabAside && <Reanimated.View entering={reducedMotion ? undefined : FadeIn.duration(ControlMotion.settleMs)} exiting={reducedMotion ? undefined : FadeOut.duration(ControlMotion.pressMs)}
          style={[styles.writeFabDock, { bottom: (Platform.OS === 'ios' ? insets.bottom : 0) + Spacing.three }]}><Pressable analyticsId="feed.write" accessibilityRole="button" accessibilityLabel={t.tabs.write} onPress={() => openWriter()}
          style={({ pressed }) => [ControlStyles.pill, styles.writeFab, writeFabCompact && styles.writeFabCompact, controlPresentation(theme, { tone: 'primary', clay, pressed, reducedMotion }).container]}>
          {clay && <ClayPillFill kind="cta" />}
          <ClayIcon clay="pencil" claySize={24} name={{ ios: 'plus', android: 'add', web: 'add' }} size={IconSize.toolbar} tintColor={theme.accentInk} />
          {!writeFabCompact && <ThemedText type="label" style={{ color: theme.accentInk }}>{t.tabs.write}</ThemedText>}
        </Pressable></Reanimated.View>}
      </View></SafeAreaView>

      <Modal visible={categorySheet} animationType={reducedMotion ? 'fade' : 'slide'} presentationStyle="pageSheet" onRequestClose={() => { play('selection'); setCategorySheet(false); }}>
        <SafeAreaView style={[styles.categorySheet, { backgroundColor: theme.background }]}>
          <View style={styles.categorySheetHead}>
            <View style={{ flex: 1 }}>
              <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{tr('카테고리')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{tr('무엇을 올리는 곳인지 보고 골라 보세요. 자주 쓰는 6개는 위 줄에 늘 있어요.')}</ThemedText>
            </View>
            <Pressable analyticsId="feed.categories.close" accessibilityRole="button" onPress={() => { play('selection'); setCategorySheet(false); }}
              style={({ pressed }) => [ControlStyles.pill, clay && styles.clayPad, controlPresentation(theme, { tone: 'ghost', pressed, clay }).container]}>
              {clay && <ClayPillFill kind="white" />}
              <ThemedText type="smallBold" themeColor={clay ? undefined : 'textSecondary'}>{tr('닫기')}</ThemedText>
            </Pressable>
          </View>
          <ScrollView analyticsId="feed.categories.sheet" contentContainerStyle={styles.categoryGrid}>
            {TAGS.map(tg => {
              const active = tagFilter === tg.id;
              return (
                <Pressable key={tg.id} analyticsId="feed.categories.pick" accessibilityRole="button" accessibilityState={{ selected: active }}
                  onPress={() => { setCategorySheet(false); changeTagFilter(tg.id); }}
                  style={({ pressed }) => [styles.categoryCell, clayBox && { overflow: 'visible' }, { backgroundColor: clayBox ? 'transparent' : active ? theme.backgroundSelected : theme.card, borderColor: clayBox ? 'transparent' : active ? theme.accent : theme.line }, pressed && { opacity: 0.82 }]}>
                  {clayBox && <ClayBoxFill kind="tile" />}
                  <ThemedText type="smallBold" style={active && { color: theme.accent }}>{tr(tg.label)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{tr(TAG_HINTS[tg.slug] ?? '')}</ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {(listingCategory === 'housing' || listingCategory === 'used') && <ListingMapScreen visible={listingMap} category={listingCategory} city={city} posts={listingPosts}
        filters={listingFilters} onFilters={setListingFilters} onClose={() => setListingMap(false)}
        onOpenPost={post => { setListingMap(false); setTimeout(() => openDetail(post), Platform.OS === 'ios' ? 350 : 0); }} />}
      {/* 검색: 제목·내용·해시태그. 입력 전엔 인기 해시태그 칩 */}
      <Modal visible={searching} animationType={reducedMotion ? 'fade' : 'slide'} onRequestClose={() => { play('selection'); setSearching(false); }}
        onDismiss={() => {
          const post = searchSelection.current;
          searchSelection.current = null;
          if (post) openDetail(post);
        }}>
        <SafeAreaProvider key={`${fontScale}-${theme.background}`} style={[styles.writer, { backgroundColor: theme.background }]}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={[styles.searchHead, { borderBottomColor: theme.line }]}>
              <View style={[styles.searchField, { backgroundColor: theme.backgroundElement }]}>
                <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.textSecondary} />
                <TextInput
                  value={query}
                  onChangeText={(value) => { setQuery(value); setSearchResults([]); }}
                  placeholder={t.search.placeholder}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={t.search.placeholder}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={[styles.searchInput, { color: theme.text }]}
                />
                {!!query && <Pressable analyticsId="components_feed-screen.pressable.27" accessibilityRole="button" accessibilityLabel={tr("검색어 지우기")}
                  onPress={() => { play('selection'); setQuery(''); setSearchResults([]); }}
                  style={({ pressed }) => [styles.searchClear, { opacity: pressed ? 0.65 : 1 }]}>
                  <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={18} tintColor={theme.textSecondary} />
                </Pressable>}
              </View>
              <Pressable analyticsId="components_feed-screen.pressable.8" onPress={() => { play('selection'); setSearching(false); }} accessibilityRole="button"
                style={({ pressed }) => [styles.searchClose, { opacity: pressed ? 0.65 : 1 }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.search.close}
                </ThemedText>
              </Pressable>
            </View>

            {q.length === 0 ? (
              <View style={styles.popularWrap}>
                <ThemedText accessibilityRole="header" style={styles.searchTitle}>{tr("동네 이야기 찾기")}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{tr("제목, 내용, 해시태그로 이웃의 이야기를 찾아보세요.")}</ThemedText>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.popularTitle}>{t.search.popular}</ThemedText>
                <View style={styles.popularChips}>
                  {popularTags.map((h) => (
                    <Pressable analyticsId="components_feed-screen.pressable.9"
                      key={h}
                      onPress={() => {
                        play('selection');
                        setQuery(h);
                        setSearchResults([]);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.filterChip,
                        !clay && Depth.control,
                        clay && styles.clayPad,
                        { backgroundColor: clay ? 'transparent' : theme.backgroundElement, borderBottomColor: clay ? 'transparent' : theme.line, },
                      ]}>
                      {clay && <ClayPillFill kind="white" />}
                      <ThemedText type="smallBold" style={{ fontSize: 13, color: theme.navy }}>
                        {'#' + h}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <FlatList analyticsId="components_feed-screen.flatlist.2"
                onViewableItemsChanged={trackTranslationSearch}
                viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY}
                data={searchResults.filter((post) => !hidden('listed_post', post.id, post.author.id) && (!meetupsOnly || !post.room?.closed))}
                keyExtractor={(p) => p.id}
                contentContainerStyle={styles.listContent}
                ItemSeparatorComponent={() => <View style={{ height: Spacing.two + 2 }} />}
                ListEmptyComponent={
                  <ThemedText type="small" themeColor="textSecondary" style={styles.searchEmpty}>
                    {t.search.none(query.trim())}
                  </ThemedText>
                }
                renderItem={({ item }) => (
                  <PostCard
                    post={item}
                    translationVisible={visibleSearchIds.has(item.id) && searching}
                    onPress={() => {
                      // iOS must finish dismissing search before presenting detail or login.
                      if (Platform.OS === 'ios') searchSelection.current = item;
                      setSearching(false);
                      if (Platform.OS !== 'ios') openDetail(item);
                    }}
                    onJoin={() => void onJoin(item)}
                    joinStatus={myRequests[item.id]}
                    onHashtag={(value) => { setQuery(value); setSearchResults([]); }}
                    onAuthor={() => openAuthor(item)}
                  />
                )}
              />
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={joinPost != null} transparent animationType="fade" onRequestClose={() => { play('selection'); setJoinPost(null); }}>
        <View style={styles.joinBackdrop}>
          <Pressable analyticsId="components_feed-screen.pressable.10" style={StyleSheet.absoluteFill} onPress={() => { play('selection'); setJoinPost(null); }} accessibilityRole="button" accessibilityLabel={tr("참여 신청 닫기")} />
          <ThemedView style={[styles.joinSheet, { backgroundColor: theme.card }]}>
            <ThemedText type="subtitle">{t.chat.joinFormTitle}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t.chat.joinFormBody}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t.chat.joinDoneBody}</ThemedText>
            <TextInput
              value={joinMessage}
              onChangeText={setJoinMessage}
              maxLength={300}
              multiline
              placeholder={t.chat.joinFormPlaceholder}
              placeholderTextColor={theme.textSecondary}
              style={[styles.joinInput, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]}
            />
            <View style={styles.joinActions}>
              <Pressable analyticsId="components_feed-screen.pressable.11" onPress={() => { play('selection'); setJoinPost(null); }} accessibilityRole="button" style={({ pressed }) => [styles.secondaryButton, clay && styles.clayPad, { borderColor: clay ? 'transparent' : theme.line, opacity: pressed ? 0.65 : 1 }]}>
                {clay && <ClayPillFill kind="white" />}
                <ThemedText type="smallBold">{t.write.cancel}</ThemedText>
              </Pressable>
              <Pressable analyticsId="components_feed-screen.pressable.12"
                onPress={() => { play('selection'); void submitJoin(); }}
                disabled={joining}
                accessibilityRole="button"
                accessibilityState={{ disabled: joining, busy: joining }}
                style={({ pressed }) => [styles.aiButton, clay && styles.clayCta, { backgroundColor: clay ? 'transparent' : theme.accent, borderColor: clay ? 'transparent' : theme.accent, opacity: joining ? 0.6 : pressed ? 0.7 : 1 }]}>
                {clay && <ClayPillFill kind="cta" />}
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{joining ? t.chat.joinSending : t.chat.joinSubmit}</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* 도시 선택은 안전 영역을 확보한 전체 화면(iOS) 또는 하단 모달(Android)로 연다. */}
      <Modal
        visible={cityPicker}
        animationType={reducedMotion ? 'fade' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : 'overFullScreen'}
        transparent={Platform.OS !== 'ios'}
        allowSwipeDismissal
        onRequestClose={() => { play('selection'); setCityPicker(false); }}>
        <SafeAreaProvider style={[styles.cityBackdrop, Platform.OS === 'ios' && { backgroundColor: theme.background }]}>
          {Platform.OS !== 'ios' && (
            <Pressable analyticsId="components_feed-screen.pressable.13" style={StyleSheet.absoluteFill} onPress={() => { play('selection'); setCityPicker(false); }} accessibilityRole="button" accessibilityLabel={t.write.cancel} />
          )}
          <ThemedView style={[styles.citySheet, Platform.OS === 'ios' && styles.citySheetIOS]}>
            <View style={{ flex: 1, paddingTop: Platform.OS === 'ios' ? insets.top : 0, paddingBottom: insets.bottom }}>
              <CityPicker onClose={() => setCityPicker(false)} onPicked={() => setCityPicks(value => value + 1)} />
            </View>
          </ThemedView>
        </SafeAreaProvider>
      </Modal>

      {/* 글쓰기의 선택 항목은 접고, 제목과 본문을 먼저 보여준다. */}
      {business && <BusinessWriter business={business} visible={businessWriting} onClose={() => setBusinessWriting(false)} onPublished={() => { void refreshFeed().catch(() => {}); }} />}
      <Modal visible={writing} animationType={reducedMotion ? 'fade' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} allowSwipeDismissal
        onRequestClose={() => { play('reaction'); setWriting(false); }}>
        <SafeAreaProvider style={[styles.writer, { backgroundColor: theme.background }]}>
          <KeyboardScreen>
          <SafeAreaView style={styles.writer}>
            {writerPanel === 'city' ? (
              <CityPicker onClose={() => changeWriterPanel(null)} draft={{ city: draftCity, onSelect: setDraftCity }} />
            ) : <View style={styles.writer}>
              <View style={[styles.writerHead, { borderBottomColor: theme.line }]}>
                <Pressable analyticsId="components_feed-screen.pressable.14" onPress={() => { play('reaction'); setWriting(false); }} accessibilityRole="button" accessibilityLabel={t.write.cancel}
                  style={({ pressed }) => [styles.writerClose, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
                  <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={22} tintColor={theme.text} />
                </Pressable>
                <View style={styles.writerHeading}>
                  <ThemedText accessibilityRole="header" style={styles.writerNavTitle}>{t.write.title}</ThemedText>
                  {(tag.kind === 'meetup' || postKind === 'listing') && <ThemedText type="small" themeColor="textSecondary">{tag.kind === 'meetup'
                    ? isAdmin ? tr("관리자 계정 · 제한 없음") : t.write.meetupLimitNote
                    : isAdmin ? tr("관리자 계정 · 제한 없음") : listingQuota ? t.write.listingRemaining(listingQuota.used, listingQuota.max) : t.write.listingLimitNote}</ThemedText>}
                </View>
                <RaisedActionButton analyticsId="components_feed-screen.pressable.15" compact onPress={() => { play('selection'); void submit(); }}
                  disabled={submitting || creatingDraft || !title.trim() || (!body.trim() && !writerListing)} busy={submitting}
                  label={submitting ? t.write.submitting : t.write.submit} />
              </View>
              <PostBodyEditor value={body} onChangeText={setBody} cityName={draftCity.englishName} allowLocation={tag.kind !== 'meetup' && !writerListing} editable={!submitting && !creatingDraft} accessibilityLabel={t.write.bodyLabel}
                placeholder={tag.kind !== 'meetup' && postKind === 'listing' ? t.write.listingBodyPlaceholder : t.write.bodyPlaceholder[tag.slug]} placeholderTextColor={theme.textSecondary} multiline
                style={[styles.bodyInput, { color: theme.text }]}
                renderLayout={({ input, actions, attachments }) => <View style={styles.writer}>
              <ScrollView analyticsId="components_feed-screen.scrollview.2" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.writerScroll}>
                <View style={styles.writerContext}>
                  <Pressable analyticsId="components_feed-screen.writer-options" accessibilityRole="button" accessibilityLabel={tr("게시 설정 변경, {0}, {1}, {2}", (tr(draftCity.name)), (tr(tag.label)), (postKind === 'listing' ? t.write.kindListing : t.write.kindStory))} accessibilityState={{ expanded: writerOptionsOpen }} onPress={() => { play('reaction'); Keyboard.dismiss(); animateLayout(); setWriterOptionsOpen(open => !open); setWriterPanel(null); }} style={({ pressed }) => [styles.writerContextSummary, !clay && Depth.control, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : theme.card, }]}>
                    {clay && <ClayPillFill kind="white" />}
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.writerContextValue}>{tr(draftCity.name)} · {tr(tag.label)}{tag.kind !== 'meetup' ? ` · ${postKind === 'listing' ? t.write.kindListing : t.write.kindStory}` : ''}</ThemedText>
                    <ThemedText type="smallBold" themeColor="accent">{tr("변경")}</ThemedText>
                    <SymbolView name={{ ios: writerOptionsOpen ? 'chevron.up' : 'chevron.right', android: writerOptionsOpen ? 'expand_less' : 'chevron_right', web: writerOptionsOpen ? 'expand_less' : 'chevron_right' }} size={14} tintColor={theme.accent} />
                  </Pressable>
                  {writerOptionsOpen && <View style={styles.writerOptionButtons}>
                  <Pressable analyticsId="components_feed-screen.pressable.16" accessibilityRole="button" accessibilityLabel={`${t.write.postCity}, ${tr(draftCity.name)}, ${draftCity.province}`}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel('city'); }}
                    style={({ pressed }) => [styles.contextButton, !clay && Depth.control, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : pressed ? theme.backgroundSelected : theme.backgroundElement, opacity: clay && pressed ? 0.82 : 1 }]}>
                    {clay && <ClayPillFill kind="white" />}
                    <SymbolView name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }} size={16} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" style={styles.contextText}>{tr(draftCity.name)} · {draftCity.province}</ThemedText>
                    <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  <Pressable analyticsId="components_feed-screen.pressable.17" accessibilityRole="button" accessibilityLabel={`${t.write.category}, ${tr(tag.label)}`} accessibilityState={{ expanded: writerPanel === 'category' }}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel(writerPanel === 'category' ? null : 'category'); }}
                    style={({ pressed }) => [styles.contextButton, !clay && Depth.control, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : pressed || writerPanel === 'category' ? theme.backgroundSelected : theme.backgroundElement, opacity: clay && pressed ? 0.82 : 1 }]}>
                    {clay && <ClayPillFill kind={writerPanel === 'category' ? 'on' : 'white'} />}
                    <ThemedText type="smallBold" style={styles.contextText}>{tr(tag.label)}</ThemedText>
                    <SymbolView name={{ ios: writerPanel === 'category' ? 'chevron.up' : 'chevron.down', android: writerPanel === 'category' ? 'expand_less' : 'expand_more', web: writerPanel === 'category' ? 'expand_less' : 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  {tag.kind !== 'meetup' && <Pressable analyticsId="components_feed-screen.pressable.18" accessibilityRole="button" accessibilityLabel={`${t.write.pickKind}, ${postKind === 'listing' ? t.write.kindListing : t.write.kindStory}`} accessibilityState={{ expanded: writerPanel === 'kind' }}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel(writerPanel === 'kind' ? null : 'kind'); }}
                    style={({ pressed }) => [styles.contextButton, !clay && Depth.control, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : pressed || writerPanel === 'kind' ? theme.backgroundSelected : theme.backgroundElement, opacity: clay && pressed ? 0.82 : 1 }]}>
                    {clay && <ClayPillFill kind={writerPanel === 'kind' ? 'on' : 'white'} />}
                    <ThemedText type="smallBold" style={styles.contextText}>{postKind === 'listing' ? t.write.kindListing : t.write.kindStory}</ThemedText>
                    <SymbolView name={{ ios: writerPanel === 'kind' ? 'chevron.up' : 'chevron.down', android: writerPanel === 'kind' ? 'expand_less' : 'expand_more', web: writerPanel === 'kind' ? 'expand_less' : 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>}
                  </View>}
                </View>
                {writerPanel === 'kind' && <View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.writerLabel}>{t.write.pickKind}</ThemedText>
                  <View style={styles.tagRow} accessibilityRole="radiogroup">
                    {([['story', t.write.kindStory, t.write.kindStoryHint], ['listing', t.write.kindListing, t.write.kindListingHint]] as const).map(([kind, label, hint]) => {
                      const selected = postKind === kind;
                      return <Pressable analyticsId="components_feed-screen.pressable.19" key={kind} onPress={() => { play('selection'); animateLayout(); setPostKind(kind); setWriterPanel(null); setWriterOptionsOpen(false); }} accessibilityRole="radio"
                        accessibilityLabel={`${label}, ${hint}`} accessibilityState={{ selected, checked: selected }}
                        style={({ pressed }) => [styles.tagChip, !clay && Depth.control, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : selected ? theme.accent : theme.backgroundElement, borderBottomColor: clay ? 'transparent' : selected ? theme.accentDepth : theme.line, }]}>
                        {clay && <ClayPillFill kind={selected ? 'on' : 'white'} />}
                        <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
                      </Pressable>;
                    })}
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.writerLabel}>{postKind === 'listing' ? t.write.kindListingHint : t.write.kindStoryHint}</ThemedText>
                </View>}
                {writerPanel === 'category' && <View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.writerLabel}>{t.write.pickTag}</ThemedText>
                  <View style={styles.tagRow}>
                    {/* 비즈니스 is written from a business profile; only the admin posts there as a person. */}
                    {TAGS.filter((tg) => isAdmin || tg.slug !== 'business').map((tg) => {
                      const selected = tg.id === tag.id;
                      return (
                        <Pressable analyticsId="components_feed-screen.pressable.20"
                          key={tg.id}
                          onPress={() => {
                            play('selection');
                            if (tg.kind === 'meetup') {
                              setWriting(false);
                              setWriterPanel(null);
                              router.push('/meetup-create');
                              return;
                            }
                            animateLayout();
                            setTag(tg);
                            if (isListingCategory(tg.slug)) setPostKind('listing');
                            setWriterPanel(null);
                            setWriterOptionsOpen(false);
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={({ pressed }) => [
                            styles.tagChip,
                            !clay && Depth.control,
                            clay && styles.clayPad,
                            { backgroundColor: clay ? 'transparent' : selected ? theme.accent : theme.backgroundElement, borderBottomColor: clay ? 'transparent' : selected ? theme.accentDepth : theme.line, },
                          ]}>
                          {clay && <ClayPillFill kind={selected ? 'on' : 'white'} />}
                          <ThemedText
                            type="smallBold"
                            style={{ color: selected ? theme.accentInk : theme.textSecondary }}>
                            {tr(tg.label)}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>}
                <TextInput value={title} onChangeText={setTitle} onFocus={() => play('selection')} editable={!submitting && !creatingDraft} accessibilityLabel={t.write.titlePlaceholder}
                  placeholder={writerListing === 'jobs' ? tr('포지션 (예: 카페 바리스타)') : t.write.titlePlaceholder} placeholderTextColor={theme.textSecondary} maxLength={80}
                  style={[styles.titleInput, { color: theme.text, borderBottomColor: theme.line }]} />
                {writerListing && writerListingDraft && <View style={styles.writerAttachments}><ListingFields category={writerListing} cityId={draftCity.id} value={writerListingDraft}
                  onChange={draft => setListingDraft({ category: writerListing, draft })} missing={listingTried ? writerListingResult?.missing : []}
                  disabled={submitting || creatingDraft} lead={writerListingResult?.details.lead} /></View>}
                {input}
                <View style={styles.writerAttachments}>{attachments}</View>
                {tag.kind !== 'meetup' && postKind === 'story' && pollDraft && <View style={styles.writerAttachments}><PollDraftFields poll={pollDraft} onChange={setPollDraft} disabled={submitting || creatingDraft} /></View>}
                {aiDraftReady && aiFields.length > 0 && <View style={[styles.aiFields, { backgroundColor: theme.card }]}>
                  {aiFields.map((field, index) => <View key={field.label} style={[styles.aiFieldRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }]}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.aiFieldLabel}>{field.label}</ThemedText>
                    <TextInput value={field.value} editable={!submitting} maxLength={80} accessibilityLabel={field.label}
                      onChangeText={value => setAiFields(current => current.map((item, position) => position === index ? { ...item, value, source: value.trim() ? (item.source === 'missing' ? 'memo' : item.source) : 'missing' } : item))}
                      placeholder={tr("직접 적어 주세요")} placeholderTextColor={theme.textSecondary}
                      style={[styles.aiFieldInput, { color: theme.text }]} />
                    <ThemedText type="small" style={{ color: field.value.trim() ? theme.textSecondary : theme.accent }}>
                      {!field.value.trim() ? tr("비어 있음") : field.source === 'photo' ? tr("사진") : tr("메모")}
                    </ThemedText>
                  </View>)}
                </View>}
                {aiDraftReady && <View style={styles.aiReviewRow}>
                  <ThemedText accessibilityRole="alert" type="small" themeColor="textSecondary" style={styles.flexText}>{t.write.reviewDraft}</ThemedText>
                  {aiUndo.current && <Pressable analyticsId="components_feed-screen.ai-undo" accessibilityRole="button" onPress={() => { play('selection'); undoAiDraft(); }}
                    style={({ pressed }) => [styles.aiUndo, { opacity: pressed ? 0.6 : 1 }]}>
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>{tr("메모로 되돌리기")}</ThemedText>
                  </Pressable>}
                </View>}
                {tag.kind === 'meetup' && <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>{t.write.roomNote}</ThemedText>}
                {tag.kind !== 'meetup' && postKind === 'listing' && !writerListing && <>
                  <TextInput value={priceInput} onChangeText={setPriceInput} editable={!submitting && !creatingDraft} accessibilityLabel={t.write.pricePlaceholder}
                    placeholder={t.write.pricePlaceholder} placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" maxLength={10}
                    style={[styles.hashtagInput, { color: theme.text, borderBottomColor: theme.line }]} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>{t.write.listingNote}</ThemedText>
                </>}
                {draftImages.length > 0 && <View style={[styles.aiCard, { borderColor: theme.line }]}>
                  {draftImages.length > 0 && (
                    <View style={styles.photoGrid}>
                      {draftImages.map((image, index) => (
                        <View key={`${image.uri}-${index}`} ref={(node) => { photoTiles.current[index] = node; }} style={[styles.photoTile, photosLaunched && index < 3 && styles.photoLaunched]}>
                          <Image source={{ uri: image.uri }} style={styles.photoTileImage} contentFit="cover" />
                          {index < MAX_AI_IMAGES && <View style={[styles.photoAiBadge, { backgroundColor: theme.card }]} accessibilityLabel={tr("AI가 읽는 사진")}>
                            <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={10} tintColor={theme.accent} />
                          </View>}
                          <Pressable analyticsId="components_feed-screen.pressable.21"
                            onPress={() => { play('selection'); setDraftImages((current) => current.filter((_, position) => position !== index)); setAiDraftReady(false); }}
                            accessibilityRole="button"
                            accessibilityLabel={tr("{0}번째 사진 삭제", (index + 1))}
                            style={[styles.photoRemove, { backgroundColor: theme.card }]}>
                            <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor={theme.text} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <ThemedText type="small" themeColor="textSecondary">{tr('사진 {0}/{1}', draftImages.length, MAX_POST_IMAGES)}</ThemedText>
                  {photoConsent !== null && <Pressable analyticsId="compose.photo-consent" accessibilityRole="checkbox" accessibilityLabel={tr('이 사진을 글링 공식 SNS에 소개해도 돼요')}
                    accessibilityHint={tr('체크해 두면 글링이 릴스나 게시물을 만들 때 이 사진을 골라 쓸 수 있어요. 마음이 바뀌면 설정에서 취소하면 돼요.')} accessibilityState={{ checked: photoConsent, disabled: submitting }} aria-checked={photoConsent} disabled={submitting}
                    onPress={() => { play('selection'); setPhotoConsent(on => !on); }} style={styles.photoConsent}>
                    <ThemedText>{photoConsent ? '▣' : '□'}{'  ' + tr('이 사진을 글링 공식 SNS에 소개해도 돼요')}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{tr('체크해 두면 글링이 릴스나 게시물을 만들 때 이 사진을 골라 쓸 수 있어요. 마음이 바뀌면 설정에서 취소하면 돼요.')}</ThemedText>
                  </Pressable>}
                </View>}
                  {selectedHashtags.length > 0 && <View style={styles.selectedHashtags}>
                    {selectedHashtags.map((hashtag) => <Pressable analyticsId="components_feed-screen.pressable.27" key={hashtag} accessibilityRole="button" accessibilityLabel={tr("#{0} 삭제", (hashtag))}
                      onPress={() => { play('reaction'); animateLayout(); setHashtagInput(current => parseHashtags(current).filter(value => value !== hashtag).join(' ')); }}
                      style={({ pressed }) => [styles.selectedHashtag, !clay && Depth.control, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : theme.accent, borderBottomColor: theme.accentDepth, }]}>
                      {clay && <ClayPillFill kind="on" />}
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>#{hashtag} ×</ThemedText>
                    </Pressable>)}
                  </View>}

              </ScrollView>
              <View style={[styles.writerFooter, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
                <View style={styles.writerAiRow}>
                <Pressable analyticsId="components_feed-screen.pressable.23"
                  onPress={() => { play('selection'); void createAiDraft(); }}
                  disabled={submitting || creatingDraft || (draftImages.length === 0 && !hasDraftText)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: submitting || creatingDraft || (draftImages.length === 0 && !hasDraftText), busy: creatingDraft }}
                  accessibilityHint={writesNew ? tr("메모로 글 한 편 써 드려요") : tr("적어둔 내용으로 글을 다듬어요")}
                  style={[styles.aiButton, clay && styles.clayPad, { borderColor: clay ? 'transparent' : theme.accent, opacity: submitting || creatingDraft || (draftImages.length === 0 && !hasDraftText) ? 0.6 : 1 }]}>
                  {clay && <ClayPillFill kind="white" />}
                  <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={16} tintColor={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: clay ? theme.text : theme.accent, flexShrink: 1 }}>
                    {creatingDraft ? t.write.creatingDraft : writesNew ? tr("AI로 글쓰기") : t.write.polishDraft}
                  </ThemedText>
                </Pressable>
                  <ThemedText type="small" accessibilityLiveRegion="polite" themeColor={aiNote?.tone === 'warn' ? undefined : 'textSecondary'} style={[styles.writerAiHint, aiNote?.tone === 'warn' && { color: theme.danger }]}>
                    {creatingDraft ? (draftImages.length ? tr("사진 {0}장이랑 메모 보고 쓰는 중이에요", Math.min(draftImages.length, MAX_AI_IMAGES)) : tr("메모로 글 쓰는 중이에요"))
                      : aiNote ? aiNote.text
                      : !hasDraftText && draftImages.length === 0 ? tr("한 줄만 적어도 돼요. 예) 이케아 책상 팔아요 40불")
                      : writesNew ? (draftImages.length ? tr("메모랑 사진 {0}장 보고 글 한 편 써 드려요", Math.min(draftImages.length, MAX_AI_IMAGES)) : tr("메모로 글 한 편 써 드려요"))
                      : tr("적어둔 내용으로 글을 다듬어요")}
                  </ThemedText>
                </View>
                <View style={styles.writerTools}>
                    <Pressable analyticsId="components_feed-screen.pressable.25"
                      onPress={() => { play('selection'); void pickDraftImage('library'); }}
                      disabled={submitting || creatingDraft || !canAddPostImage(draftImages.length)}
                      accessibilityRole="button"
                      accessibilityLabel={draftImages.length === 0 ? t.write.choosePhoto : t.write.addPhoto}
                      accessibilityState={{ disabled: submitting || creatingDraft || !canAddPostImage(draftImages.length) }}
                      style={[styles.writerTool, clay && styles.clayPad, { opacity: canAddPostImage(draftImages.length) ? 1 : 0.5 }]}>
                      {clay && <ClayPillFill kind="white" />}
                      <SymbolView name={{ ios: 'photo', android: 'photo_library', web: 'photo_library' }} size={20} tintColor={theme.textSecondary} />
                      <ThemedText type="smallBold" style={styles.writerToolLabel}>{tr("사진")}</ThemedText>
                    </Pressable>
                  {actions}
                  <Pressable analyticsId="components_feed-screen.pressable.26" accessibilityRole="button" accessibilityLabel={tr("더보기")} accessibilityState={{ expanded: writerPanel === 'more', disabled: submitting || creatingDraft }} disabled={submitting || creatingDraft}
                    onPress={() => { play('selection'); Keyboard.dismiss(); changeWriterPanel('more'); }} style={[styles.writerTool, clay && styles.clayPad]}>
                    {clay && <ClayPillFill kind="white" />}
                    <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={20} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" style={styles.writerToolLabel} themeColor="textSecondary">{tr("더보기")}</ThemedText>
                  </Pressable>
                </View>
              </View>
              </View>} />
              <Modal visible={writerPanel === 'more'} transparent animationType="fade" onRequestClose={() => { play('selection'); changeWriterPanel(null); }}>
                <SafeAreaProvider>
                  <KeyboardAvoidingView behavior="padding" style={styles.writerMoreBackdrop}>
                    <SafeAreaView edges={['bottom']} accessibilityViewIsModal style={[styles.writerMoreSheet, { backgroundColor: theme.card }]}>
                      <View style={[styles.writerHead, { borderBottomColor: theme.line }]}>
                        <ThemedText type="smallBold" accessibilityRole="header" style={styles.writerMoreTitle}>{tr("더보기")}</ThemedText>
                        <Pressable analyticsId="components_feed-screen.pressable.26" accessibilityRole="button" accessibilityLabel={t.write.cancel} onPress={() => { play('selection'); changeWriterPanel(null); }} style={styles.writerClose}>
                          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={theme.textSecondary} />
                        </Pressable>
                      </View>
                      <ScrollView analyticsId="components_feed-screen.scrollview.3" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.writerMoreContent}>
                        {postKind === 'story' && !pollDraft && <View style={styles.writerAttachments}><PollDraftFields poll={null} onChange={value => { setPollDraft(value); changeWriterPanel(null); }} disabled={submitting || creatingDraft} /></View>}
                {isAdmin && tag.kind !== 'meetup' && <Pressable analyticsId="post.ad_label" accessibilityRole="checkbox" accessibilityLabel={tr('광고')}
                  accessibilityState={{ checked: hasAdLabel(selectedHashtags), disabled: submitting || creatingDraft || (!hasAdLabel(selectedHashtags) && selectedHashtags.length >= MAX_HASHTAGS) }}
                  disabled={submitting || creatingDraft || (!hasAdLabel(selectedHashtags) && selectedHashtags.length >= MAX_HASHTAGS)}
                  onPress={() => { play('selection'); setHashtagInput(toggleAdLabel); }}
                  style={[styles.aiButton, styles.writerAttachments, clay && styles.clayPad, { backgroundColor: clay ? 'transparent' : hasAdLabel(selectedHashtags) ? theme.backgroundSelected : theme.backgroundElement }]}>
                  {clay && <ClayPillFill kind={hasAdLabel(selectedHashtags) ? 'on' : 'white'} />}
                  <ThemedText type="smallBold" style={clay && hasAdLabel(selectedHashtags) ? { color: theme.accentInk } : undefined}>{hasAdLabel(selectedHashtags) ? '☑ AD' : '□ AD'}</ThemedText>
                </Pressable>}
                        {Platform.OS !== 'web' && <Pressable analyticsId="components_feed-screen.pressable.24" accessibilityRole="button" accessibilityLabel={t.write.takePhoto} disabled={submitting || creatingDraft || !canAddPostImage(draftImages.length)}
                          onPress={() => { play('selection'); void pickDraftImage('camera'); }} style={[styles.writerMoreCamera, clay && styles.clayPad]}>
                          {clay && <ClayPillFill kind="white" />}
                          <SymbolView name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} size={20} tintColor={theme.textSecondary} />
                          <ThemedText type="smallBold">{t.write.takePhoto}</ThemedText>
                        </Pressable>}
                <View>
                  <TextInput value={hashtagInput} onChangeText={setHashtagInput} onFocus={() => play('selection')} editable={!submitting && !creatingDraft} accessibilityLabel={t.write.hashtags}
                    placeholder={t.write.hashtagPlaceholder} placeholderTextColor={theme.textSecondary} autoCapitalize="none"
                    style={[styles.hashtagInput, { color: theme.navy, borderBottomColor: theme.line }]} />
                  <View style={styles.writerHashtags}>
                    <ScrollView analyticsId="components_feed-screen.scrollview.3"
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      contentContainerStyle={styles.hashtagBar}>
                      {writerHashtags.filter(hashtag => !selectedHashtags.includes(hashtag)).map((hashtag) => (
                        <Pressable analyticsId="components_feed-screen.pressable.27"
                          key={hashtag}
                          onPress={() => {
                            play('reaction');
                            animateLayout();
                            setHashtagInput((value) => addHashtag(value, hashtag));
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={t.write.addHashtag(hashtag)}
                          style={({ pressed }) => [
                            styles.suggestionChip,
                            !clay && Depth.control,
                            clay && styles.clayPad,
                            { backgroundColor: clay ? 'transparent' : pressed ? theme.backgroundSelected : theme.backgroundElement, borderBottomColor: clay ? 'transparent' : theme.line, },
                          ]}>
                          {clay && <ClayPillFill kind="white" />}
                          <ThemedText type="smallBold" style={{ fontSize: 12, color: theme.navy }}>
                            {'#' + hashtag}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
                      </ScrollView>
                    </SafeAreaView>
                  </KeyboardAvoidingView>
                </SafeAreaProvider>
              </Modal>
            </View>}
          </SafeAreaView>
          </KeyboardScreen>
        </SafeAreaProvider>
      </Modal>
    <UserSheet user={sheetUser} onClose={() => setSheetUser(null)} />
    </TabContent>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    maxWidth: MaxContentWidth,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
  },
  header: { paddingTop: Spacing.two, paddingBottom: Spacing.four },
  categoryLoading: { minHeight: 280, alignItems: 'center', justifyContent: 'center' },
  categoryHead: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  categorySheet: { flex: 1 },
  categorySheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.four, paddingBottom: Spacing.two },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, padding: Spacing.four, paddingTop: Spacing.two },
  categoryCell: { width: '48%', minHeight: 72, borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.three, paddingTop: Spacing.one, paddingBottom: Spacing.two },
  headRowLarge: { flexWrap: 'wrap' },
  wordmark: { width: 88, height: 38 },
  wordmarkCompact: { width: 64, height: 36 },
  homeButton: { minHeight: 44, justifyContent: 'center' },
  homeButtonLarge: { width: '100%', alignItems: 'flex-start' },
  cityGlass: { marginLeft: 'auto', borderRadius: ControlStyles.pill.borderRadius, flexShrink: 1 },
  cityGlassLarge: { marginLeft: 0, flex: 1, minWidth: 0 },
  iconGlass: { borderRadius: ControlStyles.icon.borderRadius },
  iconButton: ControlStyles.icon,
  cityButton: { ...ControlStyles.pill, flexDirection: 'row', gap: Spacing.one, flexShrink: 1, paddingHorizontal: 12 },
  cityButtonClay: { paddingHorizontal: 18 },
  city: { ...Typography.label, flexShrink: 1 },
  unreadBadge: { position: 'absolute', top: 0, right: 0, minWidth: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontSize: 10, lineHeight: 14, fontVariant: ['tabular-nums'] },
  journalIntro: { paddingTop: Spacing.three, gap: Spacing.one },
  todayHeader: { paddingBottom: Spacing.one },
  journalStatusRow: { minHeight: 24, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  writeFabDock: { position: 'absolute', right: Spacing.three },
  writeFab: { minHeight: ControlMetrics.action, flexDirection: 'row', gap: Spacing.one, borderWidth: 1 },
  clayPad: { overflow: 'visible', paddingHorizontal: 18 }, clayCta: { overflow: 'visible', paddingHorizontal: 24, borderBottomWidth: 0, borderWidth: 0 },
  clayChip: { flexDirection: 'row', gap: 4, paddingLeft: 8, paddingRight: 12 },
  writeFabCompact: { width: ControlMetrics.action, paddingHorizontal: 0 },
  journalDate: { fontSize: 12, lineHeight: 18, letterSpacing: 0.8 },
  feedArea: { flex: 1 },
  // 목록 좌우 여백까지 덮어, 위에 붙었을 때 꽉 찬 사진이 정렬 줄 옆으로 비치지 않게.
  sortBar: { marginHorizontal: -Spacing.three, paddingHorizontal: Spacing.three },
  loadingCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: Spacing.five },
  loadingCoverPage: { justifyContent: 'center', paddingTop: 0 },
  journalTitle: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.8 },
  chipGlass: { borderRadius: 28, marginTop: Spacing.two },
  // The clay tray can't clip (its shadow hangs below it), so the chips are cut to the tray's round ends here; its art ends ~2pt inside each side.
  chipClip: { borderRadius: 999, overflow: 'hidden', marginHorizontal: 2 },
  chipBar: { flexDirection: 'row', gap: Spacing.one, padding: Spacing.one },
  filterChip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderBottomWidth: 2, paddingHorizontal: 14, paddingVertical: Spacing.two },
  chipPressed: { opacity: 0.65 },
  featured: { marginTop: Spacing.three },
  meetupSection: { marginTop: Spacing.four, gap: Spacing.three },
  meetupPreview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: 20 },
  meetupCopy: { flex: 1, minHeight: 44, justifyContent: 'center', gap: Spacing.one },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.two },
  sectionTitle: { fontSize: 18, lineHeight: 26, fontWeight: 700, letterSpacing: -0.4 },
  latestHeading: { marginTop: Spacing.four },
  popularLabel: {
    fontSize: 12,
  },
  hashtagBar: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  searchHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchField: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, paddingLeft: Spacing.three, paddingRight: Spacing.one },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 4,
  },
  searchClear: { minWidth: 36, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  searchClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  popularWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five,
    gap: Spacing.three,
  },
  searchTitle: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6 },
  popularTitle: { marginTop: Spacing.three, fontSize: 13 },
  popularChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  searchEmpty: {
    textAlign: 'center',
    paddingTop: Spacing.five,
  },
  loadingMore: { textAlign: 'center', paddingVertical: Spacing.three },
  joinBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  joinSheet: { padding: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  joinInput: { minHeight: 96, padding: Spacing.three, borderWidth: 1, borderRadius: 10, textAlignVertical: 'top' },
  joinActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  soon: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  soonTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: 700,
    textAlign: 'center',
  },
  soonBody: {
    textAlign: 'center',
    maxWidth: 280,
  },
  soonCta: {
    marginTop: Spacing.two,
    borderRadius: 999,
    borderBottomWidth: 3,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  cityBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,24,30,0.3)' },
  citySheet: { height: '88%', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  citySheetIOS: { height: '100%' },
  writer: {
    flex: 1,
  },
  writerHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  writerClose: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  writerHeading: { flex: 1, minWidth: 0, alignItems: 'center', gap: Spacing.half },
  writerNavTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  writerFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two },
  writerAiRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  writerAiHint: { flex: 1, flexBasis: 120, fontSize: 11, lineHeight: 17 },
  writerTools: { flexDirection: 'row', gap: Spacing.two },
  writerTool: { flex: 1, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  writerToolLabel: { fontSize: 11, lineHeight: 16 },
  writerAttachments: { marginHorizontal: Spacing.four },
  writerMoreBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  writerMoreSheet: { maxHeight: '85%', width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  writerMoreTitle: { flex: 1 },
  writerMoreContent: { paddingVertical: Spacing.three, gap: Spacing.two },
  writerMoreCamera: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', minHeight: 44, paddingHorizontal: Spacing.four },
  writerContext: { gap: Spacing.two, marginHorizontal: Spacing.four, paddingVertical: Spacing.two },
  writerContextSummary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 12, paddingHorizontal: 12 },
  writerContextValue: { flex: 1 },
  writerOptionButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingBottom: Spacing.two },
  contextButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: Spacing.two, borderRadius: 12 },
  contextText: { flexShrink: 1 },
  writerLabel: { marginHorizontal: Spacing.four, marginBottom: Spacing.two },
  writerScroll: {
    paddingBottom: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  aiCard: {
    marginHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photoTile: { width: '31%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  photoTileImage: { width: '100%', height: '100%' },
  photoConsent: { minHeight: 44, justifyContent: 'center', gap: 2 },
  photoLaunched: { opacity: 0 },
  photoAiBadge: { position: 'absolute', left: 6, bottom: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  aiFields: { marginHorizontal: Spacing.four, marginBottom: Spacing.two, borderRadius: 14, overflow: 'hidden' },
  aiFieldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, minHeight: 44 },
  aiFieldLabel: { width: 72 },
  aiFieldInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  aiReviewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginHorizontal: Spacing.four, marginBottom: Spacing.two },
  aiUndo: { minHeight: 44, justifyContent: 'center' },
  flexText: { flex: 1 },
  listingGrid: { flexDirection: 'row', gap: Spacing.three },
  photoRemove: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
  },
  aiButton: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  aiNotice: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  tagChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderBottomWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  writerHashtags: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  selectedHashtags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  selectedHashtag: { minHeight: 44, borderRadius: 999, borderBottomWidth: 2, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  suggestionChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    borderBottomWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  titleInput: {
    fontSize: 20,
    fontWeight: 700,
    marginHorizontal: Spacing.four,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hashtagInput: {
    fontSize: 14,
    fontWeight: 600,
    borderBottomWidth: 1,
    marginHorizontal: Spacing.four,
    paddingVertical: 10,
  },
  bodyInput: {
    minHeight: 180,
    fontSize: 17,
    lineHeight: 26,
    textAlignVertical: 'top',
    marginHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  meetupNote: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
});
