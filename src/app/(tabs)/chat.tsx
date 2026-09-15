import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, DeviceEventEmitter, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRoom } from '@/components/chat-room';
import { LoginPanel } from '@/components/login-panel';
import { RelationshipSlotCard } from '@/components/relationship-slot-card';
import { ThemedText } from '@/components/themed-text';
import { TabContent } from '@/components/tab-content';
import { TrustBadge } from '@/components/trust-badge';
import { MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { getCommunityActionError, loadConversations, loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT, respondMeetupRequest, type ConversationPage, type ConversationFilter, type MeetupRequest } from '@/lib/community-data';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';

type Inbox = ConversationPage & { userId: string; filter: ConversationFilter; requests: MeetupRequest[] };

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
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selection, setSelection] = useState<{ userId: string; id: string } | null>(null);
  const [filter, setFilter] = useState<ConversationFilter>(view === 'requests' ? 'requests' : 'all');
  const selectionId = useRef<string | null>(null);
  const activeFilter = useRef(filter);
  const inFlight = useRef<{ key: string; request: number; promise: Promise<void> } | null>(null);
  const pageBusy = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useLayoutEffect(() => { currentUser.current = userId; activeFilter.current = filter; version.current += 1; }, [userId, filter, conversationId]);
  useLayoutEffect(() => { selectionId.current = selection?.userId === userId ? selection.id : null; }, [selection, userId]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ userId: string; text: string } | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const conversations = inbox?.userId === userId && inbox.filter === filter ? inbox.conversations : [];
  const requests = inbox?.userId === userId ? inbox.requests : [];
  const openConversation = selection?.userId === userId ? conversations.find((item) => item.id === selection.id)
    ?? (inbox?.userId === userId && inbox.selectedConversation?.id === selection.id ? inbox.selectedConversation : undefined) : undefined;
  const pendingCount = (inbox?.userId === userId ? inbox.pendingCount : 0) + requests.length;
  const displayed = conversations;

  const refresh = useCallback(async () => {
    if (!userId || currentUser.current !== userId) return;
    const key = `${userId}:${filter}:${conversationId ?? ''}`;
    if (inFlight.current?.key === key) return inFlight.current.promise;
    const request = ++version.current;
    setLoading(true); setError(null);
    const promise = (async () => {
      try {
        const [next, nextRequests] = await Promise.all([
          loadConversations(supabase, userId, filter, null, conversationId ?? selectionId.current),
          loadPendingMeetupRequests(supabase, userId),
        ]);
        if (currentUser.current !== userId || version.current !== request) return;
        setInbox({ ...next, userId, filter, requests: nextRequests });
        if (conversationId && next.selectedConversation) setSelection({ userId, id: next.selectedConversation.id });
      } catch { if (currentUser.current === userId && version.current === request) setError({ userId, text: t.chat.loadError }); }
      finally {
        if (currentUser.current === userId && version.current === request) setLoading(false);
        if (inFlight.current?.request === request) inFlight.current = null;
      }
    })();
    inFlight.current = { key, request, promise };
    return promise;
  }, [conversationId, filter, userId]);
  const changed = useCallback(async () => { await Promise.all([refresh(), refreshMembership()]); }, [refresh, refreshMembership]);
  useFocusEffect(useCallback(() => {
    if (view === 'requests' && !conversationId) { setFilter('requests'); setSelection(null); }
  }, [conversationId, view]));
  useFocusEffect(useCallback(() => {
    void changed(); return () => { version.current += 1; inFlight.current = null; };
  }, [changed]));
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision = 0;
    const schedule = () => {
      const next = ++revision;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          await inFlight.current?.promise;
          if (active && revision === next) await changed();
        })();
      }, 150);
    };
    const channel = supabase.channel(`inbox:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, schedule)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: message }) => {
        if (!active) return;
        // The event already passed message RLS. Update visible previews without refetching history.
        setInbox((current) => {
          if (!current || current.userId !== userId) return current;
          const update = (item: Inbox['conversations'][number]) => item.id === message.conversation_id
            && typeof message.created_at === 'string' && message.created_at >= item.latestAt
            ? { ...item, latestBody: message.body as string, latestAt: message.created_at } : item;
          return { ...current, conversations: current.conversations.map(update).sort((a, b) =>
            Number(b.status === 'active') - Number(a.status === 'active') || b.latestAt.localeCompare(a.latestAt) || b.id.localeCompare(a.id)),
          selectedConversation: current.selectedConversation ? update(current.selectedConversation) : null };
        });
        // Reconcile only when a snapshot was already in flight, so it cannot overwrite this event.
        if (inFlight.current) schedule();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetup_requests', filter: `host_id=eq.${userId}` }, schedule)
      .subscribe();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, schedule);
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active') schedule(); });
    return () => { active = false; clearTimeout(timer); listener.remove(); appState.remove(); void supabase.removeChannel(channel); };
  }, [changed, userId]);

  const loadMore = async () => {
    if (!userId || pageBusy.current || loading || !inbox?.cursor || inbox.userId !== userId || inbox.filter !== filter) return;
    const request = version.current;
    pageBusy.current = true; setLoadingMore(true);
    try {
      const next = await loadConversations(supabase, userId, filter, inbox.cursor);
      if (currentUser.current !== userId || activeFilter.current !== filter || version.current !== request) return;
      setInbox((current) => {
        if (!current || current.userId !== userId || current.filter !== filter) return current;
        const ids = new Set(current.conversations.map(({ id }) => id));
        return { ...current, cursor: next.cursor, pendingCount: next.pendingCount,
          conversations: [...current.conversations, ...next.conversations.filter(({ id }) => !ids.has(id))] };
      });
    } catch { if (currentUser.current === userId && version.current === request) setError({ userId, text: t.chat.loadError }); }
    finally { pageBusy.current = false; setLoadingMore(false); }
  };

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

  if (!auth.isAuthed) return <LoginPanel reason={t.auth.reasonChat} onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  return <TabContent style={styles.container}><SafeAreaView style={styles.safeArea} edges={['top']}>
    <FlatList data={displayed} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
      onEndReached={() => void loadMore()} onEndReachedThreshold={0.4}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.accent} accessibilityLabel={t.chat.loading} /> : null}
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
  </SafeAreaView><Modal visible={!!openConversation} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => { setSelection(null); router.setParams({ conversationId: undefined }); }}>
    {openConversation && <ChatRoom key={`${userId}:${openConversation.id}`} conversation={openConversation} currentUserId={auth.me.id} onChanged={changed} onClose={() => { setSelection(null); router.setParams({ conversationId: undefined }); void changed(); }} />}
  </Modal></TabContent>;
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
