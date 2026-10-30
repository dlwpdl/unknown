import { NewcomerProgressCard } from '@/components/newcomer';
import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView, FlatList } from '@/components/analytics-controls';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import Reanimated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
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
} from 'react-native';
import { requestPushPrompt } from '@/lib/push-prompt';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { todayLabel } from '@/components/daily-chip';
import { CityPicker } from '@/components/city-picker';
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
import { StateCard } from '@/components/state-card';
import { StartGuide } from '@/components/start-guide';
import { WeeklyRanking } from '@/components/weekly-ranking';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { PostDetail } from '@/components/post-detail';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
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
  loadTrendingHashtags,
  MEETUPS_CHANGED_EVENT,
  requestMeetupJoin,
} from '@/lib/community-data';
import { appendUniquePosts, limitBusinessPosts, loadPublicFeed, loadPublicPost, type FeedSort } from '@/lib/feed-data';
import { addHashtag, canonicalizeHashtag, getSuggestedHashtags, hasAdLabel, MAX_HASHTAGS, parseHashtags, toggleAdLabel } from '@/lib/hashtags';
import { canAddPostImage, MAX_POST_IMAGES } from '@/lib/image-upload';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { normalizePoll, type PollDraft } from '@/lib/post-polls';
import { TAGS } from '@/lib/mock';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { googlePinUrl, postMapBody, withPostMap } from '@/lib/post-maps';
import {
  BUSINESS_VIEW_KEY, emptyListingDraft, isListingCategory, LISTING_VIEW_KEY, listingFiltersActive, listingFromDraft, matchesListingFilters, NO_LISTING_FILTERS, parseListingView, withListingLead,
  type ListingCategory, type ListingDraft, type ListingFilters, type ListingView,
} from '@/lib/listing-details';
import { findNeighborhood, neighborhoodName } from '@/lib/neighborhoods';
import { supabase } from '@/lib/supabase';
import type { DailyQuota, Post, PostKind, Tag } from '@/lib/types';
import { splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';



// 처음 보이는 카테고리 칩: 전체·부동산·구인구직·중고거래·정착·맛집 (owner 2026-10-29).
const PRIMARY_TAGS: (number | null)[] = [null, 1, 4, 14, 18, 12];
const TAG_HINTS: Record<string, string> = {
  housing: '렌트·매매·쉐어 구하기', jobs: '알바·채용·구직', used: '물건 사고팔기', settlement: '비자·PR·보험·은행',
  food: '식당·카페 후기와 추천', meetup: '같이 할 사람 찾기', life: '일상 이야기·잡담', business: '한인 가게 소식',
  festival: '행사·공연·축제', education: '학교·학원·유학', shopping: '세일·장보기 정보', travel: '근교·여행 후기',
};

export default function FeedScreen({ meetupsOnly = false }: { meetupsOnly?: boolean }) {
  const { tr, t, language, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const reducedMotion = useReducedMotion();
  const { fontScale, width: viewportWidth } = useWindowDimensions();
  const [hasBusinessSwitch, setHasBusinessSwitch] = useState(false);
  const expandedHeader = fontScale > 1.2 || (hasBusinessSwitch && viewportWidth < 380);
  const router = useRouter();
  const { compose, hashtag } = useLocalSearchParams<{ compose?: string; hashtag?: string }>();
  const { isAuthed, isAuthLoading, promptLogin, me, isAdmin } = useAuth();
  const business = useChatIdentity();
  const [businessWriting, setBusinessWriting] = useState(false);
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const bottomClear = insets.bottom + TabBarHeight; // 탭바 + 홈 인디케이터 실측 높이
  const [posts, setPosts] = useState<Post[]>([]);
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
  const [writing, setWriting] = useState(false);
  const postSuccessPending = useRef(false);
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
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [aiFields, setAiFields] = useState<DraftField[]>([]);
  const [aiNote, setAiNote] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const aiUndo = useRef<{ title: string; body: string; tag: Tag; hashtagInput: string; postKind: PostKind; priceInput: string } | null>(null);
  const writesNew = !hasDraftText || isShortNote(title, splitPostAttachments(body).body);
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  // 카드의 작성자를 누르면 글을 열지 않고 바로 미니 프로필로 간다.
  const openAuthor = (post: Post) => {
    if (post.business) { router.push({ pathname: '/company/[id]', params: { id: post.business.id } }); return; }
    if (post.room) { router.push({ pathname: '/meetup-profile', params: { postId: post.id } }); return; }
    setSheetUser({ id: post.author.id, nickname: post.author.nickname, neighborhood: post.author.neighborhood, verified: post.author.verified, trustLevel: post.author.trustLevel, mine: post.author.id === me.id });
  };
  const [pendingPost, setPendingPost] = useState<Post | null>(null); // 로그인 후 이어서 열 글
  const [tagFilter, setTagFilter] = useState<number | null>(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null); // 카테고리 칩
  const [feedSort, setFeedSort] = useState<FeedSort>('latest');
  const activeSort = meetupsOnly ? 'latest' : feedSort;
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [feedOpacity] = useState(() => new Animated.Value(1));
  const [chipLift] = useState(() => new Animated.Value(1));
  const [categorySheet, setCategorySheet] = useState(false);
  const feedListRef = useRef<NativeFlatList<Post | Post[] | null>>(null);
  const feedIntroHeight = useRef(0);
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
  const [loadedEventsCityId, setLoadedEventsCityId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!feedReady) return;
    feedCursorPost.current = undefined;
    void refreshFeed().catch(() => {
      // Visibility must come from the server; never fall back to unfiltered seed posts.
    });
    return cancelFeedRequests;
  }, [cancelFeedRequests, feedReady, refreshFeed]);

  const cityOpen = city.state === 'open';
  const cityPosts = posts.filter((p) => p.cityId === city.id && !hidden('post', p.id, p.author.id));
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
  const cityLoading = cityOpen && !meetupsOnly && (loadedFeedCityId !== city.id || loadedEventsCityId !== city.id);

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
      setPendingPost(post); // 로그인 성공하면 이어서 열기
      return promptLogin(t.auth.reasonDetail);
    }
    setDetailPost(post);
    setDetailVisible(true);
  };
  const weeklyRanking = cityOpen && !meetupsOnly && tagFilter == null && <WeeklyRanking cityId={city.id} refreshKey={rankingRefresh} onOpen={async (postId) => {
    try {
      const post = await loadPublicPost(supabase, postId);
      if (post) openDetail(post);
      else Alert.alert(tr("글을 찾을 수 없어요"), tr("삭제되었거나 공개되지 않은 글이에요."));
    } catch {
      Alert.alert(tr("글을 불러오지 못했어요"), tr("잠시 후 다시 시도해 주세요."));
    }
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

  const updateViewCount = useCallback((postId: string, count: number) => {
    setPosts((current) => current.map((item) => item.id === postId ? { ...item, views: count } : item));
    setSearchResults((current) => current.map((item) => item.id === postId ? { ...item, views: count } : item));
  }, []);

  // 로그인 직후 보려던 글을 이어서 연다.
  useEffect(() => {
    if (isAuthed && pendingPost) {
      const timer = setTimeout(() => {
        setDetailPost(pendingPost);
        setDetailVisible(true);
        setPendingPost(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAuthed, pendingPost]);
  const showActionError = useCallback((code: keyof typeof t.actionErrors) => {
    const message = t.actionErrors[code];
    Alert.alert(message.title, message.body, [
      { text: t.write.cancel, style: 'cancel' },
      ...(message.membership ? [{ text: tr("멤버십 보기"), onPress: () => { setWriting(false); setJoinPost(null); setDetailVisible(false); setDetailPost(null); router.push('/profile/membership'); } }] : []),
    ]);
  }, [router, t, tr]);

  const onJoin = (post: Post) => {
    play('selection');
    if (!isAuthed) return promptLogin(t.auth.reasonJoinLogin);
    if (post.room?.closed) return showActionError('MEETUP_CLOSED');
    if (post.author.id === me.id) return Alert.alert(t.chat.ownMeetupTitle, t.chat.ownMeetupBody);
    if (post.room?.eventKind) {
      setDetailVisible(false);
      setDetailPost(null);
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
      play('meetup');
      setJoinPost(null);
      setJoinMessage('');
      Alert.alert(t.chat.joinDoneTitle, t.chat.joinDoneBody);
    } catch (error) {
      play('warning');
      const code = getCommunityActionError(error);
      if (code) showActionError(code);
      else Alert.alert(t.chat.startErrorTitle, t.chat.startErrorBody);
    } finally {
      setJoining(false);
    }
  };

  const openWriter = useCallback(() => {
    play('reaction');
    if (!isAuthed) return promptLogin(t.auth.reasonWrite);
    // Acting as a business, the writer offers only business post types (owner 2026-10-25, option A).
    if (business) { setBusinessWriting(true); return; }
    if (writing) return;
    void loadListingQuota(supabase).then(setListingQuota).catch(() => {});
    const revision = ++writerRevision.current;
    draftLocation.current = null;
    if (!title.trim() && !body.trim() && !hashtagInput.trim() && draftImages.length === 0 && !pollDraft) {
      setDraftCity(city);
      // Writing from 부동산·구인구직·중고거래 starts in that category with its fields.
      const listingTag = listingCategory && TAGS.find(item => item.slug === listingCategory);
      if (listingTag) { setTag(listingTag); setPostKind('listing'); }
    }
    setWriterPanel(null);
    setWriterOptionsOpen(false);
    setWriting(true);
    void location.capture().then((fix) => {
      if (revision !== writerRevision.current) return;
      draftLocation.current = fix;
    });
  }, [isAuthed, promptLogin, business, writing, city, location, title, body, hashtagInput, draftImages, pollDraft, play, t.auth.reasonWrite, listingCategory]);

  useEffect(() => {
    if (!writing) { writerRevision.current++; draftLocation.current = null; }
  }, [writing]);


  useEffect(() => {
    if (compose !== '1') return;
    router.setParams({ compose: undefined });
    queueMicrotask(openWriter);
  }, [compose, openWriter, router]);

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
    setSubmitting(true);
    const revision = feedRevision.current;
    const hashtags = parseHashtags(hashtagInput);
    try {
      const created = await createCommunityPost(supabase, {
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
      });
      const post = created.post;
      if (revision === feedRevision.current) {
        void location.record(draftLocation.current, created.id);
        setCity(draftCity);
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
      postSuccessPending.current = Platform.OS === 'ios';
      setWriting(false);
      if (Platform.OS !== 'ios') setTimeout(() => play('postPublished'), 350);
    } catch (error) {
      play('warning');
      const contentRejected = isContentRejected(error);
      const actionError = getCommunityActionError(error);
      if (actionError) showActionError(actionError);
      else Alert.alert(
        contentRejected ? t.safety.contentBlockedTitle : t.write.submitErrorTitle,
        contentRejected ? t.safety.contentBlockedBody : t.write.submitErrorBody,
      );
    } finally {
      setSubmitting(false);
    }
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

  const feedState = cityOpen && feedLoading ? <View style={styles.categoryLoading}>{cityLoading ? <View style={[styles.feedPlaceholder, { backgroundColor: theme.backgroundElement }]} accessible={false} /> : <GlingLoader color={theme.accent} accessibilityLabel={tr("글 불러오는 중")} />}</View> : (
    cityOpen ? (
      feedError && feedData.length === 0 ? (
        <StateCard kind="error" title={tr("글을 불러오지 못했어요")} body={tr("연결을 확인하고 다시 시도해 주세요.")} actionLabel={tr("다시 시도")} onAction={() => { play('selection'); void refreshFeed().catch(() => {}); }} />
      ) : feedData.length > 0 && listingPosts.length === 0 ? (
        <View style={styles.soon}>
          <ThemedText accessibilityRole="header" style={styles.soonTitle}>{tr('조건에 맞는 글이 없어요')}</ThemedText>
          <Pressable analyticsId="listing.filters.reset" onPress={() => { play('selection'); setListingFilters(NO_LISTING_FILTERS); }} accessibilityRole="button" style={({ pressed }) => [styles.soonCta, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, opacity: pressed ? 0.82 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('조건 모두 지우기')}</ThemedText>
          </Pressable>
        </View>
      ) : feedData.length === 0 ? (
        <View style={styles.soon}>
          <ThemedText accessibilityRole="header" style={styles.soonTitle}>{meetupsOnly ? t.feed.meetupEmptyTitle : activeSort === 'popular' ? tr("최근 7일 글이 아직 없어요") : t.feed.emptyTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.soonBody}>{meetupsOnly ? t.feed.meetupEmptyBody : activeSort === 'popular' ? tr("최신순에서 다른 이야기도 둘러보세요.") : t.feed.emptyBody}</ThemedText>
          <Pressable analyticsId="components_feed-screen.pressable.6" onPress={openWriter} accessibilityRole="button" style={({ pressed }) => [styles.soonCta, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, }]}>
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
          style={({ pressed }) => [styles.soonCta, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, }]}>
          <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
            {t.feed.soonCta}
          </ThemedText>
        </Pressable>
      </View>
    )
  );

  return (
    <TabContent style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}><View style={styles.safeArea}>
        <View style={[styles.headRow, expandedHeader && styles.headRowLarge, { backgroundColor: theme.background }]}>
          <Pressable analyticsId="feed.home" accessibilityRole="button" accessibilityLabel={`${t.appName}, ${t.tabs.today}`}
            onPress={() => { play('selection'); router.navigate('/'); }} style={[styles.homeButton, expandedHeader && styles.homeButtonLarge]}>
            <Image source={theme === Colors.light ? require('@/assets/brand/gling-night-wordmark-light.png') : require('@/assets/brand/gling-night-wordmark.png')} style={[styles.wordmark, (viewportWidth < 380 || fontScale > 1.2) && styles.wordmarkCompact]} contentFit="contain" accessible={false} />
          </Pressable>
          <GlassSurface tone="control" interactive style={[styles.cityGlass, expandedHeader && styles.cityGlassLarge]}><Pressable analyticsId="components_feed-screen.pressable.1"
            onPress={() => { play('reaction'); setCityPicker(true); }} accessibilityRole="button"
            accessibilityLabel={`${tr(city.name)}, ${t.feed.cityPickerTitle}`}
            style={({ pressed }) => [styles.cityButton, controlPresentation(theme, { pressed, reducedMotion }).container]}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.city}>{tr(city.name)}</ThemedText>
            <SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} tintColor={theme.text} />
          </Pressable></GlassSurface>
          <View style={styles.iconGlass}><Pressable analyticsId="components_feed-screen.pressable.2"
            onPress={() => { play('selection'); openSearch(); }} accessibilityRole="button" accessibilityLabel={appLocale === 'en-CA' ? 'Search Gling' : '통합검색'}
            style={({ pressed }) => [styles.iconButton, controlPresentation(theme, { tone: 'ghost', pressed, reducedMotion }).container]}>
            <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.toolbar} tintColor={theme.text} />
          </Pressable></View>
          {!meetupsOnly && <View style={styles.iconGlass}><Pressable analyticsId="discovery.open"
            onPress={() => { play('reaction'); router.push('/map'); }} accessibilityRole="button" accessibilityLabel={tr('부동산·중고거래·장소·행사 통합 지도')}
            style={({ pressed }) => [styles.iconButton, controlPresentation(theme, { tone: 'ghost', pressed, reducedMotion }).container]}>
            <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={IconSize.toolbar} tintColor={theme.text} />
          </Pressable></View>}
          <ProfileAvatarButton onBusinessSwitchAvailabilityChange={setHasBusinessSwitch} />
        </View>
        {cityOpen && !meetupsOnly && (
          <View style={styles.categoryHead}>
            <GlassSurface tone="control" style={styles.chipGlass}><ScrollView analyticsId="components_feed-screen.scrollview.1" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
              {/* 처음 보이는 칩 6개(전체·라이프·맛집·부동산·구인구직·정착, owner 2026-10-30); 나머지는 '더보기' 시트. */}
              {[...PRIMARY_TAGS, ...(tagFilter != null && !PRIMARY_TAGS.includes(tagFilter) ? [tagFilter] : [])].map((id) => {
                const label = id == null ? t.feed.filterAll : tr(TAGS.find((tg) => tg.id === id)!.label);
                const active = tagFilter === id;
                return (
                  <Animated.View key={id ?? 'all'} style={active && { borderRadius: 999, transform: [{ scale: chipLift }] }}><Pressable analyticsId="components_feed-screen.pressable.3"
                    onPress={() => changeTagFilter(id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.filterChip,
                      { backgroundColor: active ? theme.accent : pressed ? 'rgba(255,255,255,0.12)' : 'transparent', borderBottomColor: 'transparent', },
                    ]}>
                    <ThemedText type="smallBold" style={{ color: active ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
                  </Pressable></Animated.View>
                );
              })}
              <Pressable analyticsId="feed.categories.more" accessibilityRole="button" accessibilityLabel={tr('카테고리 전체 보기')}
                onPress={() => { play('selection'); setCategorySheet(true); }}
                style={({ pressed }) => [styles.filterChip, { flexDirection: 'row', gap: 4, borderBottomColor: 'transparent', backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
                <ThemedText type="smallBold" themeColor="accent">{tr('더보기')}</ThemedText>
                <SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={IconSize.chevron} tintColor={theme.accent} />
              </Pressable>
            </ScrollView></GlassSurface>
          </View>
        )}
        <FlatList analyticsId="components_feed-screen.flatlist.1" ref={feedListRef}
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
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomClear + Spacing.three }]}
          ItemSeparatorComponent={({ leadingItem }) => leadingItem == null ? null : <View style={{ height: (businessCategory && !businessGrid) || (listingCategory && !usedGrid) ? 0 : Spacing.four }} />}
          ListFooterComponent={loadingMore ? <ThemedText type="small" themeColor="textSecondary" style={styles.loadingMore}>{t.feed.loadingMore}</ThemedText> : feedState ?? undefined}
          renderItem={({ item, index }) => item == null && index === 1 && showFeedSort ? (
            <FeedSortControl sort={activeSort} title={businessCategory ? tr('새 소식') : selectedFilterTag ? tr("{0} 글", (selectedFilterTag.label)) : tr("오늘 글")} onChange={changeFeedSort}
              action={businessCategory ? <Pressable analyticsId="business.directory.open" accessibilityRole="button" accessibilityLabel={tr('비즈니스 찾기')}
                onPress={() => { play('selection'); router.push('/businesses'); }}
                style={({ pressed }) => [ControlStyles.pill, { flexDirection: 'row', gap: Spacing.two }, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
                <SymbolView name={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} size={IconSize.inline} tintColor={theme.accent} />
                <ThemedText type="smallBold" themeColor="accent">{tr('비즈니스 찾기')}</ThemedText>
                <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.accent} />
              </Pressable> : listingCategory && listingCategory !== 'jobs' ? <ListingModeSwitch mode="list" onChange={mode => setListingMap(mode === 'map')} /> : undefined}>
              {listingCategory && <ListingFilterBar category={listingCategory} cityId={city.id} filters={listingFilters} onChange={setListingFilters}
                view={listingView} onView={changeListingView} />}
              {businessCategory && <ListingViewSwitch view={businessView} onView={changeBusinessView} />}
            </FeedSortControl>
          ) : item == null ? (
            <View style={styles.header} onLayout={event => { feedIntroHeight.current = event.nativeEvent.layout.height; }}>
              <View style={styles.journalIntro}>
                <View style={styles.journalStatusRow}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.journalDate}>{todayLabel(appLocale)}</ThemedText>
                  {cityLoading && <View style={styles.cityLoadingStatus}><GlingLoader color={theme.accent} size={18} accessibilityLabel={tr("{0} 소식 불러오는 중", (city.name))} /><ThemedText type="small" themeColor="textSecondary">{tr("소식 불러오는 중")}</ThemedText></View>}
                </View>
                {meetupsOnly && <ThemedText accessibilityRole="header" style={styles.journalTitle}>{t.feed.meetupTitle}</ThemedText>}
              </View>
              {!meetupsOnly && <StartGuide cityName={city.name} onPickCity={() => setCityPicker(true)} onOpenMeetups={() => router.navigate('/meetups')} />}
              {!meetupsOnly && isAuthed && <NewcomerProgressCard />}
              {cityOpen && !meetupsOnly && <LocalEventsCarousel cityId={city.id} refreshKey={rankingRefresh} cityLoading={cityLoading} onCityReady={setLoadedEventsCityId} />}
              {cityOpen && !meetupsOnly && <CityPopularPlaces cityId={city.id} />}
              {meetupsOnly && <>
                <MyMeetups onOpen={async (postId) => {
                  const post = await loadPublicPost(supabase, postId);
                  if (!post) throw new Error('POST_NOT_FOUND');
                  openDetail(post);
                }} />
                {cityOpen && <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{t.meetup.discover}</ThemedText>}
              </>}
              {!feedLoading && weeklyRanking}
            </View>
          ) : (
            Array.isArray(item) ? <Animated.View style={[styles.listingGrid, { opacity: feedOpacity }]}>
              {item.map(post => businessGrid ? <BusinessNewsCard key={post.id} variant="tile" post={post} onPress={() => openDetail(post)} onAuthor={() => openAuthor(post)}
                translationVisible={visibleFeedIds.has(post.id) && !searching && !detailVisible && !writing} />
                : post.listingDetails ? <ListingCard key={post.id} variant="tile" post={post as DetailedPost} onPress={() => openDetail(post)} />
                : <View key={post.id} style={styles.flexText}><PostCard flat post={post} onPress={() => openDetail(post)} onJoin={() => void onJoin(post)} onHashtag={openSearch} onAuthor={() => openAuthor(post)} /></View>)}
              {item.length === 1 && <View style={styles.flexText} />}
            </Animated.View> :
            <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 5) * 65).duration(360)}><Animated.View style={{ opacity: feedOpacity }}>{listingCategory && item.listingDetails ? <ListingCard
              post={item as DetailedPost} onPress={() => openDetail(item)} /> : businessCategory ? <BusinessNewsCard
              post={item} onPress={() => openDetail(item)} onAuthor={() => openAuthor(item)}
              translationVisible={visibleFeedIds.has(item.id) && !searching && !detailVisible && !writing} /> : <PostCard
              flat
              post={item}
              translationVisible={visibleFeedIds.has(item.id) && !searching && !detailVisible && !writing}
              onPress={() => openDetail(item)}
              onJoin={() => void onJoin(item)}
              onHashtag={openSearch}
              onAuthor={() => openAuthor(item)}
            />}{!meetupsOnly && adsSupported && (Platform.OS !== 'web' || (!isAuthed && !feedError && !detailVisible && !writing && !searching)) && feedAdPosition(index - (showFeedSort ? 2 : 1), feedRows.length) && <FeedAd key={`ad-after-${item.id}`} />}</Animated.View></Reanimated.View>
          )}
        />

      </View></SafeAreaView>

      <Modal visible={categorySheet} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={() => setCategorySheet(false)}>
        <SafeAreaView style={[styles.categorySheet, { backgroundColor: theme.background }]}>
          <View style={styles.categorySheetHead}>
            <View style={{ flex: 1 }}>
              <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{tr('카테고리')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{tr('무엇을 올리는 곳인지 보고 골라 보세요. 자주 쓰는 6개는 위 줄에 늘 있어요.')}</ThemedText>
            </View>
            <Pressable analyticsId="feed.categories.close" accessibilityRole="button" onPress={() => { play('selection'); setCategorySheet(false); }}
              style={({ pressed }) => [ControlStyles.pill, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{tr('닫기')}</ThemedText>
            </Pressable>
          </View>
          <ScrollView analyticsId="feed.categories.sheet" contentContainerStyle={styles.categoryGrid}>
            {TAGS.map(tg => {
              const active = tagFilter === tg.id;
              return (
                <Pressable key={tg.id} analyticsId="feed.categories.pick" accessibilityRole="button" accessibilityState={{ selected: active }}
                  onPress={() => { setCategorySheet(false); changeTagFilter(tg.id); }}
                  style={({ pressed }) => [styles.categoryCell, { backgroundColor: active ? theme.backgroundSelected : theme.card, borderColor: active ? theme.accent : theme.line }, pressed && { opacity: 0.82 }]}>
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
      {/* 검색: 제목·내용·해시태그. 입력 전엔 인기 해시태그 칩 (당근 검색 패턴) */}
      <Modal visible={searching} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setSearching(false)}
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
                        Depth.control,
                        { backgroundColor: theme.backgroundElement, borderBottomColor: theme.line, },
                      ]}>
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
                data={searchResults.filter((post) => !hidden('post', post.id, post.author.id) && (!meetupsOnly || !post.room?.closed))}
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
                    onHashtag={(value) => { setQuery(value); setSearchResults([]); }}
                    onAuthor={() => openAuthor(item)}
                  />
                )}
              />
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {/* 글 상세 (로그인 게이트 통과 시) — pageSheet: 상단 여백·스와이프 닫기 네이티브 제공 */}
      <Modal
        visible={detailVisible && !!detailPost}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        allowSwipeDismissal
        onRequestClose={() => setDetailVisible(false)}
        onDismiss={() => setDetailPost(null)}>
        {detailPost && (
          <PostDetail
            post={detailPost}
            onViewCountChange={updateViewCount}
            onClose={() => setDetailVisible(false)}
            onPostRemoved={(postId) => setPosts((current) => current.filter((post) => post.id !== postId))}
            onPostChanged={(saved) => {
              setPosts(current => current.map(post => post.id === saved.id ? saved : post));
              setSearchResults(current => current.map(post => post.id === saved.id ? saved : post));
              setDetailPost(saved);
            }}
            onJoin={() => onJoin(detailPost)}
            onCommentCountChange={(count) => {
              setPosts((current) => current.map((post) => post.id === detailPost.id ? { ...post, comments: count } : post));
              setDetailPost((current) => current ? { ...current, comments: count } : current);
            }}
          />
        )}
      </Modal>

      <Modal visible={joinPost != null} transparent animationType="fade" onRequestClose={() => setJoinPost(null)}>
        <View style={styles.joinBackdrop}>
          <Pressable analyticsId="components_feed-screen.pressable.10" style={StyleSheet.absoluteFill} onPress={() => { play('selection'); setJoinPost(null); }} accessibilityRole="button" accessibilityLabel={tr("모임 신청 닫기")} />
          <ThemedView style={[styles.joinSheet, { backgroundColor: theme.card }]}>
            <ThemedText type="subtitle">{t.chat.joinFormTitle}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t.chat.joinFormBody}</ThemedText>
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
              <Pressable analyticsId="components_feed-screen.pressable.11" onPress={() => { play('selection'); setJoinPost(null); }} accessibilityRole="button" style={({ pressed }) => [styles.secondaryButton, { borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
                <ThemedText type="smallBold">{t.write.cancel}</ThemedText>
              </Pressable>
              <Pressable analyticsId="components_feed-screen.pressable.12"
                onPress={() => { play('selection'); void submitJoin(); }}
                disabled={joining}
                accessibilityRole="button"
                accessibilityState={{ disabled: joining, busy: joining }}
                style={({ pressed }) => [styles.aiButton, { backgroundColor: theme.accent, opacity: joining ? 0.6 : pressed ? 0.7 : 1 }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{joining ? t.chat.joinSending : t.chat.joinSubmit}</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* 도시 선택은 안전 영역을 확보한 전체 화면(iOS) 또는 하단 모달(Android)로 연다. */}
      <Modal
        visible={cityPicker}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : 'overFullScreen'}
        transparent={Platform.OS !== 'ios'}
        allowSwipeDismissal
        onRequestClose={() => setCityPicker(false)}>
        <SafeAreaProvider style={[styles.cityBackdrop, Platform.OS === 'ios' && { backgroundColor: theme.background }]}>
          {Platform.OS !== 'ios' && (
            <Pressable analyticsId="components_feed-screen.pressable.13" style={StyleSheet.absoluteFill} onPress={() => { play('selection'); setCityPicker(false); }} accessibilityRole="button" accessibilityLabel={t.write.cancel} />
          )}
          <ThemedView style={[styles.citySheet, Platform.OS === 'ios' && styles.citySheetIOS]}>
            <View style={{ flex: 1, paddingTop: Platform.OS === 'ios' ? insets.top : 0, paddingBottom: insets.bottom }}>
              <CityPicker onClose={() => setCityPicker(false)} />
            </View>
          </ThemedView>
        </SafeAreaProvider>
      </Modal>

      {/* 글쓰기의 선택 항목은 접고, 제목과 본문을 먼저 보여준다. */}
      {business && <BusinessWriter business={business} visible={businessWriting} onClose={() => setBusinessWriting(false)} onPublished={() => { void refreshFeed().catch(() => {}); }} />}
      <Modal visible={writing} animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} allowSwipeDismissal
        onDismiss={() => {
          if (!postSuccessPending.current) return;
          postSuccessPending.current = false;
          play('postPublished');
        }}
        onRequestClose={() => setWriting(false)}>
        <SafeAreaProvider style={[styles.writer, { backgroundColor: theme.background }]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.writer}>
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
                  <Pressable analyticsId="components_feed-screen.writer-options" accessibilityRole="button" accessibilityLabel={tr("게시 설정 변경, {0}, {1}, {2}", (tr(draftCity.name)), (tr(tag.label)), (postKind === 'listing' ? t.write.kindListing : t.write.kindStory))} accessibilityState={{ expanded: writerOptionsOpen }} onPress={() => { play('reaction'); Keyboard.dismiss(); animateLayout(); setWriterOptionsOpen(open => !open); setWriterPanel(null); }} style={({ pressed }) => [styles.writerContextSummary, Depth.control, { backgroundColor: theme.card, }]}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.writerContextValue}>{tr(draftCity.name)} · {tr(tag.label)}{tag.kind !== 'meetup' ? ` · ${postKind === 'listing' ? t.write.kindListing : t.write.kindStory}` : ''}</ThemedText>
                    <ThemedText type="smallBold" themeColor="accent">{tr("변경")}</ThemedText>
                    <SymbolView name={{ ios: writerOptionsOpen ? 'chevron.up' : 'chevron.right', android: writerOptionsOpen ? 'expand_less' : 'chevron_right', web: writerOptionsOpen ? 'expand_less' : 'chevron_right' }} size={14} tintColor={theme.accent} />
                  </Pressable>
                  {writerOptionsOpen && <View style={styles.writerOptionButtons}>
                  <Pressable analyticsId="components_feed-screen.pressable.16" accessibilityRole="button" accessibilityLabel={`${t.write.postCity}, ${tr(draftCity.name)}, ${draftCity.province}`}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel('city'); }}
                    style={({ pressed }) => [styles.contextButton, Depth.control, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, }]}>
                    <SymbolView name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }} size={16} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" style={styles.contextText}>{tr(draftCity.name)} · {draftCity.province}</ThemedText>
                    <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  <Pressable analyticsId="components_feed-screen.pressable.17" accessibilityRole="button" accessibilityLabel={`${t.write.category}, ${tr(tag.label)}`} accessibilityState={{ expanded: writerPanel === 'category' }}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel(writerPanel === 'category' ? null : 'category'); }}
                    style={({ pressed }) => [styles.contextButton, Depth.control, { backgroundColor: pressed || writerPanel === 'category' ? theme.backgroundSelected : theme.backgroundElement, }]}>
                    <ThemedText type="smallBold" style={styles.contextText}>{tr(tag.label)}</ThemedText>
                    <SymbolView name={{ ios: writerPanel === 'category' ? 'chevron.up' : 'chevron.down', android: writerPanel === 'category' ? 'expand_less' : 'expand_more', web: writerPanel === 'category' ? 'expand_less' : 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  {tag.kind !== 'meetup' && <Pressable analyticsId="components_feed-screen.pressable.18" accessibilityRole="button" accessibilityLabel={`${t.write.pickKind}, ${postKind === 'listing' ? t.write.kindListing : t.write.kindStory}`} accessibilityState={{ expanded: writerPanel === 'kind' }}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel(writerPanel === 'kind' ? null : 'kind'); }}
                    style={({ pressed }) => [styles.contextButton, Depth.control, { backgroundColor: pressed || writerPanel === 'kind' ? theme.backgroundSelected : theme.backgroundElement, }]}>
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
                        style={({ pressed }) => [styles.tagChip, Depth.control, { backgroundColor: selected ? theme.accent : theme.backgroundElement, borderBottomColor: selected ? theme.accentDepth : theme.line, }]}>
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
                            Depth.control,
                            { backgroundColor: selected ? theme.accent : theme.backgroundElement, borderBottomColor: selected ? theme.accentDepth : theme.line, },
                          ]}>
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
                        <View key={`${image.uri}-${index}`} style={styles.photoTile}>
                          <Image source={{ uri: image.uri }} style={styles.photoTileImage} contentFit="cover" />
                          {index < MAX_AI_IMAGES && <View style={[styles.photoAiBadge, { backgroundColor: theme.card }]} accessibilityLabel={tr("AI가 읽는 사진")}>
                            <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={10} tintColor={theme.accent} />
                          </View>}
                          <Pressable analyticsId="components_feed-screen.pressable.21"
                            onPress={() => { play('selection'); setDraftImages((current) => current.filter((_, position) => position !== index)); setAiDraftReady(false); }}
                            accessibilityRole="button"
                            accessibilityLabel={tr("{0}번째 사진 삭제", (index + 1))}
                            style={[styles.photoRemove, { backgroundColor: theme.card }]}>
                            <ThemedText type="smallBold" style={{ color: theme.text }}>✕</ThemedText>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <ThemedText type="small" themeColor="textSecondary">{tr('사진 {0}/{1}', draftImages.length, MAX_POST_IMAGES)}</ThemedText>
                </View>}
                  {selectedHashtags.length > 0 && <View style={styles.selectedHashtags}>
                    {selectedHashtags.map((hashtag) => <Pressable analyticsId="components_feed-screen.pressable.27" key={hashtag} accessibilityRole="button" accessibilityLabel={tr("#{0} 삭제", (hashtag))}
                      onPress={() => { play('reaction'); animateLayout(); setHashtagInput(current => parseHashtags(current).filter(value => value !== hashtag).join(' ')); }}
                      style={({ pressed }) => [styles.selectedHashtag, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, }]}>
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
                  style={[styles.aiButton, { borderColor: theme.accent, opacity: submitting || creatingDraft || (draftImages.length === 0 && !hasDraftText) ? 0.6 : 1 }]}>
                  <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={16} tintColor={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent, flexShrink: 1 }}>
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
                      style={[styles.writerTool, { opacity: canAddPostImage(draftImages.length) ? 1 : 0.5 }]}>
                      <SymbolView name={{ ios: 'photo', android: 'photo_library', web: 'photo_library' }} size={20} tintColor={theme.textSecondary} />
                      <ThemedText type="smallBold" style={styles.writerToolLabel}>{tr("사진")}</ThemedText>
                    </Pressable>
                  {actions}
                  <Pressable analyticsId="components_feed-screen.pressable.26" accessibilityRole="button" accessibilityLabel={tr("더보기")} accessibilityState={{ expanded: writerPanel === 'more', disabled: submitting || creatingDraft }} disabled={submitting || creatingDraft}
                    onPress={() => { play('selection'); Keyboard.dismiss(); changeWriterPanel('more'); }} style={styles.writerTool}>
                    <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={20} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" style={styles.writerToolLabel} themeColor="textSecondary">{tr("더보기")}</ThemedText>
                  </Pressable>
                </View>
              </View>
              </View>} />
              <Modal visible={writerPanel === 'more'} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={() => changeWriterPanel(null)}>
                <SafeAreaProvider>
                  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.writerMoreBackdrop}>
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
                  style={[styles.aiButton, styles.writerAttachments, { backgroundColor: hasAdLabel(selectedHashtags) ? theme.backgroundSelected : theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{hasAdLabel(selectedHashtags) ? '☑ AD' : '□ AD'}</ThemedText>
                </Pressable>}
                        {Platform.OS !== 'web' && <Pressable analyticsId="components_feed-screen.pressable.24" accessibilityRole="button" accessibilityLabel={t.write.takePhoto} disabled={submitting || creatingDraft || !canAddPostImage(draftImages.length)}
                          onPress={() => { play('selection'); void pickDraftImage('camera'); }} style={styles.writerMoreCamera}>
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
                            Depth.control,
                            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, borderBottomColor: theme.line, },
                          ]}>
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
          </KeyboardAvoidingView>
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
  cityButton: { ...ControlStyles.pill, flexDirection: 'row', gap: Spacing.one, flexShrink: 1, paddingHorizontal: 12 },
  city: { ...Typography.label, flexShrink: 1 },
  iconButton: ControlStyles.icon,
  unreadBadge: { position: 'absolute', top: 0, right: 0, minWidth: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontSize: 10, lineHeight: 14, fontVariant: ['tabular-nums'] },
  journalIntro: { paddingTop: Spacing.three, gap: Spacing.one },
  journalStatusRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  cityLoadingStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  journalDate: { fontSize: 12, lineHeight: 18, letterSpacing: 0.8 },
  feedPlaceholder: { width: '100%', height: 180, borderRadius: 16 },
  journalTitle: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.8 },
  chipGlass: { borderRadius: 28, marginTop: Spacing.two },
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
