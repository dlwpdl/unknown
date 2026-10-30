import { useLanguage } from '@/hooks/use-language';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StyleSheet,
  UIManager,
  TextInput,
  View,
  type FlatList as NativeFlatList,
  type TextInputInstance,
} from 'react-native';
import { requestPushPrompt } from '@/lib/push-prompt';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TicketmasterSourceLink } from '@/components/ticketmaster-source-link';
import { MerchantSourceLink } from '@/components/merchant-source-link';
import { MerchantReviews } from '@/components/merchant-reviews';
import { MeetupReviews } from '@/components/meetup-reviews';
import { PostPoll } from '@/components/post-poll';
import { MeetupRsvp } from '@/components/meetup-rsvp';
import { PostCard, PostReactionToggle } from '@/components/post-card';
import { TranslatedCommentBody } from '@/components/content-translation';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { PostShareSheet } from '@/components/post-share-sheet';
import { PostBodyEditor } from '@/components/post-body-editor';
import { PostPhotoGallery } from '@/components/post-photo-gallery';
import { PostPhotoEditor, type EditablePostImage } from '@/components/post-photo-editor';
import { PostPhotoCredits } from '@/components/post-photo-credits';
import { MeetupActionBar, MeetupChips, MeetupNotes, MeetupSummary, useMeetupParticipation } from '@/components/chilling-host-profile';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StateCard } from '@/components/state-card';
import { TrustBadge } from '@/components/trust-badge';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { count } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { buildCommentListRows, type CommentListRow } from '@/lib/comment-list';
import { createThreadComment, loadCommentThreadContext, loadCommentThreadPage, type CommentCursor } from '@/lib/comment-threads';
import { bumpListing, deleteComment, deletePost, editComment, editPost, getCommunityActionError, isContentRejected, recordPostShare, recordPostView, setListingStatus, toggleCommentReaction, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicPost } from '@/lib/feed-data';
import { MAX_POST_IMAGES } from '@/lib/image-upload';
import { CITIES } from '@/lib/mock';
import { postMapBody, postPublicAddress } from '@/lib/post-maps';
import { stripListingLead } from '@/lib/listing-details';
import { ListingInfo, type DetailedPost } from '@/components/listing-card';
import { splitPostPhotoCredits } from '@/lib/post-photo-credits';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { splitEventMeetupBody, visibleMeetupBody } from '@/lib/meetup-ai';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { placeMapRoute } from '@/lib/discovery';
import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';
import { supabase } from '@/lib/supabase';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import type { Post, PostComment } from '@/lib/types';
import { ticketmasterReference } from '../../supabase/functions/_shared/ticketmaster';

type ReportSelection = {
  targetType: ReportTarget;
  targetId: string;
  reportedUserId?: string;
  reportedBusinessId?: string;
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
  onPostChanged?: (post: Post) => void;
  management?: { edit: (postId: string, patch: { title: string; body: string }, replacement?: Parameters<typeof editPost>[3]) => Promise<void>; remove: (postId: string) => Promise<void> };
};

type PageState = { cursor: CommentCursor | null; loading: boolean; error: boolean; loaded: boolean };

export function PostDetail(props: PostDetailProps) {
  const { tr } = useLanguage();
  const { isAuthed, me, promptLogin } = useAuth(), { play } = useInteractionFeedback();
  if (!isAuthed) return <ThemedView style={{ flex: 1, padding: 16, gap: 16 }}>
    <Pressable analyticsId="post.login-gate.close" accessibilityRole="button" accessibilityLabel={tr("글 닫기")} onPress={() => { play('selection'); props.onClose(); }} style={{ minHeight: 44, justifyContent: 'center' }}><ThemedText>{tr("돌아가기")}</ThemedText></Pressable>
    <StateCard kind="blocked" title={props.post.title} body={tr("전체 내용과 댓글은 로그인 후 확인할 수 있어요.")} actionLabel={tr("Google·소셜 로그인")}
      onAction={() => promptLogin('로그인하고 이 글을 확인해요.')} />
  </ThemedView>;
  // Drafts, likes and pending requests belong to one post and one account.
  return <PostDetailContent key={`${props.post.id}:${isAuthed ? me.id : 'guest'}`} {...props} />;
}

