import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { addPostComment, isContentRejected, loadPostCommentsPage, startDirectConversation, toggleCommentReaction, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import type { Post, PostComment } from '@/lib/types';

// 미니 프로필 대상 (글 작성자 or 댓글 작성자)
type SheetUser = {
  id?: string;
  nickname: string;
  neighborhood?: string;
  verified?: boolean;
  trustLevel?: 2 | 3;
  mine?: boolean;
};

type ReportSelection = {
  targetType: ReportTarget;
  targetId: string;
  reportedUserId: string;
  reportedNickname: string;
};

// 글 상세 = 카드 + 댓글. 댓글은 무제한(하루 캡은 발행에만) — 원페이저 원칙.
// pageSheet로 뜨므로 상단은 시트가 여백을 만들고, 하단은 insets로 홈바를 피한다.
export function PostDetail({
  post,
  onClose,
  onJoin,
  onCommentCountChange,
}: {
  post: Post;
  onClose: () => void;
  onJoin?: () => void;
  onCommentCountChange?: (count: number) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthed, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const [comments, setComments] = useState<PostComment[]>(post.commentList ?? []);
  const [draft, setDraft] = useState('');
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  const [sending, setSending] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [reportSelection, setReportSelection] = useState<ReportSelection | null>(null);
  const [commentTotal, setCommentTotal] = useState(post.comments);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    void loadPostCommentsPage(supabase, post.id)
      .then((next) => active && setComments(next.map((comment) => ({ ...comment, mine: comment.authorId === me.id }))))
      .catch(() => {});
    return () => { active = false; };
  }, [me.id, post.id]);

  const loadMore = async () => {
    const last = comments.at(-1);
    if (!last?.createdAt || loadingMore || comments.length >= commentTotal) return;
    setLoadingMore(true);
    try {
      const next = await loadPostCommentsPage(supabase, post.id, { createdAt: last.createdAt, id: last.id });
      setComments((current) => [...current, ...next.filter((comment) => !current.some(({ id }) => id === comment.id)).map((comment) => ({ ...comment, mine: comment.authorId === me.id }))]);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleCommentLike = async (id: string) => {
    if (!isAuthed) return promptLogin(t.auth.reasonLike);
    if (busyCommentId) return;
    const comment = comments.find((item) => item.id === id);
    if (!comment) return;
    play('reaction');
    const previous = comment.likedByMe ?? false;
    setBusyCommentId(id);
    setComments((current) => current.map((item) => item.id === id ? {
      ...item,
      likedByMe: !previous,
      likes: Math.max(0, (item.likes ?? 0) + (previous ? -1 : 1)),
    } : item));
    try {
      await toggleCommentReaction(supabase, id, me.id, previous);
    } catch {
      play('warning');
      setComments((current) => current.map((item) => item.id === id ? {
        ...item,
        likedByMe: previous,
        likes: Math.max(0, (item.likes ?? 0) + (previous ? 1 : -1)),
      } : item));
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    } finally {
      setBusyCommentId(null);
    }
  };

  const send = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonComment);
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const created = await addPostComment(supabase, post.id, me.id, body);
      const nextTotal = commentTotal + 1;
      setComments((current) => [{ id: created.id, authorId: me.id, nickname: me.nickname, body, mine: true, likes: 0, likedByMe: false, createdAt: created.created_at }, ...current]);
      setCommentTotal(nextTotal);
      onCommentCountChange?.(nextTotal);
      setDraft('');
      play('message');
    } catch (error) {
      play('warning');
      Alert.alert(
        isContentRejected(error) ? t.safety.contentBlockedTitle : t.detail.sendErrorTitle,
        isContentRejected(error) ? t.safety.contentBlockedBody : t.detail.sendErrorBody,
      );
    } finally {
      setSending(false);
    }
  };

  const requestChat = async (u: SheetUser) => {
    if (!isAuthed) return promptLogin(t.auth.reasonChatLogin);
    if (!u.id) return;
    try {
      const conversationId = await startDirectConversation(supabase, u.id);
      setSheetUser(null);
      play('message');
      router.push({ pathname: '/chat', params: { conversationId } });
    } catch {
      play('warning');
      Alert.alert(t.chat.startErrorTitle, t.chat.startErrorBody);
    }
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <View style={[styles.head, { borderBottomColor: theme.line }]}>
        <ThemedText type="smallBold">{t.detail.commentsTitle(commentTotal)}</ThemedText>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12} style={styles.closeBtn}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {t.detail.close}
          </ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <PostCard
            post={post}
            onJoin={onJoin}
            onAuthor={() =>
              setSheetUser({
                id: post.author.id,
                nickname: post.author.nickname,
                neighborhood: post.author.neighborhood,
                verified: post.author.verified,
                trustLevel: post.author.trustLevel,
                mine: post.author.id === me.id,
              })
            }
          />
          <View style={styles.comments}>
            {comments.map((c) => (
              <View
                key={c.id}
                style={[
                  styles.comment,
                  c.mine && { backgroundColor: theme.backgroundElement, borderRadius: 10, padding: 10 },
                ]}>
                <Pressable
                  onPress={() =>
                    setSheetUser({
                      id: c.authorId,
                      nickname: c.nickname,
                      verified: c.verified,
                      trustLevel: c.trustLevel,
                      mine: c.mine,
                    })
                  }
                  accessibilityRole="button"
                  style={[styles.avatar, { backgroundColor: c.mine ? theme.accent : theme.backgroundElement }]}>
                  <ThemedText
                    type="smallBold"
                    style={{ fontSize: 12, color: c.mine ? theme.accentInk : theme.navy }}>
                    {c.nickname[0]}
                  </ThemedText>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Pressable
                    onPress={() =>
                      setSheetUser({
                        id: c.authorId,
                        nickname: c.nickname,
                        verified: c.verified,
                        trustLevel: c.trustLevel,
                        mine: c.mine,
                      })
                    }
                    accessibilityRole="button"
                    style={styles.commentHead}>
                    <ThemedText type="smallBold" style={{ fontSize: 13 }}>
                      {c.nickname}
                    </ThemedText>
                    <TrustBadge verified={c.verified} trustLevel={c.trustLevel} />
                    {c.mine && (
                      <View style={[styles.mineBadge, { backgroundColor: theme.accent }]}>
                        <ThemedText type="smallBold" style={{ fontSize: 10, lineHeight: 13, color: theme.accentInk }}>
                          {t.feed.mineBadge}
                        </ThemedText>
                      </View>
                    )}
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary">
                    {c.body}
                  </ThemedText>
                  <View style={styles.commentActions}>
                    <Pressable
                      onPress={() => void toggleCommentLike(c.id)}
                      disabled={busyCommentId === c.id}
                      hitSlop={8}
                      accessibilityRole="button">
                      <ThemedText
                        type={c.likedByMe ? 'smallBold' : 'small'}
                        style={{ fontSize: 12, lineHeight: 16, color: c.likedByMe ? theme.accent : theme.textSecondary }}>
                        {t.feed.likes(c.likes ?? 0)}{c.likedByMe ? ' ♥' : ''}
                      </ThemedText>
                    </Pressable>
                    {!c.mine && c.authorId && (
                      <Pressable
                        onPress={() => setReportSelection({ targetType: 'comment', targetId: c.id, reportedUserId: c.authorId!, reportedNickname: c.nickname })}
                        accessibilityRole="button">
                        <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{t.report.short}</ThemedText>
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            ))}
            {comments.length < commentTotal && (
              <Pressable onPress={() => void loadMore()} disabled={loadingMore} accessibilityRole="button" style={styles.loadMore}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>{loadingMore ? t.feed.loadingMore : t.detail.loadMoreComments}</ThemedText>
              </Pressable>
            )}
          </View>
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              borderTopColor: theme.line,
              backgroundColor: theme.card,
              paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one,
            },
          ]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t.detail.commentPlaceholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]}
          />
          <Pressable
            onPress={() => void send()}
            disabled={sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending, busy: sending }}
            style={[styles.send, { backgroundColor: theme.accent, opacity: sending ? 0.55 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
              {t.detail.send}
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* 미니 프로필: 신뢰 레벨 배지 + 대화 요청 진입점 */}
      <Modal visible={!!sheetUser} transparent animationType="fade" onRequestClose={() => setSheetUser(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetUser(null)} accessibilityRole="button">
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}
            onPress={() => {}}>
            {sheetUser && (
              <>
                <View style={[styles.sheetAvatar, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="subtitle" style={{ color: theme.navy }}>
                    {sheetUser.nickname[0]}
                  </ThemedText>
                </View>
                <View style={styles.sheetNickRow}>
                  <ThemedText type="smallBold" style={{ fontSize: 18 }}>
                    {sheetUser.nickname}
                  </ThemedText>
                  <TrustBadge verified={sheetUser.verified} trustLevel={sheetUser.trustLevel} />
                </View>
                {sheetUser.neighborhood && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {sheetUser.neighborhood}
                  </ThemedText>
                )}
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>
                  {sheetUser.mine
                    ? t.profileSheet.self
                    : sheetUser.trustLevel === 3
                      ? t.profileSheet.verifiedL3
                      : sheetUser.verified || sheetUser.trustLevel === 2
                        ? t.profileSheet.verifiedL2
                        : t.profileSheet.verifiedL1}
                </ThemedText>
                {!sheetUser.mine && sheetUser.id && (
                  <>
                    <Pressable
                      onPress={() => void requestChat(sheetUser)}
                      accessibilityRole="button"
                      style={[styles.sheetCta, { backgroundColor: theme.accent }]}>
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{t.profileSheet.chatRequest}</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setReportSelection({ targetType: 'user', targetId: sheetUser.id!, reportedUserId: sheetUser.id!, reportedNickname: sheetUser.nickname });
                        setSheetUser(null);
                      }}
                      accessibilityRole="button"
                      style={[styles.sheetCta, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="smallBold" themeColor="textSecondary">{t.report.userAction}</ThemedText>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {reportSelection && (
        <ReportSheet
          visible
          {...reportSelection}
          onClose={() => setReportSelection(null)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  comments: {
    gap: Spacing.three,
  },
  loadMore: { alignItems: 'center', paddingVertical: Spacing.three },
  comment: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  commentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: 2 },
  commentActionText: { fontSize: 12, lineHeight: 16 },
  mineBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 14,
  },
  send: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    alignItems: 'center',
    gap: 6,
  },
  sheetAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  sheetNickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetCta: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 13,
    marginTop: Spacing.two,
  },
});
