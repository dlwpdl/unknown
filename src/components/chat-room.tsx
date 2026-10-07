import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView, FlatList } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, Platform, StyleSheet, TextInput, UIManager, View, type FlatList as NativeFlatList, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportSheet } from '@/components/report-sheet';
import { ChatMembers } from '@/components/chat-members';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { Depth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { chatDateLabel, chatMessageTime, firstUnreadMessageIndex, showChatMessageTime } from '@/lib/chat-details';
import { blockUser, endConversation, getCommunityActionError, loadListingReviewState, writeListingReview, type ListingReviewState, isContentRejected, loadChatReadPosition, loadConversationMessages, loadConversationMessagesByIds, loadMessageReactions, markChatRead, mergeChatMessages, respondDirectConversation, sendChatAttachment, sendDirectMessage, setMessageReaction, uploadChatImage, type ChatMessageRecord, type ConversationPreview, type MessageReaction, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function conversationCapabilities(status: ConversationPreview['status']) {
  return { read: status === 'active' || status === 'ended', write: status === 'active' };
}

export function conversationExitNotice(conversation: Pick<ConversationPreview, 'kind' | 'isGroupHost' | 'requesterId'>, currentUserId: string) {
  if (conversation.kind === 'group') return conversation.isGroupHost ? t.meetup.endBody : t.meetup.leaveBody;
  if (conversation.requesterId === null) return t.chat.endLegacy;
  return conversation.requesterId === currentUserId ? t.chat.endRequester : t.chat.endRecipient;
}

export function conversationSender(message: Pick<ChatMessageRecord, 'sender_id' | 'sender_nickname'>, conversation: Pick<ConversationPreview, 'kind' | 'otherUser'>) {
  return { id: message.sender_id, nickname: message.sender_nickname ?? (conversation.kind === 'direct' && message.sender_id === conversation.otherUser.id ? conversation.otherUser.nickname : t.chat.member) };
}

type ReportSelection = { targetType: ReportTarget; targetId: string; reportedUserId: string; reportedNickname: string };
function RoomAction({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.action, primary && Depth.control, primary && { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3 }, { opacity: disabled ? 0.55 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : theme.accent }}>{label}</ThemedText></Pressable>;
}

export function ChatRoom({ conversation, currentUserId, onClose, onChanged }: { conversation: ConversationPreview; currentUserId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const theme = useTheme();
  const hidden = useContentVisibility();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const identity = useRef(auth.isAuthed ? auth.me.id : null);
  const mounted = useRef(true);
  const processing = useRef(false);
  const loadingRequest = useRef(0);
  const snapshot = useRef<Promise<void> | null>(null);
  const olderRequest = useRef(false);
  const blockedUsers = useRef(new Set<string>());
  useLayoutEffect(() => { identity.current = auth.isAuthed ? auth.me.id : null; }, [auth.isAuthed, auth.me.id]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = useCallback(() => mounted.current && identity.current === currentUserId, [currentUserId]);
  const [resolvedStatus, setResolvedStatus] = useState<ConversationPreview['status'] | null>(null);
  const status = conversation.status === 'ended' ? 'ended' : resolvedStatus ?? conversation.status;
  const access = conversationCapabilities(status);
  const [allMessages, setMessages] = useState<ChatMessageRecord[]>([]);
  const messages = useMemo(() => allMessages.filter((message) => !hidden('message', message.id, message.sender_id)), [allMessages, hidden]);
  const [draft, setDraft] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<PreparedImage | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState<string | null>(null);
  const messageList = useRef<NativeFlatList<ChatMessageRecord> | null>(null);
  const initialScroll = useRef(false);
  const scrollRetries = useRef(0);
  const followingLatest = useRef(false);
  const lastReadAt = useRef(0);
  const readReady = useRef(false);
  const [viewability] = useState(() => ({ itemVisiblePercentThreshold: 55 }));
  const [readAt, setReadAt] = useState<string | null | undefined>(undefined);
  const [unreadStart, setUnreadStart] = useState<string | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const [loading, setLoading] = useState(access.read);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<ReportSelection | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [review, setReview] = useState<ListingReviewState | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewPick, setReviewPick] = useState<boolean | null>(null);
  const [reactions, setReactions] = useState<Map<string, MessageReaction>>(new Map());
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    let active = true;
    void loadChatReadPosition(supabase, conversation.id).then((position) => {
      if (!active || !valid()) return;
      lastReadAt.current = position ? Date.parse(position) : 0;
      readReady.current = true;
      setReadAt(position);
    }).catch(() => { if (active && valid()) { readReady.current = true; setReadAt(null); setError('안 읽은 메시지 위치를 확인하지 못했어요.'); } });
    return () => { active = false; };
  }, [conversation.id, valid]);

  useEffect(() => {
    if (loading || readAt === undefined || initialScroll.current) return;
    initialScroll.current = true;
    const index = firstUnreadMessageIndex(messages, readAt, currentUserId);
    setUnreadStart(index < 0 ? null : messages[index].id);
    followingLatest.current = index < 0;
    setAwayFromLatest(index >= 0 && index < messages.length - 1);
    const timer = setTimeout(() => {
      if (index > 0) messageList.current?.scrollToIndex({ index, viewPosition: 0.12, animated: false });
      else if (index < 0) messageList.current?.scrollToEnd({ animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, currentUserId, loading, readAt]);

  const trackVisibleMessages = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatMessageRecord>[] }) => {
    if (!readReady.current || !valid()) return;
    const newest = viewableItems.map(({ item }) => item).filter((item): item is ChatMessageRecord => !!item)
      .reduce<ChatMessageRecord | null>((latest, item) => !latest || Date.parse(item.created_at) > Date.parse(latest.created_at) ? item : latest, null);
    if (!newest || Date.parse(newest.created_at) <= lastReadAt.current) return;
    lastReadAt.current = Date.parse(newest.created_at);
    void markChatRead(supabase, conversation.id, newest.id).catch(() => {});
  }, [conversation.id, valid]);
  const onMessageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearLatest = contentSize.height - layoutMeasurement.height - contentOffset.y < 88;
    followingLatest.current = nearLatest;
    setAwayFromLatest(!nearLatest);
  };
  const scrollToLatest = (animated = false) => {
    followingLatest.current = true;
    setAwayFromLatest(false);
    requestAnimationFrame(() => requestAnimationFrame(() => messageList.current?.scrollToEnd({ animated })));
  };
  const animateNewMessage = useCallback(() => {
    if (reducedMotion || Platform.OS === 'web' || !initialScroll.current) return;
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation.configureNext({ duration: 220,
      create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
      update: { type: LayoutAnimation.Types.easeOut },
    });
  }, [reducedMotion]);
  const setAttachmentMenu = (open: boolean) => {
    if (open === attachmentsOpen) return;
    if (!reducedMotion && Platform.OS !== 'web') {
      if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
      LayoutAnimation.configureNext({ duration: 220,
        create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
        update: { type: LayoutAnimation.Types.easeOut },
        delete: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
      });
    }
    setAttachmentsOpen(open);
  };
  useEffect(() => {
    let active = true;
    void loadMessageReactions(supabase, messages.map((message) => message.id))
      .then((next) => { if (active) setReactions(next); })
      .catch(() => {});
    return () => { active = false; };
  }, [messages]);

  const toggleHeart = async (messageId: string) => {
    const current = reactions.get(messageId);
    const next = !current?.mine;
    play('reaction');
    setReactions((previous: Map<string, MessageReaction>) => new Map(previous).set(messageId, {
      message_id: messageId, hearts: Math.max(0, (current?.hearts ?? 0) + (next ? 1 : -1)), mine: next,
    }));
    try {
      const hearts = await setMessageReaction(supabase, messageId, next);
      setReactions((previous: Map<string, MessageReaction>) => new Map(previous).set(messageId, { message_id: messageId, hearts, mine: next }));
    } catch {
      setReactions((previous: Map<string, MessageReaction>) => new Map(previous).set(messageId, current ?? { message_id: messageId, hearts: 0, mine: false }));
    }
  };
  // 서로 메시지에 하트를 눌러 주는 기능이라 더블탭으로 토글한다 (320ms).
  // 렌더 중 Date.now() 를 부르지 않도록 터치 이벤트의 타임스탬프를 쓴다.
  const handleBubbleTap = (messageId: string, at: number) => {
    const previous = lastTap.current;
    lastTap.current = { id: messageId, at };
    if (previous && previous.id === messageId && at - previous.at < 320) { lastTap.current = null; void toggleHeart(messageId); }
  };
  const group = conversation.kind === 'group';
  const requestedByMe = conversation.requesterId === currentUserId;
  const title = group ? conversation.title : conversation.otherUser.nickname;
  const verificationNotice = !group && ![2, 3].includes(conversation.otherUser.verificationLevel)
    ? <View accessible style={[styles.safetyNotice, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{t.chat.unverifiedNotice}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{t.chat.unverifiedSafety}</ThemedText>
    </View> : null;

  const refreshMessages = useCallback(() => {
    if (!access.read || !valid()) return;
    if (snapshot.current) return snapshot.current;
    const request = ++loadingRequest.current;
    setLoading(true);
    const promise = (async () => {
      try {
        const rows = await loadConversationMessages(supabase, conversation.id);
        if (!valid() || loadingRequest.current !== request) return;
        // Reconnect starts a contiguous window and revalidates message visibility through RLS.
        setMessages(rows.filter((message) => !blockedUsers.current.has(message.sender_id)));
        setHasOlder(rows.length === 50);
      } catch { if (valid() && loadingRequest.current === request) setError(t.chat.loadMessagesError); }
      finally { if (loadingRequest.current === request) { snapshot.current = null; if (valid()) setLoading(false); } }
    })();
    snapshot.current = promise;
    return promise;
  }, [access.read, conversation.id, valid]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let flushing = false;
    const pending = new Set<string>();
    const flush = async () => {
      timer = undefined;
      if (!active || !valid() || flushing || !pending.size) return;
      const ids = [...pending].slice(0, 50);
      ids.forEach((id) => pending.delete(id));
      flushing = true;
      try {
        await snapshot.current;
        if (!active || !valid()) return;
        const request = loadingRequest.current;
        const rows = await loadConversationMessagesByIds(supabase, conversation.id, ids);
        if (active && valid()) {
          if (request === loadingRequest.current) { if (rows.length) animateNewMessage(); setMessages((previous) => mergeChatMessages(previous, rows, blockedUsers.current)); }
          else ids.forEach((id) => pending.add(id));
        }
      } catch {
        if (active && valid()) { setError(t.chat.loadMessagesError); void refreshMessages(); }
      } finally {
        flushing = false;
        if (active && pending.size && !timer) timer = setTimeout(() => void flush(), 80);
      }
    };
    void Promise.resolve().then(refreshMessages);
    const channel = supabase.channel(`room:${currentUserId}:${conversation.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversation.id}` }, ({ new: value }) => {
        if (!valid()) return;
        const next = value.status as ConversationPreview['status'];
        if (['pending', 'active', 'ended', 'rejected', 'cancelled'].includes(next)) setResolvedStatus(next);
        void onChanged();
      });
    if (access.read) channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, ({ new: message }) => {
      if (!active || typeof message.id !== 'string') return;
      pending.add(message.id);
      if (!timer && !flushing) timer = setTimeout(() => void flush(), 80);
    });
    channel.subscribe();
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active' && valid()) { void refreshMessages(); void onChanged(); } });
    return () => { active = false; clearTimeout(timer); pending.clear(); loadingRequest.current += 1; snapshot.current = null; appState.remove(); void supabase.removeChannel(channel); };
  }, [access.read, animateNewMessage, conversation.id, currentUserId, onChanged, refreshMessages, valid]);

  const respond = async (response: 'accepted' | 'rejected' | 'cancelled') => {
    if (processing.current || status !== 'pending' || !valid()) return;
    processing.current = true; setBusy(true); setError(null);
    try {
      await respondDirectConversation(supabase, conversation.id, response);
      if (!valid()) return;
      play(response === 'accepted' ? 'message' : 'warning');
      setResolvedStatus(response === 'accepted' ? 'active' : response);
      setConfirmAccept(false);
      await onChanged();
      if (valid() && response !== 'accepted') onClose();
    } catch (failure) {
      if (!valid()) return;
      play('warning');
      const code = getCommunityActionError(failure);
      const message = code ? t.actionErrors[code] : null;
      setError(message ? `${message.title} ${message.body}` : t.chat.startErrorBody);
      await onChanged();
    } finally { processing.current = false; if (valid()) setBusy(false); }
  };
  const end = async () => {
    if (processing.current || !valid()) return;
    processing.current = true; setBusy(true); setError(null);
    try { await endConversation(supabase, conversation.id); if (valid()) { play('warning'); setResolvedStatus('ended'); setConfirmEnd(false); await onChanged(); } }
    catch { if (valid()) { play('warning'); setError(t.chat.endError); } }
    finally { processing.current = false; if (valid()) setBusy(false); }
  };
  const block = async (blockedUserId: string) => {
    if (!valid() || blockedUserId === currentUserId) return;
    try {
      await blockUser(supabase, currentUserId, blockedUserId);
      if (!valid()) return;
      play('warning');
      if (group) { blockedUsers.current.add(blockedUserId); setMessages((previous) => previous.filter((message) => message.sender_id !== blockedUserId)); }
      else setResolvedStatus(status === 'pending' ? 'cancelled' : 'ended');
      setNotice(t.chat.blockDone); await onChanged();
    } catch { if (valid()) { play('warning'); setError(t.chat.blockError); } }
  };
  // 후기 자격은 서버가 판단한다. 여기서는 열린 경우에만 버튼을 보여준다.
  const applyReview = useCallback((next: ListingReviewState | null) => {
    setReview(next);
    if (next?.mine) { setReviewBody(next.mine.body ?? ''); setReviewPick(next.mine.wouldDealAgain); }
  }, []);

  const refreshReview = useCallback(async () => {
    if (conversation.kind !== 'direct') return;
    try {
      const next = await loadListingReviewState(supabase, conversation.id);
      if (valid()) applyReview(next);
    } catch { if (valid()) applyReview(null); }
  }, [applyReview, conversation.id, conversation.kind, valid]);

  const submitReview = async (wouldDealAgain: boolean) => {
    if (busy || !valid()) return;
    setBusy(true); setError(null);
    try {
      await writeListingReview(supabase, conversation.id, wouldDealAgain, reviewBody);
      if (!valid()) return;
      play('selection'); setReviewOpen(false);
      await refreshReview();
    } catch {
      if (valid()) { play('warning'); setError('후기를 남기지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    } finally { if (valid()) setBusy(false); }
  };

  // 메시지가 오갈 때마다 서버에 자격을 다시 묻는다. 양쪽이 말을 해야 열리기 때문이다.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (conversation.kind !== 'direct') return;
      try {
        const next = await loadListingReviewState(supabase, conversation.id);
        if (active && valid()) applyReview(next);
      } catch { if (active && valid()) applyReview(null); }
    })();
    return () => { active = false; };
  }, [applyReview, conversation.id, conversation.kind, messages.length, valid]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || processing.current || !access.write || !valid()) return;
    setAttachmentMenu(false);
    processing.current = true; setSending(true); setError(null);
    try {
      const id = await sendDirectMessage(supabase, conversation.id, body);
      await snapshot.current;
      if (!valid()) return;
      animateNewMessage();
      setMessages((previous) => previous.some((item) => item.id === id) ? previous : [...previous, { id, conversation_id: conversation.id, sender_id: currentUserId, sender_nickname: auth.me.nickname, body, created_at: new Date().toISOString() }]);
      setDraft((current) => current.trim() === body ? '' : current); scrollToLatest(); play('message');
    } catch (failure) { if (valid()) { play('warning'); setError(isContentRejected(failure) ? t.safety.contentBlockedBody : t.chat.sendError); await onChanged(); } }
    finally { processing.current = false; if (valid()) setSending(false); }
  };
  const pickPhoto = async () => {
    if (sending || pickingPhoto || !access.write || !valid()) return;
    setPickingPhoto(true); setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !valid()) return;
      const asset = result.assets[0];
      if (!asset?.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg')) throw new Error('UNSUPPORTED_IMAGE');
      const prepared = await preparePostImage(asset);
      if (valid()) { setSelectedPhoto(prepared); play('selection'); }
    } catch { if (valid()) { play('warning'); setError('사진을 준비하지 못했어요. JPG, PNG 또는 WebP 사진을 다시 선택해 주세요.'); } }
    finally { if (valid()) setPickingPhoto(false); }
  };
  const sendPhoto = async () => {
    if (!selectedPhoto || sending || processing.current || !access.write || !valid()) return;
    processing.current = true; setSending(true); setError(null);
    let path: string | null = null;
    let sentId: string | null = null;
    try {
      path = await uploadChatImage(supabase, currentUserId, conversation.id, selectedPhoto.base64);
      if (!valid()) return;
      sentId = await sendChatAttachment(supabase, conversation.id, { kind: 'image', imagePath: path });
      const rows = await loadConversationMessagesByIds(supabase, conversation.id, [sentId]).catch(() => []);
      if (!valid()) return;
      animateNewMessage();
      setMessages((previous) => mergeChatMessages(previous, rows.length ? rows.map((row) => ({ ...row, imageUrl: row.imageUrl ?? selectedPhoto.uri })) : [{ id: sentId!, conversation_id: conversation.id,
        sender_id: currentUserId, sender_nickname: auth.me.nickname, body: '📷 사진', kind: 'image', image_path: path, imageUrl: selectedPhoto.uri,
        created_at: new Date().toISOString() }], blockedUsers.current));
      setSelectedPhoto(null); scrollToLatest(); play('message');
    } catch { if (valid()) { play('warning'); setError('사진을 보내지 못했어요. 잠시 후 다시 시도해 주세요.'); } }
    finally {
      if (path && !sentId) void supabase.storage.from('chat-images').remove([path]).catch(() => {});
      processing.current = false; if (valid()) setSending(false);
    }
  };
  const sendCurrentLocation = async () => {
    if (sending || processing.current || !access.write || !valid()) return;
    processing.current = true; setSending(true); setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('LOCATION_PERMISSION');
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), 15000); }),
      ]);
      if (!valid()) return;
      const { latitude, longitude } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('LOCATION_UNAVAILABLE');
      const id = await sendChatAttachment(supabase, conversation.id, { kind: 'location', latitude, longitude });
      const rows = await loadConversationMessagesByIds(supabase, conversation.id, [id]).catch(() => []);
      if (!valid()) return;
      animateNewMessage();
      setMessages((previous) => mergeChatMessages(previous, rows.length ? rows : [{ id, conversation_id: conversation.id,
        sender_id: currentUserId, sender_nickname: auth.me.nickname, body: '📍 위치', kind: 'location', latitude, longitude,
        created_at: new Date().toISOString() }], blockedUsers.current));
      scrollToLatest(); play('message');
    } catch (failure) {
      if (valid()) { play('warning'); setError(failure instanceof Error && failure.message === 'LOCATION_PERMISSION'
        ? '위치 권한을 허용해야 현재 위치를 보낼 수 있어요.' : '위치를 보내지 못했어요. 연결과 위치 설정을 확인해 주세요.'); }
    } finally { clearTimeout(timer); processing.current = false; if (valid()) setSending(false); }
  };
  const openAttachments = () => { play('selection'); setAttachmentMenu(!attachmentsOpen); };
  const loadOlder = async () => {
    if (olderRequest.current || snapshot.current || !hasOlder || !messages[0] || !access.read || !valid()) return;
    const request = loadingRequest.current;
    olderRequest.current = true; setLoadingOlder(true);
    try {
      const rows = await loadConversationMessages(supabase, conversation.id, { createdAt: messages[0].created_at, id: messages[0].id });
      if (!valid() || request !== loadingRequest.current) return;
      setMessages((previous) => mergeChatMessages(previous, rows, blockedUsers.current)); setHasOlder(rows.length === 50);
    } catch { if (valid() && request === loadingRequest.current) setError(t.chat.loadMessagesError); }
    finally { olderRequest.current = false; if (valid()) setLoadingOlder(false); }
  };

  if (!auth.isAuthed || auth.me.id !== currentUserId) return null;
  return <ThemedView style={{ flex: 1 }}>
    <View style={[styles.head, { borderBottomColor: theme.line }]}><View style={styles.titleRow}><ThemedText type="smallBold" style={styles.title}>{title}</ThemedText>{!group && <TrustBadge verified={conversation.otherUser.verificationLevel >= 2} trustLevel={conversation.otherUser.verificationLevel === 3 ? 3 : conversation.otherUser.verificationLevel === 2 ? 2 : undefined} />}</View><RoomAction label={t.detail.close} onPress={onClose} /></View>
    <View style={[styles.toolbar, group && styles.groupToolbar]}>{group && access.read && conversation.groupPostId && <ChatMembers key={`${currentUserId}:${conversation.id}`} conversationId={conversation.id} groupPostId={conversation.groupPostId} currentUserId={currentUserId} />}{access.write && <RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} onPress={() => setConfirmEnd(true)} />}{!group && <><RoomAction label={t.report.short} onPress={() => setReport({ targetType: 'user', targetId: conversation.otherUser.id, reportedUserId: conversation.otherUser.id, reportedNickname: conversation.otherUser.nickname })} /><RoomAction label={t.chat.block} onPress={() => void block(conversation.otherUser.id)} /></>}</View>
    {review?.canWrite && <View style={styles.toolbar}>
      <RoomAction label={review.mine ? '거래 후기 고치기' : `${review.subjectNickname ?? ''}님 거래 후기 남기기`}
        onPress={() => setReviewOpen((current) => !current)} disabled={busy} />
      {review.mine && <ThemedText type="small" themeColor="textSecondary">
        {review.mine.wouldDealAgain ? '다시 거래하겠다고 남겼어요' : '다시 거래하지 않겠다고 남겼어요'}
      </ThemedText>}
    </View>}
    {review?.canWrite && reviewOpen && <View style={[styles.confirmation, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">거래는 어떠셨어요?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {review.postTitle} · 거래한 사람만 남길 수 있어요
      </ThemedText>
      <View style={styles.reviewPick}>
        {([[true, '다시 거래할래요'], [false, '아쉬웠어요']] as [boolean, string][]).map(([value, label]) => {
          const on = reviewPick === value;
          return (
            <Pressable analyticsId="components_chat-room.pressable.2" key={label} onPress={() => { play('selection'); setReviewPick(value); }} accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }} disabled={busy}
              style={({ pressed }) => [styles.reviewOption, Depth.control,
                { borderColor: on ? theme.accent : theme.line, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
              <ThemedText type="smallBold" style={on ? { color: theme.accent } : undefined}>{label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={reviewBody} onChangeText={setReviewBody} maxLength={300} multiline editable={!busy}
        placeholder="어땠는지 한 줄로 남겨주세요 (선택)" accessibilityLabel="거래 후기"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line, minHeight: 64 }]} />
      <View style={styles.messageActions}>
        <RoomAction label={t.profile.cancel} onPress={() => setReviewOpen(false)} disabled={busy} />
        <RoomAction label={busy ? '남기는 중' : '후기 남기기'}
          onPress={() => { if (reviewPick !== null) void submitReview(reviewPick); }}
          disabled={busy || reviewPick === null} primary />
      </View>
    </View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {status === 'pending' ? <ScrollView analyticsId="components_chat-room.scrollview.1" contentContainerStyle={styles.request}>{verificationNotice}<ThemedText type="smallBold">{requestedByMe ? t.chat.requestSent : t.chat.receivedRequest}</ThemedText><ThemedText type="small" themeColor="textSecondary">{t.chat.pendingBody}</ThemedText><ThemedText type="small">{requestedByMe ? t.chat.requesterRisk : t.chat.acceptBody}</ThemedText>
        {requestedByMe ? <RoomAction label={t.chat.cancelRequest} onPress={() => void respond('cancelled')} disabled={busy} /> : <><RoomAction label={confirmAccept ? '확인하고 수락' : t.chat.accept} onPress={() => confirmAccept ? void respond('accepted') : setConfirmAccept(true)} disabled={busy} primary />{confirmAccept && <ThemedText type="small" themeColor="accent">내 대화 자리 1개를 사용해요. 양쪽에 빈자리가 있을 때 수락할 수 있어요.</ThemedText>}<RoomAction label={t.chat.reject} onPress={() => void respond('rejected')} disabled={busy} /></>}
      </ScrollView> : access.read ? loading && messages.length === 0 ? <View style={styles.center}><GlingLoader color={theme.accent} accessibilityLabel={t.chat.loading} /></View> : <View style={styles.messageList}><FlatList ref={messageList} analyticsId="components_chat-room.flatlist.1" data={messages} keyExtractor={(message) => message.id} contentContainerStyle={styles.scroll}
        onViewableItemsChanged={trackVisibleMessages} viewabilityConfig={viewability}
        onScroll={onMessageScroll} scrollEventThrottle={32} maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onLayout={() => { if (initialScroll.current && followingLatest.current) requestAnimationFrame(() => messageList.current?.scrollToEnd({ animated: false })); }}
        onContentSizeChange={() => { if (initialScroll.current && followingLatest.current && !loadingOlder) requestAnimationFrame(() => messageList.current?.scrollToEnd({ animated: false })); }}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          if (++scrollRetries.current > 3) return;
          messageList.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
          setTimeout(() => messageList.current?.scrollToIndex({ index, viewPosition: 0.12, animated: false }), 120);
        }}
        ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{access.write ? t.chat.newConversation : t.chat.endedBody}</ThemedText>}
        ListFooterComponent={<View style={{ height: Spacing.four }} />}
        ListHeaderComponent={<>{hasOlder && messages.length > 0 && <RoomAction label={loadingOlder ? t.feed.loadingMore : t.chat.loadOlder} onPress={() => void loadOlder()} disabled={loadingOlder} />}{verificationNotice}</>}
        renderItem={({ item: message, index }) => {
          const author = conversationSender(message, conversation);
          const date = chatDateLabel(message.created_at, messages[index - 1]?.created_at);
          const mine = message.sender_id === currentUserId;
          const time = showChatMessageTime(message, messages[index + 1]) ? <ThemedText type="small" themeColor="textSecondary" style={mine ? styles.timeMine : undefined}>{chatMessageTime(message.created_at)}</ThemedText> : null;
          const reaction = reactions.get(message.id);
          const attachment = message.kind === 'image' || message.kind === 'location';
          const content = message.kind === 'image'
            ? message.imageUrl ? <Image source={{ uri: message.imageUrl }} style={styles.chatPhoto} contentFit="cover" accessibilityLabel="대화에서 보낸 사진" />
              : <ThemedText type="small" themeColor="textSecondary">사진을 불러오지 못했어요</ThemedText>
            : message.kind === 'location' && message.latitude != null && message.longitude != null
              ? <View style={styles.locationCard}><ThemedText type="subtitle">📍</ThemedText><ThemedText type="smallBold">공유한 위치</ThemedText><ThemedText type="small" themeColor="accent">지도에서 열기 ↗</ThemedText></View>
              : <ThemedText type="small" style={mine ? { color: theme.accentInk } : undefined}>{message.body}</ThemedText>;
          const onBubblePress = (at: number) => {
            if (message.kind === 'image' && message.imageUrl) { play('selection'); setPhotoOpen(message.imageUrl); return; }
            if (message.kind === 'location' && message.latitude != null && message.longitude != null) {
              play('selection');
              const query = encodeURIComponent(`${message.latitude},${message.longitude}`);
              void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(() => setError('지도를 열지 못했어요. 다시 시도해 주세요.'));
              return;
            }
            handleBubbleTap(message.id, at);
          };
          // 하트 모양은 그대로 두고, 내가 누른 경우에만 눌린 느낌(배경·그림자)을 준다.
          const heart = reaction && reaction.hearts > 0
            ? <View style={[styles.heartBadge, mine && styles.timeMine, reaction.mine && styles.heartBadgeMine]}>
                <ThemedText type="small" themeColor={reaction.mine ? undefined : 'textSecondary'} style={reaction.mine ? styles.heartBadgeTextMine : undefined}>❤️ {reaction.hearts}</ThemedText>
              </View>
            : null;
          return <View style={styles.messageGroup}>
            {message.id === unreadStart && <View style={[styles.unreadDivider, { borderColor: theme.accent }]}><ThemedText type="smallBold" themeColor="accent">여기부터 안 읽은 메시지</ThemedText></View>}
            {date && <ThemedText type="small" themeColor="textSecondary" style={styles.date}>{date}</ThemedText>}
            {mine ? <><Pressable analyticsId="components_chat-room.pressable.heart" onPress={(event: { nativeEvent?: { timestamp?: number } }) => onBubblePress(event?.nativeEvent?.timestamp ?? 0)} accessibilityRole={message.kind === 'location' ? 'link' : 'button'} accessibilityLabel={attachment ? message.kind === 'image' ? '사진 크게 보기' : '공유한 위치 지도에서 열기' : '메시지에 하트 (두 번 탭)'} style={[styles.bubbleMine, { backgroundColor: attachment ? theme.card : theme.accent }]}>{content}</Pressable>{heart}{time}</>
              : <View style={styles.row}><View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="navy">{author.nickname[0]}</ThemedText></View><View style={styles.rowBody}><ThemedText type="smallBold">{author.nickname}</ThemedText><Pressable analyticsId="components_chat-room.pressable.heart" onPress={(event: { nativeEvent?: { timestamp?: number } }) => onBubblePress(event?.nativeEvent?.timestamp ?? 0)} accessibilityRole={message.kind === 'location' ? 'link' : 'button'} accessibilityLabel={attachment ? message.kind === 'image' ? '사진 크게 보기' : '공유한 위치 지도에서 열기' : '메시지에 하트 (두 번 탭)'} style={[styles.bubble, { backgroundColor: theme.card, borderColor: theme.line }]}>{content}</Pressable>{heart}{time}<View style={styles.messageActions}><RoomAction label={t.report.short} onPress={() => setReport({ targetType: 'message', targetId: message.id, reportedUserId: author.id, reportedNickname: author.nickname })} />{group && <RoomAction label={t.chat.block} onPress={() => void block(author.id)} />}</View></View></View>}
          </View>;
        }} />{awayFromLatest && <Pressable analyticsId="components_chat-room.jump-latest" accessibilityRole="button" accessibilityLabel="최근 메시지로 내려가기" onPress={() => { play('selection'); followingLatest.current = true; setAwayFromLatest(false); messageList.current?.scrollToEnd({ animated: true }); }} style={[styles.jumpLatest, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="smallBold" themeColor="accent">↓ 최근 메시지</ThemedText></Pressable>}</View> : <View style={styles.request}><ThemedText type="small" themeColor="textSecondary">처리되거나 취소된 요청이에요. 대화 목록에서 새로 확인해 주세요.</ThemedText></View>}
      {!!error && <ThemedText accessibilityRole="alert" type="small" themeColor="accent" style={styles.feedback}>{error}</ThemedText>}{notice && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.feedback}>{notice}</ThemedText>}
      {confirmEnd && access.write && <View style={[styles.confirmation, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{t.chat.endConfirm}</ThemedText><ThemedText type="small">{conversationExitNotice(conversation, currentUserId)}</ThemedText>{group && <MeetupPolicyNotice mode={conversation.isGroupHost ? 'close' : 'leave'} />}<View style={styles.messageActions}><RoomAction label={t.profile.cancel} onPress={() => setConfirmEnd(false)} disabled={busy} /><RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} onPress={() => void end()} disabled={busy} primary /></View></View>}
      {access.write && selectedPhoto && <View style={[styles.photoPreview, { backgroundColor: theme.card, borderTopColor: theme.line }]}><Image source={{ uri: selectedPhoto.uri }} style={styles.previewImage} contentFit="cover" accessibilityLabel="보낼 사진 미리보기" /><View style={styles.previewActions}><ThemedText type="smallBold">선택한 사진</ThemedText><ThemedText type="small" themeColor="textSecondary">{Math.ceil(selectedPhoto.bytes / 1024)}KB · 이 대화에만 공유</ThemedText></View><RoomAction label="취소" onPress={() => { play('selection'); setSelectedPhoto(null); }} disabled={sending} /><RoomAction label={sending ? '보내는 중' : '사진 보내기'} onPress={() => void sendPhoto()} disabled={sending} primary /></View>}
      {access.write ? <>
        <View style={[styles.composer, { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: attachmentsOpen ? Spacing.one : Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
          <Pressable analyticsId="components_chat-room.add-attachment" accessibilityRole="button" accessibilityLabel={attachmentsOpen ? '첨부 메뉴 닫기' : '첨부 메뉴 열기'} accessibilityState={{ expanded: attachmentsOpen, disabled: sending || pickingPhoto }} disabled={sending || pickingPhoto} onPress={openAttachments} style={({ pressed }) => [styles.addAttachment, Depth.control, { backgroundColor: attachmentsOpen ? theme.backgroundSelected : theme.backgroundElement, transform: [{ translateY: pressed ? 2 : 0 }] }]}><SymbolView name={{ ios: attachmentsOpen ? 'xmark' : 'plus', android: attachmentsOpen ? 'close' : 'add', web: attachmentsOpen ? 'close' : 'add' }} size={21} tintColor={theme.accent} /></Pressable>
          <TextInput value={draft} onChangeText={setDraft} maxLength={2000} placeholder={t.chat.messagePlaceholder} accessibilityLabel={t.chat.messagePlaceholder} placeholderTextColor={theme.textSecondary} returnKeyType="send" submitBehavior="submit" onSubmitEditing={() => void send()} style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]} />
          <RoomAction label={sending ? t.chat.sending : t.chat.send} onPress={() => void send()} disabled={sending || busy || !draft.trim()} primary />
        </View>
        {attachmentsOpen && <View accessibilityLabel="첨부 방법" style={[styles.attachmentMenu, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one }]}>
          <Pressable analyticsId="components_chat-room.attachment-photo" accessibilityRole="button" accessibilityLabel="사진 보내기" disabled={sending || pickingPhoto} accessibilityState={{ disabled: sending || pickingPhoto }} onPress={() => { play('selection'); setAttachmentMenu(false); void pickPhoto(); }} style={({ pressed }) => [styles.attachmentOption, Depth.control, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, transform: [{ translateY: pressed ? 2 : 0 }] }]}><View style={[styles.attachmentIcon, { backgroundColor: theme.backgroundSelected, shadowColor: '#000' }]}><SymbolView name={{ ios: 'photo', android: 'image', web: 'image' }} size={22} tintColor={theme.accent} /></View><ThemedText type="smallBold">사진 보내기</ThemedText></Pressable>
          <Pressable analyticsId="components_chat-room.attachment-location" accessibilityRole="button" accessibilityLabel="현재 위치 공유" disabled={sending} accessibilityState={{ disabled: sending }} onPress={() => { play('selection'); setAttachmentMenu(false); Alert.alert('현재 위치 공유', '현재 위치를 이 대화 참여자에게 한 번 보낼까요?', [{ text: '취소', style: 'cancel' }, { text: '보내기', onPress: () => { play('selection'); void sendCurrentLocation(); } }]); }} style={({ pressed }) => [styles.attachmentOption, Depth.control, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement, transform: [{ translateY: pressed ? 2 : 0 }] }]}><View style={[styles.attachmentIcon, { backgroundColor: theme.backgroundSelected, shadowColor: '#000' }]}><SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={22} tintColor={theme.accent} /></View><ThemedText type="smallBold">현재 위치 공유</ThemedText></Pressable>
        </View>}
      </> : status === 'ended' && <ThemedText type="small" themeColor="textSecondary" style={[styles.feedback, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>{t.chat.endedBody}</ThemedText>}
    </KeyboardAvoidingView>
    {report && <ReportSheet visible {...report} onClose={() => {
      setReport(null); void onChanged();
      void refreshMessages();
    }} />}
    <Modal visible={!!photoOpen} transparent animationType="fade" onRequestClose={() => setPhotoOpen(null)}><View style={styles.photoBackdrop}><Pressable analyticsId="components_chat-room.photo-close" accessibilityRole="button" accessibilityLabel="사진 닫기" onPress={() => { play('selection'); setPhotoOpen(null); }} style={styles.photoClose}><ThemedText type="subtitle">닫기 ✕</ThemedText></Pressable>{photoOpen && <Image source={{ uri: photoOpen }} style={styles.fullPhoto} contentFit="contain" accessibilityLabel="대화 사진 크게 보기" />}</View></Modal>
  </ThemedView>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1, gap: Spacing.two },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  title: { fontSize: 17, lineHeight: 22, flexShrink: 1 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', paddingHorizontal: Spacing.two },
  groupToolbar: { justifyContent: 'space-between', alignItems: 'center' },
  action: { minWidth: 44, minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, justifyContent: 'center', alignItems: 'center' },
  request: { padding: Spacing.three, gap: Spacing.three },
  safetyNotice: { padding: Spacing.three, borderRadius: 12, gap: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { flex: 1 },
  unreadDivider: { alignItems: 'center', borderTopWidth: 1, paddingTop: Spacing.two, marginTop: Spacing.two },
  jumpLatest: { position: 'absolute', right: Spacing.three, bottom: Spacing.two, minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: 22, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  scroll: { padding: Spacing.three, gap: Spacing.three },
  messageGroup: { gap: Spacing.one },
  date: { textAlign: 'center', paddingVertical: Spacing.two },
  timeMine: { alignSelf: 'flex-end' },
  heartBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  // 내가 누른 하트만 진하게: 옅은 배경 + 테두리 + 그림자.
  heartBadgeMine: {
    backgroundColor: 'rgba(0,0,0,0.06)', borderColor: 'rgba(0,0,0,0.14)',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  heartBadgeTextMine: { color: '#1c1c1e', textShadowColor: 'rgba(0,0,0,0.30)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  empty: { textAlign: 'center', paddingVertical: Spacing.five },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', paddingRight: Spacing.five },
  rowBody: { gap: Spacing.one, flexShrink: 1 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bubble: { borderWidth: 1, borderRadius: 14, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: Spacing.two, alignSelf: 'flex-start' },
  bubbleMine: { alignSelf: 'flex-end', borderRadius: 14, borderTopRightRadius: 4, paddingHorizontal: 12, paddingVertical: Spacing.two, marginLeft: Spacing.five },
  chatPhoto: { width: 210, height: 180, borderRadius: 10 },
  locationCard: { minWidth: 176, minHeight: 110, gap: Spacing.one, justifyContent: 'center' },
  photoPreview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, flexWrap: 'wrap' },
  previewImage: { width: 52, height: 52, borderRadius: 8 },
  previewActions: { flex: 1, minWidth: 90 },
  addAttachment: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  attachmentMenu: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.four, paddingHorizontal: Spacing.two, paddingTop: Spacing.two },
  attachmentOption: { minWidth: 112, minHeight: 86, gap: Spacing.one, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  attachmentIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.18, shadowRadius: 11, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  photoBackdrop: { flex: 1, backgroundColor: '#0B0B12', justifyContent: 'center' },
  photoClose: { position: 'absolute', top: 50, right: 16, zIndex: 2, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  fullPhoto: { width: '100%', height: '100%' },
  messageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  feedback: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  reviewPick: { flexDirection: 'row', gap: Spacing.two },
  reviewOption: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  confirmation: { padding: Spacing.three, gap: Spacing.two },
  composer: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 14 },
});
