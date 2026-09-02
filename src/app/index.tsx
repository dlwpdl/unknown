import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { parseAiDraftResponse } from '@/lib/ai-draft';
import {
  createCommunityPost,
  isContentRejected,
  loadDailyQuota,
  loadTrendingHashtags,
  loadUnreadNotificationCount,
  POST_QUOTA_CHANGED_EVENT,
  recordPostView,
  requestMeetupJoin,
} from '@/lib/community-data';
import { loadPublicFeed } from '@/lib/feed-data';
import { addHashtag, canonicalizeHashtag, getSuggestedHashtags, parseHashtags } from '@/lib/hashtags';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES, INITIAL_QUOTA, MOCK_POSTS, TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { views } from '@/lib/views';
import type { City, Post, Tag } from '@/lib/types';

type DraftImage = { uri: string; base64: string; mimeType: string };

export default function FeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { isAuthed, promptLogin, me } = useAuth();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets();
  const bottomClear = insets.bottom + TabBarHeight; // 탭바 + 홈 인디케이터 실측 높이
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);
  const [quota, setQuota] = useState(INITIAL_QUOTA);
  const [city, setCity] = useState<City>(CITIES[0]);
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
  const [tagFilter, setTagFilter] = useState<number | null>(null); // 카테고리 칩
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trendingTags, setTrendingTags] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<Post[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [joinPost, setJoinPost] = useState<Post | null>(null);
  const [joinMessage, setJoinMessage] = useState('');
  const [joining, setJoining] = useState(false);

  const refreshFeed = useCallback(async () => {
    const next = await loadPublicFeed(supabase, city.id, tagFilter);
    setPosts(next);
    setHasMore(next.length === 30);
  }, [city.id, tagFilter]);

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
    void loadDailyQuota(supabase).then((next) => {
      setQuota(next);
      DeviceEventEmitter.emit(POST_QUOTA_CHANGED_EVENT, next);
    }).catch(() => {});
  }, [isAuthed, me.id]);

  const cityOpen = city.state === 'open';
  const cityPosts = useMemo(() => posts.filter((p) => p.cityId === city.id), [posts, city.id]);
  const feedData = useMemo(
    () =>
      cityOpen
        ? cityPosts.filter((p) => tagFilter == null || p.tag.id === tagFilter)
        : [],
    [cityOpen, cityPosts, tagFilter],
  );

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

  useEffect(() => {
    if (!isAuthed) return;
    const refreshUnread = () => void loadUnreadNotificationCount(supabase, me.id).then(setUnreadCount).catch(() => {});
    refreshUnread();
    const channel = supabase.channel(`notification-count:${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, refreshUnread)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [isAuthed, me.id]);

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
    const firstView = !views.has(post.id);
    if (firstView) {
      views.mark(post.id);
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, views: item.views + 1 } : item));
      void recordPostView(supabase, post.id).catch(() => {
        views.unmark(post.id);
        setPosts((current) => current.map((item) => item.id === post.id ? { ...item, views: Math.max(0, item.views - 1) } : item));
        setDetailPost((current) => current?.id === post.id ? { ...current, views: Math.max(0, current.views - 1) } : current);
      });
    }
    setDetailPost(firstView ? { ...post, views: post.views + 1 } : post);
  };

  // 테스트 UX: 소셜 로그인(mock) 직후 보려던 글 자동 오픈
  useEffect(() => {
    if (isAuthed && pendingPost) {
      const timer = setTimeout(() => {
        setDetailPost(pendingPost);
        setPendingPost(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAuthed, pendingPost]);
  const onJoin = (post: Post) => {
    if (!isAuthed) return promptLogin(t.auth.reasonJoinLogin);
    if (post.author.id === me.id) return Alert.alert(t.chat.ownMeetupTitle, t.chat.ownMeetupBody);
    setJoinMessage('');
    setJoinPost(post);
  };

  const submitJoin = async () => {
    if (!joinPost || joining) return;
    setJoining(true);
    try {
      await requestMeetupJoin(supabase, joinPost.id, joinMessage);
      play('meetup');
      setJoinPost(null);
      setJoinMessage('');
      Alert.alert(t.chat.joinDoneTitle, t.chat.joinDoneBody);
    } catch {
      play('warning');
      Alert.alert(t.chat.startErrorTitle, t.chat.startErrorBody);
    } finally {
      setJoining(false);
    }
  };

  const openWriter = useCallback(() => {
    if (!isAuthed) return promptLogin(t.auth.reasonWrite);
    // ponytail: 캡 검사는 서버(create_post RPC)가 최종 강제 — 여긴 UX용 사전 안내만
    if (quota.used >= quota.max) {
      Alert.alert(t.feed.capReachedTitle, t.feed.capReachedBody);
      return;
    }
    setWriting(true);
  }, [isAuthed, promptLogin, quota.max, quota.used]);

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
          cityName: city.name,
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
        cityId: city.id,
        tag,
        title: title.trim(),
        body: body.trim(),
        hashtags,
        image: draftImage ? { base64: draftImage.base64, mimeType: draftImage.mimeType } : undefined,
      });
      setPosts((prev) => [post, ...prev.filter(({ id }) => id !== post.id)]);
      const nextQuota = await loadDailyQuota(supabase);
      setQuota(nextQuota);
      DeviceEventEmitter.emit(POST_QUOTA_CHANGED_EVENT, nextQuota);
      setTagFilter(null);
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
      Alert.alert(
        dailyLimit ? t.feed.capReachedTitle : contentRejected ? t.safety.contentBlockedTitle : t.write.submitErrorTitle,
        dailyLimit ? t.feed.capReachedBody : contentRejected ? t.safety.contentBlockedBody : t.write.submitErrorBody,
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
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={feedData}
          onEndReached={() => void loadMorePosts()}
          onEndReachedThreshold={0.4}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void refreshFeed().catch(() => Alert.alert(t.feed.refreshErrorTitle, t.feed.refreshErrorBody)).finally(() => setRefreshing(false));
          }}
          keyExtractor={(p) => p.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomClear + Spacing.three }]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.two + 2 }} />}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.headRow}>
                <Pressable
                  onPress={() => setCityPicker(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t.feed.cityPickerTitle}>
                  <ThemedText type="subtitle" style={styles.city}>
                    {city.name} <ThemedText themeColor="textSecondary">▾</ThemedText>
                  </ThemedText>
                </Pressable>
                <View style={styles.headActions}>
                  {isAuthed && (
                    <Pressable
                      onPress={() => router.push('/notifications')}
                      accessibilityRole="button"
                      accessibilityLabel={t.notifications.open}
                      style={styles.notificationButton}>
                      <ThemedText type="smallBold">{t.notifications.title}</ThemedText>
                      {unreadCount > 0 && (
                        <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
                          <ThemedText type="smallBold" style={styles.unreadText}>{Math.min(unreadCount, 99)}</ThemedText>
                        </View>
                      )}
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => openSearch()}
                    accessibilityRole="button"
                    accessibilityLabel={t.search.placeholder}
                    style={styles.searchBtn}>
                    <ThemedText type="smallBold">{t.search.open}</ThemedText>
                  </Pressable>
                </View>
              </View>
              {cityOpen && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipBar}>
                  {[null, ...TAGS.map((tg) => tg.id)].map((id) => {
                    const label = id == null ? t.feed.filterAll : TAGS.find((tg) => tg.id === id)!.label;
                    const active = tagFilter === id;
                    return (
                      <Pressable
                        key={id ?? 'all'}
                        onPress={() => {
                          play('selection');
                          setTagFilter(id);
                        }}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.filterChip,
                          { backgroundColor: active ? theme.accent : theme.backgroundElement },
                          pressed && styles.chipPressed,
                        ]}>
                        <ThemedText
                          type="smallBold"
                          style={{ fontSize: 13, color: active ? theme.accentInk : theme.textSecondary }}>
                          {label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              {cityOpen && (
                <View style={styles.popularRow}>
                  <ThemedText type="smallBold" themeColor="textSecondary" style={styles.popularLabel}>
                    {t.feed.popularHashtags}
                  </ThemedText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.hashtagBar}>
                    {popularTags.map((hashtag) => (
                      <Pressable
                        key={hashtag}
                        onPress={() => {
                          play('selection');
                          openSearch(hashtag);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`#${hashtag}`}
                        style={({ pressed }) => pressed && styles.chipPressed}>
                        <ThemedText type="smallBold" style={{ fontSize: 12, color: theme.navy }}>
                          {'#' + hashtag}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          }
          ListFooterComponent={loadingMore ? <ThemedText type="small" themeColor="textSecondary" style={styles.loadingMore}>{t.feed.loadingMore}</ThemedText> : null}
          ListEmptyComponent={
            cityOpen ? null : (
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
          renderItem={({ item }) => (
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
      <Modal visible={searching} animationType="slide" onRequestClose={() => setSearching(false)}>
        <ThemedView style={styles.writer}>
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
                data={searchResults}
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
                      setSearching(false);
                      openDetail(item);
                    }}
                    onJoin={() => void onJoin(item)}
                    onHashtag={setQuery}
                  />
                )}
              />
            )}
          </SafeAreaView>
        </ThemedView>
      </Modal>

      {/* 글 상세 (로그인 게이트 통과 시) — pageSheet: 상단 여백·스와이프 닫기 네이티브 제공 */}
      <Modal
        visible={!!detailPost}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailPost(null)}>
        {detailPost && (
          <PostDetail
            post={detailPost}
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

      {/* 지역 선택: 큰 도시만. 열린 도시(밴쿠버)만 피드, 나머지는 '곧' 배지 */}
      <Modal visible={cityPicker} animationType="slide" onRequestClose={() => setCityPicker(false)}>
        <ThemedView style={styles.writer}>
          <SafeAreaView style={{ flex: 1 }}>
            <View style={styles.writerHead}>
              <View style={{ width: 40 }} />
              <ThemedText type="smallBold">{t.feed.cityPickerTitle}</ThemedText>
              <Pressable onPress={() => setCityPicker(false)} accessibilityRole="button">
                <ThemedText type="small" themeColor="textSecondary">
                  {t.write.cancel}
                </ThemedText>
              </Pressable>
            </View>
            <FlatList
              data={CITIES}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingHorizontal: Spacing.three }}
              ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
              renderItem={({ item }) => {
                const selected = item.id === city.id;
                const open = item.state === 'open';
                return (
                  <Pressable
                    onPress={() => {
                      setCity(item);
                      setCityPicker(false);
                    }}
                    accessibilityRole="button"
                    style={[
                      styles.cityRow,
                      { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.line },
                    ]}>
                    <View>
                      <ThemedText type="smallBold">{item.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
                        {item.province}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.cityBadge,
                        { backgroundColor: open ? theme.accent : theme.backgroundElement },
                      ]}>
                      <ThemedText
                        type="smallBold"
                        style={{ fontSize: 11, color: open ? theme.accentInk : theme.textSecondary }}>
                        {open ? t.feed.cityOpen : t.feed.citySoon}
                      </ThemedText>
                    </View>
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </ThemedView>
      </Modal>

      {/* 글쓰기: 태그 선선택 → 태그별 안내문 (당근 패턴) */}
      <Modal visible={writing} animationType="slide" onRequestClose={() => setWriting(false)}>
        <ThemedView style={styles.writer}>
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
        </ThemedView>
      </Modal>
    </ThemedView>
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
  header: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  city: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: 700,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  notificationButton: { minHeight: 36, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  unreadBadge: { position: 'absolute', top: -2, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  unreadText: { color: '#FFFFFF', fontSize: 9, lineHeight: 12, fontVariant: ['tabular-nums'] },
  searchBtn: {
    padding: 6,
  },
  chipBar: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.95 }],
  },
  popularRow: {
    gap: Spacing.two,
  },
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
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  cityBadge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
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
