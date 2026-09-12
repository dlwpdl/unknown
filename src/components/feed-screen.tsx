import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Alert,
  DeviceEventEmitter,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DailyChip, todayLabel } from '@/components/daily-chip';
import { MyMeetups } from '@/components/my-meetups';
import { NearbyCityCard } from '@/components/nearby-city-card';
import { PostCard } from '@/components/post-card';
import { PostDetail } from '@/components/post-detail';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { nearbyCommunity, type LocationFix } from '@/lib/location';
import { useCommunityLocation } from '@/lib/location-provider';
import { parseAiDraftResponse } from '@/lib/ai-draft';
import {
  createCommunityPost,
  getCommunityActionError,
  isContentRejected,
  loadDailyQuota,
  loadTrendingHashtags,
  MEETUPS_CHANGED_EVENT,
  POST_QUOTA_CHANGED_EVENT,
  requestMeetupJoin,
} from '@/lib/community-data';
import { groupJournalPosts, loadPublicFeed, loadPublicPost } from '@/lib/feed-data';
import { addHashtag, canonicalizeHashtag, getSuggestedHashtags, parseHashtags } from '@/lib/hashtags';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES, INITIAL_QUOTA, MOCK_POSTS, TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { DailyQuota, Post, Tag } from '@/lib/types';

type DraftImage = { uri: string; base64: string; mimeType: string };

