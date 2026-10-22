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
import { PostBodyEditor } from '@/components/post-body-editor';
import { PollDraftFields } from '@/components/poll-draft-fields';
import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { WeeklyRanking } from '@/components/weekly-ranking';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { PostDetail } from '@/components/post-detail';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { useCommunityCity } from '@/lib/community-city';
import type { LocationFix } from '@/lib/location';
import { useCommunityLocation } from '@/lib/location-provider';
import { parseAiDraftResponse } from '@/lib/ai-draft';
import {
  createCommunityPost,
  loadListingQuota,
  getCommunityActionError,
  isContentRejected,
  loadTrendingHashtags,
  MEETUPS_CHANGED_EVENT,
  requestMeetupJoin,
} from '@/lib/community-data';
import { appendUniquePosts, loadPublicFeed, loadPublicPost, type FeedSort } from '@/lib/feed-data';
import { addHashtag, canonicalizeHashtag, getSuggestedHashtags, hasAdLabel, MAX_HASHTAGS, parseHashtags, toggleAdLabel } from '@/lib/hashtags';
import { canAddPostImage, MAX_POST_IMAGES } from '@/lib/image-upload';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { normalizePoll, type PollDraft } from '@/lib/post-polls';
import { TAGS } from '@/lib/mock';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { postMapBody, withPostMap } from '@/lib/post-maps';
import { supabase } from '@/lib/supabase';
import type { DailyQuota, Post, PostKind, Tag } from '@/lib/types';
import { splitPostAttachments, withPostAttachments } from '../../supabase/functions/_shared/post-links';



