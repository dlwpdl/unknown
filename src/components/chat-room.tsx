import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import {
  loadConversationMessages,
  sendDirectMessage,
  type ChatMessageRecord,
  type ConversationPreview,
} from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function ChatRoom({
  conversation,
  currentUserId,
  onClose,
}: {
  conversation: ConversationPreview;
  currentUserId: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { play } = useInteractionFeedback();
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportedMessage, setReportedMessage] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);

  useEffect(() => {
    let active = true;
    void loadConversationMessages(supabase, conversation.id)
      .then((rows) => {
        if (!active) return;
        setMessages(rows);
        setHasOlder(rows.length === 50);
      })
      .catch(() => active && setError(t.chat.loadMessagesError))
      .finally(() => active && setLoading(false));

    const channel = supabase
      .channel(`messages:${conversation.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
        ({ new: value }) => {
          const message = value as ChatMessageRecord;
          setMessages((current) => current.some(({ id }) => id === message.id) ? current : [...current, message]);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const id = await sendDirectMessage(supabase, conversation.id, body);
      setMessages((current) => current.some((message) => message.id === id) ? current : [
        ...current,
        { id, conversation_id: conversation.id, sender_id: currentUserId, body, created_at: new Date().toISOString() },
      ]);
      setDraft('');
      play('message');
    } catch {
      play('warning');
      setError(t.chat.sendError);
    } finally {
      setSending(false);
    }
  };

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !messages[0]) return;
    setLoadingOlder(true);
    try {
      const rows = await loadConversationMessages(supabase, conversation.id, messages[0].created_at);
      setMessages((current) => [...rows.filter((row) => !current.some(({ id }) => id === row.id)), ...current]);
      setHasOlder(rows.length === 50);
    } catch {
      setError(t.chat.loadMessagesError);
    } finally {
      setLoadingOlder(false);
    }
  };

  const verificationLevel = conversation.otherUser.verificationLevel;

  return (
    <ThemedView style={{ flex: 1 }}>
      <View style={[styles.head, { borderBottomColor: theme.line }]}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold" style={{ fontSize: 16 }}>{conversation.otherUser.nickname}</ThemedText>
          <TrustBadge
            verified={verificationLevel >= 2}
            trustLevel={verificationLevel === 3 ? 3 : verificationLevel === 2 ? 2 : undefined}
          />
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.detail.close}</ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={theme.accent} accessibilityLabel={t.chat.loading} /></View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={({ id }) => id}
            contentContainerStyle={styles.scroll}
            ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{t.chat.newConversation}</ThemedText>}
            ListHeaderComponent={hasOlder && messages.length ? (
              <Pressable onPress={() => void loadOlder()} disabled={loadingOlder} accessibilityRole="button" style={styles.olderButton}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>{loadingOlder ? t.feed.loadingMore : t.chat.loadOlder}</ThemedText>
              </Pressable>
            ) : null}
            renderItem={({ item: message }) => {
              const mine = message.sender_id === currentUserId;
              return mine ? (
                <View style={[styles.bubbleMine, { backgroundColor: theme.accent }]}>
                  <ThemedText type="small" style={{ color: theme.accentInk }}>{message.body}</ThemedText>
                </View>
              ) : (
                <View style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold" style={{ fontSize: 12, color: theme.navy }}>{conversation.otherUser.nickname[0]}</ThemedText>
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.titleRow}>
                      <ThemedText type="smallBold" style={{ fontSize: 12.5 }}>{conversation.otherUser.nickname}</ThemedText>
                      <TrustBadge verified={verificationLevel >= 2} trustLevel={verificationLevel === 3 ? 3 : verificationLevel === 2 ? 2 : undefined} />
                    </View>
                    <View style={[styles.bubble, { backgroundColor: theme.card, borderColor: theme.line }]}>
                      <ThemedText type="small">{message.body}</ThemedText>
                    </View>
                    <Pressable
                      onPress={() => setReportedMessage(message.id)}
                      accessibilityRole="button"
                      style={styles.reportButton}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.reportText}>{t.report.short}</ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}

        {!!error && <ThemedText accessibilityRole="alert" type="small" style={[styles.error, { color: theme.accent }]}>{error}</ThemedText>}
        <View
          style={[
            styles.composer,
            { borderTopColor: theme.line, backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.two) + Spacing.one },
          ]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={2000}
            placeholder={t.chat.messagePlaceholder}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]}
          />
          <Pressable
            onPress={() => void send()}
            disabled={sending || !draft.trim()}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending || !draft.trim(), busy: sending }}
            style={[styles.send, { backgroundColor: theme.accent, opacity: sending || !draft.trim() ? 0.55 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{sending ? t.chat.sending : t.chat.send}</ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ReportSheet
        visible={reportedMessage != null}
        targetType="message"
        targetId={reportedMessage ?? conversation.id}
        reportedUserId={conversation.otherUser.id}
        reportedNickname={conversation.otherUser.nickname}
        onClose={() => setReportedMessage(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 12, borderBottomWidth: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.three },
  olderButton: { alignItems: 'center', paddingVertical: Spacing.two },
  empty: { textAlign: 'center', paddingVertical: Spacing.five },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingRight: Spacing.six },
  rowBody: { gap: 4, flexShrink: 1 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bubble: { borderWidth: 1, borderRadius: 14, borderTopLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start' },
  bubbleMine: { alignSelf: 'flex-end', borderRadius: 14, borderTopRightRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginLeft: Spacing.six },
  reportButton: { alignSelf: 'flex-start', paddingVertical: 2 },
  reportText: { fontSize: 11, lineHeight: 15 },
  error: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  composer: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 14 },
  send: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 10 },
});
