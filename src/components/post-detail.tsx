import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { createThreadComment, loadCommentThreadContext, loadCommentThreadPage, type CommentCursor } from '@/lib/comment-threads';
import { getCommunityActionError, isContentRejected, recordPostView, startDirectConversation, toggleCommentReaction, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';
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

type PostDetailProps = {
  post: Post;
  commentId?: string;
  onClose: () => void;
  onJoin?: () => void;
  onCommentCountChange?: (count: number) => void;
  onViewCountChange?: (postId: string, count: number) => void;
};

type PageState = { cursor: CommentCursor | null; loading: boolean; error: boolean; loaded: boolean };

export function PostDetail(props: PostDetailProps) {
  const { isAuthed, me } = useAuth();
  // Drafts, likes and pending requests belong to one post and one account.
  return <PostDetailContent key={`${props.post.id}:${isAuthed ? me.id : 'guest'}`} {...props} />;
}

function PostDetailContent({ post, commentId, onClose, onJoin, onCommentCountChange, onViewCountChange }: PostDetailProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthed, me, promptLogin, isVerified, trustLevel } = useAuth();
  const { play } = useInteractionFeedback();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [pages, setPages] = useState<Record<string, PageState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [context, setContext] = useState<{ id: string; comments: PostComment[]; error: boolean } | null>(null);
  const [contextRetry, setContextRetry] = useState(0);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  const [sending, setSending] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [reportSelection, setReportSelection] = useState<ReportSelection | null>(null);
  const [commentTotal, setCommentTotal] = useState(post.comments);
  const [viewCount, setViewCount] = useState(post.views);
  const [requestingChat, setRequestingChat] = useState(false);
  const requestBusy = useRef(false);
  const sendBusy = useRef(false);
  const likeBusy = useRef(false);
  const pageRequests = useRef(new Set<string>());
  const loadedPages = useRef(new Set<string>());
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledContext = useRef<string | undefined>(undefined);
  const active = useRef(true);
  const focusedContext = context?.id === commentId ? context : null;
  const focusedRoot = focusedContext?.comments.find((comment) => !comment.parentId);
  const focusedReply = focusedContext?.comments.find((comment) => comment.id === commentId && comment.parentId);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    // The database counts each (post, account) once, across app restarts and devices.
    void recordPostView(supabase, post.id).then((count) => {
      if (!active) return;
      setViewCount(count);
      onViewCountChange?.(post.id, count);
    }).catch(() => {});
    return () => { active = false; };
  }, [isAuthed, me.id, onViewCountChange, post.id]);

  const loadPage = useCallback(async (parentId: string | null = null, cursor: CommentCursor | null = null) => {
    const key = parentId ?? 'root';
    if (!active.current || pageRequests.current.has(key) || (!cursor && loadedPages.current.has(key))) return;
    pageRequests.current.add(key);
    setPages((current) => ({ ...current, [key]: { ...current[key], cursor, loading: true, error: false, loaded: current[key]?.loaded ?? false } }));
    try {
      const next = await loadCommentThreadPage(supabase, post.id, parentId, cursor);
      if (!active.current) return;
      loadedPages.current.add(key);
      setComments((current) => {
        const ids = new Set(current.map(({ id }) => id));
        return [...current, ...next.comments.filter(({ id }) => !ids.has(id))];
      });
      setPages((current) => ({ ...current, [key]: { cursor: next.cursor, loading: false, error: false, loaded: true } }));
    } catch {
      if (active.current) setPages((current) => ({ ...current, [key]: { ...current[key], loading: false, error: true } }));
    } finally {
      pageRequests.current.delete(key);
    }
  }, [post.id]);

  useEffect(() => { void Promise.resolve().then(() => loadPage()); }, [loadPage]);

  useEffect(() => {
    if (!commentId) return;
    let current = true;
    void loadCommentThreadContext(supabase, post.id, commentId).then((next) => {
      if (!current || !active.current) return;
      setContext({ id: commentId, comments: next, error: false });
      const root = next.find((comment) => !comment.parentId);
      if (root && ((root.replyCount ?? 0) > 0 || next.length > 1)) {
        setExpanded((previous) => new Set(previous).add(root.id));
        void loadPage(root.id);
      }
    }).catch(() => {
      if (current && active.current) setContext({ id: commentId, comments: [], error: true });
    });
    return () => { current = false; };
  }, [commentId, contextRetry, loadPage, post.id]);

  const updateComment = (id: string, update: (comment: PostComment) => PostComment) => {
    setComments((current) => current.map((comment) => comment.id === id ? update(comment) : comment));
    setContext((current) => current && { ...current, comments: current.comments.map((comment) => comment.id === id ? update(comment) : comment) });
  };

  const toggleCommentLike = async (id: string) => {
    if (!isAuthed) return promptLogin(t.auth.reasonLike);
    if (likeBusy.current) return;
    const comment = focusedContext?.comments.find((item) => item.id === id) ?? comments.find((item) => item.id === id);
    if (!comment) return;
    play('reaction');
    const previous = comment.likedByMe ?? false;
    likeBusy.current = true;
    setBusyCommentId(id);
    updateComment(id, (item) => ({
      ...item,
      likedByMe: !previous,
      likes: Math.max(0, (item.likes ?? 0) + (previous ? -1 : 1)),
    }));
    try {
      await toggleCommentReaction(supabase, id, me.id, previous);
    } catch {
      if (!active.current) return;
      play('warning');
      updateComment(id, (item) => ({
        ...item,
        likedByMe: previous,
        likes: Math.max(0, (item.likes ?? 0) + (previous ? 1 : -1)),
      }));
      Alert.alert(t.feed.actionErrorTitle, t.feed.actionErrorBody);
    } finally {
      likeBusy.current = false;
      if (active.current) setBusyCommentId(null);
    }
  };

  const send = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonComment);
    const body = draft.trim();
    const parentId = replyTo ? replyTo.parentId ?? replyTo.id : null;
    const targetPage = pages[parentId ?? 'root'];
    if (!body || sendBusy.current || !targetPage?.loaded || targetPage.loading) return;
    sendBusy.current = true;
    setSendError(null);
    setSending(true);
    try {
      const id = await createThreadComment(supabase, post.id, body, replyTo?.id);
      if (!active.current) return;
      const nextTotal = commentTotal + 1;
      setComments((current) => [{
        id, authorId: me.id, nickname: me.nickname, body, likes: 0, likedByMe: false,
        verified: isVerified, trustLevel: trustLevel === 3 ? 3 : undefined,
        parentId: parentId ?? undefined, replyToId: replyTo?.id, replyToNickname: replyTo?.nickname, replyCount: 0,
      }, ...current]);
      if (parentId) updateComment(parentId, (comment) => ({ ...comment, replyCount: (comment.replyCount ?? 0) + 1 }));
      setCommentTotal(nextTotal);
      onCommentCountChange?.(nextTotal);
      setDraft('');
      setReplyTo(null);
      play('message');
    } catch (error) {
      if (!active.current) return;
      play('warning');
      const message = isContentRejected(error) ? t.safety.contentBlockedBody : t.detail.sendErrorBody;
      if (Platform.OS === 'web') setSendError(message);
      else Alert.alert(isContentRejected(error) ? t.safety.contentBlockedTitle : t.detail.sendErrorTitle, message);
    } finally {
      sendBusy.current = false;
      if (active.current) setSending(false);
    }
  };

  const requestChat = async (u: SheetUser) => {
    if (!isAuthed) return promptLogin(t.auth.reasonChatLogin);
    if (!u.id || requestBusy.current) return;
    requestBusy.current = true;
    setRequestingChat(true);
    try {
      const conversationId = await startDirectConversation(supabase, u.id);
      if (!active.current) return;
      setSheetUser(null);
      play('message');
      onClose();
      router.push({ pathname: '/chat', params: { conversationId, view: 'requests' } });
    } catch (error) {
      if (!active.current) return;
      play('warning');
      const code = getCommunityActionError(error);
      const message = code ? t.actionErrors[code] : null;
      if (message) Alert.alert(message.title, message.body, [
        { text: t.write.cancel, style: 'cancel' },
        ...(message.membership ? [{ text: '멤버십 보기', onPress: () => { setSheetUser(null); onClose(); router.push('/profile/membership'); } }] : []),
      ]);
      else Alert.alert(t.chat.startErrorTitle, t.chat.startErrorBody);
    } finally { requestBusy.current = false; if (active.current) setRequestingChat(false); }
  };

  const toggleReplies = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!expanded.has(id) && !pages[id]?.loaded) void loadPage(id);
  };

  const chooseReply = (comment: PostComment) => {
    if (!isAuthed) return promptLogin(t.auth.reasonComment);
    const rootId = comment.parentId ?? comment.id;
    setReplyTo(comment);
    setExpanded((current) => new Set(current).add(rootId));
    if (!pages[rootId]?.loaded) void loadPage(rootId);
    inputRef.current?.focus();
  };

  const renderPageAction = (parentId: string | null = null) => {
    const page = pages[parentId ?? 'root'];
    if (!page || page.loading) return <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.loadMore}>{t.feed.loadingMore}</ThemedText>;
    if (!page.error && !page.cursor) return null;
    return <View>
      {page.error && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{parentId ? '답글' : '댓글'}을 불러오지 못했어요.</ThemedText>}
      <Pressable onPress={() => void loadPage(parentId, page.cursor)} accessibilityRole="button" style={styles.loadMore}>
        <ThemedText type="smallBold" themeColor="accent">{page.error ? '다시 시도' : parentId ? '답글 더 보기' : t.detail.loadMoreComments}</ThemedText>
      </Pressable>
    </View>;
  };

  const renderComment = (c: PostComment) => {
    const mine = isAuthed && c.authorId === me.id;
    return (
      <View
        key={c.id}
        style={[
          styles.comment,
          mine && { backgroundColor: theme.backgroundElement, borderRadius: 10, padding: 10 },
        ]}>
        <Pressable
          onPress={() =>
            setSheetUser({
              id: c.authorId,
              nickname: c.nickname,
              verified: c.verified,
              trustLevel: c.trustLevel,
              mine,
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`${c.nickname} 프로필 보기`}
          style={[styles.avatar, { backgroundColor: mine ? theme.accent : theme.backgroundElement }]}>
          <ThemedText
            type="smallBold"
            style={{ fontSize: 12, color: mine ? theme.accentInk : theme.navy }}>
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
                mine,
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`${c.nickname} 프로필 보기`}
            style={styles.commentHead}>
            <ThemedText type="smallBold" style={{ fontSize: 13 }}>
              {c.nickname}
            </ThemedText>
            <TrustBadge verified={c.verified} trustLevel={c.trustLevel} />
            {mine && (
              <View style={[styles.mineBadge, { backgroundColor: theme.accent }]}>
                <ThemedText type="smallBold" style={{ fontSize: 10, lineHeight: 13, color: theme.accentInk }}>
                  {t.feed.mineBadge}
                </ThemedText>
              </View>
            )}
          </Pressable>
          {c.replyToNickname && <ThemedText type="small" themeColor="accent" style={styles.commentActionText}>{c.replyToNickname}님에게 답글</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">
            {c.body}
          </ThemedText>
          <View style={styles.commentActions}>
            <Pressable
              onPress={() => void toggleCommentLike(c.id)}
              disabled={!!busyCommentId}
              style={styles.commentAction}
              accessibilityRole="button"
              aria-pressed={Platform.OS === 'web' ? !!c.likedByMe : undefined}
              aria-busy={busyCommentId === c.id}
              accessibilityLabel={`${c.nickname}의 ${c.parentId ? '답글' : '댓글'} 공감 ${c.likes ?? 0}개`}
              accessibilityState={{ selected: !!c.likedByMe, disabled: !!busyCommentId, busy: busyCommentId === c.id }}>
              <ThemedText
                type={c.likedByMe ? 'smallBold' : 'small'}
                style={{ fontSize: 12, lineHeight: 16, color: c.likedByMe ? theme.accent : theme.textSecondary }}>
                {t.feed.likes(c.likes ?? 0)}{c.likedByMe ? ' ♥' : ''}
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => chooseReply(c)} disabled={sending} accessibilityRole="button"
              accessibilityLabel={`${c.nickname}님에게 답글 쓰기`} accessibilityState={{ disabled: sending }} style={styles.commentAction}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>답글</ThemedText>
            </Pressable>
            {!mine && c.authorId && (
              <Pressable
                onPress={() => setReportSelection({ targetType: 'comment', targetId: c.id, reportedUserId: c.authorId!, reportedNickname: c.nickname })}
                accessibilityRole="button" accessibilityLabel={`${c.nickname}의 ${c.parentId ? '답글' : '댓글'} 신고`} style={styles.commentAction}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{t.report.short}</ThemedText>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  };

  const composerPage = pages[replyTo ? replyTo.parentId ?? replyTo.id : 'root'];
  const sendDisabled = sending || !draft.trim() || !composerPage?.loaded || composerPage.loading;
  const roots: PostComment[] = [];
  const repliesByRoot = new Map<string, PostComment[]>();
  for (const comment of comments) {
    if (!comment.parentId) roots.push(comment);
    else {
      const replies = repliesByRoot.get(comment.parentId) ?? [];
      replies.push(comment);
      repliesByRoot.set(comment.parentId, replies);
    }
  }

  function renderThread(comment: PostComment, target?: PostComment) {
    return (
      <View key={comment.id}>
        {renderComment(comment)}
        {target && expanded.has(comment.id) && <View style={[styles.replies, styles.focusReply, { borderLeftColor: theme.accent, backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="accent" style={styles.commentActionText}>알림의 답글</ThemedText>
          {renderComment(target)}
        </View>}
        {((comment.replyCount ?? 0) > 0 || expanded.has(comment.id)) && (
          <Pressable
            onPress={() => {
              // The shared renderer creates this handler; refs are read only after a press.
              // eslint-disable-next-line react-hooks/refs
              toggleReplies(comment.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${comment.nickname}의 댓글 답글 ${comment.replyCount ?? 0}개 ${expanded.has(comment.id) ? '접기' : '보기'}`}
            accessibilityState={{ expanded: expanded.has(comment.id) }}
            aria-expanded={expanded.has(comment.id)}
            style={styles.replyToggle}>
            <ThemedText type="smallBold" themeColor="accent" style={styles.commentActionText}>
              {expanded.has(comment.id) ? '답글 접기' : `답글 ${comment.replyCount ?? 0}개 보기`}
            </ThemedText>
          </Pressable>
        )}
        {expanded.has(comment.id) && <View style={[styles.replies, { borderLeftColor: theme.line }]}>
          {repliesByRoot.get(comment.id)?.filter((reply) => reply.id !== target?.id).map(renderComment)}
          {renderPageAction(comment.id)}
        </View>}
      </View>
    );
  }

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
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
          onScrollBeginDrag={() => { scrolledContext.current = commentId; }}>
          <PostCard
            post={{ ...post, views: viewCount }}
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
          {PROMOTIONS_PREVIEW_ENABLED && isAuthed && post.author.id === me.id && <Pressable
            accessibilityRole="button"
            onPress={() => { onClose(); router.push({ pathname: '/profile/promotions', params: { postId: post.id } }); }}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }}>
            <ThemedText type="smallBold" themeColor="accent">이 글 끌어올리기</ThemedText>
          </Pressable>}
          {commentId && <View style={styles.focusThread}
            onLayout={({ nativeEvent }) => {
              if (!focusedRoot || scrolledContext.current === commentId) return;
              scrolledContext.current = commentId;
              scrollRef.current?.scrollTo({ y: nativeEvent.layout.y, animated: false });
            }}>
            <ThemedText type="smallBold" themeColor="accent">알림의 댓글</ThemedText>
            {focusedRoot ? renderThread(focusedRoot, focusedReply) : (
              <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                {!focusedContext ? '댓글을 불러오는 중이에요.' : focusedContext.error ? '댓글을 불러오지 못했어요.' : '이 댓글은 확인할 수 없어요.'}
              </ThemedText>
            )}
            {focusedContext?.error && <Pressable onPress={() => setContextRetry((current) => current + 1)} accessibilityRole="button" style={styles.commentAction}>
              <ThemedText type="smallBold" themeColor="accent">다시 시도</ThemedText>
            </Pressable>}
          </View>}
          <View style={styles.comments}>
            {roots.filter((comment) => comment.id !== focusedRoot?.id).map((comment) => renderThread(comment))}
            {pages.root?.loaded && comments.length === 0 && <ThemedText type="small" themeColor="textSecondary">첫 댓글을 남겨 보세요.</ThemedText>}
            {renderPageAction()}
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
          {replyTo && <View style={styles.replyContext}>
            <ThemedText type="small" themeColor="accent" style={{ flex: 1 }}>{replyTo.nickname}님에게 답글</ThemedText>
            <Pressable onPress={() => setReplyTo(null)} disabled={sending} accessibilityRole="button" accessibilityLabel="답글 취소"
              accessibilityState={{ disabled: sending }} style={styles.commentAction}>
              <ThemedText type="small" themeColor="textSecondary">취소</ThemedText>
            </Pressable>
          </View>}
          {sendError && <ThemedText type="small" themeColor="accent" accessibilityRole="alert" style={{ paddingHorizontal: Spacing.two, paddingBottom: Spacing.two }}>{sendError}</ThemedText>}
          <View style={styles.composerRow}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={(value) => { setDraft(value); setSendError(null); }}
              editable={!sending}
              multiline
              maxLength={1000}
              accessibilityLabel={replyTo ? `${replyTo.nickname}님에게 답글` : '댓글 쓰기'}
              placeholder={replyTo ? '답글을 남겨 주세요' : t.detail.commentPlaceholder}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]}
            />
            <Pressable
              onPress={() => void send()}
              disabled={sendDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: sendDisabled, busy: sending }}
              style={[styles.send, { backgroundColor: theme.accent, opacity: sendDisabled ? 0.55 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                {t.detail.send}
              </ThemedText>
            </Pressable>
          </View>
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
                    <ThemedText type="small" themeColor="textSecondary">{t.chat.requesterRisk}</ThemedText>
                    <Pressable
                      onPress={() => void requestChat(sheetUser)}
                      accessibilityRole="button"
                      disabled={requestingChat}
                      accessibilityState={{ disabled: requestingChat, busy: requestingChat }}
                      style={[styles.sheetCta, { backgroundColor: theme.accent, opacity: requestingChat ? 0.55 : 1 }]}>
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{requestingChat ? t.chat.joinSending : t.profileSheet.chatRequest}</ThemedText>
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
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  scroll: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  comments: {
    gap: Spacing.three,
  },
  loadMore: { minHeight: 44, alignItems: 'center', paddingVertical: Spacing.three },
  focusThread: { gap: Spacing.two },
  focusReply: { padding: Spacing.two, borderRadius: 10 },
  replyToggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginLeft: 54, paddingHorizontal: Spacing.one },
  replies: { marginLeft: Spacing.three, paddingLeft: Spacing.two, borderLeftWidth: 1, gap: Spacing.two },
  comment: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  commentHead: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  commentActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  commentAction: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  commentActionText: { fontSize: 12, lineHeight: 16 },
  mineBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  composerRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  replyContext: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: Spacing.two },
  input: {
    minHeight: 44,
    maxHeight: 120,
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 14,
  },
  send: {
    minHeight: 44,
    justifyContent: 'center',
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