export default function FeedScreen({ meetupsOnly = false }: { meetupsOnly?: boolean }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { isAuthed, promptLogin, me } = useAuth();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const bottomClear = insets.bottom + TabBarHeight; // 탭바 + 홈 인디케이터 실측 높이
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);
  const [quota, setQuota] = useState(INITIAL_QUOTA);
  const { city, setCity } = useCommunityCity();
  const location = useCommunityLocation();
  const [draftCity, setDraftCity] = useState(city);
  const draftLocation = useRef<(LocationFix & { userId: string }) | null>(null);
  const writerRevision = useRef(0);
  const manualDraftCity = useRef(false);
  const [cityPicker, setCityPicker] = useState(false);
  const [writing, setWriting] = useState(false);
  const [tag, setTag] = useState<Tag>(TAGS[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [draftImage, setDraftImage] = useState<DraftImage | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [aiDraftReady, setAiDraftReady] = useState(false);
  const [detailPost, setDetailPost] = useState<Post | null>(null);
  const [pendingPost, setPendingPost] = useState<Post | null>(null); // 로그인 후 이어서 열 글
  const [tagFilter, setTagFilter] = useState<number | null>(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null); // 카테고리 칩
  const [searching, setSearching] = useState(false);
  const searchSelection = useRef<Post | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trendingTags, setTrendingTags] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<Post[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [joinPost, setJoinPost] = useState<Post | null>(null);
  const [joinMessage, setJoinMessage] = useState('');
  const [joining, setJoining] = useState(false);

  const refreshFeed = useCallback(async () => {
    const next = await loadPublicFeed(supabase, city.id, tagFilter);
    setPosts(next);
    setHasMore(next.length === 30);
  }, [city.id, tagFilter]);

  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void refreshFeed().catch(() => {}));
    return () => listener.remove();
  }, [refreshFeed]);

  useEffect(() => {
    let active = true;
    void loadPublicFeed(supabase, city.id, tagFilter)
      .then((next) => {
        if (active) {
          setPosts(next);
          setHasMore(next.length === 30);
        }
      })
      .catch(() => {
        // 시드 번들은 네트워크 장애나 미적용 마이그레이션 때 빈 커뮤니티를 막는다.
    });
    return () => { active = false; };
  }, [city.id, isAuthed, me.id, tagFilter]);

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
  }, [isAuthed, me.id]);

  const cityOpen = city.state === 'open';
  const cityPosts = useMemo(() => posts.filter((p) => p.cityId === city.id), [posts, city.id]);
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
    if (!searching || !q) return;
    const timer = setTimeout(() => {
      void loadPublicFeed(supabase, city.id, null, canonicalQuery)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [canonicalQuery, city.id, q, searching]);


  const openSearch = (initial?: string) => {
    setQuery(initial ?? '');
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
    if (quota.used >= quota.max) {
      showPostLimit();
      return;
    }
    if (writing) return;
    const revision = ++writerRevision.current;
    manualDraftCity.current = false;
    draftLocation.current = null;
    setDraftCity(city);
    setWriting(true);
    void location.capture().then((fix) => {
      if (revision !== writerRevision.current) return;
      draftLocation.current = fix;
      const recommended = fix && CITIES.find((item) => item.id === nearbyCommunity(fix));
      if (recommended && !manualDraftCity.current) setDraftCity(recommended);
    });
  }, [isAuthed, promptLogin, quota.max, quota.used, showPostLimit, writing, city, location]);

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
        base64: true,
        quality: 0.7,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri || !asset.base64) throw new Error('IMAGE_NOT_AVAILABLE');
      if (Math.ceil(asset.base64.length * 0.75) > 5 * 1024 * 1024) {
        Alert.alert(t.write.photoErrorTitle, t.write.photoTooLarge);
        return;
      }
      const mimeType = asset.mimeType ?? 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        Alert.alert(t.write.photoErrorTitle, t.write.photoUnsupported);
        return;
      }
      setDraftImage({ uri: asset.uri, base64: asset.base64, mimeType });
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
    if (!title.trim() || !body.trim()) {
      Alert.alert(t.write.validationTitle, t.write.validationBody);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const hashtags = parseHashtags(hashtagInput);
    try {
      const post = await createCommunityPost(supabase, {
        userId: me.id,
        cityId: draftCity.id,
        tag,
        title: title.trim(),
        body: body.trim(),
        hashtags,
        image: draftImage ? { base64: draftImage.base64, mimeType: draftImage.mimeType } : undefined,
      });
      void location.record(draftLocation.current, post.id);
      setCity(draftCity);
      setPosts((prev) => [post, ...prev.filter(({ id }) => id !== post.id)]);
      if (post.room) DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      const nextQuota = await loadDailyQuota(supabase);
      setQuota(nextQuota);
      DeviceEventEmitter.emit(POST_QUOTA_CHANGED_EVENT, nextQuota);
      setTagFilter(meetupsOnly ? TAGS.find((item) => item.kind === 'meetup')!.id : null);
      setTitle('');
      setBody('');
      setHashtagInput('');
      setDraftImage(null);
      setAiDraftReady(false);
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
    if (loadingMore || !hasMore || searching) return;
    const last = posts.at(-1);
    if (!last?.createdAt) return;
    setLoadingMore(true);
    try {
      const next = await loadPublicFeed(supabase, city.id, tagFilter, null, { createdAt: last.createdAt, id: last.id });
      setPosts((current) => [...current, ...next.filter((post) => !current.some(({ id }) => id === post.id))]);
      setHasMore(next.length === 30);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <TabContent style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={[null, ...journal.remaining]}
          stickyHeaderIndices={[0]}
          stickyHeaderHiddenOnScroll={!reducedMotion}
          onEndReached={() => void loadMorePosts()}
          onEndReachedThreshold={0.4}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
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
                <Pressable
                  onPress={() => { play('selection'); setCityPicker(true); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${city.name}, ${t.feed.cityPickerTitle}`}
                  style={({ pressed }) => [styles.cityButton, pressed && styles.chipPressed]}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.city}>{city.name}</ThemedText>
                  <SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} tintColor={theme.text} />
                </Pressable>
                <Pressable
                  onPress={() => openSearch()}
                  accessibilityRole="button"
                  accessibilityLabel={t.search.placeholder}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.chipPressed]}>
                  <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={23} tintColor={theme.text} />
                </Pressable>
                <Pressable
                  onPress={() => { play('selection'); router.push('/profile'); }}
                  accessibilityRole="button"
                  accessibilityLabel={t.tabs.profile}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.chipPressed]}>
                  <SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={24} tintColor={theme.text} />
                </Pressable>
              </View>
          }
          ListFooterComponent={loadingMore ? <ThemedText type="small" themeColor="textSecondary" style={styles.loadingMore}>{t.feed.loadingMore}</ThemedText> : null}
          renderItem={({ item }) => item == null ? (
            <View style={styles.header}>
              {isAuthed && !meetupsOnly && <NearbyCityCard onSelect={(id) => { const next = CITIES.find((item) => item.id === id); if (next) setCity(next); }} />}
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
              {cityOpen && !meetupsOnly && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
                  {[null, ...TAGS.map((tg) => tg.id)].map((id) => {
                    const label = id == null ? t.feed.filterAll : TAGS.find((tg) => tg.id === id)!.label;
                    const active = tagFilter === id;
                    return (
                      <Pressable
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
                      <Pressable onPress={() => openDetail(post)} accessibilityRole="button" style={({ pressed }) => [styles.meetupCopy, pressed && styles.chipPressed]}>
                        <ThemedText type="smallBold" numberOfLines={2}>{post.title}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {[post.author.neighborhood, t.feed.members(post.room!.memberCount, post.room!.capacity)].filter(Boolean).join(' · ')}
                        </ThemedText>
                      </Pressable>
                      <Pressable onPress={() => onJoin(post)} accessibilityRole="button" accessibilityLabel={`${post.title}, ${t.feed.joinRoom}`} style={styles.iconButton}>
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
                  <Pressable onPress={openWriter} accessibilityRole="button" style={[styles.soonCta, { backgroundColor: theme.accent }]}>
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
                <Pressable
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
            <PostCard
              post={item}
              onPress={() => openDetail(item)}
              onJoin={() => void onJoin(item)}
              onHashtag={openSearch}
            />
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
        <SafeAreaProvider style={[styles.writer, { backgroundColor: theme.background }]}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.searchHead}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t.search.placeholder}
                placeholderTextColor={theme.textSecondary}
                autoFocus
                autoCapitalize="none"
                style={[styles.searchInput, { color: theme.text }]}
              />
              <Pressable onPress={() => setSearching(false)} accessibilityRole="button">
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
                    <Pressable
                      key={h}
                      onPress={() => {
                        play('selection');
                        setQuery(h);
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
              <FlatList
                data={searchResults.filter((post) => !meetupsOnly || !post.room?.closed)}
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
                    onHashtag={setQuery}
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
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setJoinPost(null)} accessibilityRole="button" />
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
              <Pressable onPress={() => setJoinPost(null)} accessibilityRole="button" style={[styles.secondaryButton, { borderColor: theme.line }]}>
                <ThemedText type="smallBold">{t.write.cancel}</ThemedText>
              </Pressable>
              <Pressable
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
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCityPicker(false)} accessibilityRole="button" accessibilityLabel={t.write.cancel} />
          )}
          <ThemedView style={[styles.citySheet, Platform.OS === 'ios' && styles.citySheetIOS]}>
            <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
              <View style={styles.citySheetHead}>
                <ThemedText accessibilityRole="header" style={styles.cityPickerTitle}>{t.feed.cityPickerTitle}</ThemedText>
                <Pressable onPress={() => setCityPicker(false)} accessibilityRole="button" accessibilityLabel={t.write.cancel} style={styles.iconButton}>
                  <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={21} tintColor={theme.text} />
                </Pressable>
              </View>
              <FlatList
                data={CITIES}
                keyExtractor={(c) => c.id}
                contentContainerStyle={styles.cityList}
                ListHeaderComponent={<ThemedText type="default" themeColor="textSecondary" style={styles.cityPickerBody}>{t.feed.cityPickerBody}</ThemedText>}
                ListFooterComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.cityPickerNote}>{t.feed.cityPickerNote}</ThemedText>}
                renderItem={({ item }) => {
                  const selected = item.id === city.id;
                  const open = item.state === 'open';
                  return (
                    <Pressable
                      onPress={() => { play('selection'); setCity(item); setCityPicker(false); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={[item.name, !open && t.feed.citySoon, selected && t.feed.citySelected].filter(Boolean).join(', ')}
                      style={({ pressed }) => [styles.cityRow, { borderColor: theme.line }, pressed && styles.chipPressed]}>
                      <View style={styles.cityName}>
                        <ThemedText style={[styles.cityRowTitle, { color: selected ? theme.accent : theme.text }]}>{item.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">{item.province}</ThemedText>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
                        {!open && (
                          <View style={[styles.cityBadge, { backgroundColor: theme.backgroundElement }]}>
                            <ThemedText type="small" themeColor="textSecondary">{t.feed.citySoon}</ThemedText>
                          </View>
                        )}
                        {selected && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={23} tintColor={theme.accent} />}
                      </View>
                    </Pressable>
                  );
                }}
              />
            </SafeAreaView>
          </ThemedView>
        </View>
      </Modal>

      {/* 글쓰기: 태그 선선택 → 태그별 안내문 (당근 패턴) */}
      <Modal visible={writing} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setWriting(false)}>
        <SafeAreaProvider style={[styles.writer, { backgroundColor: theme.background }]}>
          <SafeAreaView style={{ flex: 1 }}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.writerHead}>
                <Pressable onPress={() => setWriting(false)} accessibilityRole="button">
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.write.cancel}
                  </ThemedText>
                </Pressable>
                <ThemedText type="smallBold">{t.write.title}</ThemedText>
                <Pressable
                  onPress={() => void submit()}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: submitting, busy: submitting }}>
                  <ThemedText type="smallBold" style={{ color: theme.accent, opacity: submitting ? 0.55 : 1 }}>
                    {submitting ? t.write.submitting : t.write.submit}
                  </ThemedText>
                </Pressable>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.writerScroll}>
                <View style={styles.writerQuota}><DailyChip quota={quota} /></View>
                <ThemedText type="smallBold">이 글을 나눌 도시 · {draftCity.name}</ThemedText>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {CITIES.filter((item) => item.state === 'open').map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: draftCity.id === item.id }}
                    onPress={() => { manualDraftCity.current = true; setDraftCity(item); }}
                    style={[styles.secondaryButton, { backgroundColor: draftCity.id === item.id ? theme.backgroundElement : theme.card }]}>
                    <ThemedText type="smallBold">{item.name}</ThemedText>
                  </Pressable>)}
                </View>
                {writing && <NearbyCityCard onFix={(fix) => { draftLocation.current = fix; }} onSelect={(id) => {
                  const next = CITIES.find((item) => item.id === id);
                  if (next) { manualDraftCity.current = true; setDraftCity(next); }
                }} />}
                <View style={[styles.aiCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
                  <View style={styles.aiCopy}>
                    <ThemedText type="smallBold">{t.write.aiTitle}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{t.write.aiBody}</ThemedText>
                  </View>
                  {draftImage ? (
                    <>
                      <Image source={{ uri: draftImage.uri }} style={styles.draftImage} contentFit="cover" />
                      <View style={styles.photoActions}>
                        <Pressable
                          onPress={() => void pickDraftImage('library')}
                          accessibilityRole="button"
                          style={[styles.secondaryButton, { borderColor: theme.line }]}>
                          <ThemedText type="smallBold">{t.write.changePhoto}</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => { setDraftImage(null); setAiDraftReady(false); }}
                          accessibilityRole="button"
                          style={[styles.secondaryButton, { borderColor: theme.line }]}>
                          <ThemedText type="small" themeColor="textSecondary">{t.write.removePhoto}</ThemedText>
                        </Pressable>
                      </View>
                      <Pressable
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
                        <Pressable
                          onPress={() => void pickDraftImage('camera')}
                          accessibilityRole="button"
                          style={[styles.photoButton, { backgroundColor: theme.accent }]}>
                          <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{t.write.takePhoto}</ThemedText>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => void pickDraftImage('library')}
                        accessibilityRole="button"
                        style={[styles.photoButton, { backgroundColor: theme.backgroundElement }]}>
                        <ThemedText type="smallBold">{t.write.choosePhoto}</ThemedText>
                      </Pressable>
                    </View>
                  )}
                  {aiDraftReady && (
                    <View accessibilityRole="alert" style={[styles.aiNotice, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="small" themeColor="textSecondary">{t.write.reviewDraft}</ThemedText>
                    </View>
                  )}
                </View>

              <View style={styles.tagRow}>
                {TAGS.map((tg) => {
                  const selected = tg.id === tag.id;
                  return (
                    <Pressable
                      key={tg.id}
                      onPress={() => {
                        play('selection');
                        setTag(tg);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.tagChip,
                        { backgroundColor: selected ? theme.accent : theme.backgroundElement },
                        pressed && styles.chipPressed,
                      ]}>
                      <ThemedText
                        type="smallBold"
                        style={{ fontSize: 13, color: selected ? theme.accentInk : theme.textSecondary }}>
                        {tg.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.writerHashtags}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.popularLabel}>
                  {t.write.popularHashtags}
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.hashtagBar}>
                  {writerHashtags.map((hashtag) => (
                    <Pressable
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

              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t.write.titlePlaceholder}
                placeholderTextColor={theme.textSecondary}
                maxLength={80}
                style={[styles.titleInput, { color: theme.text, borderBottomColor: theme.line }]}
              />
              <TextInput
                value={hashtagInput}
                onChangeText={setHashtagInput}
                placeholder={t.write.hashtagPlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                style={[styles.hashtagInput, { color: theme.navy, borderBottomColor: theme.line }]}
              />
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder={t.write.bodyPlaceholder[tag.slug]}
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[styles.bodyInput, { color: theme.text }]}
              />
              {tag.kind === 'meetup' && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.meetupNote}>
                  {t.write.roomNote}
                </ThemedText>
              )}
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
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
  citySheetHead: { flexDirection: 'row', alignItems: 'center', padding: Spacing.four, gap: Spacing.two },
  cityPickerTitle: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: 700, letterSpacing: -0.5 },
  cityList: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four },
  cityPickerBody: { marginBottom: Spacing.three },
  cityPickerNote: { marginTop: Spacing.four },
  cityRow: { minHeight: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, paddingVertical: Spacing.three, gap: Spacing.three },
  cityName: { flex: 1, gap: Spacing.one },
  cityRowTitle: { fontSize: 17, lineHeight: 24, fontWeight: 600 },
  cityBadge: { borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  writerQuota: { marginHorizontal: Spacing.three, marginBottom: Spacing.three },
  writer: {
    flex: 1,
  },
  writerHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  writerScroll: {
    paddingBottom: Spacing.five,
  },
  aiCard: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: 12,
  },
  aiCopy: {
    gap: Spacing.one,
  },
  draftImage: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 10,
  },
  photoActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  photoButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
  },
  secondaryButton: {
    minHeight: 40,
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
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  tagChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  writerHashtags: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  suggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  titleInput: {
    fontSize: 18,
    fontWeight: 700,
    borderBottomWidth: 1,
    marginHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  hashtagInput: {
    fontSize: 14,
    fontWeight: 600,
    borderBottomWidth: 1,
    marginHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  bodyInput: {
    minHeight: 220,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  meetupNote: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
});
