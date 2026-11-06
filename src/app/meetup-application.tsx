import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, LayoutAnimation, Platform, StyleSheet, UIManager, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from '@/components/symbol-view';
import { Image } from 'expo-image';
import { ControlMotion } from '@/constants/design-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { InitialAvatar, ListCard, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { InfoNote } from '@/components/notice-blocks';
import { MannerSummary } from '@/components/manner-summary';
import { MeetupHistoryChoice } from '@/components/meetup-room-summary';
import { MeetupLanguageCounts } from '@/components/meetup-language';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useAuth } from '@/lib/auth';
import { getChillingError, getChillingErrorCode, loadChillingApplication, loadMeetupRequestStatus, respondMeetupRequestV2, type ChillingApplication, type MeetupParticipation } from '@/lib/chilling-data';
import { CITIES } from '@/lib/mock';
import { loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT, type MeetupRequest } from '@/lib/community-data';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';
import { loadMannerSummary, type MannerSummary as Summary } from '@/lib/user-profile';

// Same meetup first, then any other meetup I host. Requests without a review screen stay in the inbox.
function nextPendingRequest(requests: MeetupRequest[], handledId: string, postId: string | undefined, isHidden: (request: MeetupRequest) => boolean) {
  const open = requests.filter(request => request.id !== handledId && request.post?.room?.eventKind && !isHidden(request));
  return open.find(request => request.post_id === postId) ?? open[0] ?? null;
}

