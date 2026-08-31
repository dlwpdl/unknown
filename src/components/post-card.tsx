import { useState } from 'react';
import { Image } from 'expo-image';
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

// 카드 = 고정 셸(헤더·태그 배지·반응 푸터) × 태그별 본문 모듈 (원페이저 '카드 디자인')
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
  const isMeetup = post.tag.kind === 'meetup';
  // 구조화된 동네를 첫 발견 칩으로 보여주고, 그다음 주제 해시태그를 붙인다.
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
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      {/* 셸: 헤더 */}
      <View style={styles.head}>
        <Pressable
          onPress={onAuthor}
          disabled={!onAuthor}
          accessibilityRole="button"
          style={[styles.avatar, { backgroundColor: mine ? theme.accent : theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={{ color: mine ? theme.accentInk : theme.navy }}>
            {post.author.nickname[0]}
          </ThemedText>
        </Pressable>
        <Pressable onPress={onAuthor} disabled={!onAuthor} accessibilityRole="button" style={{ flex: 1 }}>
          <View style={styles.nickRow}>
            <ThemedText type="smallBold">{post.author.nickname}</ThemedText>
            <TrustBadge verified={post.author.verified} trustLevel={post.author.trustLevel} />
            {mine && (
              <View style={[styles.mineBadge, { backgroundColor: theme.accent }]}>
                <ThemedText type="smallBold" style={{ fontSize: 10, lineHeight: 13, color: theme.accentInk }}>
                  {t.feed.mineBadge}
                </ThemedText>
              </View>
            )}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {post.createdAtLabel} · {t.feed.views(post.views)}
          </ThemedText>
        </Pressable>
        <View style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText
            type="smallBold"
            style={{ fontSize: 11, lineHeight: 14, color: isMeetup ? theme.accent : theme.navy }}>
            {post.tag.label}
          </ThemedText>
        </View>
        {!mine && (
          <Pressable
            onPress={() => isAuthed ? setReportOpen(true) : promptLogin(t.auth.reasonReport)}
            accessibilityRole="button"
            accessibilityLabel={t.report.title(post.author.nickname)}
            hitSlop={10}
            style={styles.more}>
            <ThemedText type="smallBold" themeColor="textSecondary">···</ThemedText>
          </Pressable>
        )}
      </View>

      {/* 발견 칩: 구조화된 동네 + 주제 해시태그 */}
      {chips.length > 0 && (
        <View style={styles.hashRow}>
          {chips.map((c) => (
            <Pressable
              key={c}
              onPress={onHashtag ? () => {
                play('selection');
                onHashtag(c);
              } : undefined}
              disabled={!onHashtag}
              accessibilityRole="button"
              accessibilityLabel={`#${c} 필터`}
              style={({ pressed }) => [
                styles.hash,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="small" style={{ fontSize: 12, lineHeight: 16, color: theme.navy }}>
                {'#' + c}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {!!post.imageUris?.[0] && (
        <Image
          source={{ uri: post.imageUris[0] }}
          style={styles.postImage}
          contentFit="cover"
          transition={120}
          accessibilityLabel="게시글 사진"
        />
      )}

      {/* 본문 */}
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button">
        <ThemedText type="default" style={styles.title}>
          {post.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          {post.body}
        </ThemedText>
      </Pressable>

      {/* 목적 오브젝트 모듈: 오픈챗/모임 */}
      {post.room && (
        <View style={[styles.module, { borderColor: theme.line }]}>
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={{ fontSize: 13, lineHeight: 18 }}>
              {post.room.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12, lineHeight: 16 }}>
              {[
                post.room.verifiedOnly ? t.feed.roomGate : null,
                t.feed.members(post.room.memberCount, post.room.capacity),
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </View>
          <Pressable
            onPress={onJoin}
            style={({ pressed }) => [styles.join, { backgroundColor: theme.accent }, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.feed.joinRoom}>
            <ThemedText type="smallBold" style={{ fontSize: 12, lineHeight: 16, color: theme.accentInk }}>
              {t.feed.joinRoom}
            </ThemedText>
          </Pressable>
        </View>
      )}

      {/* 셸: 반응 푸터 */}
      <View style={[styles.foot, { borderTopColor: theme.line }]}>
        <Pressable
          onPress={toggleLike}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.feed.likes(post.likes)}>
          <ThemedText
            type={likedOn ? 'smallBold' : 'small'}
            style={[styles.footItem, { color: likedOn ? theme.accent : theme.textSecondary }]}>
            {t.feed.likes(likeCount)}
            {likedOn ? ' ♥' : ''}
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
          {t.feed.comments(post.comments)}
        </ThemedText>
        <Pressable
          onPress={toggleSave}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.profile.saved}>
          <ThemedText
            type={savedOn ? 'smallBold' : 'small'}
            style={[styles.footItem, { color: savedOn ? theme.accent : theme.textSecondary }]}>
            {t.feed.saves(saveCount)}
            {savedOn ? ' ✓' : ''}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => void share()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.feed.shares(shareCount)}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footItem}>
            {t.feed.shares(shareCount)}
          </ThemedText>
        </Pressable>
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
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  meta: {
    fontSize: 12,
    lineHeight: 16,
  },
  mineBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  more: { minWidth: 24, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  hashRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  hash: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  title: {
    fontWeight: 700,
    marginTop: 10,
    marginBottom: 4,
  },
  postImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    marginTop: 12,
    borderRadius: 10,
  },
  module: {
    marginTop: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  join: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  foot: {
    flexDirection: 'row',
    gap: Spacing.three,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
  },
  footItem: {
    fontVariant: ['tabular-nums'],
  },
});
