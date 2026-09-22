import { Pressable, ScrollView, FlatList } from '@/components/analytics-controls';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Alert,
  DeviceEventEmitter,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { todayLabel } from '@/components/daily-chip';
import { CityPicker } from '@/components/city-picker';
import { FeedAd } from '@/components/feed-ad';
import { adsSupported, feedAdPosition } from '@/lib/ads';
import { MyMeetups } from '@/components/my-meetups';
import { PostCard } from '@/components/post-card';
import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { WeeklyRanking } from '@/components/weekly-ranking';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { PostDetail } from '@/components/post-detail';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import type { LocationFix } from '@/lib/location';
import { useCommunityLocation } from '@/lib/location-provider';
import { parseAiDraftResponse } from '@/lib/ai-draft';
import {
  createCommunityPost,
  loadListingQuota,
  getCommunityActionError,
  isContentRejected,
  loadDailyQuota,
  loadTrendingHashtags,
  MEETUPS_CHANGED_EVENT,
  POST_QUOTA_CHANGED_EVENT,
  requestMeetupJoin,
} from '@/lib/community-data';
import { appendUniquePosts, groupJournalPosts, loadPublicFeed, loadPublicPost } from '@/lib/feed-data';
import { addHashtag, canonicalizeHashtag, getSuggestedHashtags, parseHashtags } from '@/lib/hashtags';
import { getPostImagePlan } from '@/lib/image-upload';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { INITIAL_QUOTA, TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { DailyQuota, Post, PostKind, Tag } from '@/lib/types';

type DraftImage = { uri: string; base64: string; mimeType: string };

export default function FeedScreen({ meetupsOnly = false }: { meetupsOnly?: boolean }) {
  const theme = useTheme();
  const hidden = useContentVisibility();
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { isAuthed, promptLogin, me } = useAuth();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const bottomClear = insets.bottom + TabBarHeight; // 탭바 + 홈 인디케이터 실측 높이
  const [posts, setPosts] = useState<Post[]>([]);
  const [quota, setQuota] = useState(INITIAL_QUOTA);
  const { city, setCity } = useCommunityCity();
  const location = useCommunityLocation();
  const [draftCity, setDraftCity] = useState(city);
  const draftLocation = useRef<(LocationFix & { userId: string }) | null>(null);
  const writerRevision = useRef(0);
  const [writerPanel, setWriterPanel] = useState<'city' | 'category' | 'kind' | 'hashtags' | null>(null);
  const [cityPicker, setCityPicker] = useState(false);
  const [writing, setWriting] = useState(false);
  const [tag, setTag] = useState<Tag>(TAGS[0]);
  const [postKind, setPostKind] = useState<PostKind>('story');
  const [priceInput, setPriceInput] = useState('');
  const [listingQuota, setListingQuota] = useState<DailyQuota | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [draftImage, setDraftImage] = useState<DraftImage | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  // 카드의 작성자를 누르면 글을 열지 않고 바로 미니 프로필로 간다.
  const openAuthor = (post: Post) => setSheetUser({ id: post.author.id, nickname: post.author.nickname, neighborhood: post.author.neighborhood, verified: post.author.verified, trustLevel: post.author.trustLevel, mine: post.author.id === me.id });
  const [pendingPost, setPendingPost] = useState<Post | null>(null); // 로그인 후 이어서 열 글
  const [tagFilter, setTagFilter] = useState<number | null>(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null); // 카테고리 칩
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
  const feedKey = `${viewerScope}:${city.id}:${tagFilter ?? 'all'}`;
  const feedRevision = useRef(0);
  const feedRequest = useRef<{ key: string; revision: number; promise: Promise<void> } | null>(null);
  const loadingMoreRef = useRef(false);
  const searchRevision = useRef(0);
  const cancelFeedRequests = useCallback(() => { feedRevision.current++; }, []);

  const refreshFeed = useCallback(() => {
    if (feedRequest.current?.key === feedKey && feedRequest.current.revision === feedRevision.current) {
      return feedRequest.current.promise;
    }
    const revision = ++feedRevision.current;
    const promise = loadPublicFeed(supabase, city.id, tagFilter, null, null, { viewerScope })
      .then((next) => {
        if (revision !== feedRevision.current) return;
        setPosts(next);
        setHasMore(next.length === 30);
      })
      .finally(() => {
        if (feedRequest.current?.promise === promise) feedRequest.current = null;
      });
    feedRequest.current = { key: feedKey, revision, promise };
    return promise;
  }, [city.id, feedKey, tagFilter, viewerScope]);

  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void refreshFeed().catch(() => {}));
    return () => listener.remove();
  }, [refreshFeed]);

  useEffect(() => {
    void refreshFeed().catch(() => {
      // Visibility must come from the server; never fall back to unfiltered seed posts.
    });
    return cancelFeedRequests;
  }, [cancelFeedRequests, refreshFeed]);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    const refreshQuota = () => void loadDailyQuota(supabase)
      .then((next) => { if (active) setQuota(next); }).catch(() => {});
    refreshQuota();
    const listener = DeviceEventEmitter.addListener(POST_QUOTA_CHANGED_EVENT, (next?: DailyQuota) => {
      if (next) setQuota(next);
      else refreshQuota();
    });
    return () => { active = false; listener.remove(); };
  }, [isAuthed, me.id, me.cityId]);

  const cityOpen = city.state === 'open';
  const cityPosts = posts.filter((p) => p.cityId === city.id && !hidden('post', p.id, p.author.id));
  const feedData = useMemo(
    () =>
      cityOpen
        ? cityPosts.filter((p) => (tagFilter == null || p.tag.id === tagFilter) && (!meetupsOnly || !p.room?.closed))
        : [],
    [cityOpen, cityPosts, meetupsOnly, tagFilter],
  );

  const journal = useMemo(() => meetupsOnly
    ? { featured: undefined, meetups: [], remaining: feedData }
    : groupJournalPosts(feedData), [feedData, meetupsOnly]);

  // 검색: 제목·내용·닉네임·동네·해시태그 부분일치 ('#' 입력은 무시)
  // 영문 동네명도 매칭 (Coquitlam → 코퀴틀람) — 표기 파편화 방지
  const q = query.replace(/#/g, '').trim().toLowerCase();
  const canonicalQuery = canonicalizeHashtag(q).toLocaleLowerCase();
  const selectedFilterTag = tagFilter == null ? null : TAGS.find((item) => item.id === tagFilter);
  const fallbackTags = useMemo(
    () => getSuggestedHashtags(cityPosts, selectedFilterTag, 10),
    [cityPosts, selectedFilterTag],
  );
  const popularTags = trendingTags.length ? trendingTags : fallbackTags;
  const writerHashtags = useMemo(() => getSuggestedHashtags(cityPosts, tag, 8), [cityPosts, tag]);

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
        setPendingPost(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAuthed, pendingPost]);
  const showActionError = useCallback((code: keyof typeof t.actionErrors) => {
    const message = t.actionErrors[code];
    Alert.alert(message.title, message.body, [
      { text: t.write.cancel, style: 'cancel' },
      ...(message.membership ? [{ text: '멤버십 보기', onPress: () => { setWriting(false); setJoinPost(null); setDetailPost(null); router.push('/profile/membership'); } }] : []),
    ]);
  }, [router]);

  const onJoin = (post: Post) => {
    if (!isAuthed) return promptLogin(t.auth.reasonJoinLogin);
    if (post.room?.closed) return showActionError('MEETUP_CLOSED');
    if (post.author.id === me.id) return Alert.alert(t.chat.ownMeetupTitle, t.chat.ownMeetupBody);
    if (post.room?.eventKind) {
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

  const showPostLimit = useCallback(() => {
    Alert.alert(t.feed.capReachedTitle, t.feed.capReachedBody, [
      { text: t.write.cancel, style: 'cancel' },
      { text: '멤버십 보기', onPress: () => { setWriting(false); router.push('/profile/membership'); } },
    ]);
  }, [router]);

  const openWriter = useCallback(() => {
    if (!isAuthed) return promptLogin(t.auth.reasonWrite);
    // ponytail: 캡 검사는 서버(create_post RPC)가 최종 강제 — 여긴 UX용 사전 안내만
    if (postKind === 'story' && quota.used >= quota.max) {
      showPostLimit();
      return;
    }
    if (writing) return;
    void loadListingQuota(supabase).then(setListingQuota).catch(() => {});
    const revision = ++writerRevision.current;
    draftLocation.current = null;
    if (!title.trim() && !body.trim() && !hashtagInput.trim() && !draftImage) setDraftCity(city);
    setWriterPanel(null);
    setWriting(true);
    void location.capture().then((fix) => {
      if (revision !== writerRevision.current) return;
      draftLocation.current = fix;
    });
  }, [isAuthed, promptLogin, quota.max, quota.used, showPostLimit, writing, city, location, title, body, hashtagInput, draftImage, postKind]);

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
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('IMAGE_NOT_AVAILABLE');
      const mimeType = asset.mimeType ?? 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        Alert.alert(t.write.photoErrorTitle, t.write.photoUnsupported);
        return;
      }
      const plan = getPostImagePlan(asset.width, asset.height, mimeType);
      const context = ImageManipulator.manipulate(asset.uri);
      if (plan.resize) context.resize(plan.resize);
      const image = await context.renderAsync();
      const optimized = await image.saveAsync({
        base64: true,
        compress: 0.8,
        format: plan.format === 'png' ? SaveFormat.PNG : plan.format === 'webp' ? SaveFormat.WEBP : SaveFormat.JPEG,
      });
      if (!optimized.base64) throw new Error('IMAGE_NOT_AVAILABLE');
      if (Math.ceil(optimized.base64.length * 0.75) > 5 * 1024 * 1024) {
        Alert.alert(t.write.photoErrorTitle, t.write.photoTooLarge);
        return;
      }
      setDraftImage({ uri: optimized.uri, base64: optimized.base64, mimeType: plan.mimeType });
      setAiDraftReady(false);
    } catch {
      Alert.alert(t.write.photoErrorTitle, t.write.photoErrorBody);
    }
  };

  const createAiDraft = async () => {
    if (!draftImage || creatingDraft) return;
    setCreatingDraft(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-post', {
        body: {
          imageBase64: draftImage.base64,
          mimeType: draftImage.mimeType,
          cityName: draftCity.name,
          selectedCategory: tag.slug,
          titleHint: title.trim() || undefined,
          bodyHint: body.trim() || undefined,
        },
      });
      if (error) throw error;
      const draft = parseAiDraftResponse(data);
      setTag(TAGS.find(({ slug }) => slug === draft.categorySlug) ?? tag);
      setTitle(draft.title);
      setBody(draft.body);
      setHashtagInput(draft.hashtags.map((hashtag) => `#${hashtag}`).join(' '));
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
    setSubmitting(true);
    const hashtags = parseHashtags(hashtagInput);
    try {
      const created = await createCommunityPost(supabase, {
        userId: me.id,
        cityId: draftCity.id,
        tag,
        title: title.trim(),
        body: body.trim(),
        hashtags,
        image: draftImage ? { base64: draftImage.base64, mimeType: draftImage.mimeType } : undefined,
        kind: postKind,
        price: postKind === 'listing' && priceInput.trim() ? Number(priceInput.replace(/[^0-9.]/g, '')) : null,
      });
      void location.record(draftLocation.current, created.id);
      setCity(draftCity);
      const post = created.post;
      if (post) setPosts((prev) => [post, ...prev.filter(({ id }) => id !== created.id)]);
      else void refreshFeed().catch(() => {});
      if (post?.room) DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      const nextQuota = await loadDailyQuota(supabase).catch(() => null);
      if (nextQuota) {
        setQuota(nextQuota);
        DeviceEventEmitter.emit(POST_QUOTA_CHANGED_EVENT, nextQuota);
      }
      setTagFilter(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null);
      setTitle('');
      setBody('');
      setHashtagInput('');
      setDraftImage(null);
      setAiDraftReady(false);
      setPostKind('story');
      setPriceInput('');
      setWriting(false);
      play('success');
      Alert.alert(t.write.successTitle, t.write.successBody);
    } catch (error) {
      play('warning');
      const dailyLimit = typeof error === 'object' && error !== null && 'message' in error
        && String(error.message).includes('DAILY_POST_LIMIT_REACHED');
      const contentRejected = isContentRejected(error);
      const actionError = getCommunityActionError(error);
      if (dailyLimit) showPostLimit();
      else if (actionError) showActionError(actionError);
      else Alert.alert(
        contentRejected ? t.safety.contentBlockedTitle : t.write.submitErrorTitle,
        contentRejected ? t.safety.contentBlockedBody : t.write.submitErrorBody,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const loadMorePosts = async () => {
    if (loadingMoreRef.current || !hasMore || searching) return;
    const last = posts.at(-1);
    if (!last?.createdAt) return;
    const revision = feedRevision.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = await loadPublicFeed(
        supabase,
        city.id,
        tagFilter,
        null,
        { createdAt: last.createdAt, id: last.id, sortAt: last.sortAt },
        { viewerScope },
      );
      if (revision !== feedRevision.current) return;
      setPosts((current) => appendUniquePosts(current, next));
      setHasMore(next.length === 30);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  return (
    <TabContent style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList analyticsId="components_feed-screen.flatlist.1"
          data={[null, ...journal.remaining]}
          stickyHeaderIndices={[0]}
          stickyHeaderHiddenOnScroll={!reducedMotion}
          onEndReached={() => void loadMorePosts()}
          onEndReachedThreshold={0.4}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            setRankingRefresh((current) => current + 1);
            void refreshFeed().catch(() => Alert.alert(t.feed.refreshErrorTitle, t.feed.refreshErrorBody)).finally(() => setRefreshing(false));
          }}
          keyExtractor={(p) => p?.id ?? 'journal-intro'}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomClear + Spacing.three }]}
          ItemSeparatorComponent={({ leadingItem }) => leadingItem == null ? null : <View style={{ height: Spacing.four }} />}
          ListHeaderComponent={
              <View style={[styles.headRow, { backgroundColor: theme.background }]}>
                <Image
                  source={require('@/assets/brand/gling-wordmark.png')}
                  style={styles.wordmark}
                  contentFit="contain"
                  tintColor={theme === Colors.dark ? theme.text : undefined}
                  accessibilityLabel={t.appName}
                />
                <Pressable analyticsId="components_feed-screen.pressable.1"
                  onPress={() => { play('selection'); setCityPicker(true); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${city.name}, ${t.feed.cityPickerTitle}`}
                  style={({ pressed }) => [styles.cityButton, pressed && styles.chipPressed]}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.city}>{city.name}</ThemedText>
                  <SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} tintColor={theme.text} />
                </Pressable>
                <Pressable analyticsId="components_feed-screen.pressable.2"
                  onPress={() => openSearch()}
                  accessibilityRole="button"
                  accessibilityLabel={t.search.placeholder}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.chipPressed]}>
                  <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={23} tintColor={theme.text} />
                </Pressable>
                <ProfileAvatarButton />
              </View>
          }
          ListFooterComponent={loadingMore ? <ThemedText type="small" themeColor="textSecondary" style={styles.loadingMore}>{t.feed.loadingMore}</ThemedText> : null}
          renderItem={({ item, index }) => item == null ? (
            <View style={styles.header}>
              <View style={styles.journalIntro}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.journalDate}>{todayLabel()}</ThemedText>
                <ThemedText accessibilityRole="header" style={styles.journalTitle}>{meetupsOnly ? t.feed.meetupTitle : t.feed.journalTitle}</ThemedText>
              </View>
              {meetupsOnly && <>
                <MyMeetups onOpen={async (postId) => {
                  const post = await loadPublicPost(supabase, postId);
                  if (!post) throw new Error('POST_NOT_FOUND');
                  openDetail(post);
                }} />
                {cityOpen && <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{t.meetup.discover}</ThemedText>}
              </>}
              {cityOpen && !meetupsOnly && tagFilter == null && (
                <WeeklyRanking cityId={city.id} refreshKey={rankingRefresh} onOpen={async (postId) => {
                  const post = await loadPublicPost(supabase, postId);
                  if (post) openDetail(post);
                }} />
              )}
              {cityOpen && !meetupsOnly && (
                <ScrollView analyticsId="components_feed-screen.scrollview.1" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
                  {[null, ...TAGS.map((tg) => tg.id)].map((id) => {
                    const label = id == null ? t.feed.filterAll : TAGS.find((tg) => tg.id === id)!.label;
                    const active = tagFilter === id;
                    return (
                      <Pressable analyticsId="components_feed-screen.pressable.3"
                        key={id ?? 'all'}
                        onPress={() => { play('selection'); setTagFilter(id); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.filterChip,
                          { backgroundColor: active ? theme.accent : 'transparent' },
                          pressed && styles.chipPressed,
                        ]}>
                        <ThemedText type="smallBold" style={{ color: active ? theme.accentInk : theme.textSecondary }}>{label}</ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              {journal.featured && (
                <View style={styles.featured}>
                  <PostCard
                    key={journal.featured.id}
                    post={journal.featured}
                    onPress={() => openDetail(journal.featured!)}
                    onHashtag={openSearch}
                    onAuthor={() => openAuthor(journal.featured!)}
                  />
                </View>
              )}
              {journal.meetups.length > 0 && (
                <View style={styles.meetupSection}>
                  <View style={styles.sectionHeading}>
                    <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{t.feed.meetupHeading}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{t.feed.meetupSubheading}</ThemedText>
                  </View>
                  {journal.meetups.map((post) => (
                    <View key={post.id} style={[styles.meetupPreview, { backgroundColor: theme.backgroundElement }]}>
                      <SymbolView name={{ ios: 'person.2', android: 'group', web: 'group' }} size={28} tintColor={theme.accent} />
                      <Pressable analyticsId="components_feed-screen.pressable.4" onPress={() => openDetail(post)} accessibilityRole="button" style={({ pressed }) => [styles.meetupCopy, pressed && styles.chipPressed]}>
                        <ThemedText type="smallBold" numberOfLines={2}>{post.title}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {[post.author.neighborhood, t.feed.members(post.room!.memberCount, post.room!.capacity)].filter(Boolean).join(' · ')}
                        </ThemedText>
                      </Pressable>
                      <Pressable analyticsId="components_feed-screen.pressable.5" onPress={() => onJoin(post)} accessibilityRole="button" accessibilityLabel={`${post.title}, ${t.feed.joinRoom}`} style={styles.iconButton}>
                        <SymbolView name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={22} tintColor={theme.text} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              {journal.remaining.length > 0 && (journal.featured || journal.meetups.length > 0) && (
                <ThemedText accessibilityRole="header" style={[styles.sectionTitle, styles.latestHeading]}>{t.feed.latestHeading}</ThemedText>
              )}
              {
            cityOpen ? (
              feedData.length === 0 ? (
                <View style={styles.soon}>
                  <ThemedText accessibilityRole="header" style={styles.soonTitle}>{meetupsOnly ? t.feed.meetupEmptyTitle : t.feed.emptyTitle}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.soonBody}>{meetupsOnly ? t.feed.meetupEmptyBody : t.feed.emptyBody}</ThemedText>
                  <Pressable analyticsId="components_feed-screen.pressable.6" onPress={openWriter} accessibilityRole="button" style={[styles.soonCta, { backgroundColor: theme.accent }]}>
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
                  onPress={() => setCityPicker(true)}
                  accessibilityRole="button"
                  style={[styles.soonCta, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                    {t.feed.soonCta}
                  </ThemedText>
                </Pressable>
              </View>
            )
              }
            </View>
          ) : (
            <View><PostCard
              post={item}
              onPress={() => openDetail(item)}
              onJoin={() => void onJoin(item)}
              onHashtag={openSearch}
              onAuthor={() => openAuthor(item)}
            />{!meetupsOnly && adsSupported && feedAdPosition(index - 1) && <FeedAd />}</View>
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
            <View style={styles.searchHead}>
              <TextInput
                value={query}
                onChangeText={(value) => { setQuery(value); setSearchResults([]); }}
                placeholder={t.search.placeholder}
                placeholderTextColor={theme.textSecondary}
                autoFocus
                autoCapitalize="none"
                style={[styles.searchInput, { color: theme.text }]}
              />
              <Pressable analyticsId="components_feed-screen.pressable.8" onPress={() => setSearching(false)} accessibilityRole="button">
                <ThemedText type="small" themeColor="textSecondary">
                  {t.search.close}
                </ThemedText>
              </Pressable>
            </View>

            {q.length === 0 ? (
              <View style={styles.popularWrap}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={{ fontSize: 13 }}>
                  {t.search.popular}
                </ThemedText>
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
                        { backgroundColor: theme.backgroundElement },
                        pressed && styles.chipPressed,
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
        visible={!!detailPost}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        allowSwipeDismissal
        onRequestClose={() => setDetailPost(null)}>
        {detailPost && (
          <PostDetail
            post={detailPost}
            onViewCountChange={updateViewCount}
            onClose={() => setDetailPost(null)}
            onPostRemoved={(postId) => setPosts((current) => current.filter((post) => post.id !== postId))}
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
          <Pressable analyticsId="components_feed-screen.pressable.10" style={StyleSheet.absoluteFill} onPress={() => setJoinPost(null)} accessibilityRole="button" />
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
              <Pressable analyticsId="components_feed-screen.pressable.11" onPress={() => setJoinPost(null)} accessibilityRole="button" style={[styles.secondaryButton, { borderColor: theme.line }]}>
                <ThemedText type="smallBold">{t.write.cancel}</ThemedText>
              </Pressable>
              <Pressable analyticsId="components_feed-screen.pressable.12"
                onPress={() => void submitJoin()}
                disabled={joining}
                accessibilityRole="button"
                accessibilityState={{ disabled: joining, busy: joining }}
                style={[styles.aiButton, { backgroundColor: theme.accent, opacity: joining ? 0.6 : 1 }]}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{joining ? t.chat.joinSending : t.chat.joinSubmit}</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* 도시 선택은 iOS의 네이티브 pageSheet와 Android의 하단 모달을 사용한다. */}
      <Modal
        visible={cityPicker}
        animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
        transparent={Platform.OS !== 'ios'}
        allowSwipeDismissal
        onRequestClose={() => setCityPicker(false)}>
        <View style={[styles.cityBackdrop, Platform.OS === 'ios' && { backgroundColor: theme.background }]}>
          {Platform.OS !== 'ios' && (
            <Pressable analyticsId="components_feed-screen.pressable.13" style={StyleSheet.absoluteFill} onPress={() => setCityPicker(false)} accessibilityRole="button" accessibilityLabel={t.write.cancel} />
          )}
          <ThemedView style={[styles.citySheet, Platform.OS === 'ios' && styles.citySheetIOS]}>
            <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
              {cityPicker && <CityPicker onClose={() => setCityPicker(false)} />}
            </SafeAreaView>
          </ThemedView>
        </View>
      </Modal>

      {/* 글쓰기의 선택 항목은 접고, 제목과 본문을 먼저 보여준다. */}
      <Modal visible={writing} animationType={reducedMotion ? 'none' : 'slide'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'} allowSwipeDismissal
        onRequestClose={() => setWriting(false)}>
        <SafeAreaProvider style={[styles.writer, { backgroundColor: theme.background }]}>
          <SafeAreaView style={styles.writer}>
            {writerPanel === 'city' ? (
              <CityPicker onClose={() => setWriterPanel(null)} draft={{ city: draftCity, onSelect: setDraftCity }} />
            ) : <KeyboardAvoidingView style={styles.writer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={[styles.writerHead, { borderBottomColor: theme.line }]}>
                <Pressable analyticsId="components_feed-screen.pressable.14" onPress={() => setWriting(false)} accessibilityRole="button" accessibilityLabel={t.write.cancel}
                  style={({ pressed }) => [styles.writerClose, { backgroundColor: theme.backgroundElement }, pressed && styles.chipPressed]}>
                  <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} />
                </Pressable>
                <View style={styles.writerHeading}>
                  <ThemedText type="smallBold" accessibilityRole="header">{t.write.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{postKind === 'listing' && tag.kind !== 'meetup' && listingQuota ? t.write.listingRemaining(listingQuota.used, listingQuota.max) : t.write.remaining(quota.used, quota.max)}</ThemedText>
                </View>
                <Pressable analyticsId="components_feed-screen.pressable.15" onPress={() => void submit()} disabled={submitting || creatingDraft || !title.trim() || !body.trim()}
                  accessibilityRole="button" accessibilityState={{ disabled: submitting || creatingDraft || !title.trim() || !body.trim(), busy: submitting }}
                  style={({ pressed }) => [styles.writerSubmit, { backgroundColor: theme.accent, opacity: submitting || creatingDraft || !title.trim() || !body.trim() ? 0.45 : 1 }, pressed && styles.chipPressed]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{submitting ? t.write.submitting : t.write.submit}</ThemedText>
                </Pressable>
              </View>
              <ScrollView analyticsId="components_feed-screen.scrollview.2" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.writerScroll}>
                <View style={styles.writerContext}>
                  <Pressable analyticsId="components_feed-screen.pressable.16" accessibilityRole="button" accessibilityLabel={`${t.write.postCity}, ${draftCity.name}, ${draftCity.province}`}
                    onPress={() => { Keyboard.dismiss(); setWriterPanel('city'); }}
                    style={({ pressed }) => [styles.contextButton, { backgroundColor: theme.backgroundElement }, pressed && styles.chipPressed]}>
                    <SymbolView name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }} size={16} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" style={styles.contextText}>{draftCity.name} · {draftCity.province}</ThemedText>
                    <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  <Pressable analyticsId="components_feed-screen.pressable.17" accessibilityRole="button" accessibilityLabel={`${t.write.category}, ${tag.label}`} accessibilityState={{ expanded: writerPanel === 'category' }}
                    onPress={() => { Keyboard.dismiss(); setWriterPanel(writerPanel === 'category' ? null : 'category'); }}
                    style={({ pressed }) => [styles.contextButton, { backgroundColor: theme.backgroundElement }, pressed && styles.chipPressed]}>
                    <ThemedText type="smallBold" style={styles.contextText}>{tag.label}</ThemedText>
                    <SymbolView name={{ ios: writerPanel === 'category' ? 'chevron.up' : 'chevron.down', android: writerPanel === 'category' ? 'expand_less' : 'expand_more', web: writerPanel === 'category' ? 'expand_less' : 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>
                  {tag.kind !== 'meetup' && <Pressable analyticsId="components_feed-screen.pressable.18" accessibilityRole="button" accessibilityLabel={`${t.write.pickKind}, ${postKind === 'listing' ? t.write.kindListing : t.write.kindStory}`} accessibilityState={{ expanded: writerPanel === 'kind' }}
                    onPress={() => { Keyboard.dismiss(); setWriterPanel(writerPanel === 'kind' ? null : 'kind'); }}
                    style={({ pressed }) => [styles.contextButton, { backgroundColor: theme.backgroundElement }, pressed && styles.chipPressed]}>
                    <ThemedText type="smallBold" style={styles.contextText}>{postKind === 'listing' ? t.write.kindListing : t.write.kindStory}</ThemedText>
                    <SymbolView name={{ ios: writerPanel === 'kind' ? 'chevron.up' : 'chevron.down', android: writerPanel === 'kind' ? 'expand_less' : 'expand_more', web: writerPanel === 'kind' ? 'expand_less' : 'expand_more' }} size={12} tintColor={theme.textSecondary} />
                  </Pressable>}
                </View>
                {writerPanel === 'kind' && <View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.writerLabel}>{t.write.pickKind}</ThemedText>
                  <View style={styles.tagRow} accessibilityRole="radiogroup">
                    {([['story', t.write.kindStory, t.write.kindStoryHint], ['listing', t.write.kindListing, t.write.kindListingHint]] as const).map(([kind, label, hint]) => {
                      const selected = postKind === kind;
                      return <Pressable analyticsId="components_feed-screen.pressable.19" key={kind} onPress={() => { play('selection'); setPostKind(kind); setWriterPanel(null); }} accessibilityRole="radio"
                        accessibilityLabel={`${label}, ${hint}`} accessibilityState={{ selected, checked: selected }}
                        style={({ pressed }) => [styles.tagChip, { backgroundColor: selected ? theme.accent : theme.backgroundElement }, pressed && styles.chipPressed]}>
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
                            setTag(tg);
                            setWriterPanel(null);
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          style={({ pressed }) => [
                            styles.tagChip,
                            { backgroundColor: selected ? theme.accent : theme.backgroundElement },
                            pressed && styles.chipPressed,
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
                <TextInput value={title} onChangeText={setTitle} accessibilityLabel={t.write.titlePlaceholder}
                  placeholder={t.write.titlePlaceholder} placeholderTextColor={theme.textSecondary} maxLength={80}
                  style={[styles.titleInput, { color: theme.text }]} />
                <TextInput value={body} onChangeText={setBody} accessibilityLabel={t.write.bodyLabel}
                  placeholder={tag.kind !== 'meetup' && postKind === 'listing' ? t.write.listingBodyPlaceholder : t.write.bodyPlaceholder[tag.slug]} placeholderTextColor={theme.textSecondary} multiline
                  style={[styles.bodyInput, { color: theme.text }]} />
                {tag.kind === 'meetup' && <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>{t.write.roomNote}</ThemedText>}
                {tag.kind !== 'meetup' && postKind === 'listing' && <>
                  <TextInput value={priceInput} onChangeText={setPriceInput} accessibilityLabel={t.write.pricePlaceholder}
                    placeholder={t.write.pricePlaceholder} placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" maxLength={10}
                    style={[styles.hashtagInput, { color: theme.text, borderBottomColor: theme.line }]} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>{t.write.listingNote}</ThemedText>
                </>}
                <View style={[styles.aiCard, { borderColor: theme.line }]}>
                  {draftImage ? (
                    <>
                      <Image source={{ uri: draftImage.uri }} style={styles.draftImage} contentFit="cover" />
                      <View style={styles.photoActions}>
                        <Pressable analyticsId="components_feed-screen.pressable.21"
                          onPress={() => void pickDraftImage('library')}
                          accessibilityRole="button"
                          style={[styles.secondaryButton, { borderColor: theme.line }]}>
                          <ThemedText type="smallBold">{t.write.changePhoto}</ThemedText>
                        </Pressable>
                        <Pressable analyticsId="components_feed-screen.pressable.22"
                          onPress={() => { setDraftImage(null); setAiDraftReady(false); }}
                          accessibilityRole="button"
                          style={[styles.secondaryButton, { borderColor: theme.line }]}>
                          <ThemedText type="small" themeColor="textSecondary">{t.write.removePhoto}</ThemedText>
                        </Pressable>
                      </View>
                      <Pressable analyticsId="components_feed-screen.pressable.23"
                        onPress={() => void createAiDraft()}
                        disabled={creatingDraft}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: creatingDraft, busy: creatingDraft }}
                        style={[styles.aiButton, { backgroundColor: theme.accent, opacity: creatingDraft ? 0.65 : 1 }]}>
                        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                          {creatingDraft ? t.write.creatingDraft : t.write.createDraft}
                        </ThemedText>
                      </Pressable>
                    </>
                  ) : (
                    <View style={styles.photoActions}>
                      {Platform.OS !== 'web' && (
                        <Pressable analyticsId="components_feed-screen.pressable.24"
                          onPress={() => void pickDraftImage('camera')}
                          accessibilityRole="button"
                          style={[styles.photoButton, { backgroundColor: theme.backgroundElement }]}>
                          <SymbolView name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }} size={18} tintColor={theme.textSecondary} />
                          <ThemedText type="smallBold" style={styles.contextText}>{t.write.takePhoto}</ThemedText>
                        </Pressable>
                      )}
                      <Pressable analyticsId="components_feed-screen.pressable.25"
                        onPress={() => void pickDraftImage('library')}
                        accessibilityRole="button"
                        style={[styles.photoButton, { backgroundColor: theme.backgroundElement }]}>
                        <SymbolView name={{ ios: 'photo', android: 'photo_library', web: 'photo_library' }} size={18} tintColor={theme.textSecondary} />
                        <ThemedText type="smallBold" style={styles.contextText}>{t.write.choosePhoto}</ThemedText>
                      </Pressable>
                    </View>
                  )}
                  {aiDraftReady && (
                    <View accessibilityRole="alert" style={[styles.aiNotice, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="small" themeColor="textSecondary">{t.write.reviewDraft}</ThemedText>
                    </View>
                  )}
                </View>
                <View style={[styles.writerExtras, { borderTopColor: theme.line }]}>
                  <Pressable analyticsId="components_feed-screen.pressable.26" accessibilityRole="button" accessibilityLabel={t.write.hashtags} accessibilityState={{ expanded: writerPanel === 'hashtags' }}
                    onPress={() => setWriterPanel(writerPanel === 'hashtags' ? null : 'hashtags')}
                    style={({ pressed }) => [styles.hashtagToggle, pressed && styles.chipPressed]}>
                    <SymbolView name={{ ios: 'number', android: 'tag', web: 'tag' }} size={18} tintColor={theme.textSecondary} />
                    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.contextText}>{hashtagInput.trim() || t.write.hashtags}</ThemedText>
                    <SymbolView name={{ ios: writerPanel === 'hashtags' ? 'chevron.up' : 'plus', android: writerPanel === 'hashtags' ? 'expand_less' : 'add', web: writerPanel === 'hashtags' ? 'expand_less' : 'add' }} size={16} tintColor={theme.textSecondary} />
                  </Pressable>
                </View>
                {writerPanel === 'hashtags' && <View>
                  <TextInput value={hashtagInput} onChangeText={setHashtagInput} accessibilityLabel={t.write.hashtags}
                    placeholder={t.write.hashtagPlaceholder} placeholderTextColor={theme.textSecondary} autoCapitalize="none"
                    style={[styles.hashtagInput, { color: theme.navy, borderBottomColor: theme.line }]} />
                  <View style={styles.writerHashtags}>
                    <ScrollView analyticsId="components_feed-screen.scrollview.3"
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      contentContainerStyle={styles.hashtagBar}>
                      {writerHashtags.map((hashtag) => (
                        <Pressable analyticsId="components_feed-screen.pressable.27"
                          key={hashtag}
                          onPress={() => {
                            play('selection');
                            setHashtagInput((value) => addHashtag(value, hashtag));
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={t.write.addHashtag(hashtag)}
                          style={({ pressed }) => [
                            styles.suggestionChip,
                            { backgroundColor: theme.backgroundElement },
                            pressed && styles.chipPressed,
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
            </KeyboardAvoidingView>}
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
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  wordmark: { width: 64, height: 36 },
  cityButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginLeft: 'auto', minHeight: 44, flexShrink: 1, paddingHorizontal: Spacing.one },
  city: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  unreadBadge: { position: 'absolute', top: 0, right: 0, minWidth: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontSize: 10, lineHeight: 14, fontVariant: ['tabular-nums'] },
  journalIntro: { paddingTop: Spacing.four, gap: Spacing.two },
  journalDate: { fontSize: 12, lineHeight: 18, letterSpacing: 0.8 },
  journalTitle: { fontSize: 28, lineHeight: 36, fontWeight: 700, letterSpacing: -0.8 },
  chipBar: { flexDirection: 'row', gap: Spacing.one, paddingTop: Spacing.three },
  filterChip: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 999, paddingHorizontal: 14, paddingVertical: Spacing.two },
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
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: 600,
    paddingVertical: 4,
  },
  popularWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
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
  writerHeading: { flex: 1, alignItems: 'center', gap: Spacing.half },
  writerSubmit: { minHeight: 44, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  writerContext: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginHorizontal: Spacing.four, paddingVertical: Spacing.three },
  contextButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: Spacing.two, borderRadius: 12 },
  contextText: { flexShrink: 1 },
  writerLabel: { marginHorizontal: Spacing.four, marginBottom: Spacing.two },
  writerExtras: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: Spacing.four },
  hashtagToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52, paddingVertical: Spacing.two },
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
  draftImage: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 10,
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  photoButton: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
  },
  aiButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
  },
  aiNotice: {
    borderRadius: 8,
    padding: Spacing.two,
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
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  writerHashtags: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  suggestionChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: 700,
    marginHorizontal: Spacing.four,
    paddingVertical: 12,
  },
  hashtagInput: {
    fontSize: 14,
    fontWeight: 600,
    borderBottomWidth: 1,
    marginHorizontal: Spacing.four,
    paddingVertical: 10,
  },
  bodyInput: {
    minHeight: 220,
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