function PostDetailContent({ post: initialPost, commentId, onClose, onJoin, onCommentCountChange, onViewCountChange, onPostRemoved, onPostChanged, management }: PostDetailProps) {
  const { tr, t, language } = useLanguage();
  const business = useChatIdentity();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const [post, setPost] = useState(initialPost);
  const photoCredits = splitPostPhotoCredits(post.body);
  const linkedPlace = post.room ? splitPlaceMeetupBody(post.body, post.cityId) : null;
  const linkedEventDetails = post.room && ticketmasterReference(post.body) ? splitEventMeetupBody(post.body).details : linkedPlace?.details ?? '';
  const placeSourceLabel = linkedPlace ? `${linkedPlace.place.name} · ${tr(CITIES.find(city => city.id === post.cityId)?.name ?? '')} · ${language === 'en' ? 'View map' : '지도 보기'}` : '';
  const onListingChanged = useCallback((next: Partial<Post>) => setPost((current) => ({ ...current, ...next })), []);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAuthed, me, promptLogin, isVerified, trustLevel } = useAuth();
  const canManagePost = isAuthed && (post.author.id === me.id || !!management);
  const { play } = useInteractionFeedback();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [visibleCommentIds, setVisibleCommentIds] = useState<Set<string>>(new Set());
  const trackTranslationComments = useCallback(({ viewableItems }: { viewableItems: { item: CommentListRow }[] }) =>
    setVisibleCommentIds(new Set(viewableItems.flatMap(({ item }) => item.type === 'comment' ? [item.comment.id] : []))), []);
  const [pages, setPages] = useState<Record<string, PageState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [context, setContext] = useState<{ id: string; comments: PostComment[]; error: boolean } | null>(null);
  const [contextRetry, setContextRetry] = useState(0);
  const [draft, setDraft] = useState('');
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [editing, setEditing] = useState<PostComment | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sheetUser, setSheetUser] = useState<SheetUser | null>(null);
  const [sending, setSending] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [reportSelection, setReportSelection] = useState<ReportSelection | null>(null);
  const [commentTotal, setCommentTotal] = useState(post.comments);
  const [viewCount, setViewCount] = useState(post.views);
  const [postDraft, setPostDraft] = useState<{ title: string; body: string } | null>(null);
  const [postImages, setPostImages] = useState<EditablePostImage[] | null>(null);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deletePostOpen, setDeletePostOpen] = useState(false);
  const [pickingPostImages, setPickingPostImages] = useState(false);
  const [savingPost, setSavingPost] = useState(false);
  // Meetups swap the action bar for the composer only while asking, replying or editing.
  const [composing, setComposing] = useState(false);
  const meetupStatus = useMeetupParticipation(post);
  const postEditBusy = useRef(false);
  const sendBusy = useRef(false);
  const likeBusy = useRef(false);
  const pageRequests = useRef(new Set<string>());
  const loadedPages = useRef(new Set<string>());
  const inputRef = useRef<TextInputInstance>(null);
  const scrollRef = useRef<NativeFlatList<CommentListRow>>(null);
  const createdCommentToReveal = useRef<string | null>(null);
  const listHeaderHeight = useRef(0);
  const scrolledContext = useRef<string | undefined>(undefined);
  const active = useRef(true);
  const visibleComments = (items: PostComment[]) => items.filter((item) =>
    !hidden('comment', item.id, item.authorId)
    && !items.some((ancestor) => (ancestor.id === item.parentId || ancestor.id === item.replyToId)
      && hidden('comment', ancestor.id, ancestor.authorId)));
  const focusedContext = context && context.id === commentId ? { ...context, comments: visibleComments(context.comments) } : null;
  const postHidden = hidden('post', post.id, post.author.id);
  useEffect(() => { if (postHidden) onClose(); }, [postHidden, onClose]);
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
        setCommentTotal(nextTotal); onCommentCountChange?.(nextTotal); play('warning');
      } catch { if (active.current) { play('warning'); Alert.alert(t.detail.deleteErrorTitle, t.detail.sendErrorBody); } }
    })() },
  ]);

  const startEditPost = () => {
    if ((post.imagePaths?.length ?? 0) !== (post.imageUris?.filter(Boolean).length ?? 0)) {
      play('warning'); Alert.alert(tr("사진을 다시 불러와 주세요."), tr("사진을 모두 불러오지 못했어요. 글을 다시 연 뒤 수정해 주세요.")); return;
    }
    setPostMenuOpen(false);
    setPostImages((post.imagePaths ?? []).map((path, index) => ({ path, uri: post.imageUris![index] })));
    setPostDraft({ title: post.title, body: post.room ? visibleMeetupBody(post.body) : post.body });
    scrollRef.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const pickPostImages = async (replace = false) => {
    if (!postDraft || postEditBusy.current) return;
    const remaining = replace ? MAX_POST_IMAGES : MAX_POST_IMAGES - (postImages?.length ?? 0);
    if (remaining <= 0) return;
    postEditBusy.current = true;
    setPickingPostImages(true); play('selection');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true,
        orderedSelection: true, selectionLimit: remaining,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (!assets.length || assets.length > remaining) throw new Error('INVALID_IMAGE_COUNT');
      if (assets.some((asset) => !asset.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg'))) {
        if (active.current) { play('warning'); Alert.alert(t.write.photoErrorTitle, t.write.photoUnsupported); }
        return;
      }
      const prepared: PreparedImage[] = [];
      for (const asset of assets) prepared.push(await preparePostImage(asset, { withThumb: true }));
      if (active.current) setPostImages(current => replace ? prepared : [...(current ?? []), ...prepared]);
    } catch (error) {
      if (active.current) {
        play('warning');
        Alert.alert(t.write.photoErrorTitle, error instanceof Error && error.message === 'IMAGE_TOO_LARGE' ? t.write.photoTooLarge : t.write.photoErrorBody);
      }
    } finally {
      postEditBusy.current = false;
      if (active.current) setPickingPostImages(false);
    }
  };

  // 정렬 시각에 손이 닿지 않으므로 수정해도 피드에서 끌어올려지지 않는다.
  const savePost = async () => {
    if (!postDraft || postEditBusy.current) return;
    const title = postDraft.title.trim();
    const body = postDraft.body.trim() + linkedEventDetails;
    if (!title || !body) { play('warning'); return Alert.alert(tr("제목과 내용을 모두 적어주세요.")); }
    postEditBusy.current = true;
    setSavingPost(true);
    try {
      const replacement = postImages ? { userId: me.id, images: postImages } : undefined;
      if (management) await management.edit(post.id, { title, body }, replacement);
      else await editPost(supabase, post.id, { title, body }, replacement);
      if (!active.current) return;
      setPost((current) => ({ ...current, title, body }));
      setPostDraft(null); setPostImages(null); play('selection');
      try {
        const saved = await loadPublicPost(supabase, post.id);
        if (!saved) throw new Error('POST_READBACK_UNAVAILABLE');
        if (active.current) { setPost(saved); onPostChanged?.(saved); }
      } catch {
        if (active.current) {
          play('warning');
          Alert.alert(tr("글은 저장됐어요."), tr("화면을 새로 불러오지 못했어요. 글을 다시 열어 저장된 내용을 확인해 주세요."));
        }
      }
    } catch (error) {
      if (!active.current) return;
      play('warning');
      Alert.alert(isContentRejected(error) ? tr("커뮤니티 규칙에 맞지 않는 표현이 있어요.") : tr("글을 수정하지 못했어요."), t.detail.sendErrorBody);
    } finally {
      postEditBusy.current = false;
      if (active.current) setSavingPost(false);
    }
  };

  const confirmDeletePost = async () => {
        if (postEditBusy.current) return;
        postEditBusy.current = true; setSavingPost(true);
        try {
          if (management) await management.remove(post.id);
          else await deletePost(supabase, post.id);
          play('warning');
          onPostRemoved?.(post.id);
          onClose();
        } catch { play('warning'); Alert.alert(tr("글을 삭제하지 못했어요."), t.detail.sendErrorBody); }
        finally { postEditBusy.current = false; if (active.current) { setSavingPost(false); setDeletePostOpen(false); } }
  };

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
        setEditing(null); setDraft(''); setComposing(false); play('message');
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
      const id = await createThreadComment(supabase, post.id, body, replyTo?.id, business?.id);
      if (!active.current) return;
      createdCommentToReveal.current = id;
      requestPushPrompt('comment');
      const nextTotal = commentTotal + 1;
      setComments((current) => [{
        id, authorId: business?.id ?? me.id, nickname: business?.name ?? me.nickname, body, likes: 0, likedByMe: false, business: business ?? undefined,
        verified: !business && isVerified, trustLevel: !business && trustLevel === 3 ? 3 : undefined,
        parentId: parentId ?? undefined, replyToId: replyTo?.id, replyToNickname: replyTo?.nickname, replyCount: 0,
      }, ...current]);
      if (parentId) {
        setExpanded(current => new Set(current).add(parentId));
        updateComment(parentId, (comment) => ({ ...comment, replyCount: (comment.replyCount ?? 0) + 1 }));
      }
      setCommentTotal(nextTotal);
      onCommentCountChange?.(nextTotal);
      setDraft('');
      setReplyTo(null);
      setComposing(false);
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
      {page.error && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{tr(parentId ? '답글을 불러오지 못했어요.' : '댓글을 불러오지 못했어요.')}</ThemedText>}
      <Pressable analyticsId="components_post-detail.pressable.1" onPress={() => { play('selection'); void loadPage(parentId, page.cursor); }} accessibilityRole="button" style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}>
        <ThemedText type="smallBold" themeColor="accent">{tr(page.error ? tr("다시 시도") : parentId ? tr("답글 더 보기") : t.detail.loadMoreComments)}</ThemedText>
      </Pressable>
    </View>;
  };

  const renderComment = (c: PostComment) => {
    // A business comment is editable while acting as that business; RLS still checks the real author.
    const mine = isAuthed && (c.business ? c.business.id === business?.id : c.authorId === me.id);
    const openAuthor = () => {
      play('selection');
      if (c.business) { onClose(); router.push({ pathname: '/company/[id]', params: { id: c.business.id } }); return; }
      setSheetUser({ id: c.authorId, nickname: c.nickname, verified: c.verified, trustLevel: c.trustLevel, mine });
    };
    return (
      <View
        key={c.id}
        style={styles.comment}>
        <Pressable analyticsId="components_post-detail.pressable.2"
          onPress={openAuthor}
          accessibilityRole="button"
          accessibilityLabel={tr("{0} 프로필 보기", (c.nickname))}
          style={({ pressed }) => [styles.avatar, { backgroundColor: mine ? theme.accent : theme.backgroundElement }, pressed && styles.pressed]}>
          <ThemedText
            type="smallBold"
            style={{ fontSize: 12, color: mine ? theme.accentInk : theme.navy }}>
            {c.nickname[0]}
          </ThemedText>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Pressable analyticsId="components_post-detail.pressable.3"
            onPress={openAuthor}
            accessibilityRole="button"
            accessibilityLabel={tr("{0} 프로필 보기", (c.nickname))}
            style={({ pressed }) => [styles.commentHead, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={{ fontSize: 13 }}>
              {c.nickname}
            </ThemedText>
            <TrustBadge verified={c.verified} trustLevel={c.trustLevel} />
            {c.business && (
              <View style={[styles.mineBadge, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={{ fontSize: 10, lineHeight: 13 }}>{tr('비즈니스')}</ThemedText>
              </View>
            )}
            {mine && (
              <View style={[styles.mineBadge, { backgroundColor: theme.accent }]}>
                <ThemedText type="smallBold" style={{ fontSize: 10, lineHeight: 13, color: theme.accentInk }}>
                  {t.feed.mineBadge}
                </ThemedText>
              </View>
            )}
          </Pressable>
          {c.replyToNickname && <ThemedText type="small" themeColor="accent" style={styles.commentActionText}>{tr('{0}님에게 답글', c.replyToNickname)}</ThemedText>}
          <TranslatedCommentBody id={c.id} body={c.body} visible={visibleCommentIds.has(c.id)} />
          <View style={styles.commentActions}>
            <Pressable analyticsId="components_post-detail.pressable.4"
              onPress={() => void toggleCommentLike(c.id)}
              disabled={!!busyCommentId}
              style={styles.commentAction}
              accessibilityRole="button"
              aria-pressed={Platform.OS === 'web' ? !!c.likedByMe : undefined}
              aria-busy={busyCommentId === c.id}
              accessibilityLabel={tr("{0}의 {1} 공감 {2}개", (c.nickname), (c.parentId ? tr('답글') : tr('댓글')), (c.likes ?? 0))}
              accessibilityState={{ selected: !!c.likedByMe, disabled: !!busyCommentId, busy: busyCommentId === c.id }}>
              <ThemedText
                type={c.likedByMe ? 'smallBold' : 'small'}
                style={{ fontSize: 12, lineHeight: 16, color: c.likedByMe ? theme.accent : theme.textSecondary }}>
                {t.feed.likes(c.likes ?? 0)}{c.likedByMe ? ' ♥' : ''}
              </ThemedText>
            </Pressable>
            <Pressable analyticsId="components_post-detail.pressable.5" onPress={() => { play('selection'); chooseReply(c); }} disabled={sending} accessibilityRole="button"
              accessibilityLabel={tr("{0}님에게 답글 쓰기", (c.nickname))} accessibilityState={{ disabled: sending }} style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{tr("답글")}</ThemedText>
            </Pressable>
            {mine && (
              <>
                <Pressable analyticsId="components_post-detail.pressable.6" onPress={() => { play('selection'); startEdit(c); }} disabled={sending} accessibilityRole="button" accessibilityLabel={tr("내 {0} 수정", (c.parentId ? tr('답글') : tr('댓글')))} accessibilityState={{ disabled: sending }} style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{t.detail.edit}</ThemedText>
                </Pressable>
                <Pressable analyticsId="components_post-detail.pressable.7" onPress={() => { play('selection'); confirmDelete(c); }} disabled={sending} accessibilityRole="button" accessibilityLabel={tr("내 {0} 삭제", (c.parentId ? tr('답글') : tr('댓글')))} accessibilityState={{ disabled: sending }} style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.commentActionText}>{t.detail.delete}</ThemedText>
                </Pressable>
              </>
            )}
            {!mine && c.authorId && (
              <Pressable analyticsId="components_post-detail.pressable.8"
                onPress={() => { play('selection'); setReportSelection({ targetType: 'comment', targetId: c.id, ...(c.business ? { reportedBusinessId: c.business.id } : { reportedUserId: c.authorId! }), reportedNickname: c.nickname }); }}
                accessibilityRole="button" accessibilityLabel={tr("{0}의 {1} 신고", (c.nickname), (c.parentId ? tr('답글') : tr('댓글')))} style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
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
    comments: visibleComments(comments),
    expanded,
    focusedCommentId: commentId,
    focusedComments: focusedContext?.comments,
    focusStatus: commentId ? !focusedContext ? 'loading' : focusedContext.error ? 'error' : focusedRoot ? 'ready' : 'hidden' : undefined,
    rootPageLoaded: !!pages.root?.loaded,
  });

  const revealCreatedComment = () => {
    const index = listRows.findIndex(row => row.type === 'comment' && row.comment.id === createdCommentToReveal.current);
    if (index >= 0) scrollRef.current?.scrollToIndex({ index, viewPosition: 1, animated: true });
  };

  const renderRow = ({ item }: { item: CommentListRow }) => {
    if (item.type === 'label') {
      return <View style={item.label === 'focus-reply' ? [styles.replyRow, styles.focusReplyLabel, { borderLeftColor: theme.accent, backgroundColor: theme.backgroundElement }] : undefined}>
        <ThemedText type="smallBold" themeColor="accent" style={item.label === 'focus-reply' ? styles.commentActionText : undefined}>
          {tr(item.label === 'focus-reply' ? tr("알림의 답글") : tr("알림의 댓글"))}
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
        onLayout={createdCommentToReveal.current === item.comment.id ? () => {
          requestAnimationFrame(() => {
            if (!active.current || createdCommentToReveal.current !== item.comment.id) return;
            revealCreatedComment();
            createdCommentToReveal.current = null;
          });
        } : item.focusTarget ? () => {
          if (scrolledContext.current === commentId) return;
          scrolledContext.current = commentId;
          scrollRef.current?.scrollToIndex({ index: 0, animated: false });
        } : undefined}>
        {renderComment(item.comment)}
      </View>;
    }
    if (item.type === 'toggle') {
      const comment = item.comment;
      return <Pressable analyticsId="components_post-detail.pressable.9"
        onPress={() => {
          play('selection');
          toggleReplies(comment.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={tr(expanded.has(comment.id) ? '{0}의 댓글 답글 {1}개 접기' : '{0}의 댓글 답글 {1}개 보기', comment.nickname, count(comment.replyCount ?? 0))}
        accessibilityState={{ expanded: expanded.has(comment.id) }}
        aria-expanded={expanded.has(comment.id)}
        style={({ pressed }) => [styles.replyToggle, pressed && styles.pressed]}>
        <ThemedText type="smallBold" themeColor="accent" style={styles.commentActionText}>
          {tr(expanded.has(comment.id) ? tr("답글 접기") : tr("답글 {0}개 보기", (count(comment.replyCount ?? 0))))}
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
        {tr(item.status === 'loading' ? tr("댓글을 불러오는 중이에요.") : item.status === 'error' ? tr("댓글을 불러오지 못했어요.") : tr("이 댓글은 확인할 수 없어요."))}
      </ThemedText>;
    }
    if (item.type === 'focus-retry') {
      return <Pressable analyticsId="components_post-detail.pressable.10" onPress={() => { play('selection'); setContextRetry((current) => current + 1); }} accessibilityRole="button" style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
        <ThemedText type="smallBold" themeColor="accent">{tr("다시 시도")}</ThemedText>
      </Pressable>;
    }
    return <ThemedText type="small" themeColor="textSecondary">{tr("첫 댓글을 남겨 보세요.")}</ThemedText>;
  };

  if (postHidden) return null;
  return (
    <ThemedView style={{ flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' }}
      onLayout={event => {
        if (Platform.OS === 'ios') {
          const target = event.currentTarget;
          if (typeof target === 'number') UIManager.measureInWindow(target, (_x, y) => setKeyboardOffset(y));
          else target.measureInWindow((_x, y) => setKeyboardOffset(y));
        }
      }}>
      <Modal visible={postMenuOpen || deletePostOpen} transparent animationType="fade" onRequestClose={() => { if (!savingPost) { play('selection'); setPostMenuOpen(false); setDeletePostOpen(false); } }}>
        <View style={styles.menuOverlay}>
          <Pressable analyticsId="post.manage.dismiss" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}
            onPress={() => { if (!savingPost) { play('selection'); setPostMenuOpen(false); setDeletePostOpen(false); } }} />
          <View accessibilityViewIsModal style={[styles.menuSheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <ThemedText type="smallBold" accessibilityRole="header" style={styles.menuTitle}>{tr(deletePostOpen ? tr("이 글을 삭제할까요?") : management ? tr("비즈니스 글 관리") : tr("내 글 관리"))}</ThemedText>
            {deletePostOpen ? <>
              <ThemedText themeColor="textSecondary" style={styles.menuTitle}>{tr("삭제한 글은 되돌릴 수 없어요. 달린 댓글도 함께 보이지 않게 됩니다.")}</ThemedText>
              <Pressable analyticsId="components_post-detail.pressable.15" accessibilityRole="button" accessibilityLabel={tr(management ? tr("비즈니스 글 삭제 확인") : tr("내 글 삭제 확인"))} disabled={savingPost}
                onPress={() => { play('warning'); void confirmDeletePost(); }} style={styles.menuRow}>
                <ThemedText themeColor="danger">{tr(savingPost ? tr("삭제 중…") : tr("글 삭제"))}</ThemedText>
              </Pressable>
            </> : <>
              {post.kind !== 'listing' && post.tag.kind === 'post' && !post.room && <ListingControls post={post} onChanged={onListingChanged} closeMenu={() => setPostMenuOpen(false)} />}
              {PROMOTIONS_PREVIEW_ENABLED && Platform.OS !== 'web' && isAuthed && post.author.id === me.id && <Pressable analyticsId="components_post-detail.pressable.16" accessibilityRole="button"
                onPress={() => { play('selection'); setPostMenuOpen(false); onClose(); router.push({ pathname: '/profile/promotions', params: { postId: post.id } }); }} style={styles.menuRow}>
                <SymbolView name={{ ios: 'arrow.up.circle', android: 'arrow_circle_up', web: 'arrow_circle_up' }} size={20} tintColor={theme.text} />
                <ThemedText>{tr("이 글 끌어올리기")}</ThemedText>
              </Pressable>}
              <Pressable analyticsId="components_post-detail.pressable.14" accessibilityRole="button" accessibilityLabel={tr(management ? tr("비즈니스 글 수정") : tr("내 글 수정"))} onPress={() => { play('selection'); startEditPost(); }} style={styles.menuRow}>
                <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={20} tintColor={theme.text} />
                <ThemedText>{tr("글·사진 수정")}</ThemedText>
              </Pressable>
              <Pressable analyticsId="post.manage.delete" accessibilityRole="button" accessibilityLabel={tr(management ? tr("비즈니스 글 삭제") : tr("내 글 삭제"))} onPress={() => { play('warning'); setPostMenuOpen(false); setDeletePostOpen(true); }} style={styles.menuRow}>
                <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={20} tintColor={theme.danger} />
                <ThemedText themeColor="danger">{tr("글 삭제")}</ThemedText>
              </Pressable>
            </>}
            <Pressable analyticsId="post.manage.cancel" accessibilityRole="button" disabled={savingPost} onPress={() => { play('selection'); setPostMenuOpen(false); setDeletePostOpen(false); }} style={[styles.menuRow, { justifyContent: 'center', borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <ThemedText themeColor="textSecondary">{tr("취소")}</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
      <View style={[styles.head, { backgroundColor: theme.background }]}>
        <Pressable analyticsId="components_post-detail.pressable.11" onPress={() => { play('selection'); onClose(); }} accessibilityRole="button" accessibilityLabel={t.detail.close} style={({ pressed }) => [styles.closeBtn, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={22} tintColor={theme.text} />
        </Pressable>
        {!commentId && !postDraft
          ? <View accessible accessibilityRole="header" accessibilityLabel={tr(post.room ? "모임 상세" : "글 상세")} style={styles.headSpacer} />
          : <ThemedText accessibilityRole="header" style={styles.headTitle}>{tr(postDraft ? tr("글 수정") : commentId ? t.detail.commentsTitle(commentTotal) : tr("글 상세"))}</ThemedText>}
        {post.room && !postDraft && <PostReactionToggle post={post} kind="save" />}
        {!postDraft && <Pressable analyticsId="post.detail.share" accessibilityRole="button" accessibilityLabel={tr(post.room ? tr("모임 초대 링크 공유") : tr("게시물 링크 공유"))}
          onPress={() => { play('selection'); setShareOpen(true); }} style={({ pressed }) => [styles.shareBtn, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <SymbolView name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }} size={20} tintColor={theme.accent} />
          <ThemedText type="smallBold" themeColor="accent">{tr(post.room ? tr("초대") : tr("공유"))}</ThemedText>
        </Pressable>}
        <Pressable analyticsId="post.manage.open" accessibilityRole="button" accessibilityLabel={tr("글 관리 메뉴")} disabled={!canManagePost || savingPost || pickingPostImages || !!postDraft}
          style={({ pressed }) => [styles.closeBtn, { opacity: canManagePost ? 1 : 0, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}
          accessibilityElementsHidden={!canManagePost}
          importantForAccessibility={!canManagePost ? 'no-hide-descendants' : 'auto'}
          onPress={() => { if (canManagePost) { play('selection'); setPostMenuOpen(true); } }}>
          <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={22} tintColor={theme.text} />
        </Pressable>
      </View>
      {shareOpen && <PostShareSheet post={post} visible onClose={() => setShareOpen(false)}
        onShared={() => { void recordPostShare(supabase, post.id).catch(() => {}); }} />}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
        <FlatList analyticsId="components_post-detail.flatlist.1"
          ref={scrollRef}
          data={postDraft ? [] : listRows}
          onViewableItemsChanged={trackTranslationComments}
          viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY}
          keyExtractor={(item) => item.key}
          renderItem={renderRow}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={revealCreatedComment}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            scrollRef.current?.scrollToOffset({ offset: listHeaderHeight.current + index * averageItemLength, animated: false });
          }}
          onScrollBeginDrag={() => { scrolledContext.current = commentId; createdCommentToReveal.current = null; }}
          ListHeaderComponent={<View style={styles.listHeader} onLayout={event => { listHeaderHeight.current = event.nativeEvent.layout.height; }}>
            {canManagePost && postDraft && (
              <View style={[styles.postEdit, { borderColor: theme.line }]}>
                <TextInput value={postDraft.title} onChangeText={(text) => setPostDraft((current) => current && { ...current, title: text })}
                  placeholder={tr("제목")} placeholderTextColor={theme.textSecondary} maxLength={100} editable={!savingPost}
                  accessibilityLabel={tr("글 제목 수정")}
                  style={[styles.postEditInput, { color: theme.text, borderColor: theme.line }]} />
                <PostBodyEditor value={postDraft.body} cityName={CITIES.find(city => city.id === post.cityId)?.englishName} allowLocation={!post.room} onChangeText={(text) => setPostDraft((current) => current && { ...current, body: text })}
                  placeholder={tr("내용")} placeholderTextColor={theme.textSecondary} maxLength={Math.max(1000 - linkedEventDetails.length, [...(post.body ?? '')].length)} multiline editable={!savingPost}
                  accessibilityLabel={tr("글 내용 수정")}
                  style={[styles.postEditInput, styles.postEditBody, { color: theme.text, borderColor: theme.line }]} />
                <ThemedText type="smallBold">{tr('사진 {0}/{1}', postImages?.length ?? 0, MAX_POST_IMAGES)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{tr("첫 사진이 표지예요. 앞·뒤 버튼으로 순서를 바꿀 수 있어요.")}</ThemedText>
                <PostPhotoEditor images={postImages ?? []} disabled={savingPost || pickingPostImages} onChange={setPostImages} />
                <View style={styles.postActions}>
                  <Pressable analyticsId="components_post-detail.replace-photos" onPress={() => void pickPostImages()} disabled={savingPost || pickingPostImages || (postImages?.length ?? 0) >= MAX_POST_IMAGES} accessibilityRole="button"
                    accessibilityLabel={tr("사진 추가, 최대 {0}장", (MAX_POST_IMAGES))} style={[styles.postAction, { borderColor: theme.line, borderWidth: 1 }]}>
                    <ThemedText type="smallBold" themeColor="accent">{tr(pickingPostImages ? tr("사진 준비 중…") : tr("+ 사진 추가"))}</ThemedText>
                  </Pressable>
                  <Pressable analyticsId="post.edit.replace-all" onPress={() => void pickPostImages(true)} disabled={savingPost || pickingPostImages} accessibilityRole="button" accessibilityLabel={tr("사진 전체 교체")} style={styles.postAction}>
                    <ThemedText type="small" themeColor="textSecondary">{tr("전체 교체")}</ThemedText>
                  </Pressable>
                </View>
                <View style={styles.postActions}>
                  <Pressable analyticsId="components_post-detail.pressable.12" onPress={() => { play('selection'); setPostDraft(null); setPostImages(null); }} disabled={savingPost || pickingPostImages} accessibilityRole="button"
                    accessibilityState={{ disabled: savingPost || pickingPostImages }} style={({ pressed }) => [styles.postAction, Depth.control, { backgroundColor: theme.backgroundElement, }]}>
                    <ThemedText type="smallBold" themeColor="textSecondary">{t.write.cancel}</ThemedText>
                  </Pressable>
                  <Pressable analyticsId="components_post-detail.pressable.13" onPress={() => { play('selection'); void savePost(); }} disabled={savingPost || pickingPostImages} accessibilityRole="button"
                    accessibilityState={{ disabled: savingPost || pickingPostImages, busy: savingPost }} style={({ pressed }) => [styles.postAction, { backgroundColor: theme.accent, opacity: pressed ? 0.65 : 1 }]}>
                    <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr(savingPost ? tr("저장 중") : tr("저장"))}</ThemedText>
                  </Pressable>
                </View>
              </View>
            )}
            {!postDraft && <PostPhotoGallery post={post} />}
            {!postDraft && <PostPhotoCredits credits={photoCredits.credits} />}
            {!postDraft && <PostCard
              hidePhoto
              hideRoom={!!post.room}
              flat={!!post.room}
              postDetail={!post.room}
              // The info card shows the summary line and the neighborhood map, so the body drops both.
              post={{ ...post, body: post.listingDetails ? postMapBody(stripListingLead(photoCredits.body, post.listingDetails)).body : photoCredits.body, views: viewCount }}
              beforeBody={post.listingDetails ? <ListingInfo post={post as DetailedPost} /> : undefined}
              meetupDetail={post.room ? { beforeTitle: <MeetupChips post={post} />, afterTitle: <MeetupSummary post={post} status={meetupStatus} onClose={onClose} onBeforeNavigate={onJoin ? onClose : undefined} /> } : undefined}
              afterBody={<>
                {post.kind === 'listing' && post.tag.slug === 'housing' && !post.listingDetails && <View style={{ gap: Spacing.one }}>
                  <ThemedText type="smallBold" accessibilityRole="header">{tr("주소·위치")}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" selectable>{postPublicAddress(post.body) ?? tr("상세주소 미등록")}</ThemedText>
                </View>}
                <MerchantSourceLink postId={post.id} /><MerchantReviews postId={post.id} reviewKind={post.tag.slug === 'jobs' ? 'employment' : 'usage'} onOpenProfile={(id) => { onClose(); router.push({ pathname: '/company/[id]', params: { id, review: post.tag.slug === 'jobs' ? 'employment' : 'usage' } }); }} />{post.room && <TicketmasterSourceLink body={post.body} cityId={post.cityId} onNavigate={onClose} />}
                {linkedPlace && <Pressable analyticsId="components_post-map-link.pressable.1" accessibilityRole="button" accessibilityLabel={placeSourceLabel} onPress={() => { play('selection'); onClose(); router.navigate(placeMapRoute(linkedPlace.place)); }} style={({ pressed }) => [ControlStyles.action, controlPresentation(theme, { pressed }).container, { borderWidth: 1 }]}><ThemedText type="smallBold" style={controlPresentation(theme).text}>{placeSourceLabel}</ThemedText></Pressable>}
              </>}
              onJoin={onJoin ?? (() => isAuthed ? router.push({ pathname: '/meetup-join', params: { postId: post.id } }) : promptLogin('이 모임에 참여하려면 가입하거나 로그인해 주세요.'))}
              onAuthor={() => {
                if (post.business) { onClose(); router.push({ pathname: '/company/[id]', params: { id: post.business.id } }); return; }
                if (post.room) { onClose(); router.push({ pathname: '/meetup-profile', params: { postId: post.id } }); return; }
                setSheetUser({
                  id: post.author.id,
                  nickname: post.author.nickname,
                  neighborhood: post.author.neighborhood,
                  verified: post.author.verified,
                  trustLevel: post.author.trustLevel,
                  mine: post.author.id === me.id,
                  listingId: post.kind === 'listing' ? post.id : undefined,
                  contextPostId: post.kind === 'listing' || post.room ? post.id : undefined,
                });
              }}
            />}
            {!postDraft && post.kind === 'story' && !post.room && <PostPoll postId={post.id} />}
            {!postDraft && post.room && <MeetupRsvp postId={post.id} />}
            {!postDraft && post.room && post.room.eventKind !== 'once' && Platform.OS !== 'web' && <View style={[styles.meetupSection, { borderTopColor: theme.line }]}>
              <ThemedText accessibilityRole="header" style={Typography.section}>{tr("후기")}</ThemedText>
              <MeetupReviews postId={post.id} kind="group" reviewsOnly onBeforeNavigate={onClose} />
            </View>}
            {!postDraft && post.room && <View style={[styles.meetupSection, styles.meetupSectionRow, { borderTopColor: theme.line }]}>
              <ThemedText accessibilityRole="header" style={[Typography.section, styles.flexText]}>{tr("질문·댓글")} <ThemedText themeColor="textSecondary" style={Typography.section}>{commentTotal}</ThemedText></ThemedText>
              <Pressable analyticsId="meetup.detail.ask" accessibilityRole="button" onPress={() => { play('selection'); setComposing(true); inputRef.current?.focus(); }} style={styles.askBtn}>
                <ThemedText type="smallBold" themeColor="accent">{tr("질문 남기기")}</ThemedText>
              </Pressable>
            </View>}
            {canManagePost && post.kind === 'listing' && <ListingControls post={post} onChanged={onListingChanged} />}
          </View>}
          ListFooterComponent={post.room && !postDraft ? <MeetupNotes post={post} /> : undefined}
        />

        {!postDraft && post.room && !composing && !replyTo && !editing && <MeetupActionBar post={post} status={meetupStatus} onJoin={onJoin} onBeforeNavigate={onJoin ? onClose : undefined} />}
        {!postDraft && (!post.room || composing || !!replyTo || !!editing) && <View
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
            <Pressable analyticsId="components_post-detail.pressable.17" onPress={() => { play('selection'); setEditing(null); setDraft(''); }} disabled={sending} accessibilityRole="button" accessibilityLabel={tr("수정 취소")}
              accessibilityState={{ disabled: sending }} style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="textSecondary">{tr("취소")}</ThemedText>
            </Pressable>
          </View>}
          {replyTo && !editing && <View style={styles.replyContext}>
            <ThemedText type="small" themeColor="accent" style={{ flex: 1 }}>{tr('{0}님에게 답글', replyTo.nickname)}</ThemedText>
            <Pressable analyticsId="components_post-detail.pressable.18" onPress={() => { play('selection'); setReplyTo(null); }} disabled={sending} accessibilityRole="button" accessibilityLabel={tr("답글 취소")}
              accessibilityState={{ disabled: sending }} style={({ pressed }) => [styles.commentAction, pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="textSecondary">{tr("취소")}</ThemedText>
            </Pressable>
          </View>}
          {sendError && <ThemedText type="small" themeColor="accent" accessibilityRole="alert" style={{ paddingHorizontal: Spacing.two, paddingBottom: Spacing.two }}>{sendError}</ThemedText>}
          <View style={styles.composerRow}>
            {!post.room && !replyTo && !editing && <><PostReactionToggle post={post} kind="like" showCount /><PostReactionToggle post={post} kind="save" showCount /></>}
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={(value) => { setDraft(value); setSendError(null); }}
              autoFocus={!!post.room}
              onBlur={() => { if (!draft.trim() && !replyTo && !editing) setComposing(false); }}
              editable={!sending}
              multiline
              maxLength={1000}
              accessibilityLabel={tr(replyTo ? tr("{0}님에게 답글", (replyTo.nickname)) : tr("댓글 쓰기"))}
              placeholder={business && !editing ? tr("{0} 이름으로 남겨요", business.name) : tr(replyTo ? tr("답글을 남겨 주세요") : t.detail.commentPlaceholder)}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]}
            />
            <Pressable analyticsId="components_post-detail.pressable.19"
              onPress={() => { play('selection'); void send(); }}
              disabled={sendDisabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: sendDisabled, busy: sending }}
              style={({ pressed }) => [styles.send, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: sendDisabled ? 0.55 : 1, }]}>
              <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                {t.detail.send}
              </ThemedText>
            </Pressable>
          </View>
        </View>}
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
  menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  menuSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12 },
  menuTitle: { paddingHorizontal: 24, paddingVertical: 12 },
  menuRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 12 },
  pressed: { opacity: 0.65 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: Spacing.three,
  },
  headTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  headSpacer: { flex: 1, minHeight: 44 },
  meetupSection: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  meetupSectionRow: { flexDirection: 'row', alignItems: 'center' },
  flexText: { flex: 1 },
  askBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  shareBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.two, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  closeBtn: {
    width: 44,
    minHeight: 44,
    borderRadius: 22,
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
  postAction: { minHeight: 44, justifyContent: 'center', borderRadius: 10, paddingHorizontal: Spacing.two },
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
// `closeMenu` renders the same actions as rows of the ··· sheet (regular posts only have the free bump).
function ListingControls({ post, onChanged, closeMenu }: { post: Post; onChanged: (next: Partial<Post>) => void; closeMenu?: () => void }) {
  const { t } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [busy, setBusy] = useState(false);
  // Date.now() in render is impure for the React compiler; sample it once per mount.
  const [now] = useState(() => Date.now());
  const listing = post.kind === 'listing';
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
    <Pressable analyticsId="components_post-detail.pressable.20" key={label} accessibilityRole="button" onPress={() => { play('selection'); closeMenu?.(); onPress(); }} disabled={busy} accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [closeMenu ? styles.menuRow : styles.listingAction, (pressed || busy) && { opacity: 0.6 }]}>
      {closeMenu && <SymbolView name={{ ios: 'arrow.up.to.line', android: 'vertical_align_top', web: 'vertical_align_top' }} size={20} tintColor={theme.text} />}
      <ThemedText type={closeMenu ? undefined : 'smallBold'} themeColor={closeMenu ? undefined : primary ? 'accent' : 'textSecondary'}>{label}</ThemedText>
    </Pressable>
  );
  if (closeMenu) return alive ? action(t.detail.bump, () => void run(async () => {
    const result = await bumpListing(supabase, post.id);
    return { bumpedAt: result.bumpedAt, expiresAt: result.expiresAt, sortAt: result.bumpedAt };
  }, t.detail.bumped), true) : null;
  return (
    <View style={[styles.listingBar, { borderTopColor: theme.line, borderBottomColor: theme.line }]}>
      {listing && <ThemedText type="small" themeColor="textSecondary" style={styles.listingState}>
        {t.detail.listingStatus[post.listingStatus ?? 'open']}{alive && daysLeft != null ? ` · ${t.detail.expiresIn(daysLeft)}` : ''}
      </ThemedText>}
      <View style={styles.listingActions}>
      {alive && action(t.detail.bump, () => void run(async () => {
        const result = await bumpListing(supabase, post.id);
        return { bumpedAt: result.bumpedAt, expiresAt: result.expiresAt, sortAt: result.bumpedAt };
      }, t.detail.bumped), true)}
      {listing && alive && post.listingStatus !== 'partial' && action(t.detail.markPartial, () => void run(async () => ({ listingStatus: (await setListingStatus(supabase, post.id, 'partial')).status })))}
      {listing && alive && action(t.detail.markClosed, () => void run(async () => ({ listingStatus: (await setListingStatus(supabase, post.id, 'closed')).status })))}
      {listing && !alive && action(t.detail.reopen, () => void run(async () => {
        const result = await setListingStatus(supabase, post.id, 'open');
        return { listingStatus: result.status, expiresAt: result.expiresAt, bumpedAt: null };
      }), true)}
      </View>
    </View>
  );
}
