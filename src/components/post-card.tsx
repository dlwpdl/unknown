import { useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Alert, Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ReportSheet } from '@/components/report-sheet';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { recordPostShare, togglePostReaction } from '@/lib/community-data';
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
}: {
  post: Post;
  onJoin?: () => void;
  onHashtag?: (h: string) => void; // 해시태그 탭 → 검색/필터
  onAuthor?: () => void; // 작성자 탭 → 미니 프로필
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { isAuthed, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const mine = post.author.id === me.id;
  const [savedOn, setSavedOn] = useState(post.savedByMe ?? false);
  const [likedOn, setLikedOn] = useState(post.likedByMe ?? false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [saveCount, setSaveCount] = useState(post.saves);
  const [shareCount, setShareCount] = useState(post.shares ?? 0);
  const [busyReaction, setBusyReaction] = useState<'like' | 'save' | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState<{ postId: string; uri: string } | null>(null);
  const isMeetup = post.tag.kind === 'meetup';
  const firstPhoto = post.imageUris?.[0];
  const photo = failedPhoto?.postId === post.id && failedPhoto.uri === firstPhoto ? undefined : firstPhoto;
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
    if (!isAuthed) return promptLogin(t.auth.reasonShare);
    const url = buildSharedPostUrl(post.id);
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) await navigator.share({ title: post.title, text: post.body, url });
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
      style={[
        styles.card,
        photo ? styles.photoCard : styles.textCard,
        { backgroundColor: photo ? theme.card : theme.background, borderColor: theme.line },
      ]}>
      {photo && (
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : 'image'}
          accessibilityLabel={`${t.feed.postImage} · ${post.title}`}
          style={({ pressed }) => pressed && styles.pressed}>
          <Image
            source={{ uri: photo }}
            style={[styles.postImage, { backgroundColor: theme.backgroundElement }]}
            contentFit="cover"
            transition={0}
            onError={() => setFailedPhoto({ postId: post.id, uri: photo })}
          />
        </Pressable>
      )}

      <View style={styles.content}>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText
            type="smallBold"
            style={[styles.category, { color: isMeetup ? theme.accent : theme.textSecondary }]}>
            {post.tag.label}
          </ThemedText>
          <ThemedText style={[styles.title, photo && styles.photoTitle]}>
            {post.title}
          </ThemedText>
          <ThemedText
            themeColor="textSecondary"
            style={styles.body}
            numberOfLines={onPress ? 3 : undefined}>
            {post.body}
          </ThemedText>
        </Pressable>

        {chips.length > 0 && (
          <View style={styles.hashRow}>
            {chips.map((chip) => (
              <Pressable
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
          <Pressable
            onPress={onAuthor}
            disabled={!onAuthor}
            accessibilityRole={onAuthor ? 'button' : undefined}
            style={({ pressed }) => [styles.author, pressed && styles.pressed]}>
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
                {post.createdAtLabel} · {t.feed.views(post.views)}
              </ThemedText>
            </View>
          </Pressable>
          {!mine && (
            <Pressable
              onPress={() => isAuthed ? setReportOpen(true) : promptLogin(t.auth.reasonReport)}
              accessibilityRole="button"
              accessibilityLabel={t.report.title(post.author.nickname)}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={22}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          )}
        </View>

        {post.room && (
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
                    post.room.verifiedOnly ? t.feed.roomGate : null,
                    t.feed.members(post.room.memberCount, post.room.capacity),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              </View>
            </View>
            {onJoin && (
              <Pressable
                onPress={onJoin}
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

        <View style={[styles.foot, { borderTopColor: theme.line }]}>
          <Pressable
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
              {likeCount}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={onPress}
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
              {post.comments}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={toggleSave}
            disabled={!!busyReaction}
            style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.saves(saveCount)}
            accessibilityState={{ selected: savedOn, disabled: !!busyReaction, busy: busyReaction === 'save' }}>
            <SymbolView
              name={{ ios: savedOn ? 'bookmark.fill' : 'bookmark', android: savedOn ? 'bookmark_added' : 'bookmark', web: savedOn ? 'bookmark_added' : 'bookmark' }}
              size={20}
              tintColor={savedOn ? theme.accent : theme.textSecondary}
            />
            <ThemedText
              type={savedOn ? 'smallBold' : 'small'}
              style={[styles.footItem, { color: savedOn ? theme.accent : theme.textSecondary }]}>
              {saveCount}
            </ThemedText>
          </Pressable>
          <Pressable
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
              {shareCount}
            </ThemedText>
          </Pressable>
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
  photoCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 24 },
  textCard: { borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: Spacing.three },
  pressed: { opacity: 0.65 },
  postImage: { width: '100%', aspectRatio: 16 / 10 },
  category: { fontSize: 12, lineHeight: 18, marginBottom: Spacing.two },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  photoTitle: { fontSize: 24, lineHeight: 32, letterSpacing: -0.6 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', marginTop: Spacing.two },
  hashRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three },
  hash: { minHeight: 44, minWidth: 44, maxWidth: '100%', flexShrink: 1, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  author: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  authorCopy: { flex: 1 },
  nickRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  nickname: { flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18 },
  avatar: { minWidth: 32, minHeight: 32, borderRadius: 16, padding: Spacing.one, alignItems: 'center', justifyContent: 'center' },
  more: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  module: { marginTop: Spacing.three, borderRadius: 16, padding: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  roomInfo: { flexGrow: 1, flexBasis: 152, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  roomCopy: { flex: 1 },
  roomTitle: { fontSize: 15, lineHeight: 22 },
  join: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.three, paddingTop: Spacing.one },
  reaction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, minWidth: 44, minHeight: 44 },
  footItem: { fontVariant: ['tabular-nums'] },
});
