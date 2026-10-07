import { Pressable } from '@/components/analytics-controls';
import { useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Alert, Animated, Easing, Platform, Share, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ReportSheet } from '@/components/report-sheet';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count, t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { recordPostShare, togglePostReaction } from '@/lib/community-data';
import { getPostImageSource } from '@/lib/feed-data';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { uniqueHashtags } from '@/lib/hashtags';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { buildSharedPostUrl } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export function PostCard({
  post,
  onJoin,
  onHashtag,
  onAuthor,
  onPress,
  hidePhoto,
  hideRoom = false,
  flat = false,
  afterBody,
}: {
  post: Post;
  onJoin?: () => void;
  onHashtag?: (h: string) => void; // 해시태그 탭 → 검색/필터
  onAuthor?: () => void; // 작성자 탭 → 미니 프로필
  onPress?: () => void;
  hidePhoto?: boolean; // 상세 화면은 갤러리가 사진을 대신 보여준다
  hideRoom?: boolean;
  flat?: boolean;
  afterBody?: ReactNode;
}) {
  const theme = useTheme();
  const { isAuthed, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [saveBurst] = useState(() => new Animated.Value(0));
  const openPost = () => { play('selection'); onPress?.(); };
  const mine = post.author.id === me.id;
  const [savedOn, setSavedOn] = useState(post.savedByMe ?? false);
  const [likedOn, setLikedOn] = useState(post.likedByMe ?? false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [saveCount, setSaveCount] = useState(post.saves);
  const [shareCount, setShareCount] = useState(post.shares ?? 0);
  const [busyReaction, setBusyReaction] = useState<'like' | 'save' | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<{ postId: string; uri: string } | null>(null);
  const [loadedPhoto, setLoadedPhoto] = useState<{ key: string; aspectRatio: number } | null>(null);
  const isMeetup = post.tag.kind === 'meetup';
  const isListing = post.kind === 'listing';
  const viewerScope = isAuthed ? me.id : 'guest';
  const photoSource = getPostImageSource(post, viewerScope);
  const firstPhoto = photoSource?.uri;
  const photoKey = `${viewerScope}:${post.id}:${firstPhoto}`;
  const photoAspectRatio = loadedPhoto?.key === photoKey ? loadedPhoto.aspectRatio : 16 / 10;
  const photo = hidePhoto || (failedPhoto?.postId === post.id && failedPhoto.uri === firstPhoto) ? undefined : firstPhoto;
  const photoCount = post.imagePaths?.length ?? 0;
  const chips = uniqueHashtags([post.author.neighborhood, ...(post.hashtags ?? [])]);

  const toggleLike = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonLike);
    if (busyReaction) return;
    play('reaction');
    const previous = likedOn;
    setLikedOn(!previous);
    setLikeCount((count) => Math.max(0, count + (previous ? -1 : 1)));
    setBusyReaction('like');
    try {
      await togglePostReaction(supabase, post.id, me.id, 'like', previous);
    } catch {
      play('warning');
      setLikedOn(previous);
      setLikeCount((count) => Math.max(0, count + (previous ? 1 : -1)));
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    } finally {
      setBusyReaction(null);
    }
  };

  const toggleSave = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonSave);
    if (busyReaction) return;
    play('reaction');
    const previous = savedOn;
    if (!previous && !reducedMotion) {
      saveBurst.stopAnimation();
      saveBurst.setValue(0);
      Animated.timing(saveBurst, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    setSavedOn(!previous);
    setSaveCount((count) => Math.max(0, count + (previous ? -1 : 1)));
    setBusyReaction('save');
    try {
      await togglePostReaction(supabase, post.id, me.id, 'save', previous);
    } catch {
      play('warning');
      setSavedOn(previous);
      setSaveCount((count) => Math.max(0, count + (previous ? 1 : -1)));
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    } finally {
      setBusyReaction(null);
    }
  };

  const share = async () => {
    play('selection');
    if (!isAuthed) return promptLogin(t.auth.reasonShare);
    const url = buildSharedPostUrl(post.id);
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) await navigator.share({ title: post.title, text: post.room ? visibleMeetupBody(post.body) : post.body, url });
        else {
          await navigator.clipboard.writeText(url);
          Alert.alert(t.feed.linkCopied);
        }
        setShareCount(await recordPostShare(supabase, post.id));
        return;
      }
      const result = await Share.share({ title: post.title, message: `${post.title}\n${url}`, url });
      if (result.action === Share.sharedAction) {
        setShareCount(await recordPostShare(supabase, post.id));
      }
    } catch {
      // 공유 시트를 닫거나 지원하지 않는 대상이면 횟수를 올리지 않는다.
    }
  };

  return (
    <View
      style={flat ? undefined : [
        styles.card,
        photo ? styles.photoCard : styles.textCard,
        { backgroundColor: theme.card },
      ]}>
      {photo && (
        <Pressable analyticsId="components_post-card.pressable.1"
          onPress={openPost}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : 'image'}
          accessibilityLabel={`${t.feed.postImage} · ${post.title}`}
          style={({ pressed }) => pressed && styles.pressed}>
          <Image
            key={photoKey}
            source={photoSource}
            style={[styles.postImage, flat && styles.flatPostImage, { aspectRatio: photoAspectRatio, backgroundColor: theme.backgroundElement }]}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={`${viewerScope}:${post.id}`}
            transition={0}
            onLoad={({ source: { width, height } }) => {
              if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                setLoadedPhoto({ key: photoKey, aspectRatio: width / height });
              }
            }}
            onError={() => setFailedPhoto({ postId: post.id, uri: photo })}
          />
          {photoCount > 1 && (
            <View style={styles.photoCount}>
              <ThemedText type="smallBold" style={styles.photoCountText}>{`1/${photoCount}`}</ThemedText>
            </View>
          )}
        </Pressable>
      )}

      <View style={[styles.content, photo && !flat && styles.photoContent]}>
        <Pressable analyticsId="components_post-card.pressable.2"
          onPress={openPost}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText
            type="smallBold"
            style={[styles.category, { color: isMeetup ? theme.accent : theme.textSecondary }]}>
            {post.tag.label}{isListing ? ` · ${t.detail.listingBadge}` : ''}
          </ThemedText>
          <ThemedText style={[styles.title, photo && styles.photoTitle, flat && styles.detailTitle]}>
            {post.title}
          </ThemedText>
          <ThemedText
            themeColor="textSecondary"
            style={styles.body}
            numberOfLines={onPress ? 3 : undefined}>
            {post.room ? visibleMeetupBody(post.body) : post.body}
          </ThemedText>
          {isListing && (post.price != null || (post.listingStatus && post.listingStatus !== 'open')) && (
            <View style={styles.listingLine}>
              {post.price != null && <ThemedText style={styles.price}>{t.detail.price(post.price)}</ThemedText>}
              {post.listingStatus && post.listingStatus !== 'open' && (
                <ThemedText type="small" themeColor="textSecondary">{t.detail.listingStatus[post.listingStatus]}</ThemedText>
              )}
            </View>
          )}
        </Pressable>

        {afterBody}

        {chips.length > 0 && (
          <View style={styles.hashRow}>
            {chips.map((chip) => (
              <Pressable analyticsId="components_post-card.pressable.3"
                key={chip}
                onPress={onHashtag ? () => {
                  play('selection');
                  onHashtag(chip);
                } : undefined}
                disabled={!onHashtag}
                accessibilityRole={onHashtag ? 'button' : undefined}
                accessibilityLabel={t.feed.hashtagFilter(chip)}
                style={({ pressed }) => [styles.hash, pressed && styles.pressed]}>
                <ThemedText type="small" style={{ color: theme.navy }}>
                  {'#' + chip}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.head}>
          <Pressable analyticsId="components_post-card.pressable.4"
            onPress={() => { play('reaction'); onAuthor?.(); }}
            disabled={!onAuthor}
            accessibilityRole={onAuthor ? 'button' : undefined}
            style={({ pressed }) => [styles.author, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent', transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <View style={[styles.avatar, { backgroundColor: mine ? theme.accent : theme.backgroundElement }]}>
              <ThemedText type="smallBold" style={{ color: mine ? theme.accentInk : theme.navy }}>
                {post.author.nickname[0]}
              </ThemedText>
            </View>
            <View style={styles.authorCopy}>
              <View style={styles.nickRow}>
                <ThemedText type="smallBold" style={styles.nickname}>{post.author.nickname}</ThemedText>
                <TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} />
                {mine && (
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {t.feed.mineBadge}
                  </ThemedText>
                )}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                {post.createdAtLabel}{post.bumpedAt ? ` · ${t.detail.bumpedLabel}` : ''}
              </ThemedText>
            </View>
          </Pressable>
          {!mine && (
            <Pressable analyticsId="components_post-card.pressable.5"
              onPress={() => { play('reaction'); if (isAuthed) setReportOpen(true); else promptLogin(t.auth.reasonReport); }}
              accessibilityRole="button"
              accessibilityLabel={t.report.title(post.author.nickname)}
              style={({ pressed }) => [styles.more, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent', transform: [{ scale: pressed ? 0.88 : 1 }] }]}>
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={22}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          )}
        </View>

        {post.room && !hideRoom && (
          <View style={[styles.module, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.roomInfo}>
              <SymbolView
                name={{ ios: 'person.2', android: 'group', web: 'group' }}
                size={28}
                tintColor={theme.accent}
              />
              <View style={styles.roomCopy}>
                <ThemedText type="smallBold" style={styles.roomTitle}>
                  {post.room.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
                  {[
                    post.room.closed ? t.meetup.closed : null,
                    post.room.verifiedOnly ? t.feed.roomGate : null,
                    t.feed.members(post.room.memberCount, post.room.capacity),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              </View>
            </View>
            {onJoin && !post.room.closed && (
              <Pressable analyticsId="components_post-card.pressable.6"
                onPress={() => { play('selection'); onJoin(); }}
                style={({ pressed }) => [styles.join, { backgroundColor: theme.accent }, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t.feed.joinRoom}>
                <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                  {t.feed.joinRoom}
                </ThemedText>
              </Pressable>
            )}
          </View>
        )}

        <View style={[styles.foot, flat && styles.flatFoot, { borderTopColor: theme.line }]}>
          <Pressable analyticsId="components_post-card.pressable.7"
            onPress={toggleLike}
            disabled={!!busyReaction}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.likes(likeCount)}
            accessibilityState={{ selected: likedOn, disabled: !!busyReaction, busy: busyReaction === 'like' }}>
            <SymbolView
              name={{ ios: likedOn ? 'heart.fill' : 'heart', android: 'favorite', web: 'favorite' }}
              size={20}
              tintColor={likedOn ? theme.accent : theme.textSecondary}
            />
            <ThemedText
              type={likedOn ? 'smallBold' : 'small'}
              style={[styles.footItem, { color: likedOn ? theme.accent : theme.textSecondary }]}>
              {count(likeCount)}
            </ThemedText>
          </Pressable>
          <Pressable analyticsId="components_post-card.pressable.8"
            onPress={openPost}
            disabled={!onPress}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={t.feed.comments(post.comments)}>
            <SymbolView
              name={{ ios: 'bubble.right', android: 'chat_bubble', web: 'chat_bubble' }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
              {count(post.comments)}
            </ThemedText>
          </Pressable>
          <Pressable analyticsId="components_post-card.pressable.9"
            onPress={toggleSave}
            disabled={!!busyReaction}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.saves(saveCount)}
            accessibilityState={{ selected: savedOn, disabled: !!busyReaction, busy: busyReaction === 'save' }}>
            <Animated.View style={[styles.saveMark, { transform: reducedMotion ? undefined : [{ scale: saveBurst.interpolate({ inputRange: [0, 0.28, 0.65, 1], outputRange: [1, 1.27, 0.95, 1] }) }] }]}>
              {!reducedMotion && [[-12, -12], [0, -17], [12, -12], [-14, 5], [14, 5], [0, 16]].map(([x, y], index) => <Animated.View key={index} pointerEvents="none" style={[styles.saveSpark, {
                backgroundColor: index % 2 ? '#F9C76C' : theme.accent,
                opacity: saveBurst.interpolate({ inputRange: [0, 0.15, 0.65, 1], outputRange: [0, 1, 0.75, 0] }),
                transform: [
                  { translateX: saveBurst.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
                  { translateY: saveBurst.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
                ],
              }]} />)}
              <SymbolView
                name={{ ios: savedOn ? 'bookmark.fill' : 'bookmark', android: savedOn ? 'bookmark_added' : 'bookmark', web: savedOn ? 'bookmark_added' : 'bookmark' }}
                size={20}
                tintColor={savedOn ? theme.accent : theme.textSecondary}
              />
            </Animated.View>
            <ThemedText
              type={savedOn ? 'smallBold' : 'small'}
              style={[styles.footItem, { color: savedOn ? theme.accent : theme.textSecondary }]}>
              {count(saveCount)}
            </ThemedText>
          </Pressable>
          <Pressable analyticsId="components_post-card.pressable.10"
            onPress={() => void share()}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.shares(shareCount)}>
            <SymbolView
              name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
              {count(shareCount)}
            </ThemedText>
          </Pressable>
          <View style={styles.reaction} accessible accessibilityLabel={t.feed.views(post.views)}>
            <SymbolView
              name={{ ios: 'eye', android: 'visibility', web: 'visibility' }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
              {count(post.views)}
            </ThemedText>
          </View>
        </View>
      </View>
      <ReportSheet
        visible={reportOpen}
        targetType="post"
        targetId={post.id}
        reportedUserId={post.author.id}
        reportedNickname={post.author.nickname}
        onClose={() => setReportOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  photoCard: { borderRadius: 24 },
  photoCount: { position: 'absolute', bottom: 10, right: 10, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(22,22,24,0.66)' },
  photoCountText: { color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  textCard: { borderRadius: 16, paddingHorizontal: Spacing.three },
  content: { paddingVertical: Spacing.three },
  photoContent: { paddingHorizontal: Spacing.three },
  pressed: { opacity: 0.65 },
  postImage: { width: '100%' },
  flatPostImage: { borderRadius: 16 },
  category: { fontSize: 12, lineHeight: 18, marginBottom: Spacing.two },
  title: { fontSize: 18, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  photoTitle: { fontSize: 20, lineHeight: 28, letterSpacing: -0.5 },
  detailTitle: { fontSize: 28, lineHeight: 36, letterSpacing: -0.6 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', marginTop: Spacing.two },
  listingLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, marginTop: Spacing.two },
  price: { fontSize: 17, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3 },
  hashRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three },
  hash: { minHeight: 44, minWidth: 44, maxWidth: '100%', flexShrink: 1, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  author: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12 },
  authorCopy: { flex: 1 },
  nickRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  nickname: { flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18 },
  avatar: { minWidth: 32, minHeight: 32, borderRadius: 16, padding: Spacing.one, alignItems: 'center', justifyContent: 'center' },
  more: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  module: { marginTop: Spacing.three, borderRadius: 16, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  roomInfo: { flexGrow: 1, flexBasis: 152, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  roomCopy: { flex: 1 },
  roomTitle: { fontSize: 15, lineHeight: 22 },
  join: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.three, paddingTop: Spacing.one },
  flatFoot: { borderTopWidth: 0, paddingTop: 0 },
  reaction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, minWidth: 44, minHeight: 44 },
  saveMark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  saveSpark: { position: 'absolute', left: 9, top: 8, width: 4, height: 8, borderRadius: 2 },
  footItem: { fontVariant: ['tabular-nums'] },
});
