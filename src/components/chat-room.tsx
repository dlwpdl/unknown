import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { blockUser, endConversation, getCommunityActionError, loadListingReviewState, writeListingReview, type ListingReviewState, isContentRejected, loadConversationMessages, loadConversationMessagesByIds, mergeChatMessages, respondDirectConversation, sendDirectMessage, type ChatMessageRecord, type ConversationPreview, type ReportTarget } from '@/lib/community-data';
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
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, primary && { backgroundColor: theme.accent }, { opacity: disabled ? 0.55 : pressed ? 0.7 : 1 }]}><ThemedText type="smallBold" style={{ color: primary ? theme.accentInk : theme.accent }}>{label}</ThemedText></Pressable>;
}

export function ChatRoom({ conversation, currentUserId, onClose, onChanged }: { conversation: ConversationPreview; currentUserId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const theme = useTheme();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { play } = useInteractionFeedback();
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
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [draft, setDraft] = useState('');
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
          if (request === loadingRequest.current) setMessages((previous) => mergeChatMessages(previous, rows, blockedUsers.current));
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
  }, [access.read, conversation.id, currentUserId, onChanged, refreshMessages, valid]);

  const respond = async (response: 'accepted' | 'rejected' | 'cancelled') => {
    if (processing.current || status !== 'pending' || !valid()) return;
    processing.current = true; setBusy(true); setError(null);
    try {
      await respondDirectConversation(supabase, conversation.id, response);
      if (!valid()) return;
      setResolvedStatus(response === 'accepted' ? 'active' : response);
      setConfirmAccept(false);
      await onChanged();
      if (valid() && response !== 'accepted') onClose();
    } catch (failure) {
      if (!valid()) return;
      const code = getCommunityActionError(failure);
      const message = code ? t.actionErrors[code] : null;
      setError(message ? `${message.title} ${message.body}` : t.chat.startErrorBody);
      await onChanged();
    } finally { processing.current = false; if (valid()) setBusy(false); }
  };
  const end = async () => {
    if (processing.current || !valid()) return;
    processing.current = true; setBusy(true); setError(null);
    try { await endConversation(supabase, conversation.id); if (valid()) { setResolvedStatus('ended'); setConfirmEnd(false); await onChanged(); } }
    catch { if (valid()) setError(t.chat.endError); }
    finally { processing.current = false; if (valid()) setBusy(false); }
  };
  const block = async (blockedUserId: string) => {
    if (!valid() || blockedUserId === currentUserId) return;
    try {
      await blockUser(supabase, currentUserId, blockedUserId);
      if (!valid()) return;
      if (group) { blockedUsers.current.add(blockedUserId); setMessages((previous) => previous.filter((message) => message.sender_id !== blockedUserId)); }
      else setResolvedStatus(status === 'pending' ? 'cancelled' : 'ended');
      setNotice(t.chat.blockDone); await onChanged();
    } catch { if (valid()) setError(t.chat.blockError); }
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
    processing.current = true; setSending(true); setError(null);
    try {
      const id = await sendDirectMessage(supabase, conversation.id, body);
      await snapshot.current;
      if (!valid()) return;
      setMessages((previous) => previous.some((item) => item.id === id) ? previous : [...previous, { id, conversation_id: conversation.id, sender_id: currentUserId, sender_nickname: auth.me.nickname, body, created_at: new Date().toISOString() }]);
      setDraft(''); play('message');
    } catch (failure) { if (valid()) { play('warning'); setError(isContentRejected(failure) ? t.safety.contentBlockedBody : t.chat.sendError); await onChanged(); } }
    finally { processing.current = false; if (valid()) setSending(false); }
  };
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
    <View style={styles.toolbar}>{access.write && <RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} onPress={() => setConfirmEnd(true)} />}{!group && <><RoomAction label={t.report.short} onPress={() => setReport({ targetType: 'user', targetId: conversation.otherUser.id, reportedUserId: conversation.otherUser.id, reportedNickname: conversation.otherUser.nickname })} /><RoomAction label={t.chat.block} onPress={() => void block(conversation.otherUser.id)} /></>}</View>
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
            <Pressable key={label} onPress={() => setReviewPick(value)} accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: busy }} disabled={busy}
              style={({ pressed }) => [styles.reviewOption,
                { borderColor: on ? theme.accent : theme.line, backgroundColor: on ? theme.card : 'transparent' },
                pressed && { transform: [{ scale: 0.985 }] }]}>
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
      {status === 'pending' ? <ScrollView contentContainerStyle={styles.request}>{verificationNotice}<ThemedText type="smallBold">{requestedByMe ? t.chat.requestSent : t.chat.receivedRequest}</ThemedText><ThemedText type="small" themeColor="textSecondary">{t.chat.pendingBody}</ThemedText><ThemedText type="small">{requestedByMe ? t.chat.requesterRisk : t.chat.acceptBody}</ThemedText>
        {requestedByMe ? <RoomAction label={t.chat.cancelRequest} onPress={() => void respond('cancelled')} disabled={busy} /> : <><RoomAction label={confirmAccept ? '확인하고 수락' : t.chat.accept} onPress={() => confirmAccept ? void respond('accepted') : setConfirmAccept(true)} disabled={busy} primary />{confirmAccept && <ThemedText type="small" themeColor="accent">내 대화 자리 1개를 사용해요. 양쪽에 빈자리가 있을 때 수락할 수 있어요.</ThemedText>}<RoomAction label={t.chat.reject} onPress={() => void respond('rejected')} disabled={busy} /></>}
      </ScrollView> : access.read ? loading && messages.length === 0 ? <View style={styles.center}><ActivityIndicator color={theme.accent} accessibilityLabel={t.chat.loading} /></View> : <FlatList data={messages} keyExtractor={(message) => message.id} contentContainerStyle={styles.scroll}
        ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{access.write ? t.chat.newConversation : t.chat.endedBody}</ThemedText>}
        ListHeaderComponent={<>{hasOlder && messages.length > 0 && <RoomAction label={loadingOlder ? t.feed.loadingMore : t.chat.loadOlder} onPress={() => void loadOlder()} disabled={loadingOlder} />}{verificationNotice}</>}
        renderItem={({ item: message }) => {
          const author = conversationSender(message, conversation);
          if (message.sender_id === currentUserId) return <View style={[styles.bubbleMine, { backgroundColor: theme.accent }]}><ThemedText type="small" style={{ color: theme.accentInk }}>{message.body}</ThemedText></View>;
          return <View style={styles.row}><View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="navy">{author.nickname[0]}</ThemedText></View><View style={styles.rowBody}><ThemedText type="smallBold">{author.nickname}</ThemedText><View style={[styles.bubble, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="small">{message.body}</ThemedText></View><View style={styles.messageActions}><RoomAction label={t.report.short} onPress={() => setReport({ targetType: 'message', targetId: message.id, reportedUserId: author.id, reportedNickname: author.nickname })} />{group && <RoomAction label={t.chat.block} onPress={() => void block(author.id)} />}</View></View></View>;
        }} /> : <View style={styles.request}><ThemedText type="small" themeColor="textSecondary">처리되거나 취소된 요청이에요. 대화 목록에서 새로 확인해 주세요.</ThemedText></View>}
      {!!error && <ThemedText accessibilityRole="alert" type="small" themeColor="accent" style={styles.feedback}>{error}</ThemedText>}{notice && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.feedback}>{notice}</ThemedText>}
      {confirmEnd && access.write && <View style={[styles.confirmation, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{t.chat.endConfirm}</ThemedText><ThemedText type="small">{conversationExitNotice(conversation, currentUserId)}</ThemedText><View style={styles.messageActions}><RoomAction label={t.profile.cancel} onPress={() => setConfirmEnd(false)} disabled={busy} /><RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} onPress={() => void end()} disabled={busy} primary /></View></View>}
      {access.write ? <View style={[styles.composer, { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one }]}><TextInput value={draft} onChangeText={setDraft} maxLength={2000} placeholder={t.chat.messagePlaceholder} accessibilityLabel={t.chat.messagePlaceholder} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]} /><RoomAction label={sending ? t.chat.sending : t.chat.send} onPress={() => void send()} disabled={sending || busy || !draft.trim()} primary /></View> : status === 'ended' && <ThemedText type="small" themeColor="textSecondary" style={[styles.feedback, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>{t.chat.endedBody}</ThemedText>}
    </KeyboardAvoidingView>
    {report && <ReportSheet visible {...report} onClose={() => {
      setReport(null); void onChanged();
      void refreshMessages();
    }} />}
  </ThemedView>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 1, gap: Spacing.two },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  title: { fontSize: 16, flexShrink: 1 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', paddingHorizontal: Spacing.two },
  action: { minWidth: 44, minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, justifyContent: 'center', alignItems: 'center' },
  request: { padding: Spacing.three, gap: Spacing.three },
  safetyNotice: { padding: Spacing.three, borderRadius: 12, gap: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three },
  empty: { textAlign: 'center', paddingVertical: Spacing.five },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', paddingRight: Spacing.five },
  rowBody: { gap: Spacing.one, flexShrink: 1 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bubble: { borderWidth: 1, borderRadius: 14, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: Spacing.two, alignSelf: 'flex-start' },
  bubbleMine: { alignSelf: 'flex-end', borderRadius: 14, borderTopRightRadius: 4, paddingHorizontal: 12, paddingVertical: Spacing.two, marginLeft: Spacing.five },
  messageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  feedback: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  reviewPick: { flexDirection: 'row', gap: Spacing.two },
  reviewOption: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  confirmation: { padding: Spacing.three, gap: Spacing.two },
  composer: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 14 },
});
