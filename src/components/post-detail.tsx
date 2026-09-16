import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { buildCommentListRows, type CommentListRow } from '@/lib/comment-list';
import { createThreadComment, loadCommentThreadContext, loadCommentThreadPage, type CommentCursor } from '@/lib/comment-threads';
import { bumpListing, deleteComment, deletePost, editComment, editPost, getCommunityActionError, isContentRejected, recordPostView, setListingStatus, toggleCommentReaction, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';
import { supabase } from '@/lib/supabase';
import type { Post, PostComment } from '@/lib/types';

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
  onPostRemoved?: (postId: string) => void;
};

type PageState = { cursor: CommentCursor | null; loading: boolean; error: boolean; loaded: boolean };

export function PostDetail(props: PostDetailProps) {
  const { isAuthed, me } = useAuth();
  // Drafts, likes and pending requests belong to one post and one account.
  return <PostDetailContent key={`${props.post.id}:${isAuthed ? me.id : 'guest'}`} {...props} />;
}

function PostDetailContent({ post: initialPost, commentId, onClose, onJoin, onCommentCountChange, onViewCountChange, onPostRemoved }: PostDetailProps) {
  const theme = useTheme();
  const [post, setPost] = useState(initialPost);
  const onListingChanged = useCallback((next: Partial<Post>) => setPost((current) => ({ ...current, ...next })), []);
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
  const [editing, setEditing] = useState<PostComment | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  const [sending, setSending] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [reportSelection, setReportSelection] = useState<ReportSelection | null>(null);
  const [commentTotal, setCommentTotal] = useState(post.comments);
  const [viewCount, setViewCount] = useState(post.views);
  const [postDraft, setPostDraft] = useState<{ title: string; body: string } | null>(null);
  const [savingPost, setSavingPost] = useState(false);
  const sendBusy = useRef(false);
  const likeBusy = useRef(false);
  const pageRequests = useRef(new Set<string>());
  const loadedPages = useRef(new Set<string>());
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<FlatList<CommentListRow>>(null);
  const scrolledContext = useRef<string | undefined>(undefined);
  const active = useRef(true);
  const focusedContext = context?.id === commentId ? context : null;
  const focusedRoot = focusedContext?.comments.find((comment) => !comment.parentId);
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

  const startEdit = (comment: PostComment) => { setReplyTo(null); setEditing(comment); setDraft(comment.body); };
  const confirmDelete = (comment: PostComment) => Alert.alert(t.detail.deleteTitle, t.detail.deleteBody, [
    { text: t.write.cancel, style: 'cancel' },
    { text: t.detail.delete, style: 'destructive', onPress: () => void (async () => {
      try {
        await deleteComment(supabase, comment.id);
        if (!active.current) return;
        setComments((current) => current.filter((item) => item.id !== comment.id));
        if (comment.parentId) updateComment(comment.parentId, (parent) => ({ ...parent, replyCount: Math.max(0, (parent.replyCount ?? 0) - 1) }));
        const nextTotal = Math.max(0, commentTotal - 1);
        setCommentTotal(nextTotal); onCommentCountChange?.(nextTotal); play('selection');
      } catch { if (active.current) { play('warning'); Alert.alert(t.detail.deleteErrorTitle, t.detail.sendErrorBody); } }
    })() },
  ]);

  // 본문만 고친다. 정렬 시각에 손이 닿지 않으므로 수정해도 피드에서 끌어올려지지 않는다.
  const savePost = async () => {
    if (!postDraft || savingPost) return;
    const title = postDraft.title.trim();
    const body = postDraft.body.trim();
    if (!title || !body) { play('warning'); return Alert.alert('제목과 내용을 모두 적어주세요.'); }
    setSavingPost(true);
    try {
      await editPost(supabase, post.id, { title, body });
      if (!active.current) return;
      setPost((current) => ({ ...current, title, body }));
      setPostDraft(null); play('selection');
    } catch (error) {
      if (!active.current) return;
      play('warning');
      Alert.alert(isContentRejected(error) ? '커뮤니티 규칙에 맞지 않는 표현이 있어요.' : '글을 수정하지 못했어요.', t.detail.sendErrorBody);
    } finally {
      if (active.current) setSavingPost(false);
    }
  };

  const confirmDeletePost = () => Alert.alert(
    '이 글을 삭제할까요?',
    '삭제한 글은 목록에서 사라지고 되돌릴 수 없어요. 달린 댓글도 함께 보이지 않게 됩니다.',
    [
      { text: t.write.cancel, style: 'cancel' },
      { text: t.detail.delete, style: 'destructive', onPress: () => void (async () => {
        try {
          await deletePost(supabase, post.id);
          play('selection');
          onPostRemoved?.(post.id);
          onClose();
        } catch { play('warning'); Alert.alert('글을 삭제하지 못했어요.', t.detail.sendErrorBody); }
      })() },
    ],
  );

  const send = async () => {
    if (!isAuthed) return promptLogin(t.auth.reasonComment);
    const body = draft.trim();
    if (editing) {
      if (!body || sendBusy.current) return;
      sendBusy.current = true; setSending(true); setSendError(null);
      try {
        await editComment(supabase, editing.id, body);
        if (!active.current) return;
        updateComment(editing.id, (comment) => ({ ...comment, body }));
        setEditing(null); setDraft(''); play('message');
      } catch (error) {
        if (!active.current) return;
        play('warning');
        Alert.alert(isContentRejected(error) ? t.safety.contentBlockedTitle : t.detail.editErrorTitle, isContentRejected(error) ? t.safety.contentBlockedBody : t.detail.sendErrorBody);
      } finally { sendBusy.current = false; if (active.current) setSending(false); }
      return;
    }
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
            {mine && (
              <>
                <Pressable onPress={() => startEdit(c)} disabled={sending} accessibilityRole="button" accessibilityLabel={`내 ${c.parentId ? '답글' : '댓글'} 수정`} accessibilityState={{ disabled: sending }} style={styles.commentAction}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{t.detail.edit}</ThemedText>
                </Pressable>
                <Pressable onPress={() => confirmDelete(c)} disabled={sending} accessibilityRole="button" accessibilityLabel={`내 ${c.parentId ? '답글' : '댓글'} 삭제`} accessibilityState={{ disabled: sending }} style={styles.commentAction}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{t.detail.delete}</ThemedText>
                </Pressable>
              </>
            )}
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
  const sendDisabled = sending || !draft.trim() || (!editing && (!composerPage?.loaded || composerPage.loading));
  const listRows = buildCommentListRows({
    comments,
    expanded,
    focusedCommentId: commentId,
    focusedComments: focusedContext?.comments,
    focusStatus: commentId ? !focusedContext ? 'loading' : focusedContext.error ? 'error' : focusedRoot ? 'ready' : 'hidden' : undefined,
    rootPageLoaded: !!pages.root?.loaded,
  });

  const renderRow = ({ item }: { item: CommentListRow }) => {
    if (item.type === 'label') {
      return <View style={item.label === 'focus-reply' ? [styles.replyRow, styles.focusReplyLabel, { borderLeftColor: theme.accent, backgroundColor: theme.backgroundElement }] : undefined}>
        <ThemedText type="smallBold" themeColor="accent" style={item.label === 'focus-reply' ? styles.commentActionText : undefined}>
          {item.label === 'focus-reply' ? '알림의 답글' : '알림의 댓글'}
        </ThemedText>
      </View>;
    }
    if (item.type === 'comment') {
      const replyStyle = item.depth === 'reply'
        ? [styles.replyRow, !item.sectionStart && styles.replyGap, { borderLeftColor: theme.line }]
        : item.depth === 'focus-reply'
          ? [styles.replyRow, styles.focusReplyComment, { borderLeftColor: theme.accent, backgroundColor: theme.backgroundElement }]
          : item.focusTarget ? styles.focusRoot : item.sectionStart ? styles.threadStart : undefined;
      return <View
        style={replyStyle}
        onLayout={item.focusTarget ? () => {
          if (scrolledContext.current === commentId) return;
          scrolledContext.current = commentId;
          scrollRef.current?.scrollToIndex({ index: 0, animated: false });
        } : undefined}>
        {renderComment(item.comment)}
      </View>;
    }
    if (item.type === 'toggle') {
      const comment = item.comment;
      return <Pressable
        onPress={() => {
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
      </Pressable>;
    }
    if (item.type === 'page') {
      return <View style={item.parentId
        ? [styles.replyRow, !item.sectionStart && styles.replyGap, { borderLeftColor: theme.line }]
        : !item.sectionStart ? styles.rootPage : undefined}>
        {renderPageAction(item.parentId)}
      </View>;
    }
    if (item.type === 'focus-status') {
      return <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.focusStatus}>
        {item.status === 'loading' ? '댓글을 불러오는 중이에요.' : item.status === 'error' ? '댓글을 불러오지 못했어요.' : '이 댓글은 확인할 수 없어요.'}
      </ThemedText>;
    }
    if (item.type === 'focus-retry') {
      return <Pressable onPress={() => setContextRetry((current) => current + 1)} accessibilityRole="button" style={styles.commentAction}>
        <ThemedText type="smallBold" themeColor="accent">다시 시도</ThemedText>
      </Pressable>;
    }
    return <ThemedText type="small" themeColor="textSecondary">첫 댓글을 남겨 보세요.</ThemedText>;
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
        <FlatList
          ref={scrollRef}
          data={listRows}
          keyExtractor={(item) => item.key}
          renderItem={renderRow}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScrollBeginDrag={() => { scrolledContext.current = commentId; }}
          ListHeaderComponent={<View style={styles.listHeader}>
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
            {isAuthed && post.author.id === me.id && postDraft && (
              <View style={[styles.postEdit, { borderColor: theme.line }]}>
                <TextInput value={postDraft.title} onChangeText={(text) => setPostDraft((current) => current && { ...current, title: text })}
                  placeholder="제목" placeholderTextColor={theme.textSecondary} maxLength={100} editable={!savingPost}
                  accessibilityLabel="글 제목 수정"
                  style={[styles.postEditInput, { color: theme.text, borderColor: theme.line }]} />
                <TextInput value={postDraft.body} onChangeText={(text) => setPostDraft((current) => current && { ...current, body: text })}
                  placeholder="내용" placeholderTextColor={theme.textSecondary} maxLength={5000} multiline editable={!savingPost}
                  accessibilityLabel="글 내용 수정"
                  style={[styles.postEditInput, styles.postEditBody, { color: theme.text, borderColor: theme.line }]} />
                <View style={styles.postActions}>
                  <Pressable onPress={() => setPostDraft(null)} disabled={savingPost} accessibilityRole="button"
                    accessibilityState={{ disabled: savingPost }} style={styles.postAction}>
                    <ThemedText type="smallBold" themeColor="textSecondary">{t.write.cancel}</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => void savePost()} disabled={savingPost} accessibilityRole="button"
                    accessibilityState={{ disabled: savingPost, busy: savingPost }} style={styles.postAction}>
                    <ThemedText type="smallBold" themeColor="accent">{savingPost ? '저장 중' : '저장'}</ThemedText>
                  </Pressable>
                </View>
              </View>
            )}
            {isAuthed && post.author.id === me.id && !postDraft && (
              <View style={styles.postActions}>
                <Pressable onPress={() => setPostDraft({ title: post.title, body: post.body })} accessibilityRole="button"
                  accessibilityLabel="내 글 수정" style={styles.postAction}>
                  <ThemedText type="smallBold">수정</ThemedText>
                </Pressable>
                <Pressable onPress={confirmDeletePost} accessibilityRole="button"
                  accessibilityLabel="내 글 삭제" style={styles.postAction}>
                  <ThemedText type="smallBold" themeColor="accent">{t.detail.delete}</ThemedText>
                </Pressable>
              </View>
            )}
            {isAuthed && post.author.id === me.id && post.kind === 'listing' && <ListingControls post={post} onChanged={onListingChanged} />}
            {PROMOTIONS_PREVIEW_ENABLED && isAuthed && post.author.id === me.id && <Pressable
              accessibilityRole="button"
              onPress={() => { onClose(); router.push({ pathname: '/profile/promotions', params: { postId: post.id } }); }}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }}>
              <ThemedText type="smallBold" themeColor="accent">이 글 끌어올리기</ThemedText>
            </Pressable>}
          </View>}
        />

        <View
          style={[
            styles.composer,
            {
              borderTopColor: theme.line,
              backgroundColor: theme.card,
              paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one,
            },
          ]}>
          {editing && <View style={styles.replyContext}>
            <ThemedText type="small" themeColor="accent" style={{ flex: 1 }}>{t.detail.editing}</ThemedText>
            <Pressable onPress={() => { setEditing(null); setDraft(''); }} disabled={sending} accessibilityRole="button" accessibilityLabel="수정 취소"
              accessibilityState={{ disabled: sending }} style={styles.commentAction}>
              <ThemedText type="small" themeColor="textSecondary">취소</ThemedText>
            </Pressable>
          </View>}
          {replyTo && !editing && <View style={styles.replyContext}>
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

      <UserSheet user={sheetUser} onClose={() => setSheetUser(null)} onBeforeNavigate={onClose} />
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
  },
  listHeader: { gap: Spacing.three, marginBottom: Spacing.three },
  listingBar: { marginHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  listingState: { paddingTop: Spacing.one },
  listingActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three },
  listingAction: { minHeight: 44, justifyContent: 'center' },
  loadMore: { minHeight: 44, alignItems: 'center', paddingVertical: Spacing.three },
  focusStatus: { marginTop: Spacing.two },
  focusRoot: { marginTop: Spacing.two },
  threadStart: { marginTop: Spacing.three },
  rootPage: { marginTop: Spacing.three },
  replyToggle: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginLeft: 54, paddingHorizontal: Spacing.one },
  replyRow: { marginLeft: Spacing.three, paddingLeft: Spacing.two, borderLeftWidth: 1 },
  replyGap: { paddingTop: Spacing.two },
  focusReplyLabel: { paddingTop: Spacing.two, paddingRight: Spacing.two, borderTopRightRadius: 10 },
  focusReplyComment: { paddingRight: Spacing.two, paddingBottom: Spacing.two, borderBottomRightRadius: 10 },
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
  postActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three },
  postAction: { minHeight: 44, justifyContent: 'center' },
  postEdit: { gap: Spacing.two, marginHorizontal: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: 10 },
  postEditInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, minHeight: 44 },
  postEditBody: { minHeight: 120, textAlignVertical: 'top' },
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
});


