import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRoom } from '@/components/chat-room';
import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import {
  loadConversations,
  loadPendingMeetupRequests,
  respondMeetupRequest,
  type ConversationPreview,
  type MeetupRequest,
} from '@/lib/community-data';
import { supabase } from '@/lib/supabase';

export default function ChatScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const { isAuthed, signInApple, signInKakao, signInDev, isAuthLoading, authError, me } = useAuth();
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [openConversation, setOpenConversation] = useState<ConversationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<MeetupRequest[]>([]);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthed) return;
    setLoading(true);
    setError(null);
    try {
      const [next, nextRequests] = await Promise.all([
        loadConversations(supabase, me.id),
        loadPendingMeetupRequests(supabase, me.id),
      ]);
      setConversations(next);
      setRequests(nextRequests);
    } catch {
      setError(t.chat.loadError);
    } finally {
      setLoading(false);
    }
  }, [isAuthed, me.id]);

  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void Promise.all([loadConversations(supabase, me.id), loadPendingMeetupRequests(supabase, me.id)])
      .then(([next, nextRequests]) => {
        if (!active) return;
        setConversations(next);
        setRequests(nextRequests);
        if (conversationId) setOpenConversation(next.find(({ id }) => id === conversationId) ?? null);
      })
      .catch(() => active && setError(t.chat.loadError));
    return () => { active = false; };
  }, [conversationId, isAuthed, me.id]);

  const handleRequest = async (request: MeetupRequest, response: 'approved' | 'rejected') => {
    if (requestBusy) return;
    setRequestBusy(request.id);
    try {
      const nextConversationId = await respondMeetupRequest(supabase, request.id, response);
      setRequests((current) => current.filter(({ id }) => id !== request.id));
      Alert.alert(t.chat.requestHandled);
      if (nextConversationId) {
        await refresh();
        router.setParams({ conversationId: nextConversationId });
      }
    } catch {
      Alert.alert(t.chat.requestError);
    } finally {
      setRequestBusy(null);
    }
  };

  if (!isAuthed) {
    return (
      <LoginPanel
        reason={t.auth.reasonChat}
        onApple={signInApple}
        onKakao={signInKakao}
        onDevLogin={signInDev}
        loading={isAuthLoading}
        error={authError}
      />
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headRow}>
          <ThemedText type="subtitle" style={styles.heading}>{t.tabs.chat}</ThemedText>
          <Pressable onPress={() => void refresh()} accessibilityRole="button" disabled={loading}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.chat.refresh}</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.safety, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}>
          <ThemedText type="smallBold" style={{ fontSize: 13, color: theme.accent }}>{t.safety.meetTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>{t.safety.meetBody}</ThemedText>
        </View>

        <View style={[styles.slotChip, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold" style={{ color: theme.navy, fontVariant: ['tabular-nums'] }}>
            {t.chat.conversationCount(conversations.length)}
          </ThemedText>
        </View>

        {requests.length > 0 && (
          <View style={styles.requests}>
            <ThemedText type="smallBold">{t.chat.requestsTitle}</ThemedText>
            {requests.map((request) => (
              <View key={request.id} style={[styles.request, { backgroundColor: theme.card, borderColor: theme.line }]}>
                <View style={styles.roomBody}>
                  <ThemedText type="smallBold">{request.requester?.nickname ?? t.chat.newConversation}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{request.post?.title}</ThemedText>
                  <ThemedText type="small">{request.message || t.chat.requestMessageEmpty}</ThemedText>
                </View>
                <View style={styles.requestActions}>
                  <Pressable onPress={() => void handleRequest(request, 'rejected')} disabled={requestBusy != null} accessibilityRole="button" style={[styles.requestButton, { borderColor: theme.line }]}>
                    <ThemedText type="smallBold">{t.chat.reject}</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => void handleRequest(request, 'approved')} disabled={requestBusy != null} accessibilityRole="button" style={[styles.requestButton, { backgroundColor: theme.accent, borderColor: theme.accent }]}>
                    <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{t.chat.approve}</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {!!error && <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.accent }}>{error}</ThemedText>}
        {loading && conversations.length === 0 ? (
          <ActivityIndicator color={theme.accent} accessibilityLabel={t.chat.loading} />
        ) : conversations.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">{t.chat.empty}</ThemedText>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={({ id }) => id}
            contentContainerStyle={styles.list}
            renderItem={({ item: conversation }) => (
              <Pressable
                onPress={() => setOpenConversation(conversation)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.room,
                  { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.7 : 1 },
                ]}>
                <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold" style={{ color: theme.navy }}>{conversation.otherUser.nickname[0]}</ThemedText>
                </View>
                <View style={styles.roomBody}>
                  <View style={styles.nickRow}>
                    <ThemedText type="smallBold">{conversation.otherUser.nickname}</ThemedText>
                    <TrustBadge
                      verified={conversation.otherUser.verificationLevel >= 2}
                      trustLevel={conversation.otherUser.verificationLevel === 3 ? 3 : conversation.otherUser.verificationLevel === 2 ? 2 : undefined}
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {conversation.latestBody ?? t.chat.newConversation}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" themeColor="textSecondary">›</ThemedText>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>

      <Modal
        visible={!!openConversation}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenConversation(null)}>
        {openConversation && (
          <ChatRoom
            conversation={openConversation}
            currentUserId={me.id}
            onClose={() => {
              setOpenConversation(null);
              router.setParams({ conversationId: undefined });
              void refresh();
            }}
          />
        )}
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three, paddingBottom: TabBarHeight },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 22, lineHeight: 30, fontWeight: 700, paddingVertical: Spacing.two },
  safety: { borderWidth: 1, borderRadius: 10, padding: Spacing.three, gap: 4, marginBottom: Spacing.three },
  slotChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: Spacing.three },
  list: { gap: Spacing.two },
  requests: { gap: Spacing.two, marginBottom: Spacing.three },
  request: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  requestActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  requestButton: { minHeight: 38, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
  room: { minHeight: 68, borderWidth: 1, borderRadius: 12, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  roomBody: { flex: 1, gap: Spacing.one },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
