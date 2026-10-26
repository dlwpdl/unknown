import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, AppState, DeviceEventEmitter, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { MeetupWaitlist } from '@/components/meetup-host-tools';
import { StateCard } from '@/components/state-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { ChillingEventSchedule, MeetupFeeLine } from '@/components/chilling-event';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { chillingAvailability, recommendedAgeMessage } from '@/lib/chilling';
import { ageForMeetupRecommendation } from '@/lib/personal-info';
import { useAuth } from '@/lib/auth';
import { chillingProfilePreview, getChillingError, getChillingErrorCode, loadChillingProfile, loadMeetupParticipation, requestChillingJoin, type ChillingProfile, type MeetupParticipation } from '@/lib/chilling-data';
import { leaveMeetup, MEETUPS_CHANGED_EVENT, requestMeetupJoin } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicPost } from '@/lib/feed-data';
import { loadMeetupFeePayments } from '@/lib/meetup-host-tools';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function MeetupJoinRoute() {

  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { me, isAuthed } = useAuth();
  return <JoinForm key={`${postId}:${isAuthed ? me.id : 'guest'}`} postId={postId} />;
}
function JoinForm({ postId }: { postId: string }) {
  const { tr, t, language, locale: appLocale } = useLanguage();
  const theme = useTheme(), router = useRouter(), hidden = useContentVisibility();
  const copy = (ko: string, en: string) => language === 'en' ? en : ko;
  const { isAuthed, promptLogin, me } = useAuth();
  const { play } = useInteractionFeedback();
  const [post, setPost] = useState<Post | null>(null), [profile, setProfile] = useState<ChillingProfile | null>(null);
  const [participation, setParticipation] = useState<MeetupParticipation | null>(null), [feePaid, setFeePaid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [recommendationAge, setRecommendationAge] = useState<number | null>(null);
  const [answer, setAnswer] = useState(''), [consent, setConsent] = useState(false), [sending, setSending] = useState(false), [sent, setSent] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null), [profileError, setProfileError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(true), [policyOpen, setPolicyOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const focusedScope = useRef<object | null>(null);
  // Invalidate retained native Alert actions during commit, before passive focus cleanup.
  useLayoutEffect(() => () => { focusedScope.current = null; }, [isAuthed, me.id, postId]);
  // 자리(등급) 문제는 멤버십 화면에서 바로 확인할 수 있게 안내한다.
  const membershipError = !!errorCode && !!t.actionErrors[errorCode as keyof typeof t.actionErrors]?.membership;
  useFocusEffect(useCallback(() => {
    let active = true;
    const scope = {};
    focusedScope.current = scope;
    busy.current = false; setSending(false);
    setNow(Date.now());
    setConsent(false); setLoading(true); setError(''); setErrorCode(null); setProfileError(''); setPost(null); setProfile(null); setParticipation(null); setFeePaid(null); setRecommendationAge(null);
    if (!isAuthed) { setLoading(false); return () => { active = false; if (focusedScope.current === scope) focusedScope.current = null; }; }
    void supabase.rpc('get_my_personal_info').then(({ data, error: failure }) => {
      if (active && !failure) setRecommendationAge(ageForMeetupRecommendation(data));
    }, () => {});
    void loadPublicPost(supabase, postId).then(async value => {
      if (!active) return;
      const [ownProfile, request] = await Promise.all([
        // A profile failure (e.g. unavailable photos) only blocks submit; the meetup and request status still load.
        value?.room?.eventKind ? loadChillingProfile(supabase, 'application').catch(e => { if (active) setProfileError(getChillingError(e)); return null; }) : null,
        value?.room && value.author.id !== me.id ? loadMeetupParticipation(supabase, postId, me.id) : null,
      ]);
      // An unverified payment read shows the fee without a status rather than guessing.
      const payments = value?.room?.fee && request?.status === 'approved' ? await loadMeetupFeePayments(supabase, postId).catch(() => null) : null;
      if (active) { setPost(value); setProfile(ownProfile); setParticipation(request); setFeePaid(payments && payments.some(row => row.user_id === me.id)); setSent(false); }
    }).catch(e => { if (active) { setError(getChillingError(e)); setErrorCode(getChillingErrorCode(e)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (focusedScope.current === scope) focusedScope.current = null; };
  // retry deliberately re-runs the focused screen's load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, me.id, postId, retry]));
  const back = () => router.canGoBack() ? router.back() : router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups');
  const unavailable = !post?.room || hidden('post', post.id, post.author.id);
  const availability = errorCode === 'MEETUP_FULL' || errorCode === 'MEETUP_HOST_CAPACITY_LIMIT' ? 'full' : errorCode === 'MEETUP_EXPIRED' ? 'ended'
    : errorCode === 'MEETUP_CLOSED' ? 'closed' : chillingAvailability(post?.room ?? {}, now);
  const inactive = availability === 'ended' || availability === 'closed';
  // Host paused new requests: the meetup stays live, existing requests and members are unaffected.
  const paused = !inactive && (post?.room?.recruitingClosed === true || errorCode === 'MEETUP_RECRUITING_CLOSED');
  const own = post?.author.id === me.id;
  const modern = !!post?.room?.eventKind;
  const status = participation?.status;
  const result = status === 'pending' || status === 'approved' || (sent && !status);
  const reapplyAt = (status === 'rejected' || status === 'cancelled') && participation ? Date.parse(participation.responded_at ?? participation.created_at) + 86400000 : 0;
  const coolingDown = reapplyAt > now;
  useFocusEffect(useCallback(() => {
    const deadlines = [post?.room?.eventKind === 'once' ? Date.parse(post.room.endsAt ?? '') : NaN, reapplyAt];
    let timer: ReturnType<typeof setTimeout>;
    const updateTime = () => {
      clearTimeout(timer);
      const current = Date.now(); setNow(current);
      const next = Math.min(...deadlines.filter(time => time > current));
      if (Number.isFinite(next)) timer = setTimeout(updateTime, Math.min(next - current + 20, 2147483647));
    };
    updateTime();
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') updateTime(); });
    return () => { clearTimeout(timer); foreground.remove(); };
  }, [post?.room?.eventKind, post?.room?.endsAt, reapplyAt]));
  const profileRoute = () => router.push({ pathname: '/meetup-profile', params: { returnPostId: postId } });
  const cancelRequest = async (scope: object | null) => {
    if (!scope || focusedScope.current !== scope || busy.current || status !== 'pending') return;
    busy.current = true; setSending(true); setError('');
    try { await leaveMeetup(supabase, postId); if (focusedScope.current !== scope) return; play('success'); DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT); setSent(false); setRetry(v => v + 1); }
    catch (e) { if (focusedScope.current === scope) { play('warning'); setError(getChillingError(e)); } }
    finally { if (focusedScope.current === scope) { busy.current = false; setSending(false); } }
  };
  const confirmCancel = () => {
    const scope = focusedScope.current;
    if (!scope) return;
    play('selection');
    if (Platform.OS === 'web') { if (globalThis.confirm(tr('이 모임의 참여 신청을 취소할까요?'))) void cancelRequest(scope); }
    else Alert.alert(tr("참여 신청 취소"), tr("호스트가 더 이상 신청 프로필을 볼 수 없어요."), [{ text: tr("돌아가기"), style: 'cancel' }, { text: tr("신청 취소"), style: 'destructive', onPress: () => void cancelRequest(scope) }]);
  };
  const submit = async () => {
    const scope = focusedScope.current;
    if (!scope || !isAuthed || busy.current || unavailable || availability !== 'open' || paused || coolingDown || own || !post || result || !answer.trim() || (modern && (profile?.version !== 2 || !consent))) return;
    busy.current = true; setSending(true); setError(''); setErrorCode(null);
    let submitted = false;
    try {
      if (modern) await requestChillingJoin(supabase, post.id, answer, consent, profile!.revision ?? '');
      else await requestMeetupJoin(supabase, post.id, answer);
      if (focusedScope.current !== scope) return;
      submitted = true; setSent(true); play('meetup'); DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      const next = await loadMeetupParticipation(supabase, post.id, me.id);
      if (focusedScope.current === scope) setParticipation(next);
    } catch (e) { if (focusedScope.current === scope) { play('warning'); setError(submitted ? "신청은 접수됐어요. 현재 상태를 다시 불러와 주세요." : getChillingError(e)); setErrorCode(submitted ? null : getChillingErrorCode(e)); if (!submitted && getChillingErrorCode(e) === 'CHILLING_PROFILE_CHANGED') { setConsent(false); setRetry(value => value + 1); } } }
    finally { if (focusedScope.current === scope) { busy.current = false; setSending(false); } }
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <View style={[styles.head, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-join.pressable.1" onPress={() => { play('selection'); back(); }} accessibilityRole="button" accessibilityLabel={tr("뒤로가기")} style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <ThemedText accessibilityRole="header" style={styles.headTitle}>{tr("참여 신청")}</ThemedText><View style={styles.back} />
    </View>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView analyticsId="app_meetup-join.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!isAuthed ? <Pressable analyticsId="app_meetup-join.pressable.2" onPress={() => { play('selection'); promptLogin('참여하려면 로그인해 주세요.'); }} style={styles.button} accessibilityRole="button"><ThemedText style={styles.body} themeColor="accent">{tr("로그인하기")}</ThemedText></Pressable>
          : loading ? <GlingLoader color={theme.accent} accessibilityLabel={tr("신청 정보 불러오는 중")} />
            : error && !post ? <StateCard kind="error" title={tr("신청 정보를 불러오지 못했어요")} body={tr(error)} actionLabel={tr("다시 불러오기")} onAction={() => setRetry(v => v + 1)} />
            : unavailable ? <StateCard kind={error ? 'error' : 'blocked'} title={error ? tr('모임 정보를 불러오지 못했어요') : tr("이 모임을 볼 수 없어요")} body={tr(error || "삭제됐거나 현재 열람할 수 없는 모임이에요.")} actionLabel={error ? tr('다시 불러오기') : undefined} onAction={error ? () => setRetry(value => value + 1) : undefined} />
              : own ? <><ThemedText style={styles.body}>{tr("내가 개최한 모임이에요. 대화 탭에서 신청자를 확인할 수 있어요.")}</ThemedText>
                  <RaisedActionButton analyticsId="app_meetup-join.pressable.3" onPress={() => { play('selection'); router.push({ pathname: '/chat', params: { view: 'requests' } }); }} label={tr("참여 신청자 검토하기")} /></>
                : inactive ? <><ThemedText type="subtitle">{post!.title}</ThemedText>
                    <StateCard kind="blocked" title={availability === 'ended' ? tr("종료된 모임이에요") : tr("모집이 마감됐어요")} body={`${status ? tr('내 신청 · {0}. ', tr({ pending: '승인 대기', approved: '이전에 승인됨', rejected: '거절됨', cancelled: '취소됨' }[status])) : ''}${tr('새 참여 신청과 승인을 할 수 없어요.')}${status === 'approved' ? tr('승인 기록이 있어도 종료된 모임 대화에는 입장할 수 없어요.') : ''}`} />
                    <Pressable analyticsId="app_meetup-join.pressable.3" accessibilityRole="button" onPress={() => { play('selection'); router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups'); }} style={styles.button}><ThemedText style={styles.body} themeColor="accent">{tr("다른 모임 찾기")}</ThemedText></Pressable>
                  </>
                : result ? <>
                    <ThemedText type="subtitle">{post!.title}</ThemedText>
                    <StateCard kind={status === 'approved' ? 'success' : 'pending'} title={status === 'approved' ? tr("참여가 승인됐어요") : status === 'pending' ? tr("승인 대기 중이에요") : tr("신청을 접수했어요")}
                      body={tr(status === 'approved' ? '대화 탭에서 모임 대화와 집결 안내를 확인해 주세요.' : status === 'pending' ? availability === 'full' ? '내 신청은 대기 중이에요. 현재 정원이 차서 모임장이 승인할 수 없어요. 신청만으로 자리가 예약되지는 않아요.' : '아직 참여가 확정되지 않았어요. 모임장이 검토한 뒤 승인하면 모임 대화에 참여할 수 있어요.' : '현재 신청 상태를 다시 불러와 주세요.')} />
                    {post!.room!.fee && <MeetupFeeLine fee={post!.room!.fee} paid={status === 'approved' ? feePaid : null} />}
                    {modern && participation && <Pressable analyticsId="app_meetup-join.pressable.11" accessibilityRole="button" onPress={() => { play('selection'); router.push({ pathname: '/meetup-application', params: { requestId: participation.id } }); }} style={styles.button}><ThemedText style={styles.body} themeColor="accent">{tr("내가 보낸 프로필과 답변 보기")}</ThemedText></Pressable>}
                    {status === 'pending' && <Pressable analyticsId="app_meetup-join.pressable.12" accessibilityRole="button" disabled={sending} accessibilityState={{ disabled: sending, busy: sending }} onPress={confirmCancel} style={styles.button}><ThemedText style={styles.body} themeColor="textSecondary">{sending ? tr("취소 중…") : tr("신청 취소")}</ThemedText></Pressable>}
                    <Pressable analyticsId="app_meetup-join.pressable.9" accessibilityRole="button" disabled={sending} onPress={() => { play('selection'); setRetry(v => v + 1); }} style={styles.button}><ThemedText style={styles.body} themeColor="accent">{tr("현재 신청 상태 새로고침")}</ThemedText></Pressable>
                    <RaisedActionButton analyticsId="app_meetup-join.pressable.3" onPress={() => { play('selection'); if (status === 'approved') router.replace({ pathname: '/chat', params: { view: 'group' } }); else router.replace('/(tabs)/meetups'); }} label={status === 'approved' ? tr("모임 대화 보기") : tr("내 모임에서 보기")} />
                  </>
                  : <>
                    <ThemedText type="subtitle">{post!.title}</ThemedText>
                    {paused && <StateCard kind="blocked" title={tr("모집 마감")} body={tr("지금은 새 참여 신청을 받지 않아요. 호스트가 모집을 다시 열면 신청할 수 있어요.")} />}
                    {!paused && availability === 'full' && <StateCard kind="blocked" title={tr("정원이 모두 찼어요")} body={tr("현재 남은 자리가 없어 신청을 보낼 수 없어요. 작성한 답변은 유지돼요. 자리 현황을 다시 확인해 주세요.")} />}
                    {(status === 'rejected' || status === 'cancelled') && <StateCard kind={status === 'rejected' ? 'blocked' : 'empty'} title={status === 'rejected' ? tr("이전 신청이 거절됐어요") : tr("이전 신청은 취소된 상태예요")} body={coolingDown ? tr('이전 신청 처리 후 24시간 동안 재신청할 수 없어요. {0} 이후 다시 신청해 주세요.', new Intl.DateTimeFormat(appLocale, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(reapplyAt))) : tr('현재 참여가 확정되지 않았어요. 답변과 공유 동의를 확인하고 다시 신청할 수 있어요.')} />}
                    {coolingDown && <Pressable analyticsId="app_meetup-join.pressable.9" accessibilityRole="button" onPress={() => { play('selection'); setRetry(v => v + 1); }} style={[styles.secondary, { borderColor: theme.accent }]}><ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr('현재 상태 확인')}</ThemedText></Pressable>}
                    <View style={[styles.summary, { borderColor: theme.line }]}><ChillingEventSchedule room={post!.room!} /></View>
                    {post!.room!.recommendedAgeMin != null && <>
                      <ThemedText type="small" style={styles.support} themeColor="textSecondary">{recommendedAgeMessage(post!.room!, recommendationAge, appLocale)}</ThemedText>
                      {recommendationAge == null && Platform.OS !== 'web' && <Pressable analyticsId="app_meetup-join.pressable.4" onPress={() => { play('selection'); router.push('/profile/settings'); }} accessibilityRole="button" style={styles.button}><ThemedText type="small" style={styles.support} themeColor="accent">{tr("계정 정보·이용 목적 확인하기")}</ThemedText></Pressable>}
                    </>}
                    <Pressable analyticsId="meetup.join.policy" accessibilityRole="button" accessibilityState={{ expanded: policyOpen }} onPress={() => { play('selection'); setPolicyOpen(value => !value); }} style={styles.button}><ThemedText style={styles.support} themeColor="textSecondary">{copy('신청·취소 안내', 'Application and cancellation details')}{policyOpen ? ' −' : ' +'}</ThemedText></Pressable>
                    {policyOpen && <MeetupPolicyNotice mode="join" />}
                    {availability === 'full' && !own && !result && <MeetupWaitlist postId={postId} />}
                    {modern && <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{copy('1. 내 모임 프로필 확인', '1. Review your meetup profile')}</ThemedText>}
                    {modern && profile?.version !== 2 ? <>
                      <ThemedText style={styles.body} accessibilityRole={profileError ? 'alert' : undefined}>{profileError ? tr(profileError) : profile ? tr('모임에서 쓸 이름과 공개 범위를 확인해 주세요. 기존 소개는 남아 있어요.') : tr("함께할 사람들에게 나를 소개할 모임 프로필이 필요해요.")}</ThemedText>
                      <Pressable analyticsId="app_meetup-join.pressable.5" onPress={() => { play('selection'); profileRoute(); }} accessibilityRole="button" style={styles.button}><ThemedText style={styles.body} themeColor="accent">{profileError ? tr("모임 프로필 열기") : profile ? tr('모임 프로필 확인하기') : tr("모임 프로필 작성하기")}</ThemedText></Pressable>
                      {!!profileError && <Pressable analyticsId="app_meetup-join.pressable.9" onPress={() => { play('selection'); setRetry(v => v + 1); }} accessibilityRole="button" style={[styles.secondary, { borderColor: theme.accent }]}><ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("다시 불러오기")}</ThemedText></Pressable>}
                    <View style={[styles.questionCard, { backgroundColor: theme.card }]}>
                      <ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("{0}님이 궁금해요", post!.author.nickname)}</ThemedText>
                      <ThemedText style={styles.question}>{post!.room!.applicationQuestion || tr("함께하고 싶은 이유를 알려주세요")}</ThemedText>
                      <TextInput value={answer} onChangeText={setAnswer} accessibilityLabel={tr("신청 답변")} multiline maxLength={300} editable={!sending} placeholder={tr("나답게 편하게 답해주세요.")} placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.line, color: theme.text, backgroundColor: theme.background }]} />
                      <ThemedText type="small" themeColor="textSecondary" style={[styles.support, styles.count]}>{answer.length}/300</ThemedText>
                    </View>

                    </> : <>
                      {profile && <View style={[styles.profilePreview, { borderColor: theme.line }]}>
                        <Pressable analyticsId="app_meetup-join.pressable.13" accessibilityRole="button" accessibilityState={{ expanded: previewOpen }} onPress={() => { play('selection'); setPreviewOpen(value => !value); }} style={styles.previewHead}>
                          <View style={styles.flex}><ThemedText type="smallBold" style={styles.body}>{profile.displayName || tr("모임 멤버")}{tr("님의 모임 프로필")}</ThemedText><ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr("이 모임장에게 함께 보내요")}</ThemedText></View><ThemedText type="smallBold" style={styles.support} themeColor="accent">{previewOpen ? tr("접기") : tr("미리보기")} ›</ThemedText>
                        </Pressable>
                        {previewOpen && <ChillingProfileCard profile={chillingProfilePreview(profile, 'host')} />}
                        <Pressable analyticsId="app_meetup-join.pressable.6" onPress={() => { play('selection'); profileRoute(); }} accessibilityRole="button" style={styles.button}><ThemedText style={styles.body} themeColor="accent">{tr("프로필 수정")}</ThemedText></Pressable></View>}
                      <ThemedText accessibilityRole="header" style={styles.sectionTitle}>{modern ? copy('2. 답변 쓰기', '2. Your answer') : copy('신청 답변', 'Your answer')}</ThemedText>
                    <View style={[styles.questionCard, { backgroundColor: theme.card }]}>
                      <ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("{0}님이 궁금해요", post!.author.nickname)}</ThemedText>
                      <ThemedText style={styles.question}>{post!.room!.applicationQuestion || tr("함께하고 싶은 이유를 알려주세요")}</ThemedText>
                      <TextInput value={answer} onChangeText={setAnswer} accessibilityLabel={tr("신청 답변")} multiline maxLength={300} editable={!sending} placeholder={tr("나답게 편하게 답해주세요.")} placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.line, color: theme.text, backgroundColor: theme.background }]} />
                      <ThemedText type="small" themeColor="textSecondary" style={[styles.support, styles.count]}>{answer.length}/300</ThemedText>
                    </View>
                      {modern && profile?.version === 2 && <ThemedText type="small" style={styles.support} themeColor="textSecondary">{profile.shareWithMembers ? tr("승인 후에는 선택한 사진·짧은 소개가 멤버에게도 공유돼요. 신청 답변은 호스트만 볼 수 있어요.") : tr("승인된 멤버에게는 모임 이름만 보여요. 사진·소개 공유는 프로필에서 바꿀 수 있어요.")}</ThemedText>}
                      {modern && <Pressable analyticsId="app_meetup-join.pressable.7" onPress={() => { play('selection'); setConsent(v => !v); }} disabled={sending} accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: sending }} style={styles.consent}>
                        <ThemedText style={styles.body} themeColor="accent">{consent ? '☑' : '□'}</ThemedText><ThemedText type="small" style={[styles.support, styles.flex]}>{tr("이 호스트에게 신청 당시 모임 프로필과 답변을 공유하는 데 동의해요. 다른 신청자에게는 공개되지 않아요. 취소·거절·탈퇴·차단·종료 후 새 조회는 제한되지만 이미 본 내용은 회수할 수 없어요.")}</ThemedText>
                      </Pressable>}
                      <ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr("안전을 위한 자동 분석과 권한 있는 운영자 검토가 적용돼요. 신청 취소는 이 신청 화면에서 할 수 있어요.")}</ThemedText>
                    </>}
                  </>}
        {!!error && !!post && (own || inactive || result) && <><ThemedText style={styles.body} accessibilityRole="alert" themeColor="accent">{tr(error)}</ThemedText>
          {membershipError && <Pressable analyticsId="app_meetup-join.pressable.10" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.button}><ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("멤버십과 모임 자리 보기 ›")}</ThemedText></Pressable>}
          <Pressable analyticsId="app_meetup-join.pressable.9" onPress={() => { play('selection'); setRetry(v => v + 1); }} accessibilityRole="button" style={styles.button}><ThemedText style={styles.body}>{tr("다시 불러오기")}</ThemedText></Pressable></>}
      </ScrollView>
      {isAuthed && !loading && !unavailable && !own && !inactive && !result && <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.line }]}>
        {!!error && !!post && <>{errorCode !== 'MEETUP_FULL' && errorCode !== 'MEETUP_RECRUITING_CLOSED' && <ThemedText style={styles.body} accessibilityRole="alert" themeColor="accent">{tr(error)}</ThemedText>}
          {membershipError && <Pressable analyticsId="app_meetup-join.pressable.10" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.button}><ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("멤버십과 모임 자리 보기 ›")}</ThemedText></Pressable>}
          <Pressable analyticsId="app_meetup-join.pressable.9" onPress={() => { play('selection'); setRetry(v => v + 1); }} accessibilityRole="button" style={[styles.secondary, { borderColor: theme.accent }]}><ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("다시 불러오기")}</ThemedText></Pressable></>}
        <RaisedActionButton analyticsId="app_meetup-join.pressable.8" onPress={() => { play('selection'); void submit(); }} disabled={sending || availability !== 'open' || paused || coolingDown || !answer.trim() || (modern && (!consent || profile?.version !== 2))} busy={sending} label={sending ? tr("보내는 중…") : paused ? tr("지금은 새 신청을 받지 않아요") : availability === 'full' ? tr("정원이 모두 찼어요") : coolingDown ? tr("재신청 대기 중") : modern && profile?.version !== 2 ? tr("프로필 작성 후 신청 가능") : status ? tr("다시 신청하기") : modern ? tr("답변과 프로필 보내기") : tr("신청 답변 보내기")} />
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, flex: { flex: 1 }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { flex: 1, textAlign: 'center', fontSize: 28, lineHeight: 36, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  sectionTitle: { fontSize: 24, lineHeight: 32, fontWeight: '600' }, support: { fontSize: 14, lineHeight: 20 },
  button: { minHeight: 44, justifyContent: 'center' }, secondary: { minHeight: 44, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center' }, input: { minHeight: 100, borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 16, lineHeight: 24, textAlignVertical: 'top' },
  consent: { minHeight: 44, flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  questionCard: { padding: Spacing.four, borderRadius: 22, gap: Spacing.three }, question: { fontSize: 20, lineHeight: 28, fontWeight: '600' }, count: { textAlign: 'right' },
  summary: { borderWidth: 1, borderRadius: 16, padding: Spacing.three }, profilePreview: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.three }, previewHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, padding: Spacing.four, gap: Spacing.two },
});