// ponytail: 작성자 전용 리스팅 액션. 쿨다운·한도 판정은 서버가 하고 여기선 결과만 반영한다.
// 저널 톤: 채운 버튼 대신 얇은 선 위의 텍스트 액션, 인주는 첫 번째 액션에만.
function ListingControls({ post, onChanged }: { post: Post; onChanged: (next: Partial<Post>) => void }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [busy, setBusy] = useState(false);
  // Date.now() in render is impure for the React compiler; sample it once per mount.
  const [now] = useState(() => Date.now());
  const alive = (post.listingStatus ?? 'open') !== 'closed' && (!post.expiresAt || new Date(post.expiresAt).getTime() > now);
  const daysLeft = post.expiresAt ? Math.round((new Date(post.expiresAt).getTime() - now) / 86_400_000) : null;
  const run = async (action: () => Promise<Partial<Post>>, successLabel?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onChanged(await action());
      play('success');
      if (successLabel) Alert.alert(successLabel);
    } catch (error) {
      play('warning');
      const code = getCommunityActionError(error);
      const copy = code ? t.actionErrors[code as keyof typeof t.actionErrors] : null;
      Alert.alert(copy?.title ?? t.write.submitErrorTitle, copy?.body ?? t.write.submitErrorBody);
    } finally {
      setBusy(false);
    }
  };
  const action = (label: string, onPress: () => void, primary = false) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} disabled={busy} accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [styles.listingAction, (pressed || busy) && { opacity: 0.6 }]}>
      <ThemedText type="smallBold" themeColor={primary ? 'accent' : 'textSecondary'}>{label}</ThemedText>
    </Pressable>
  );
  return (
    <View style={[styles.listingBar, { borderTopColor: theme.line, borderBottomColor: theme.line }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.listingState}>
        {t.detail.listingStatus[post.listingStatus ?? 'open']}{alive && daysLeft != null ? ` · ${t.detail.expiresIn(daysLeft)}` : ''}
      </ThemedText>
      <View style={styles.listingActions}>
      {alive && action(t.detail.bump, () => void run(async () => {
        const result = await bumpListing(supabase, post.id);
        return { bumpedAt: result.bumpedAt, expiresAt: result.expiresAt, sortAt: result.bumpedAt };
      }, t.detail.bumped), true)}
      {alive && post.listingStatus !== 'partial' && action(t.detail.markPartial, () => void run(async () => ({ listingStatus: (await setListingStatus(supabase, post.id, 'partial')).status })))}
      {alive && action(t.detail.markClosed, () => void run(async () => ({ listingStatus: (await setListingStatus(supabase, post.id, 'closed')).status })))}
      {!alive && action(t.detail.reopen, () => void run(async () => {
        const result = await setListingStatus(supabase, post.id, 'open');
        return { listingStatus: result.status, expiresAt: result.expiresAt, bumpedAt: null };
      }), true)}
      </View>
    </View>
  );
}