export default function MeetupApplicationRoute() {

  const { requestId } = useLocalSearchParams<{ requestId: string }>(), { me, isAuthed } = useAuth();
  return <Application key={`${requestId}:${isAuthed ? me.id : 'guest'}`} requestId={requestId} />;
}
function Application({ requestId }: { requestId: string }) {
  const { tr } = useLanguage();
  const router = useRouter(), theme = useTheme(), hidden = useContentVisibility();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion(), { height } = useWindowDimensions();
  const { isAuthed, me, promptLogin } = useAuth();
  const { refresh: refreshMembership } = useMembership();
  const [application, setApplication] = useState<ChillingApplication | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [responding, setResponding] = useState(false), [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null), [shareHistory, setShareHistory] = useState(false);
  const [requestStatus, setRequestStatus] = useState<MeetupParticipation | null>(null);
  // undefined while still looking; null means go back to the inbox.
  const [next, setNext] = useState<MeetupRequest | null | undefined>(undefined);
  const [manner, setManner] = useState<Summary | null>(null);
  const [actionError, setActionError] = useState(''), [actionCode, setActionCode] = useState<string | null>(null);
  const revision = useRef(0);
  const busy = useRef(false);
  // The next state (loaded application, approve/reject result) fades in instead of replacing the screen at once.
  const fadeNext = () => {
    if (reducedMotion || Platform.OS === 'web') return;
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation.configureNext({ duration: 220, create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } });
  };
  useFocusEffect(useCallback(() => {
    let active = true;
    revision.current += 1;
    setApplication(null); setRequestStatus(null); setManner(null); setLoading(true); setError(''); setActionError(''); setActionCode(null); setOutcome(null); setNext(undefined);
    if (!isAuthed) { setLoading(false); return; }
    void loadChillingApplication(supabase, requestId, me.id).then(async value => {
      const status = value?.request ?? await loadMeetupRequestStatus(supabase, requestId, me.id);
      if (active) { setApplication(value); setRequestStatus(status); }
      // Hosts decide with the applicant's past meetup reviews; a failed load just hides the card.
      if (value && value.requesterId !== me.id) void loadMannerSummary(supabase, value.requesterId).then(summary => { if (active) setManner(summary); }).catch(() => undefined);
    })
      .catch(e => { if (active) setError(getChillingError(e)); }).finally(() => { if (active) { fadeNext(); setLoading(false); } });
    return () => { active = false; revision.current += 1; };
  // retry deliberately re-runs the focused screen's load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, me.id, requestId, retry, reducedMotion]));
  const visible = application && !hidden('post', application.postId, application.requesterId);
  const own = application?.requesterId === me.id || requestStatus?.requester_id === me.id;
  const canRespond = visible && application.request?.host_id === me.id && application.request.status === 'pending' && !own;
  const approvalBlocked = !!actionCode && ['MEETUP_FULL', 'MEETUP_HOST_CAPACITY_LIMIT', 'MEETUP_CLOSED', 'MEETUP_EXPIRED', 'MEETUP_LIMIT_REACHED', 'RELATIONSHIP_LIMIT', 'MEETUP_JOIN_RESTRICTED', 'LANGUAGE_SIDE_FULL'].includes(actionCode);
  const identity = application?.request?.requester;
  const respond = async (response: 'approved' | 'rejected') => {
    if (busy.current || !canRespond || (response === 'approved' && approvalBlocked)) return;
    const current = revision.current, postId = application?.postId;
    busy.current = true; setResponding(true); setError(''); setActionError(''); setActionCode(null);
    try {
      await respondMeetupRequestV2(supabase, requestId, response, shareHistory);
      if (revision.current === current) { fadeNext(); setApplication(null); setOutcome(response); }
      play(response === 'approved' ? 'meetup' : 'selection');
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      void refreshMembership();
      void loadPendingMeetupRequests(supabase)
        .then(requests => nextPendingRequest(requests, requestId, postId, request => hidden('post', request.post_id, request.requester_id)), () => null)
        .then(found => { if (revision.current === current) setNext(found); });
    } catch (e) {
      play('warning');
      if (revision.current !== current) return;
      // Approval failure can mean capacity changed or consent was revoked. Recheck before retaining private content.
      setApplication(null); setRequestStatus(null); setLoading(true); setActionError(getChillingError(e)); setActionCode(getChillingErrorCode(e));
      try {
        const fresh = await loadChillingApplication(supabase, requestId, me.id);
        const status = fresh?.request ?? await loadMeetupRequestStatus(supabase, requestId, me.id);
        if (revision.current === current) { setApplication(fresh); setRequestStatus(status); }
      } catch (failure) { if (revision.current === current) setError(getChillingError(failure)); }
      finally { if (revision.current === current) setLoading(false); }
    }
    finally { busy.current = false; setResponding(false); }
  };
  const confirmReject = () => {
    play('selection');
    if (Platform.OS === 'web') { if (globalThis.confirm(tr('이 참여 신청을 거절할까요?'))) void respond('rejected'); }
    else Alert.alert(tr("참여 신청 거절"), tr("신청자에게 결과를 알리고 프로필 열람을 종료해요."), [{ text: tr("돌아가기"), style: 'cancel' }, { text: tr("거절하기"), style: 'destructive', onPress: () => void respond('rejected') }]);
  };
  const openInbox = () => { play('selection'); router.replace({ pathname: '/chat', params: { view: 'requests' } }); };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <View style={[styles.header, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-application.pressable.1" onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace(Platform.OS === 'web' ? '/chat' : '/(tabs)/chat'); }} accessibilityRole="button" accessibilityLabel={tr("뒤로가기")} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{own ? tr("내 참여 신청") : tr("참여 신청 검토")}</ThemedText>
      <View style={styles.back} />
    </View>
    {loading ? <View style={styles.center}><GlingLoader color={theme.accent} accessibilityLabel={tr("신청 정보 불러오는 중")} /></View> : <ScrollView analyticsId="app_meetup-application.scrollview.1" contentContainerStyle={styles.content}>
    {!!actionError && <StateCard kind="error" title={actionCode === 'MEETUP_FULL' ? tr("정원이 차서 승인하지 못했어요") : actionCode === 'LANGUAGE_SIDE_FULL' ? tr("이 언어 쪽 자리가 다 차서 승인하지 못했어요") : tr("처리 결과를 확인해 주세요")} body={tr(actionError)} />}
    {outcome ? <>
      <StateCard layout="start" mark={outcome === 'approved' ? 'check' : 'minus'} title={outcome === 'approved' ? tr("참여를 승인했어요") : tr("신청을 거절했어요")} body={tr("신청자가 참여 신청 화면에서 결과를 확인할 수 있어요.")} />
      {!!next && <View><SectionLabel>{tr("다음 신청")}</SectionLabel><ListCard><ListRow leading={<InitialAvatar name={next.requester?.nickname || tr("신청자")} />} title={next.requester?.nickname || tr("신청자")} detail={next.post?.title} /></ListCard></View>}
    </>
      : !isAuthed ? <StateCard kind="blocked" title={tr("로그인이 필요해요")} body={tr("참여 신청을 확인하려면 로그인해 주세요.")} actionLabel={tr("로그인하기")} onAction={() => promptLogin('참여 신청을 확인하려면 로그인해 주세요.')} />
      : visible ? <>
      {application.request?.post && <ThemedText type="small" themeColor="textSecondary">{application.request.post.title}{" " + tr("· 참여 신청")}</ThemedText>}
      <View style={styles.identity}>
        {identity?.photoUri ? <Image source={{ uri: identity.photoUri }} transition={ControlMotion.settleMs} cachePolicy="none" style={styles.avatar} contentFit="cover" accessibilityLabel={tr("{0} 모임 사진", identity.nickname)} />
          : <View style={[styles.avatar, styles.initial, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle">{(identity?.nickname ?? tr("신청자")).slice(0, 1)}</ThemedText></View>}
        <View style={styles.identityBody}><ThemedText style={styles.name}>{identity?.nickname ?? tr("신청자")}</ThemedText>
          {!!identity?.city_id && <ThemedText type="small" themeColor="textSecondary">{tr(CITIES.find(city => city.id === identity.city_id)?.name ?? identity.city_id)}</ThemedText>}
          {application.request && <ThemedText type="smallBold" themeColor="accent">{{ pending: tr("승인 대기"), approved: tr("참여 승인"), rejected: tr("신청 거절"), cancelled: tr("신청 취소됨") }[application.request.status]}</ThemedText>}
        </View>
      </View>
      {application.request?.host_id === me.id && <MeetupLanguageCounts postId={application.postId} requestId={requestId} />}
      <View style={[styles.answerCard, { backgroundColor: theme.card }]}><ThemedText type="smallBold" themeColor="accent">{tr("호스트 질문에 대한 답변")}</ThemedText><ThemedText type="small" themeColor="textSecondary">{application.question}</ThemedText><ThemedText style={styles.answer}>{application.answer}</ThemedText></View>
      <View style={styles.headingRow}><ThemedText type="smallBold">{tr("함께할 사람의 모임 프로필")}</ThemedText>
        <Tag label={tr("신청 당시")} /></View>
      <ChillingProfileCard profile={application.profile} />
      {!own && manner && <MannerSummary summary={manner} />}
      <InfoNote>{tr("이름·사진·소개·답변은 신청할 때 보낸 그대로예요. 그 뒤에 프로필을 고쳐도 여기는 바뀌지 않아요.")}</InfoNote>
    </> : <StateCard kind={error ? 'error' : requestStatus?.status === 'approved' ? 'success' : 'blocked'} title={error ? tr("신청 정보를 불러오지 못했어요") : requestStatus ? { pending: tr("신청은 승인 대기 중이에요"), approved: tr("이미 승인된 신청이에요"), rejected: tr("거절된 신청이에요"), cancelled: tr("취소된 신청이에요") }[requestStatus.status] : tr("신청 프로필을 볼 수 없어요")} body={tr(error || '공유된 신청 프로필은 현재 열람할 수 없어요.')} actionLabel={error ? tr('다시 불러오기') : undefined} onAction={() => setRetry(x => x + 1)} />}
    {!!actionError && <Pressable analyticsId="app_meetup-application.pressable.2" onPress={() => { play('selection'); setRetry(x => x + 1); }} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">{tr("현재 상태 다시 확인")}</ThemedText></Pressable>}
  </ScrollView>}
  {!loading && canRespond && <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.line }]}>
    {/* Bounded so large text can't push the approve button off screen; it fits without scrolling at normal sizes. */}
    <ScrollView analyticsId="meetup.application.decide" style={[styles.decideScroll, { maxHeight: height * 0.32 }]} contentContainerStyle={styles.decide}>
      <MeetupHistoryChoice value={shareHistory} onChange={setShareHistory} disabled={responding} />
      <ThemedText type="smallBold">{tr("승인하면")}</ThemedText>
      <View style={styles.decideRow}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={13} tintColor={theme.accent} /><ThemedText type="small" style={styles.flex}>{tr("이 모임의 멤버가 되고 모임 대화에 들어와요.")}</ThemedText></View>
      <View style={styles.decideRow}><SymbolView name={{ ios: 'exclamationmark.circle', android: 'error', web: 'error' }} size={13} tintColor={theme.danger} /><ThemedText type="small" themeColor="textSecondary" style={styles.flex}>{tr("정원이 찼거나 참여할 수 있는 모임 수를 넘으면 승인할 수 없어요.")}</ThemedText></View>
    </ScrollView>
    <RaisedActionButton analyticsId="app_meetup-application.pressable.3" disabled={responding || approvalBlocked} busy={responding} onPress={() => { play('selection'); void respond('approved'); }} label={responding ? tr("처리 중…") : approvalBlocked ? tr("현재 승인할 수 없어요") : tr("{0}님 참여 승인", (identity?.nickname ?? tr('신청자')))} />
    <Pressable analyticsId="app_meetup-application.pressable.4" accessibilityRole="button" accessibilityLabel={tr("참여 신청 거절")} disabled={responding} accessibilityState={{ disabled: responding }} onPress={confirmReject} style={styles.reject}><ThemedText type="smallBold" themeColor="textSecondary">{tr("거절하기")}</ThemedText></Pressable>
  </View>}
  {!loading && outcome && <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.line }]}>
    {next ? <>
      <RaisedActionButton analyticsId="meetup.application.next" label={tr("다음 신청 보기")} onPress={() => { play('selection'); router.replace({ pathname: '/meetup-application', params: { requestId: next.id } }); }} />
      <RaisedActionButton analyticsId="meetup.application.inbox" tone="secondary" label={tr("참여 신청 목록으로")} onPress={openInbox} />
    </> : <RaisedActionButton analyticsId="meetup.application.inbox" busy={next === undefined} label={next === undefined ? tr("다음 신청을 찾는 중…") : tr("참여 신청 목록으로")} onPress={openInbox} />}
  </View>}
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ fill: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four }, button: { minHeight: 44, justifyContent: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, identityBody: { flex: 1, gap: Spacing.one }, avatar: { width: 80, height: 80, borderRadius: 26 }, initial: { alignItems: 'center', justifyContent: 'center' }, name: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  answerCard: { borderRadius: 20, padding: Spacing.four, gap: Spacing.two }, answer: { fontSize: 17, lineHeight: 26 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  decideScroll: { flexGrow: 0 }, decide: { gap: Spacing.two }, decideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two }, flex: { flex: 1 },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, gap: Spacing.two }, reject: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
