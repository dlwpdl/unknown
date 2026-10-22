import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, DeviceEventEmitter, LayoutAnimation, Modal, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRoom } from '@/components/chat-room';
import { GlassSurface } from '@/components/glass-surface';
import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { RaisedActionButton } from '@/components/raised-action-button';
import { LoginPanel } from '@/components/login-panel';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { chatListTime, meetupChatIcon } from '@/lib/chat-details';
import { TabContent } from '@/components/tab-content';
import { TrustBadge } from '@/components/trust-badge';
import { Depth, MaxContentWidth, Spacing, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { getCommunityActionError, loadConversations, loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT, respondMeetupRequest, type ConversationPage, type ConversationFilter, type MeetupRequest } from '@/lib/community-data';
import { meetupRestrictionError } from '@/lib/meetup-policy';
import { getChillingError } from '@/lib/chilling-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';

type Inbox = ConversationPage & { userId: string; filter: ConversationFilter; requests: MeetupRequest[] };
const MEETUP_CHAT_ICONS = {
  'disco-ball': require('@/assets/brand/chat-3d/disco-ball.png'),
  ticket: require('@/assets/brand/chat-3d/ticket.png'),
  microphone: require('@/assets/brand/chat-3d/microphone.png'),
  sunset: require('@/assets/brand/chat-3d/sunset.png'),
  'sports-shoe': require('@/assets/brand/chat-3d/sports-shoe.png'),
  popcorn: require('@/assets/brand/chat-3d/popcorn.png'),
  beer: require('@/assets/brand/chat-3d/beer.png'),
} as const;

export default function ChatScreen() {
  // Pushing a tab route from a stack screen can mount the tabs twice; keep channel names unique per mount.
  const channelId = useId();
  const theme = useTheme();
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const reducedMotion = useReducedMotion();
  const { conversationId, view } = useLocalSearchParams<{ conversationId?: string; view?: string }>();
  const auth = useAuth();
  const userId = auth.isAuthed ? auth.me.id : null;
  const { membership, refresh: refreshMembership } = useMembership();
  const { play } = useInteractionFeedback();
  const meetupSlots = relationshipSlotData(membership, 'meetup');
  const currentUser = useRef(userId);
  const version = useRef(0);
  const processing = useRef(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selection, setSelection] = useState<{ userId: string; id: string } | null>(null);
  const [filter, setFilter] = useState<ConversationFilter>(view === 'requests' || view === 'group' || view === 'direct' ? view : 'all');
  const selectionId = useRef<string | null>(null);
  const activeFilter = useRef(filter);
  const inFlight = useRef<{ key: string; request: number; promise: Promise<void> } | null>(null);
  const pageBusy = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  useLayoutEffect(() => { currentUser.current = userId; activeFilter.current = filter; version.current += 1; }, [userId, filter, conversationId]);
  useLayoutEffect(() => { selectionId.current = selection?.userId === userId ? selection.id : null; }, [selection, userId]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ userId: string; text: string } | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const conversations = inbox?.userId === userId && inbox.filter === filter ? inbox.conversations : [];
  const requests = inbox?.userId === userId ? inbox.requests : [];
  const openConversation = selection?.userId === userId ? conversations.find((item) => item.id === selection.id)
    ?? (inbox?.userId === userId && inbox.selectedConversation?.id === selection.id ? inbox.selectedConversation : undefined) : undefined;
  const [modalConversation, setModalConversation] = useState<typeof openConversation>(undefined);
  const shownConversation = openConversation ?? modalConversation;
  const animateList = useCallback(() => {
    if (reducedMotion) return;
    if (Platform.OS === 'android') UIManager?.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation?.configureNext?.(LayoutAnimation.Presets.easeInEaseOut);
  }, [reducedMotion]);
  const pendingCount = (inbox?.userId === userId ? inbox.pendingCount : 0) + requests.length;
  const displayed = conversations;
  const initialLoading = loading && (inbox?.userId !== userId || inbox.filter !== filter);

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
        animateList();
        setInbox({ ...next, userId, filter, requests: nextRequests });
        if (conversationId && next.selectedConversation) { setSelection({ userId, id: next.selectedConversation.id }); setModalConversation(next.selectedConversation); }
      } catch { if (currentUser.current === userId && version.current === request) setError({ userId, text: t.chat.loadError }); }
      finally {
        if (currentUser.current === userId && version.current === request) setLoading(false);
        if (inFlight.current?.request === request) inFlight.current = null;
      }
    })();
    inFlight.current = { key, request, promise };
    return promise;
  }, [animateList, conversationId, filter, userId]);
  const changed = useCallback(async () => { await Promise.all([refresh(), refreshMembership()]); }, [refresh, refreshMembership]);
  const pullRefresh = useCallback(async () => { setPullRefreshing(true); try { await changed(); } finally { setPullRefreshing(false); } }, [changed]);
  useFocusEffect(useCallback(() => {
    if ((view === 'requests' || view === 'group' || view === 'direct') && !conversationId) { setFilter(view); setSelection(null); }
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
    const channel = supabase.channel(`inbox:${userId}:${channelId}`)
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
  }, [changed, userId, channelId]);

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
      play(response === 'approved' ? 'meetup' : 'warning');
      setApproveId(null);
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      await changed();
      if (currentUser.current === owner && nextId) router.setParams({ conversationId: nextId });
    } catch (failure) {
      if (currentUser.current !== owner) return;
      play('warning');
      const code = getCommunityActionError(failure);
      const message = code ? t.actionErrors[code] : null;
      Alert.alert(code === 'MEETUP_JOIN_RESTRICTED' ? '신청자의 새 모임 참여가 제한 중이에요' : message?.title ?? t.chat.requestError, meetupRestrictionError(failure) ?? getChillingError(failure));
      await refresh();
    } finally { processing.current = false; if (currentUser.current === owner) setRequestBusy(null); }
  };

  if (!auth.isAuthed) return <LoginPanel reason={t.auth.reasonChat} onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  return <TabContent style={styles.container}><SafeAreaView style={styles.safeArea} edges={['top']}>
    {/* 홈·모임과 같게 제목 줄은 고정한다. 필터와 안내는 목록과 함께 스크롤된다. */}
    <View style={[styles.headRow, styles.headFixed, { backgroundColor: theme.background }]}>
      <ThemedText accessibilityRole="header" style={styles.heading}>{t.tabs.chat}</ThemedText>
      <ProfileAvatarButton />
      <GlassSurface tone="control" interactive style={styles.refreshGlass}><Pressable analyticsId="app_tabs_chat.pressable.1" onPress={() => { play('selection'); void changed(); }} accessibilityRole="button" accessibilityLabel={t.chat.refresh} disabled={loading} accessibilityState={{ disabled: loading }} style={({ pressed }) => [styles.refreshAction, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent', opacity: loading ? 0.45 : 1 }]}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={19} tintColor={theme.accent} /></Pressable></GlassSurface>
    </View>
    <FlatList analyticsId="app_tabs_chat.flatlist.1" data={displayed} keyExtractor={(item) => item.id} contentContainerStyle={[styles.list, initialLoading && styles.loadingList]}
      onEndReached={() => void loadMore()} onEndReachedThreshold={0.4}
      ListFooterComponent={!initialLoading && loadingMore ? <GlingLoader color={theme.accent} accessibilityLabel={t.chat.loading} /> : null}
      refreshing={pullRefreshing} onRefresh={() => void pullRefresh()}
      ListHeaderComponent={initialLoading ? null : <View style={styles.header}>
        <View style={[styles.safety, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}><ThemedText type="smallBold" themeColor="accent">{t.safety.meetTitle}</ThemedText><ThemedText type="small" themeColor="textSecondary">{t.safety.meetBody}</ThemedText></View>
        {/* 자리(슬롯)는 상태라 칩 안의 숫자와 한 줄 안내로만 보여준다. 큰 카드는 대화 목록을 밀어냈다. */}
        <View style={styles.filters}>{([['all', t.chat.all],
          // 관리자에게는 자리 한도가 적용되지 않으므로 숫자 대신 제한 없음을 알린다.
          ['group', auth.isAdmin ? `${t.chat.groups} 제한 없음` : `${t.chat.groups}${meetupSlots ? ` ${meetupSlots.active}/${meetupSlots.limit}` : ''}`],
          ['direct', t.chat.direct],
          ['requests', `${t.chat.requestTab} ${pendingCount}`]] as const).map(([key, label]) => <Pressable analyticsId="app_tabs_chat.pressable.2" key={key} onPress={() => { play('selection'); if (key !== filter) { animateList(); setLoading(true); setFilter(key); } }} accessibilityRole="tab" accessibilityState={{ selected: filter === key }} style={({ pressed }) => [styles.filter, Depth.control, { backgroundColor: filter === key ? theme.accent : theme.backgroundElement, borderBottomColor: filter === key ? theme.accentDepth : theme.backgroundSelected, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold" style={{ color: filter === key ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>)}</View>
        {filter === 'requests' && <>
          {requests.length > 0 && <ThemedText type="smallBold">{t.chat.requestsTitle}</ThemedText>}
          {requests.map((request) => <View key={request.id} style={[styles.request, Depth.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={styles.requestIdentity}><View style={[styles.requestAvatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle" themeColor="accent">{(request.requester?.nickname ?? t.chat.member).slice(0, 1)}</ThemedText></View>
              <View style={styles.roomBody}><ThemedText style={styles.requestName}>{request.requester?.nickname ?? t.chat.member}</ThemedText><ThemedText type="small" themeColor="textSecondary">{request.post?.title}</ThemedText><ThemedText type="small" themeColor="accent">승인 대기</ThemedText></View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">{request.post?.room?.eventKind ? '모임 프로필과 질문 답변이 도착했어요.' : request.message || t.chat.requestMessageEmpty}</ThemedText>
            {request.post?.room?.eventKind ? <Pressable analyticsId="app_tabs_chat.pressable.4" onPress={() => { play('selection'); router.push({ pathname: '/meetup-application', params: { requestId: request.id } }); }} accessibilityRole="button" accessibilityLabel={`${request.requester?.nickname ?? t.chat.member}님의 프로필과 신청 답변 검토`} style={styles.action}><ThemedText type="smallBold" themeColor="accent">프로필과 답변 검토하기 ›</ThemedText></Pressable> : <>
            {approveId === request.id && <ThemedText type="small" themeColor="textSecondary">승인하면 신청자의 모임 자리 1개를 사용하고 모임 대화에 참여해요. 기존 멤버의 자리는 추가로 사용하지 않아요.</ThemedText>}
            <View style={styles.requestActions}><Pressable analyticsId="app_tabs_chat.pressable.5" onPress={() => { play('selection'); void handleRequest(request, 'rejected'); }} disabled={requestBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: requestBusy !== null }} style={({ pressed }) => [styles.requestButton, Depth.control, { borderColor: theme.line, backgroundColor: theme.card, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold">{t.chat.reject}</ThemedText></Pressable>
              {approveId === request.id
                ? <RaisedActionButton compact analyticsId="app_tabs_chat.pressable.6" onPress={() => { play('selection'); void handleRequest(request, 'approved'); }} disabled={requestBusy !== null} busy={requestBusy === request.id} label="확인하고 승인" />
                : <Pressable analyticsId="app_tabs_chat.pressable.6" onPress={() => { play('selection'); setApproveId(request.id); }} disabled={requestBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: requestBusy !== null }} style={({ pressed }) => [styles.requestButton, Depth.control, { borderColor: theme.accentDepth, backgroundColor: theme.accent, borderBottomWidth: 3, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{t.chat.approve}</ThemedText></Pressable>}</View></>}
          </View>)}
        </>}
        {error?.userId === userId && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{error.text}</ThemedText>}
      </View>}
      ListEmptyComponent={initialLoading ? <GlingLoader color={theme.accent} accessibilityLabel={t.chat.loading} />
        : loading ? null
        : filter === 'requests' ? (requests.length ? null : <StateCard title="대기 중인 모임 신청이 없어요" body="모임에 신청이 들어오면 여기서 수락하거나 거절할 수 있어요." />)
          : <StateCard title={t.chat.emptyTitle} body={t.chat.emptyBody} />}
      renderItem={({ item, index }) => <Pressable analyticsId="app_tabs_chat.pressable.7" onPress={() => { play('selection'); setModalConversation(item); setSelection({ userId: auth.me.id, id: item.id }); }} accessibilityRole="button" style={({ pressed }) => [styles.room, { borderBottomColor: theme.line, backgroundColor: pressed ? theme.backgroundElement : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }] }]}>
        <ChatAvatar kind={item.kind} title={item.title} meetupCategory={item.meetupCategory} initial={item.kind === 'direct' ? item.otherUser.nickname[0] : ''} active={focused && !shownConversation && index < 8} delay={index * 260} />
        <View style={styles.roomBody}><View style={styles.nickRow}><ThemedText style={[styles.flex, styles.roomName]} numberOfLines={1}>{item.kind === 'group' ? item.title : item.otherUser.nickname}</ThemedText>{item.kind === 'direct' && <TrustBadge verified={item.otherUser.verificationLevel >= 2} trustLevel={item.otherUser.verificationLevel === 3 ? 3 : item.otherUser.verificationLevel === 2 ? 2 : undefined} />}</View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.status === 'pending' ? '대화 상태 확인 중' : item.status === 'ended' ? t.chat.ended : item.latestBody ?? t.chat.newConversation}</ThemedText></View>
        <View style={styles.roomTime}><ThemedText type="small" themeColor="textSecondary">{chatListTime(item.latestAt)}</ThemedText></View>
      </Pressable>} />
  </SafeAreaView><Modal visible={!!openConversation} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={() => { setSelection(null); router.setParams({ conversationId: undefined }); }} onDismiss={() => setModalConversation(undefined)}>
    {shownConversation && <ChatRoom key={`${userId}:${shownConversation.id}`} conversation={shownConversation} currentUserId={auth.me.id} onChanged={changed} onClose={() => { setSelection(null); router.setParams({ conversationId: undefined }); void changed(); }} />}
  </Modal></TabContent>;
}

function ChatAvatar({ kind, title, meetupCategory, initial, active, delay }: { kind: 'group' | 'direct'; title: string; meetupCategory: string | null; initial: string; active: boolean; delay: number }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  const icon = meetupChatIcon(meetupCategory, title);
  useEffect(() => {
    if (kind !== 'group' || !active || reducedMotion) { pulse.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(delay + 1400),
      Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 950, useNativeDriver: true }),
      Animated.delay(2600),
    ]));
    animation.start();
    return () => { animation.stop(); pulse.setValue(0); };
  }, [active, delay, kind, pulse, reducedMotion]);
  return <Animated.View style={[styles.avatar, {
    backgroundColor: kind === 'group' ? 'transparent' : theme.backgroundSelected,
    shadowColor: '#000',
    transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, icon === 'sports-shoe' || icon === 'popcorn' ? -5 : -2] }) },
      { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, icon === 'sunset' ? 1.08 : 1.05] }) },
      { rotate: pulse.interpolate({ inputRange: [0, 1], outputRange: ['0deg', icon === 'disco-ball' ? '9deg' : icon === 'beer' ? '-7deg' : '3deg'] }) }],
  }]}>
    {kind === 'group' ? <>
      {icon === 'sunset' && !reducedMotion && <Animated.View pointerEvents="none" style={[styles.sunsetLight, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.2] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] }) }] }]} />}
      <Image source={MEETUP_CHAT_ICONS[icon]} style={styles.partyIcon} contentFit="contain" accessible={false} />
      {icon === 'beer' && !reducedMotion && <Animated.View pointerEvents="none" style={[styles.iconOverlay, { opacity: pulse }]}><Image source={require('@/assets/brand/chat-3d/beer-full.png')} style={styles.partyIcon} contentFit="contain" accessible={false} /></Animated.View>}
      {icon === 'disco-ball' && !reducedMotion && <Animated.View pointerEvents="none" style={[styles.glint, { opacity: pulse.interpolate({ inputRange: [0, 0.3, 0.7, 1], outputRange: [0, 0, 1, 0] }), transform: [{ rotate: '45deg' }, { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.4] }) }] }]} />}
    </>
      : <ThemedText type="subtitle" themeColor="accent">{initial}</ThemedText>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three },
  list: { gap: Spacing.two, paddingBottom: TabBarHeight + Spacing.three },
  loadingList: { flexGrow: 1, justifyContent: 'center' },
  slotNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth },
  header: { gap: Spacing.two, paddingBottom: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headFixed: { paddingBottom: Spacing.two },
  heading: { flex: 1, fontSize: 22, lineHeight: 30, fontWeight: 700, paddingVertical: Spacing.two },
  safety: { borderWidth: 1, borderRadius: 10, padding: Spacing.three, gap: Spacing.one },
  action: { minWidth: 44, minHeight: 44, padding: Spacing.two, justifyContent: 'center' },
  refreshAction: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  refreshGlass: { borderRadius: 22 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  filter: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 999, borderBottomWidth: 3, alignItems: 'center', justifyContent: 'center' },
  request: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  requestIdentity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, requestAvatar: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, requestName: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
  requestButton: { minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 22 },
  room: { minHeight: 76, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  partyIcon: { width: 52, height: 52 },
  iconOverlay: { position: 'absolute', top: 0, left: 0 },
  glint: { position: 'absolute', top: 7, right: 5, width: 8, height: 8, borderRadius: 2, backgroundColor: '#F9C76C' },
  sunsetLight: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: '#F9C76C' },
  roomBody: { flex: 1, gap: Spacing.one },
  roomName: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  roomTime: { alignItems: 'flex-end', gap: Spacing.one },
  flex: { flexShrink: 1 },
});
