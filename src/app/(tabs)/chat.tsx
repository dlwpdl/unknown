import { t as sourceCopy } from '@/i18n/ko';
import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList } from '@/components/analytics-controls';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, DeviceEventEmitter, Keyboard, LayoutAnimation, Modal, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ChatIdentitySwitcher } from '@/components/chat-identity-switcher';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { selectChatBusiness } from '@/lib/chat-identity';
import { subscribeBusinessChat } from '@/lib/business-chat';
import { loadMyMerchantConnections } from '@/lib/merchant-connections';
import { ChatRoom } from '@/components/chat-room';
import { MeetupHistoryChoice } from '@/components/meetup-room-summary';
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
import { useAuth } from '@/lib/auth';
import { getCommunityActionError, loadConversations, loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT, type ConversationPage, type ConversationFilter, type MeetupRequest } from '@/lib/community-data';
import { meetupRestrictionError } from '@/lib/meetup-policy';
import { getChillingError, respondMeetupRequestV2 } from '@/lib/chilling-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';

type Inbox = ConversationPage & { userId: string; filter: ConversationFilter; requests: MeetupRequest[]; moreRequests?: boolean };
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
  const { tr, t, locale: appLocale } = useLanguage();
  // Pushing a tab route from a stack screen can mount the tabs twice; keep channel names unique per mount.
  const channelId = useId();
  const theme = useTheme();
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const { conversationId, businessId, view } = useLocalSearchParams<{ conversationId?: string; businessId?: string; view?: string }>();
  const auth = useAuth();
  const userId = auth.isAuthed ? auth.me.id : null;
  const business = useChatIdentity(), asBusinessId = business?.id ?? null;
  const scopeKey = userId && (business ? `${userId}:${business.id}` : userId);
  const routeMatches = !conversationId || (businessId ? businessId === asBusinessId : asBusinessId === null);
  const { membership, refresh: refreshMembership } = useMembership();
  const { play } = useInteractionFeedback();
  const meetupSlots = relationshipSlotData(membership, 'meetup');
  const currentUser = useRef(scopeKey);
  const version = useRef(0);
  const processing = useRef(false);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [selection, setSelection] = useState<{ userId: string; id: string } | null>(null);
  const [requestedFilter, setFilter] = useState<ConversationFilter>(view === 'requests' || view === 'group' || view === 'direct' ? view : 'all');
  const filter = asBusinessId && (requestedFilter === 'group' || requestedFilter === 'requests') ? 'direct' : requestedFilter;
  const selectionId = useRef<string | null>(null);
  const activeFilter = useRef(filter);
  const inFlight = useRef<{ key: string; request: number; promise: Promise<void> } | null>(null);
  const pageBusy = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  useLayoutEffect(() => { currentUser.current = scopeKey; activeFilter.current = filter; version.current += 1; }, [scopeKey, filter, conversationId]);
  useLayoutEffect(() => { selectionId.current = selection?.userId === scopeKey ? selection.id : null; }, [selection, scopeKey]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ userId: string; text: string } | null>(null);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null), [shareHistory, setShareHistory] = useState(false);
  const conversations = routeMatches && inbox?.userId === scopeKey && inbox.filter === filter ? inbox.conversations : [];
  const requests = routeMatches && inbox?.userId === scopeKey ? inbox.requests : [];
  const moreRequests = routeMatches && inbox?.userId === scopeKey && inbox.moreRequests === true;
  const openConversation = selection?.userId === scopeKey ? conversations.find((item) => item.id === selection.id)
    ?? (inbox?.userId === scopeKey && inbox.selectedConversation?.id === selection.id ? inbox.selectedConversation : undefined) : undefined;
  const presentationSequence = useRef(0);
  const [modalConversation, setModalConversation] = useState<{ userId: string; conversation: NonNullable<typeof openConversation>; key: number }>();
  const [presentationOwner, setPresentationOwner] = useState(scopeKey);
  if (presentationOwner !== scopeKey) {
    setPresentationOwner(scopeKey); setSelection(null); setModalConversation(undefined);
  }
  const presentation = useRef(modalConversation);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); presentation.current = undefined; setModalConversation(undefined); setSelection(null); };
  }, []));
  const presentConversation = useCallback((conversation: NonNullable<typeof openConversation>) => {
    const next = { userId: scopeKey!, conversation, key: ++presentationSequence.current };
    presentation.current = next;
    setModalConversation(next); setSelection({ userId: scopeKey!, id: conversation.id });
  }, [scopeKey]);
  useLayoutEffect(() => {
    if (!focused || modalConversation?.userId !== scopeKey) {
      presentation.current = undefined;
    }
  }, [focused, scopeKey, modalConversation]);
  // Keep the same room mounted until UIKit finishes dismissing its sheet.
  const shownConversation = focused && modalConversation?.userId === scopeKey && routeMatches ? openConversation ?? modalConversation.conversation : undefined;
  const closeConversation = () => {
    if (!modalConversation || presentation.current !== modalConversation || currentUser.current !== scopeKey || selectionId.current !== modalConversation.conversation.id) return;
    selectionId.current = null;
    if (conversationId) version.current += 1;
    Keyboard.dismiss();
    setSelection(null); router.setParams({ conversationId: undefined, businessId: undefined });
  };
  const animateList = useCallback(() => {
    if (reducedMotion) return;
    if (Platform.OS === 'android') UIManager?.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation?.configureNext?.(LayoutAnimation.Presets.easeInEaseOut);
  }, [reducedMotion]);
  const pendingCount = (inbox?.userId === scopeKey ? inbox.pendingCount : 0) + requests.length;
  const displayed = conversations;
  const initialLoading = loading && (inbox?.userId !== scopeKey || inbox.filter !== filter);

  const refresh = useCallback(async () => {
    if (!userId || currentUser.current !== scopeKey || !routeMatches) return;
    const key = `${scopeKey}:${filter}:${conversationId ?? ''}`;
    if (inFlight.current?.key === key) return inFlight.current.promise;
    const request = ++version.current;
    setLoading(true); setError(null);
    const promise = (async () => {
      try {
        const [next, nextRequests] = await Promise.all([
          loadConversations(supabase, userId, filter, null, conversationId ?? selectionId.current, asBusinessId),
          asBusinessId ? Promise.resolve([]) : loadPendingMeetupRequests(supabase),
        ]);
        if (currentUser.current !== scopeKey || version.current !== request) return;
        animateList();
        setInbox({ ...next, userId: scopeKey!, filter, requests: nextRequests, moreRequests: nextRequests.length === 50 });
        if (conversationId && next.selectedConversation && (presentation.current?.userId !== scopeKey || presentation.current.conversation.id !== next.selectedConversation.id)) presentConversation(next.selectedConversation);
      } catch { if (currentUser.current === scopeKey && version.current === request) { if (asBusinessId) setInbox(null); setError({ userId: scopeKey!, text: sourceCopy.chat.loadError }); } }
      finally {
        if (currentUser.current === scopeKey && version.current === request) setLoading(false);
        if (inFlight.current?.request === request) inFlight.current = null;
      }
    })();
    inFlight.current = { key, request, promise };
    return promise;
  }, [animateList, conversationId, filter, userId, scopeKey, asBusinessId, routeMatches, presentConversation]);
  useEffect(() => {
    if (!userId || !conversationId) return;
    let active = true;
    if (!businessId) { selectChatBusiness(userId, null); return; }
    void loadMyMerchantConnections(supabase, userId, true).then(result => {
      if (!active) return;
      const target = result.merchants.find(item => item.id === businessId && item.role !== 'admin');
      if (!target) throw new Error('MERCHANT_ACCESS_REQUIRED');
      selectChatBusiness(userId, target);
    }).catch(() => { if (active) setError({ userId: scopeKey!, text: '비즈니스 대화 접근 권한을 확인하지 못했어요. 프로필을 다시 선택해 주세요.' }); });
    return () => { active = false; };
  }, [userId, conversationId, businessId, scopeKey]);
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
      if (!active || currentUser.current !== scopeKey || activeFilter.current !== filter) return;
      const next = ++revision;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          await inFlight.current?.promise;
          if (active && currentUser.current === scopeKey && activeFilter.current === filter && revision === next) await changed();
        })();
      }, 150);
    };
    const stopBusiness = subscribeBusinessChat(supabase, userId, event => { if ((event.businessId ?? null) === asBusinessId) schedule(); }, schedule);
    const channel = asBusinessId ? null : supabase.channel(`inbox:${userId}:${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, schedule)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: message }) => {
        if (!active) return;
        // The event already passed message RLS. Update visible previews without refetching history.
        setInbox((current) => {
          if (!current || current.userId !== scopeKey) return current;
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
    return () => { active = false; clearTimeout(timer); listener.remove(); appState.remove(); stopBusiness(); if (channel) void supabase.removeChannel(channel); };
  }, [changed, userId, channelId, asBusinessId, scopeKey, filter]);

  const loadMore = async () => {
    if (!userId || pageBusy.current || loading || !inbox?.cursor || inbox.userId !== scopeKey || inbox.filter !== filter) return;
    const request = version.current;
    pageBusy.current = true; setLoadingMore(true);
    try {
      const next = await loadConversations(supabase, userId, filter, inbox.cursor, null, asBusinessId);
      if (currentUser.current !== scopeKey || activeFilter.current !== filter || version.current !== request) return;
      setInbox((current) => {
        if (!current || current.userId !== scopeKey || current.filter !== filter) return current;
        const ids = new Set(current.conversations.map(({ id }) => id));
        return { ...current, cursor: next.cursor, pendingCount: next.pendingCount,
          conversations: [...current.conversations, ...next.conversations.filter(({ id }) => !ids.has(id))] };
      });
    } catch { if (currentUser.current === scopeKey && version.current === request) setError({ userId: scopeKey!, text: t.chat.loadError }); }
    finally { pageBusy.current = false; setLoadingMore(false); }
  };

  const loadOlderRequests = async () => {
    const last = requests.at(-1);
    if (!last || asBusinessId || pageBusy.current || loading || !inbox?.moreRequests || inbox.userId !== scopeKey) return;
    const request = version.current;
    pageBusy.current = true; setLoadingMore(true);
    try {
      const next = await loadPendingMeetupRequests(supabase, { createdAt: last.created_at, id: last.id });
      if (currentUser.current !== scopeKey || activeFilter.current !== 'requests' || version.current !== request) return;
      setInbox(current => {
        if (!current || current.userId !== scopeKey) return current;
        const ids = new Set(current.requests.map(({ id }) => id));
        return { ...current, moreRequests: next.length === 50, requests: [...current.requests, ...next.filter(({ id }) => !ids.has(id))] };
      });
    } catch { if (currentUser.current === scopeKey && version.current === request) setError({ userId: scopeKey!, text: t.chat.loadError }); }
    finally { pageBusy.current = false; setLoadingMore(false); }
  };

  const handleRequest = async (request: MeetupRequest, response: 'approved' | 'rejected') => {
    if (!userId || processing.current) return;
    const owner = scopeKey;
    processing.current = true; setRequestBusy(request.id);
    try {
      const nextId = await respondMeetupRequestV2(supabase, request.id, response, shareHistory);
      if (currentUser.current !== owner) return;
      play(response === 'approved' ? 'meetup' : 'selection');
      setApproveId(null);
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      await changed();
      if (currentUser.current === owner && nextId) router.setParams({ conversationId: nextId });
    } catch (failure) {
      if (currentUser.current !== owner) return;
      play('warning');
      const code = getCommunityActionError(failure);
      const message = code ? t.actionErrors[code] : null;
      const title = code === 'MEETUP_JOIN_RESTRICTED' ? tr("신청자의 새 모임 참여가 제한 중이에요") : message?.title ?? t.chat.requestError, body = meetupRestrictionError(failure, appLocale) ?? getChillingError(failure);
      // react-native-web's Alert.alert is a no-op.
      if (Platform.OS === 'web') globalThis.alert(`${title}\n${body}`); else Alert.alert(title, body);
      await refresh();
    } finally { processing.current = false; if (currentUser.current === owner) setRequestBusy(null); }
  };

  const confirmReject = (request: MeetupRequest) => {
    play('selection');
    if (Platform.OS === 'web') { if (globalThis.confirm(tr("이 참여 신청을 거절할까요?"))) void handleRequest(request, 'rejected'); }
    else Alert.alert(tr("참여 신청 거절"), tr("이 참여 신청을 거절할까요?"), [{ text: tr("돌아가기"), style: 'cancel' }, { text: tr("거절하기"), style: 'destructive', onPress: () => void handleRequest(request, 'rejected') }]);
  };

  if (!auth.isAuthed) return <LoginPanel reason={t.auth.reasonChat} onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  return <TabContent style={styles.container}><SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}><View style={styles.safeArea}>
    {/* 홈·모임과 같게 제목 줄은 고정한다. 필터와 안내는 목록과 함께 스크롤된다. */}
    <View style={[styles.headRow, styles.headFixed, { backgroundColor: theme.background }]}>
      <ThemedText accessibilityRole="header" style={styles.heading}>{t.tabs.chat}</ThemedText>
      <GlassSurface tone="control" interactive style={styles.refreshGlass}><Pressable analyticsId="chat.discovery.open" accessibilityRole="button" accessibilityLabel={tr('부동산·중고거래·장소·행사 통합 지도')}
        onPress={() => { play('reaction'); router.push('/map'); }} style={({ pressed }) => [styles.refreshAction, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
        <SymbolView name={{ ios: 'map', android: 'map', web: 'map' }} size={21} tintColor={theme.text} />
      </Pressable></GlassSurface>
      <ProfileAvatarButton />
      <GlassSurface tone="control" interactive style={styles.refreshGlass}><Pressable analyticsId="app_tabs_chat.pressable.1" onPress={() => { play('selection'); void changed(); }} accessibilityRole="button" accessibilityLabel={t.chat.refresh} disabled={loading} accessibilityState={{ disabled: loading }} style={({ pressed }) => [styles.refreshAction, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent', opacity: loading ? 0.45 : 1 }]}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={19} tintColor={theme.accent} /></Pressable></GlassSurface>
    </View>
    <ChatIdentitySwitcher onChanged={() => { setSelection(null); setModalConversation(undefined); router.setParams({ conversationId: undefined, businessId: undefined }); setFilter('direct'); }} />
    <FlatList analyticsId="app_tabs_chat.flatlist.1" data={displayed} keyExtractor={(item) => item.id} contentContainerStyle={[styles.list, initialLoading && styles.loadingList]}
      onEndReached={() => void loadMore()} onEndReachedThreshold={0.4}
      ListFooterComponent={!initialLoading && loadingMore ? <GlingLoader color={theme.accent} accessibilityLabel={t.chat.loading} /> : undefined}
      refreshing={pullRefreshing} onRefresh={() => void pullRefresh()}
      ListHeaderComponent={<View style={styles.header}>
        {!asBusinessId && <View style={[styles.safety, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}><ThemedText type="smallBold" themeColor="accent">{t.safety.meetTitle}</ThemedText><ThemedText type="small" themeColor="textSecondary">{t.safety.meetBody}</ThemedText></View>}
        {/* 자리(슬롯)는 상태라 칩 안의 숫자와 한 줄 안내로만 보여준다. 큰 카드는 대화 목록을 밀어냈다. */}
        <View style={styles.filters}>{([['all', t.chat.all],
          // 관리자에게는 자리 한도가 적용되지 않으므로 숫자 대신 제한 없음을 알린다.
          ['group', auth.isAdmin ? tr("{0} 제한 없음", (t.chat.groups)) : `${t.chat.groups}${meetupSlots ? ` ${meetupSlots.active}/${meetupSlots.limit}` : ''}`],
          ['direct', t.chat.direct],
          ['requests', `${t.chat.requestTab} ${pendingCount}${moreRequests ? '+' : ''}`]] as const).filter(([key]) => !asBusinessId || key === 'all' || key === 'direct').map(([key, label]) => <Pressable analyticsId="app_tabs_chat.pressable.2" key={key} onPress={() => { play('selection'); if (key !== filter) { animateList(); setLoading(true); setFilter(key); } }} accessibilityRole="tab" accessibilityState={{ selected: filter === key }} style={({ pressed }) => [styles.filter, Depth.control, { backgroundColor: filter === key ? theme.accent : theme.backgroundElement, borderBottomColor: filter === key ? theme.accentDepth : theme.backgroundSelected, }]}><ThemedText type="smallBold" style={{ color: filter === key ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>)}</View>
        {filter === 'requests' && <>
          {requests.length > 0 && <ThemedText type="smallBold">{t.chat.requestsTitle}</ThemedText>}
          {requests.map((request) => <View key={request.id} style={[styles.request, Depth.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <View style={styles.requestIdentity}><View style={[styles.requestAvatar, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle" themeColor="accent">{(request.requester?.nickname || t.chat.member).slice(0, 1)}</ThemedText></View>
              <View style={styles.roomBody}><ThemedText style={styles.requestName}>{request.requester?.nickname || t.chat.member}</ThemedText><ThemedText type="small" themeColor="textSecondary">{request.post?.title}</ThemedText><ThemedText type="small" themeColor="accent">{tr("승인 대기")}</ThemedText></View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">{request.post?.room?.eventKind ? tr("모임 프로필과 질문 답변이 도착했어요.") : request.message || t.chat.requestMessageEmpty}</ThemedText>
            {request.post?.room?.eventKind ? <Pressable analyticsId="app_tabs_chat.pressable.4" onPress={() => { play('selection'); router.push({ pathname: '/meetup-application', params: { requestId: request.id } }); }} accessibilityRole="button" accessibilityLabel={tr("{0}님의 프로필과 신청 답변 검토", (request.requester?.nickname || t.chat.member))} style={styles.action}><ThemedText type="smallBold" themeColor="accent">{tr("프로필과 답변 검토하기 ›")}</ThemedText></Pressable> : <>
            {approveId === request.id && <><ThemedText type="small" themeColor="textSecondary">{tr("승인하면 신청자의 모임 자리 1개를 사용하고 모임 대화에 참여해요. 기존 멤버의 자리는 추가로 사용하지 않아요.")}</ThemedText>
              <MeetupHistoryChoice value={shareHistory} onChange={setShareHistory} disabled={requestBusy !== null} /></>}
            <View style={styles.requestActions}><Pressable analyticsId="app_tabs_chat.pressable.5" onPress={() => confirmReject(request)} disabled={requestBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: requestBusy !== null }} style={({ pressed }) => [styles.requestButton, Depth.control, { borderColor: theme.line, backgroundColor: theme.card, }]}><ThemedText type="smallBold">{t.chat.reject}</ThemedText></Pressable>
              {approveId === request.id
                ? <RaisedActionButton compact analyticsId="app_tabs_chat.pressable.6" onPress={() => { play('selection'); void handleRequest(request, 'approved'); }} disabled={requestBusy !== null} busy={requestBusy === request.id} label={tr("확인하고 승인")} />
                : <Pressable analyticsId="app_tabs_chat.pressable.6" onPress={() => { play('selection'); setShareHistory(false); setApproveId(request.id); }} disabled={requestBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: requestBusy !== null }} style={({ pressed }) => [styles.requestButton, Depth.control, { borderColor: theme.accentDepth, backgroundColor: theme.accent, borderBottomWidth: 3, }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{t.chat.approve}</ThemedText></Pressable>}</View></>}
          </View>)}
          {moreRequests && <Pressable analyticsId="meetup.requests.more" accessibilityRole="button" disabled={loadingMore} style={styles.requestButton} onPress={() => { play('selection'); void loadOlderRequests(); }}><ThemedText type="smallBold" themeColor="accent">{loadingMore ? tr('신청 불러오는 중…') : tr('이전 모임 신청 더 보기')}</ThemedText></Pressable>}
        </>}
        {error?.userId === scopeKey && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{tr(error.text)}</ThemedText>}
      </View>}
      ListEmptyComponent={initialLoading ? <GlingLoader color={theme.accent} accessibilityLabel={t.chat.loading} />
        : loading ? undefined
        : filter === 'requests' ? (requests.length ? undefined : <StateCard title={tr("대기 중인 모임 신청이 없어요")} body={tr("모임에 신청이 들어오면 여기서 수락하거나 거절할 수 있어요.")} />)
          : <StateCard title={t.chat.emptyTitle} body={t.chat.emptyBody} />}
      renderItem={({ item, index }) => <Pressable analyticsId="app_tabs_chat.pressable.7" onPress={() => { play('selection'); presentConversation(item); }} accessibilityRole="button" style={({ pressed }) => [styles.room, { borderBottomColor: theme.line, backgroundColor: pressed ? theme.backgroundElement : 'transparent', transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }] }]}>
        <ChatAvatar kind={item.kind} title={item.title} meetupCategory={item.meetupCategory} initial={item.kind !== 'group' ? item.otherUser.nickname[0] : ''} avatarUri={item.otherIdentity?.avatarUri} active={focused && !shownConversation && index < 8} delay={index * 260} />
        <View style={styles.roomBody}><View style={styles.nickRow}><ThemedText style={[styles.flex, styles.roomName]} numberOfLines={1}>{item.kind === 'group' ? item.title : item.otherUser.nickname}</ThemedText>{item.kind === 'business' && <ThemedText type="small" themeColor="accent">{tr('비즈니스')}</ThemedText>}{item.kind === 'direct' && <TrustBadge verified={item.otherUser.verificationLevel >= 2} trustLevel={item.otherUser.verificationLevel === 3 ? 3 : item.otherUser.verificationLevel === 2 ? 2 : undefined} />}</View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.status === 'pending' ? tr("대화 상태 확인 중") : item.status === 'ended' ? t.chat.ended : item.latestBody ?? t.chat.newConversation}</ThemedText></View>
        <View style={styles.roomTime}><ThemedText type="small" themeColor="textSecondary">{chatListTime(item.latestAt, undefined, appLocale)}</ThemedText></View>
      </Pressable>} />
  </View></SafeAreaView><Modal key={modalConversation?.key ?? 'closed'} visible={focused && !!modalConversation && !!openConversation && routeMatches} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={closeConversation} onDismiss={() => {
    if (presentation.current !== modalConversation) return;
    presentation.current = undefined;
    setModalConversation(undefined);
  }}>
    <SafeAreaProvider style={{ flex: 1 }}>{shownConversation && <ChatRoom key={`${scopeKey}:${shownConversation.id}`} conversation={shownConversation} currentUserId={auth.me.id} onChanged={changed} onClose={closeConversation} />}</SafeAreaProvider>
  </Modal></TabContent>;
}

function ChatAvatar({ kind, title, meetupCategory, initial, avatarUri, active, delay }: { avatarUri?: string | null; kind: 'group' | 'direct' | 'business'; title: string; meetupCategory: string | null; initial: string; active: boolean; delay: number }) {

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
      : avatarUri ? <Image source={{ uri: avatarUri }} style={[styles.partyIcon, { borderRadius: 26 }]} contentFit="cover" accessible={false} /> : <ThemedText type="subtitle" themeColor="accent">{initial}</ThemedText>}
  </Animated.View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, width: '100%', alignSelf: 'center', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three },
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
