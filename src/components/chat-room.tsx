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
import { blockUser, endConversation, getCommunityActionError, isContentRejected, loadConversationMessages, respondDirectConversation, sendDirectMessage, type ChatMessageRecord, type ConversationPreview, type ReportTarget } from '@/lib/community-data';
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
  const group = conversation.kind === 'group';
  const requestedByMe = conversation.requesterId === currentUserId;
  const title = group ? conversation.title : conversation.otherUser.nickname;

  const refreshMessages = useCallback(async () => {
    if (!access.read || !valid()) return;
    const request = ++loadingRequest.current;
    setLoading(true);
    try {
      const rows = await loadConversationMessages(supabase, conversation.id);
      if (!valid() || loadingRequest.current !== request) return;
      setMessages((previous) => [...previous.filter((item) => !rows.some(({ id }) => id === item.id)), ...rows].filter((item) => !blockedUsers.current.has(item.sender_id)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
      setHasOlder(rows.length === 50);
    } catch { if (valid() && loadingRequest.current === request) setError(t.chat.loadMessagesError); }
    finally { if (valid() && loadingRequest.current === request) setLoading(false); }
  }, [access.read, conversation.id, valid]);
  useEffect(() => {
    void Promise.resolve().then(refreshMessages);
    const channel = supabase.channel(`room:${currentUserId}:${conversation.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversation.id}` }, ({ new: value }) => {
        if (!valid()) return;
        const next = value.status as ConversationPreview['status'];
        if (['pending', 'active', 'ended', 'rejected', 'cancelled'].includes(next)) setResolvedStatus(next);
        void onChanged();
      });
    if (access.read) channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, () => void refreshMessages());
    channel.subscribe();
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active' && valid()) { void refreshMessages(); void onChanged(); } });
    return () => { loadingRequest.current += 1; appState.remove(); void supabase.removeChannel(channel); };
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
  const send = async () => {
    const body = draft.trim();
    if (!body || sending || processing.current || !access.write || !valid()) return;
    processing.current = true; setSending(true); setError(null);
    try {
      const id = await sendDirectMessage(supabase, conversation.id, body);
      if (!valid()) return;
      setMessages((previous) => previous.some((item) => item.id === id) ? previous : [...previous, { id, conversation_id: conversation.id, sender_id: currentUserId, sender_nickname: auth.me.nickname, body, created_at: new Date().toISOString() }]);
      setDraft(''); play('message');
    } catch (failure) { if (valid()) { play('warning'); setError(isContentRejected(failure) ? t.safety.contentBlockedBody : t.chat.sendError); await onChanged(); } }
    finally { processing.current = false; if (valid()) setSending(false); }
  };
  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !messages[0] || !access.read || !valid()) return;
    setLoadingOlder(true);
    try {
      const rows = await loadConversationMessages(supabase, conversation.id, messages[0].created_at);
      if (!valid()) return;
      setMessages((previous) => [...rows.filter((row) => !previous.some(({ id }) => id === row.id)), ...previous].filter((item) => !blockedUsers.current.has(item.sender_id))); setHasOlder(rows.length === 50);
    } catch { if (valid()) setError(t.chat.loadMessagesError); }
    finally { if (valid()) setLoadingOlder(false); }
  };

  if (!auth.isAuthed || auth.me.id !== currentUserId) return null;
  return <ThemedView style={{ flex: 1 }}>
    <View style={[styles.head, { borderBottomColor: theme.line }]}><View style={styles.titleRow}><ThemedText type="smallBold" style={styles.title}>{title}</ThemedText>{!group && <TrustBadge verified={conversation.otherUser.verificationLevel >= 2} trustLevel={conversation.otherUser.verificationLevel === 3 ? 3 : conversation.otherUser.verificationLevel === 2 ? 2 : undefined} />}</View><RoomAction label={t.detail.close} onPress={onClose} /></View>
    <View style={styles.toolbar}>{access.write && <RoomAction label={group ? conversation.isGroupHost ? t.meetup.end : t.meetup.leave : t.chat.end} onPress={() => setConfirmEnd(true)} />}{!group && <><RoomAction label={t.report.short} onPress={() => setReport({ targetType: 'user', targetId: conversation.otherUser.id, reportedUserId: conversation.otherUser.id, reportedNickname: conversation.otherUser.nickname })} /><RoomAction label={t.chat.block} onPress={() => void block(conversation.otherUser.id)} /></>}</View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {status === 'pending' ? <ScrollView contentContainerStyle={styles.request}><ThemedText type="smallBold">{requestedByMe ? t.chat.requestSent : t.chat.receivedRequest}</ThemedText><ThemedText type="small" themeColor="textSecondary">{t.chat.pendingBody}</ThemedText><ThemedText type="small">{requestedByMe ? t.chat.requesterRisk : t.chat.acceptBody}</ThemedText>
        {requestedByMe ? <RoomAction label={t.chat.cancelRequest} onPress={() => void respond('cancelled')} disabled={busy} /> : <><RoomAction label={confirmAccept ? '확인하고 수락' : t.chat.accept} onPress={() => confirmAccept ? void respond('accepted') : setConfirmAccept(true)} disabled={busy} primary />{confirmAccept && <ThemedText type="small" themeColor="accent">내 대화 자리 1개를 사용해요. 양쪽에 빈자리가 있을 때 수락할 수 있어요.</ThemedText>}<RoomAction label={t.chat.reject} onPress={() => void respond('rejected')} disabled={busy} /></>}
      </ScrollView> : access.read ? loading && messages.length === 0 ? <View style={styles.center}><ActivityIndicator color={theme.accent} accessibilityLabel={t.chat.loading} /></View> : <FlatList data={messages} keyExtractor={(message) => message.id} contentContainerStyle={styles.scroll}
        ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{access.write ? t.chat.newConversation : t.chat.endedBody}</ThemedText>}
        ListHeaderComponent={hasOlder && messages.length > 0 ? <RoomAction label={loadingOlder ? t.feed.loadingMore : t.chat.loadOlder} onPress={() => void loadOlder()} disabled={loadingOlder} /> : null}
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
      if (access.read) void loadConversationMessages(supabase, conversation.id).then((rows) => { if (valid()) { setMessages(rows); setHasOlder(rows.length === 50); } }).catch(() => { if (valid()) setError(t.chat.loadMessagesError); });
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
  confirmation: { padding: Spacing.three, gap: Spacing.two },
  composer: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 14 },
});
