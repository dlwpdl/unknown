import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, DeviceEventEmitter, LayoutAnimation, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useAuth } from '@/lib/auth';
import { getChillingError, getChillingErrorCode, loadChillingApplication, loadMeetupRequestStatus, type ChillingApplication, type MeetupParticipation } from '@/lib/chilling-data';
import { CITIES } from '@/lib/mock';
import { MEETUPS_CHANGED_EVENT, respondMeetupRequest } from '@/lib/community-data';
import { useMembership } from '@/lib/membership-provider';
import { supabase } from '@/lib/supabase';

export default function MeetupApplicationRoute() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>(), { me, isAuthed } = useAuth();
  return <Application key={`${requestId}:${isAuthed ? me.id : 'guest'}`} requestId={requestId} />;
}
function Application({ requestId }: { requestId: string }) {
  const router = useRouter(), theme = useTheme(), hidden = useContentVisibility();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const { isAuthed, me } = useAuth();
  const { refresh: refreshMembership } = useMembership();
  const [application, setApplication] = useState<ChillingApplication | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [responding, setResponding] = useState(false), [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null);
  const [requestStatus, setRequestStatus] = useState<MeetupParticipation | null>(null);
  const [actionError, setActionError] = useState(''), [actionCode, setActionCode] = useState<string | null>(null);
  const revision = useRef(0);
  const busy = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    revision.current += 1;
    setApplication(null); setRequestStatus(null); setLoading(true); setError(''); setActionError(''); setActionCode(null); setOutcome(null);
    if (!isAuthed) { setLoading(false); return; }
    void loadChillingApplication(supabase, requestId, me.id).then(async value => {
      const status = value?.request ?? await loadMeetupRequestStatus(supabase, requestId, me.id);
      if (active) { setApplication(value); setRequestStatus(status); }
    })
      .catch(e => { if (active) setError(getChillingError(e)); }).finally(() => { if (active) {
        if (!reducedMotion && Platform.OS !== 'web') {
          if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
          LayoutAnimation.configureNext({ duration: 220, create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity } });
        }
        setLoading(false);
      } });
    return () => { active = false; revision.current += 1; };
  // retry deliberately re-runs the focused screen's load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, me.id, requestId, retry, reducedMotion]));
  const visible = application && !hidden('post', application.postId, application.requesterId);
  const own = application?.requesterId === me.id || requestStatus?.requester_id === me.id;
  const canRespond = visible && application.request?.host_id === me.id && application.request.status === 'pending' && !own;
  const approvalBlocked = !!actionCode && ['MEETUP_FULL', 'MEETUP_CLOSED', 'MEETUP_EXPIRED', 'MEETUP_LIMIT_REACHED', 'RELATIONSHIP_LIMIT', 'MEETUP_JOIN_RESTRICTED'].includes(actionCode);
  const identity = application?.request?.requester;
  const respond = async (response: 'approved' | 'rejected') => {
    if (busy.current || !canRespond || (response === 'approved' && approvalBlocked)) return;
    const current = revision.current;
    busy.current = true; setResponding(true); setError(''); setActionError(''); setActionCode(null);
    try {
      await respondMeetupRequest(supabase, requestId, response);
      if (revision.current === current) { setApplication(null); setOutcome(response); }
      play(response === 'approved' ? 'meetup' : 'success');
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      void refreshMembership();
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
    if (Platform.OS === 'web') { if (globalThis.confirm('이 참여 신청을 거절할까요?')) void respond('rejected'); }
    else Alert.alert('참여 신청 거절', '신청자에게 결과를 알리고 프로필 열람을 종료해요.', [{ text: '돌아가기', style: 'cancel' }, { text: '거절하기', style: 'destructive', onPress: () => void respond('rejected') }]);
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <View style={[styles.header, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-application.pressable.1" onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/(tabs)/chat'); }} accessibilityRole="button" accessibilityLabel="뒤로가기" style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{own ? '내 참여 신청' : '참여 신청 검토'}</ThemedText>
      <View style={styles.back} />
    </View>
    {loading ? <View style={styles.center}><GlingLoader color={theme.accent} accessibilityLabel="신청 정보 불러오는 중" /></View> : <ScrollView analyticsId="app_meetup-application.scrollview.1" contentContainerStyle={styles.content}>
    {!!actionError && <StateCard kind="error" title={actionCode === 'MEETUP_FULL' ? '정원이 차서 승인하지 못했어요' : '처리 결과를 확인해 주세요'} body={actionError} />}
    {outcome ? <StateCard kind={outcome === 'approved' ? 'success' : 'empty'} title={outcome === 'approved' ? '참여를 승인했어요' : '신청을 거절했어요'} body="신청자가 참여 신청 화면에서 결과를 확인할 수 있어요." actionLabel="신청함 보기" onAction={() => router.replace({ pathname: '/chat', params: { view: 'requests' } })} />
      : visible ? <>
      {application.request?.post && <ThemedText type="small" themeColor="textSecondary">{application.request.post.title} · 참여 신청</ThemedText>}
      <View style={styles.identity}>
        {identity?.photoUri ? <Image source={{ uri: identity.photoUri }} style={styles.avatar} contentFit="cover" accessibilityLabel={`${identity.nickname} 프로필 사진`} />
          : <View style={[styles.avatar, styles.initial, { backgroundColor: theme.backgroundElement }]}><ThemedText type="subtitle">{(identity?.nickname ?? '신청자').slice(0, 1)}</ThemedText></View>}
        <View style={styles.identityBody}><ThemedText style={styles.name}>{identity?.nickname ?? '신청자'}</ThemedText>
          {!!identity?.city_id && <ThemedText type="small" themeColor="textSecondary">{CITIES.find(city => city.id === identity.city_id)?.name ?? identity.city_id}</ThemedText>}
          {application.request && <ThemedText type="smallBold" themeColor="accent">{{ pending: '승인 대기', approved: '참여 승인', rejected: '신청 거절', cancelled: '신청 취소됨' }[application.request.status]}</ThemedText>}
        </View>
      </View>
      <View style={[styles.answerCard, { backgroundColor: theme.card }]}><ThemedText type="smallBold" themeColor="accent">모임장 질문에 대한 답변</ThemedText><ThemedText type="small" themeColor="textSecondary">{application.question}</ThemedText><ThemedText style={styles.answer}>{application.answer}</ThemedText></View>
      <ThemedText type="smallBold">함께할 사람의 모임 프로필</ThemedText>
      <ChillingProfileCard profile={application.profile} />
      <ThemedText type="small" themeColor="textSecondary">소개와 답변은 신청할 때 공유한 내용이에요. 닉네임·사진·활동 지역은 현재 계정 프로필을 보여요.</ThemedText>
      {canRespond && <>
        <ThemedText type="small" themeColor="textSecondary">승인하면 이 모임의 멤버가 되고 모임 대화에 참여해요. 정원이 찼거나 참여 가능한 모임 수를 넘으면 승인할 수 없어요.</ThemedText>
      </>}
    </> : <StateCard kind={error ? 'error' : requestStatus?.status === 'approved' ? 'success' : 'blocked'} title={error ? '신청 정보를 불러오지 못했어요' : requestStatus ? { pending: '신청은 승인 대기 중이에요', approved: '이미 승인된 신청이에요', rejected: '거절된 신청이에요', cancelled: '취소된 신청이에요' }[requestStatus.status] : '신청 프로필을 볼 수 없어요'} body={error || '공유된 신청 프로필은 현재 열람할 수 없어요.'} />}
    {(!!error || !!actionError) && <Pressable analyticsId="app_meetup-application.pressable.2" onPress={() => { play('selection'); setRetry(x => x + 1); }} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">현재 상태 다시 확인</ThemedText></Pressable>}
  </ScrollView>}
  {!loading && canRespond && <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.line }]}>
    <RaisedActionButton analyticsId="app_meetup-application.pressable.3" disabled={responding || approvalBlocked} busy={responding} onPress={() => { play('selection'); void respond('approved'); }} label={responding ? '처리 중…' : approvalBlocked ? '현재 승인할 수 없어요' : `${identity?.nickname ?? '신청자'}님 참여 승인`} />
    <Pressable analyticsId="app_meetup-application.pressable.4" accessibilityRole="button" accessibilityLabel="참여 신청 거절" disabled={responding} accessibilityState={{ disabled: responding }} onPress={confirmReject} style={styles.reject}><ThemedText type="smallBold" themeColor="textSecondary">신청 거절</ThemedText></Pressable>
  </View>}
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({ fill: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four }, button: { minHeight: 44, justifyContent: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, identityBody: { flex: 1, gap: Spacing.one }, avatar: { width: 80, height: 80, borderRadius: 26 }, initial: { alignItems: 'center', justifyContent: 'center' }, name: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  answerCard: { borderRadius: 20, padding: Spacing.four, gap: Spacing.two }, answer: { fontSize: 17, lineHeight: 26 },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, padding: Spacing.four, gap: Spacing.one }, reject: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
