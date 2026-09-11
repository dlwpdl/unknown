import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, DeviceEventEmitter, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRoom } from '@/components/chat-room';
import { LoginPanel } from '@/components/login-panel';
import { RelationshipSlotCard } from '@/components/relationship-slot-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrustBadge } from '@/components/trust-badge';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { getCommunityActionError, loadConversations, loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT, respondMeetupRequest, type ConversationPreview, type MeetupRequest } from '@/lib/community-data';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';

type Filter = 'all' | 'group' | 'direct' | 'requests';
type Inbox = { userId: string; conversations: ConversationPreview[]; requests: MeetupRequest[] };

export default function ChatScreen() {
  const theme = useTheme();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { conversationId, view } = useLocalSearchParams<{ conversationId?: string; view?: string }>();
  const auth = useAuth();
  const userId = auth.isAuthed ? auth.me.id : null;
  const { membership, loading: membershipLoading, refresh: refreshMembership } = useMembership();
  const currentUser = useRef(userId);
  const version = useRef(0);
  const processing = useRef(false);
  useLayoutEffect(() => { currentUser.current = userId; version.current += 1; }, [userId]);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selection, setSelection] = useState<{ userId: string; id: string } | null>(null);
  const [filter, setFilter] = useState<Filter>(view === 'requests' ? 'requests' : 'all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ userId: string; text: string } | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const conversations = inbox?.userId === userId ? inbox.conversations : [];
  const requests = inbox?.userId === userId ? inbox.requests : [];
  const openConversation = selection?.userId === userId ? conversations.find((item) => item.id === selection.id) : undefined;
  const pendingCount = conversations.filter((item) => item.status === 'pending').length + requests.length;
  const displayed = conversations.filter((item) => filter === 'requests' ? item.status === 'pending'
    : item.status !== 'pending' && (item.status === 'active' || item.status === 'ended') && (filter === 'all' || item.kind === filter));

  const refresh = useCallback(async () => {
    if (!userId || currentUser.current !== userId) return;
    const request = ++version.current;
    setLoading(true); setError(null);
    try {
      const [next, nextRequests] = await Promise.all([loadConversations(supabase, userId), loadPendingMeetupRequests(supabase, userId)]);
      if (currentUser.current !== userId || version.current !== request) return;
      setInbox({ userId, conversations: next, requests: nextRequests });
      if (conversationId) {
        const target = next.find((item) => item.id === conversationId);
        if (target) { setSelection({ userId, id: target.id }); setFilter(target.status === 'pending' ? 'requests' : target.kind); }
      }
    } catch { if (currentUser.current === userId && version.current === request) setError({ userId, text: t.chat.loadError }); }
    finally { if (currentUser.current === userId && version.current === request) setLoading(false); }
  }, [conversationId, userId]);
  const changed = useCallback(async () => { await Promise.all([refresh(), refreshMembership()]); }, [refresh, refreshMembership]);
  useFocusEffect(useCallback(() => { void changed(); return () => { version.current += 1; }; }, [changed]));
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`inbox:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => void changed())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetup_requests', filter: `host_id=eq.${userId}` }, () => void changed())
      .subscribe();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void changed());
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active') void changed(); });
    return () => { listener.remove(); appState.remove(); void supabase.removeChannel(channel); };
  }, [changed, refresh, userId]);

  const handleRequest = async (request: MeetupRequest, response: 'approved' | 'rejected') => {
    if (!userId || processing.current) return;
    const owner = userId;
    processing.current = true; setRequestBusy(request.id);
    try {
      const nextId = await respondMeetupRequest(supabase, request.id, response);
      if (currentUser.current !== owner) return;
      setApproveId(null);
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      await changed();
      if (currentUser.current === owner && nextId) router.setParams({ conversationId: nextId });
    } catch (failure) {
      if (currentUser.current !== owner) return;
      const code = getCommunityActionError(failure);
      const message = code ? t.actionErrors[code] : null;
      Alert.alert(message?.title ?? t.chat.requestError, message?.body);
      await refresh();
    } finally { processing.current = false; if (currentUser.current === owner) setRequestBusy(null); }
  };

  if (!auth.isAuthed) return <LoginPanel reason={t.auth.reasonChat} onApple={auth.signInApple} onKakao={auth.signInKakao} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  return <ThemedView style={styles.container}><SafeAreaView style={styles.safeArea} edges={['top']}>
    <FlatList data={displayed} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
      refreshing={loading} onRefresh={() => void changed()}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.headRow}><ThemedText type="subtitle" style={styles.heading}>{t.tabs.chat}</ThemedText><Pressable onPress={() => void changed()} accessibilityRole="button" disabled={loading} accessibilityState={{ disabled: loading }} style={styles.action}><ThemedText type="smallBold" themeColor="accent">{t.chat.refresh}</ThemedText></Pressable></View>
        <View style={[styles.safety, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}><ThemedText type="smallBold" themeColor="accent">{t.safety.meetTitle}</ThemedText><ThemedText type="small" themeColor="textSecondary">{t.safety.meetBody}</ThemedText></View>
        <RelationshipSlotCard kind="conversation" membership={membership} loading={membershipLoading} onMembershipPress={() => router.push('/profile/membership')} />
        <View style={styles.filters}>{([['all', t.chat.all], ['group', t.chat.groups], ['direct', t.chat.direct], ['requests', `${t.chat.requestTab} ${pendingCount}`]] as const).map(([key, label]) => <Pressable key={key} onPress={() => setFilter(key)} accessibilityRole="tab" accessibilityState={{ selected: filter === key }} style={[styles.filter, { backgroundColor: filter === key ? theme.accent : theme.backgroundElement }]}><ThemedText type="smallBold" style={{ color: filter === key ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>)}</View>
        {filter === 'requests' && <>
          <ThemedText type="small" themeColor="textSecondary">{t.chat.pendingBody}</ThemedText>
          {requests.length > 0 && <ThemedText type="smallBold">{t.chat.requestsTitle}</ThemedText>}
          {requests.map((request) => <View key={request.id} style={[styles.request, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <ThemedText type="smallBold">{request.requester?.nickname ?? t.chat.member}</ThemedText><ThemedText type="small" themeColor="textSecondary">{request.post?.title}</ThemedText><ThemedText type="small">{request.message || t.chat.requestMessageEmpty}</ThemedText>
            {approveId === request.id && <ThemedText type="small" themeColor="textSecondary">승인하면 신청자의 모임 자리 1개를 사용하고 모임 대화에 참여해요. 기존 멤버의 자리는 추가로 사용하지 않아요.</ThemedText>}
            <View style={styles.requestActions}><Pressable onPress={() => void handleRequest(request, 'rejected')} disabled={requestBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: requestBusy !== null }} style={[styles.requestButton, { borderColor: theme.line }]}><ThemedText type="smallBold">{t.chat.reject}</ThemedText></Pressable>
              <Pressable onPress={() => approveId === request.id ? void handleRequest(request, 'approved') : setApproveId(request.id)} disabled={requestBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: requestBusy !== null }} style={[styles.requestButton, { borderColor: theme.accent, backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{approveId === request.id ? '확인하고 승인' : t.chat.approve}</ThemedText></Pressable></View>
          </View>)}
        </>}
        {error?.userId === userId && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{error.text}</ThemedText>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator color={theme.accent} accessibilityLabel={t.chat.loading} /> : <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{filter === 'requests' ? requests.length ? '' : '대기 중인 대화 요청이 없어요.' : t.chat.empty}</ThemedText>}
      renderItem={({ item }) => <Pressable onPress={() => setSelection({ userId: auth.me.id, id: item.id })} accessibilityRole="button" style={({ pressed }) => [styles.room, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="navy">{item.kind === 'group' ? '모임' : item.otherUser.nickname[0]}</ThemedText></View>
        <View style={styles.roomBody}><View style={styles.nickRow}><ThemedText type="smallBold" style={styles.flex}>{item.kind === 'group' ? item.title : item.otherUser.nickname}</ThemedText>{item.kind === 'direct' && <TrustBadge verified={item.otherUser.verificationLevel >= 2} trustLevel={item.otherUser.verificationLevel === 3 ? 3 : item.otherUser.verificationLevel === 2 ? 2 : undefined} />}</View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.status === 'pending' ? item.requesterId === userId ? t.chat.sentRequest : t.chat.receivedRequest : item.status === 'ended' ? t.chat.ended : item.latestBody ?? t.chat.newConversation}</ThemedText></View>
        <ThemedText type="smallBold" themeColor="textSecondary">›</ThemedText>
      </Pressable>} />
  </SafeAreaView><Modal visible={!!openConversation} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onRequestClose={() => { setSelection(null); router.setParams({ conversationId: undefined }); }}>
    {openConversation && <ChatRoom key={`${userId}:${openConversation.id}`} conversation={openConversation} currentUserId={auth.me.id} onChanged={changed} onClose={() => { setSelection(null); router.setParams({ conversationId: undefined }); void changed(); }} />}
  </Modal></ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three },
  list: { gap: Spacing.two, paddingBottom: TabBarHeight + Spacing.three },
  header: { gap: Spacing.two, paddingBottom: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 22, lineHeight: 30, fontWeight: 700, paddingVertical: Spacing.two },
  safety: { borderWidth: 1, borderRadius: 10, padding: Spacing.three, gap: Spacing.one },
  action: { minWidth: 44, minHeight: 44, padding: Spacing.two, justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  filter: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  request: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
  requestButton: { minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
  room: { minHeight: 68, borderWidth: 1, borderRadius: 12, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  roomBody: { flex: 1, gap: Spacing.one },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  flex: { flexShrink: 1 },
  empty: { paddingVertical: Spacing.three },
});