export default function FeedScreen({ meetupsOnly = false }: { meetupsOnly?: boolean }) {
  const { tr, t, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { isAuthed, promptLogin, me, isAdmin } = useAuth();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const bottomClear = insets.bottom + TabBarHeight; // 탭바 + 홈 인디케이터 실측 높이
  const [posts, setPosts] = useState<Post[]>([]);
  const [visibleFeedIds, setVisibleFeedIds] = useState<Set<string>>(new Set());
  const [visibleSearchIds, setVisibleSearchIds] = useState<Set<string>>(new Set());
  const trackTranslationFeed = useCallback(({ viewableItems }: { viewableItems: { item: Post | null }[] }) =>
    setVisibleFeedIds(new Set(viewableItems.flatMap(({ item }) => item ? [item.id] : []))), []);
  const trackTranslationSearch = useCallback(({ viewableItems }: { viewableItems: { item: Post }[] }) =>
    setVisibleSearchIds(new Set(viewableItems.map(({ item }) => item.id))), []);
  const { city, setCity } = useCommunityCity();
  const location = useCommunityLocation();
  const [draftCity, setDraftCity] = useState(city);
  const draftLocation = useRef<(LocationFix & { userId: string }) | null>(null);
  const writerRevision = useRef(0);
  const [writerPanel, setWriterPanel] = useState<'city' | 'category' | 'kind' | 'hashtags' | null>(null);
  const [writerOptionsOpen, setWriterOptionsOpen] = useState(false);
  const [cityPicker, setCityPicker] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writerKeyboardInset, setWriterKeyboardInset] = useState(0);
  const postSuccessPending = useRef(false);
  const [tag, setTag] = useState<Tag>(TAGS[0]);
  const [postKind, setPostKind] = useState<PostKind>('story');
  const [priceInput, setPriceInput] = useState('');
  const [listingQuota, setListingQuota] = useState<DailyQuota | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pollDraft, setPollDraft] = useState<PollDraft | null>(null);
  const hasDraftText = !!title.trim() || !!splitPostAttachments(body).body.trim();
  const [hashtagInput, setHashtagInput] = useState('');
  const [draftImages, setDraftImages] = useState<PreparedImage[]>([]);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  // 카드의 작성자를 누르면 글을 열지 않고 바로 미니 프로필로 간다.
  const openAuthor = (post: Post) => setSheetUser({ id: post.author.id, nickname: post.author.nickname, neighborhood: post.author.neighborhood, verified: post.author.verified, trustLevel: post.author.trustLevel, mine: post.author.id === me.id });
  const [pendingPost, setPendingPost] = useState<Post | null>(null); // 로그인 후 이어서 열 글
  const [tagFilter, setTagFilter] = useState<number | null>(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null); // 카테고리 칩
  const [feedSort, setFeedSort] = useState<FeedSort>('latest');
  const activeSort = meetupsOnly ? 'latest' : feedSort;
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [feedOpacity] = useState(() => new Animated.Value(1));
  const [chipLift] = useState(() => new Animated.Value(1));
  const feedListRef = useRef<NativeFlatList<Post | null>>(null);
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
    feedCursorPost.current = undefined;
    void refreshFeed().catch(() => {
      // Visibility must come from the server; never fall back to unfiltered seed posts.
    });
    return cancelFeedRequests;
  }, [cancelFeedRequests, refreshFeed]);

  const cityOpen = city.state === 'open';
  const cityPosts = posts.filter((p) => p.cityId === city.id && !hidden('post', p.id, p.author.id));
  const feedData = useMemo(
    () =>
      cityOpen
        ? cityPosts.filter((p) => (tagFilter == null || p.tag.id === tagFilter) && (!meetupsOnly || !p.room?.closed))
        : [],
    [cityOpen, cityPosts, meetupsOnly, tagFilter],
  );

  const showFeedSort = cityOpen && !meetupsOnly;
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
    setQuery(initial ?? '');
    setSearchResults([]);
    setSearching(true);
  };

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
    if (writing) return;
    void loadListingQuota(supabase).then(setListingQuota).catch(() => {});
    const revision = ++writerRevision.current;
    draftLocation.current = null;
    if (!title.trim() && !body.trim() && !hashtagInput.trim() && draftImages.length === 0 && !pollDraft) setDraftCity(city);
    setWriterPanel(null);
    setWriterOptionsOpen(false);
    setWriting(true);
    void location.capture().then((fix) => {
      if (revision !== writerRevision.current) return;
      draftLocation.current = fix;
    });
  }, [isAuthed, promptLogin, writing, city, location, title, body, hashtagInput, draftImages, pollDraft, play, t.auth.reasonWrite]);

  useEffect(() => {
    if (!writing) { writerRevision.current++; draftLocation.current = null; }
  }, [writing]);
  useEffect(() => {
    if (!writing || Platform.OS !== 'ios') return;
    const frame = Keyboard.addListener('keyboardWillChangeFrame', event => setWriterKeyboardInset(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setWriterKeyboardInset(0));
    return () => { frame.remove(); hide.remove(); setWriterKeyboardInset(0); };
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
    try {
      const { data, error } = await supabase.functions.invoke('draft-post', {
        body: {
          cityName: draftCity.name,
          selectedCategory: tag.slug,
          titleHint: titleHint || undefined,
          bodyHint: bodyHint || undefined,
          ...(draftImages[0] ? { imageBase64: draftImages[0].base64, mimeType: draftImages[0].mimeType } : {}),
        },
      });
      if (error) throw error;
      const draft = parseAiDraftResponse(data);
      setTag(TAGS.find(({ slug }) => slug === draft.categorySlug) ?? tag);
      setTitle(draft.title);
      setBody(withPostMap(withPostAttachments(draft.body, attached.urls), mapped.url ?? '', mapped.label));
      setHashtagInput(current => parseHashtags(`${hasAdLabel(parseHashtags(current)) ? 'AD ' : ''}${draft.hashtags.join(' ')}`).map(hashtag => `#${hashtag}`).join(' '));
      setAiDraftReady(true);
    } catch {
      Alert.alert(t.write.aiErrorTitle, t.write.aiErrorBody);
    } finally {
      setCreatingDraft(false);
    }
  };

  const submit = async () => {
    if (tag.kind === 'meetup') {
      setWriting(false);
      router.push('/meetup-create');
      return;
    }
    if (!title.trim() || !body.trim()) {
      Alert.alert(t.write.validationTitle, t.write.validationBody);
      return;
    }
    if (submitting) return;
    let poll: PollDraft | undefined;
    try { poll = postKind === 'story' && pollDraft ? normalizePoll(pollDraft) : undefined; }
    catch {
      play('warning');
      Alert.alert(tr("투표를 확인해 주세요"), tr("질문과 보기를 모두 적어 주세요. 같은 보기는 넣을 수 없어요."));
      return;
    }
    let postBody: string;
    try { postBody = withPostMap(body, ''); }
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
        price: postKind === 'listing' && priceInput.trim() ? Number(priceInput.replace(/[^0-9.]/g, '')) : null,
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
      setTitle('');
      setBody('');
      setPollDraft(null);
      setHashtagInput('');
      setDraftImages([]);
      setAiDraftReady(false);
      setPostKind('story');
      setPriceInput('');
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
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={[styles.headRow, { backgroundColor: theme.background }]}>
          <Pressable analyticsId="feed.home" accessibilityRole="button" accessibilityLabel={`${t.appName}, ${t.tabs.today}`}
            onPress={() => { play('selection'); router.navigate('/'); }} style={styles.homeButton}>
            <Image source={theme === Colors.light ? require('@/assets/brand/gling-night-wordmark-light.png') : require('@/assets/brand/gling-night-wordmark.png')} style={styles.wordmark} contentFit="contain" accessible={false} />
          </Pressable>
          <GlassSurface tone="control" interactive style={styles.cityGlass}><Pressable analyticsId="components_feed-screen.pressable.1"
            onPress={() => { play('reaction'); setCityPicker(true); }} accessibilityRole="button"
            accessibilityLabel={`${tr(city.name)}, ${t.feed.cityPickerTitle}`}
            style={({ pressed }) => [styles.cityButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.city}>{tr(city.name)}</ThemedText>
            <SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} tintColor={theme.text} />
          </Pressable></GlassSurface>
          <GlassSurface tone="control" interactive style={styles.iconGlass}><Pressable analyticsId="components_feed-screen.pressable.2"
            onPress={() => { play('reaction'); openSearch(); }} accessibilityRole="button" accessibilityLabel={t.search.placeholder}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={21} tintColor={theme.text} />
          </Pressable></GlassSurface>
          {!meetupsOnly && <GlassSurface tone="control" interactive style={styles.iconGlass}><Pressable analyticsId="discovery.open"
            onPress={() => { play('reaction'); router.push('/map'); }} accessibilityRole="button" accessibilityLabel={tr('부동산·중고거래·장소·행사 통합 지도')}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={21} tintColor={theme.text} />
          </Pressable></GlassSurface>}
          <ProfileAvatarButton />
        </View>
        <FlatList analyticsId="components_feed-screen.flatlist.1" ref={feedListRef}
          onViewableItemsChanged={trackTranslationFeed}
          viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY}
          data={[null, ...(showFeedSort ? [null] : []), ...(feedLoading ? [] : feedData)]}
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
          keyExtractor={(p, index) => p?.id ?? (index === 0 ? 'journal-intro' : 'feed-sort')}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomClear + Spacing.three }]}
          ItemSeparatorComponent={({ leadingItem }) => leadingItem == null ? null : <View style={{ height: Spacing.four }} />}
          ListFooterComponent={loadingMore ? <ThemedText type="small" themeColor="textSecondary" style={styles.loadingMore}>{t.feed.loadingMore}</ThemedText> : feedState}
          renderItem={({ item, index }) => item == null && index === 1 && showFeedSort ? (
            <FeedSortControl sort={activeSort} title={selectedFilterTag ? tr("{0} 글", (selectedFilterTag.label)) : tr("오늘 글")} onChange={changeFeedSort} />
          ) : item == null ? (
            <View style={styles.header} onLayout={event => { feedIntroHeight.current = event.nativeEvent.layout.height; }}>
              <View style={styles.journalIntro}>
                <View style={styles.journalStatusRow}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.journalDate}>{todayLabel(appLocale)}</ThemedText>
                  {cityLoading && <View style={styles.cityLoadingStatus}><GlingLoader color={theme.accent} size={18} accessibilityLabel={tr("{0} 소식 불러오는 중", (city.name))} /><ThemedText type="small" themeColor="textSecondary">{tr("소식 불러오는 중")}</ThemedText></View>}
                </View>
                <ThemedText accessibilityRole="header" style={styles.journalTitle}>{meetupsOnly ? t.feed.meetupTitle : t.feed.journalTitle}</ThemedText>
              </View>
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
              {cityOpen && !meetupsOnly && (
                <GlassSurface tone="control" style={styles.chipGlass}><ScrollView analyticsId="components_feed-screen.scrollview.1" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
                  {[null, ...TAGS.map((tg) => tg.id)].map((id) => {
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
                </ScrollView></GlassSurface>
              )}
              {!feedLoading && weeklyRanking}
            </View>
          ) : (
            <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 5) * 65).duration(360)}><Animated.View style={{ opacity: feedOpacity }}><PostCard
              flat
              post={item}
              translationVisible={visibleFeedIds.has(item.id) && !searching && !detailVisible && !writing}
              onPress={() => openDetail(item)}
              onJoin={() => void onJoin(item)}
              onHashtag={openSearch}
              onAuthor={() => openAuthor(item)}
            />{!meetupsOnly && adsSupported && feedAdPosition(index - (showFeedSort ? 2 : 1)) && <FeedAd />}</Animated.View></Reanimated.View>
          )}
        />

      </SafeAreaView>

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
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
              <CityPicker onClose={() => setCityPicker(false)} />
            </SafeAreaView>
          </ThemedView>
        </SafeAreaProvider>
      </Modal>

      {/* 글쓰기의 선택 항목은 접고, 제목과 본문을 먼저 보여준다. */}
      <Modal visible={writing} animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} allowSwipeDismissal
        onDismiss={() => {
          if (!postSuccessPending.current) return;
          postSuccessPending.current = false;
          play('postPublished');
        }}
        onRequestClose={() => setWriting(false)}>
        <SafeAreaProvider style={[styles.writer, { backgroundColor: theme.background }]}>
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
                <View style={styles.writerHeadSpacer} />
              </View>
              <ScrollView analyticsId="components_feed-screen.scrollview.2" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.writerScroll}>
                <View style={styles.writerContext}>
                  <Pressable analyticsId="components_feed-screen.writer-options" accessibilityRole="button" accessibilityLabel={tr("게시 설정 변경, {0}, {1}, {2}", (draftCity.name), (tag.label), (postKind === 'listing' ? t.write.kindListing : t.write.kindStory))} accessibilityState={{ expanded: writerOptionsOpen }} onPress={() => { play('selection'); Keyboard.dismiss(); animateLayout(); setWriterOptionsOpen(open => !open); setWriterPanel(null); }} style={({ pressed }) => [styles.writerContextSummary, Depth.control, { backgroundColor: theme.card, }]}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.writerContextValue}>{draftCity.name} · {tag.label}{tag.kind !== 'meetup' ? ` · ${postKind === 'listing' ? t.write.kindListing : t.write.kindStory}` : ''}</ThemedText>
                    <ThemedText type="smallBold" themeColor="accent">{tr("변경")}</ThemedText>
                    <SymbolView name={{ ios: writerOptionsOpen ? 'chevron.up' : 'chevron.right', android: writerOptionsOpen ? 'expand_less' : 'chevron_right', web: writerOptionsOpen ? 'expand_less' : 'chevron_right' }} size={14} tintColor={theme.accent} />
                  </Pressable>
                  {writerOptionsOpen && <View style={styles.writerOptionButtons}>
                  <Pressable analyticsId="components_feed-screen.pressable.16" accessibilityRole="button" accessibilityLabel={`${t.write.postCity}, ${draftCity.name}, ${draftCity.province}`}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel('city'); }}
                    style={({ pressed }) => [styles.contextButton, Depth.control, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, }]}>
                    <SymbolView name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }} size={16} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" style={styles.contextText}>{draftCity.name} · {draftCity.province}</ThemedText>
                    <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  <Pressable analyticsId="components_feed-screen.pressable.17" accessibilityRole="button" accessibilityLabel={`${t.write.category}, ${tag.label}`} accessibilityState={{ expanded: writerPanel === 'category' }}
                    onPress={() => { play('reaction'); Keyboard.dismiss(); changeWriterPanel(writerPanel === 'category' ? null : 'category'); }}
                    style={({ pressed }) => [styles.contextButton, Depth.control, { backgroundColor: pressed || writerPanel === 'category' ? theme.backgroundSelected : theme.backgroundElement, }]}>
                    <ThemedText type="smallBold" style={styles.contextText}>{tag.label}</ThemedText>
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
                    {TAGS.map((tg) => {
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
                            {tg.label}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>}
                <ThemedText type="subtitle" style={styles.writerPrompt}>{tr("나누고 싶은 이야기를 적어보세요.")}</ThemedText>
                <TextInput value={title} onChangeText={setTitle} accessibilityLabel={t.write.titlePlaceholder}
                  placeholder={t.write.titlePlaceholder} placeholderTextColor={theme.textSecondary} maxLength={80}
                  style={[styles.titleInput, { color: theme.text, borderBottomColor: theme.line }]} />
                <PostBodyEditor value={body} onChangeText={setBody} cityName={draftCity.englishName} allowLocation={tag.kind !== 'meetup'} editable={!submitting && !creatingDraft} accessibilityLabel={t.write.bodyLabel}
                  placeholder={tag.kind !== 'meetup' && postKind === 'listing' ? t.write.listingBodyPlaceholder : t.write.bodyPlaceholder[tag.slug]} placeholderTextColor={theme.textSecondary} multiline
                  style={[styles.bodyInput, { color: theme.text, borderBottomColor: theme.line }]} />
                {tag.kind !== 'meetup' && postKind === 'story' && <PollDraftFields poll={pollDraft} onChange={setPollDraft} disabled={submitting || creatingDraft} />}
                {isAdmin && tag.kind !== 'meetup' && <Pressable analyticsId="post.ad_label" accessibilityRole="checkbox" accessibilityLabel={tr('광고')}
                  accessibilityState={{ checked: hasAdLabel(selectedHashtags), disabled: submitting || creatingDraft || (!hasAdLabel(selectedHashtags) && selectedHashtags.length >= MAX_HASHTAGS) }}
                  disabled={submitting || creatingDraft || (!hasAdLabel(selectedHashtags) && selectedHashtags.length >= MAX_HASHTAGS)}
                  onPress={() => { play('selection'); setHashtagInput(toggleAdLabel); }}
                  style={[styles.aiButton, { backgroundColor: hasAdLabel(selectedHashtags) ? theme.backgroundSelected : theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{hasAdLabel(selectedHashtags) ? '☑ AD' : '□ AD'}</ThemedText>
                </Pressable>}
                <Pressable analyticsId="components_feed-screen.pressable.23"
                  onPress={() => { play('selection'); void createAiDraft(); }}
                  disabled={creatingDraft || (draftImages.length === 0 && !hasDraftText)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: creatingDraft || (draftImages.length === 0 && !hasDraftText), busy: creatingDraft }}
                  style={[styles.aiButton, { backgroundColor: theme.backgroundElement, opacity: creatingDraft || (draftImages.length === 0 && !hasDraftText) ? 0.6 : 1 }]}>
                  <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={16} tintColor={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {creatingDraft ? t.write.creatingDraft : hasDraftText ? t.write.polishDraft : t.write.createDraft}
                  </ThemedText>
                </Pressable>
                {aiDraftReady && <ThemedText accessibilityRole="alert" type="small" themeColor="textSecondary" style={styles.aiNotice}>{t.write.reviewDraft}</ThemedText>}
                {tag.kind === 'meetup' && <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>{t.write.roomNote}</ThemedText>}
                {tag.kind !== 'meetup' && postKind === 'listing' && <>
                  <TextInput value={priceInput} onChangeText={setPriceInput} accessibilityLabel={t.write.pricePlaceholder}
                    placeholder={t.write.pricePlaceholder} placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" maxLength={10}
                    style={[styles.hashtagInput, { color: theme.text, borderBottomColor: theme.line }]} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>{t.write.listingNote}</ThemedText>
                </>}
                <View style={[styles.aiCard, { borderColor: theme.line }]}>
                  {draftImages.length > 0 && (
                    <View style={styles.photoGrid}>
                      {draftImages.map((image, index) => (
                        <View key={`${image.uri}-${index}`} style={styles.photoTile}>
                          <Image source={{ uri: image.uri }} style={styles.photoTileImage} contentFit="cover" />
                          <Pressable analyticsId="components_feed-screen.pressable.21"
                            onPress={() => { play('selection'); setDraftImages((current) => current.filter((_, position) => position !== index)); setAiDraftReady(false); }}
                            accessibilityRole="button"
                            accessibilityLabel={tr("{0}번째 사진 삭제", (index + 1))}
                            style={styles.photoRemove}>
                            <ThemedText type="smallBold" style={{ color: Colors.light.text }}>✕</ThemedText>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={styles.photoActions}>
                    {Platform.OS !== 'web' && (
                      <Pressable analyticsId="components_feed-screen.pressable.24"
                        onPress={() => { play('selection'); void pickDraftImage('camera'); }}
                        disabled={!canAddPostImage(draftImages.length)}
                        accessibilityRole="button"
                        accessibilityLabel={t.write.takePhoto}
                        accessibilityState={{ disabled: !canAddPostImage(draftImages.length) }}
                        style={[styles.photoButton, styles.cameraButton, { backgroundColor: theme.backgroundElement, opacity: canAddPostImage(draftImages.length) ? 1 : 0.5 }]}>
                        <SymbolView name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} size={18} tintColor={theme.textSecondary} />
                      </Pressable>
                    )}
                    <Pressable analyticsId="components_feed-screen.pressable.25"
                      onPress={() => { play('selection'); void pickDraftImage('library'); }}
                      disabled={!canAddPostImage(draftImages.length)}
                      accessibilityRole="button"
                      accessibilityLabel={draftImages.length === 0 ? t.write.choosePhoto : t.write.addPhoto}
                      accessibilityState={{ disabled: !canAddPostImage(draftImages.length) }}
                      style={[styles.photoButton, { backgroundColor: theme.backgroundElement, opacity: canAddPostImage(draftImages.length) ? 1 : 0.5 }]}>
                      <SymbolView name={{ ios: 'photo', android: 'photo_library', web: 'photo_library' }} size={18} tintColor={theme.textSecondary} />
                      <ThemedText type="smallBold" style={styles.contextText}>{draftImages.length === 0 ? tr("사진 추가") : t.write.addPhoto}</ThemedText>
                    </Pressable>
                    <Pressable analyticsId="components_feed-screen.pressable.26" accessibilityRole="button" accessibilityLabel={t.write.hashtags} accessibilityState={{ expanded: writerPanel === 'hashtags' }}
                      onPress={() => { play('reaction'); changeWriterPanel(writerPanel === 'hashtags' ? null : 'hashtags'); }}
                      style={({ pressed }) => [styles.hashtagToggle, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
                    <SymbolView name={{ ios: 'number', android: 'tag', web: 'tag' }} size={18} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1} style={styles.contextText}>{hashtagInput.trim() || t.write.hashtags}</ThemedText>
                    </Pressable>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">{tr("사진") + " "}{draftImages.length}/{MAX_POST_IMAGES}{" " + tr("· 올릴 때 자동으로 줄여요")}</ThemedText>
                </View>
                {writerPanel === 'hashtags' && <View>
                  <TextInput value={hashtagInput} onChangeText={setHashtagInput} accessibilityLabel={t.write.hashtags}
                    placeholder={t.write.hashtagPlaceholder} placeholderTextColor={theme.textSecondary} autoCapitalize="none"
                    style={[styles.hashtagInput, { color: theme.navy, borderBottomColor: theme.line }]} />
                  {selectedHashtags.length > 0 && <View style={styles.selectedHashtags}>
                    {selectedHashtags.map((hashtag) => <Pressable analyticsId="components_feed-screen.pressable.27" key={hashtag} accessibilityRole="button" accessibilityLabel={tr("#{0} 삭제", (hashtag))}
                      onPress={() => { play('reaction'); animateLayout(); setHashtagInput(current => parseHashtags(current).filter(value => value !== hashtag).join(' ')); }}
                      style={({ pressed }) => [styles.selectedHashtag, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, }]}>
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>#{hashtag} ×</ThemedText>
                    </Pressable>)}
                  </View>}
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
                </View>}
              </ScrollView>
              <View style={[styles.writerFooter, { backgroundColor: theme.background, borderTopColor: theme.line, paddingBottom: Spacing.two + writerKeyboardInset }]}>
                <RaisedActionButton analyticsId="components_feed-screen.pressable.15" onPress={() => { play('selection'); void submit(); }}
                  disabled={submitting || creatingDraft || !title.trim() || !body.trim()} busy={submitting}
                  label={submitting ? t.write.submitting : t.write.submit} />
              </View>
            </View>}
          </SafeAreaView>
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
    maxWidth: MaxContentWidth,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
  },
  header: { paddingTop: Spacing.two, paddingBottom: Spacing.four },
  categoryLoading: { minHeight: 280, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.three, paddingTop: Spacing.one, paddingBottom: Spacing.two },
  wordmark: { width: 64, height: 36 },
  homeButton: { minHeight: 44, justifyContent: 'center' },
  cityGlass: { marginLeft: 'auto', borderRadius: 12, flexShrink: 1 },
  iconGlass: { borderRadius: 22 },
  cityButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 44, borderRadius: 12, flexShrink: 1, paddingHorizontal: Spacing.two },
  city: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  iconButton: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
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
  writerHeadSpacer: { width: 44, height: 44 },
  writerHeading: { flex: 1, alignItems: 'center', gap: Spacing.half },
  writerNavTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  writerFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  writerContext: { gap: Spacing.two, marginHorizontal: Spacing.four, paddingVertical: Spacing.two },
  writerContextSummary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 12, paddingHorizontal: 12 },
  writerContextValue: { flex: 1 },
  writerOptionButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingBottom: Spacing.two },
  contextButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: Spacing.two, borderRadius: 12 },
  contextText: { flexShrink: 1 },
  writerLabel: { marginHorizontal: Spacing.four, marginBottom: Spacing.two },
  hashtagToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, minHeight: 44, paddingHorizontal: 12, borderRadius: 12 },
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
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)' },
  photoActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  photoButton: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  cameraButton: { flex: 0, width: 44, paddingHorizontal: 0 },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
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
  writerPrompt: { marginHorizontal: Spacing.four, marginTop: Spacing.three, marginBottom: Spacing.one, fontSize: 22, lineHeight: 28 },
  titleInput: {
    fontSize: 20,
    fontWeight: 700,
    marginHorizontal: Spacing.four,
    paddingVertical: 12,
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
    minHeight: 160,
    fontSize: 17,
    lineHeight: 26,
    textAlignVertical: 'top',
    marginHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meetupNote: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
});
