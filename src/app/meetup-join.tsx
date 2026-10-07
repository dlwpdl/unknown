import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, AppState, DeviceEventEmitter, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { StateCard } from '@/components/state-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { ChillingEventSchedule } from '@/components/chilling-event';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { chillingAvailability, recommendedAgeMessage } from '@/lib/chilling';
import { ageForMeetupRecommendation } from '@/lib/personal-info';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { getChillingError, getChillingErrorCode, loadChillingProfile, loadMeetupParticipation, requestChillingJoin, type ChillingProfile, type MeetupParticipation } from '@/lib/chilling-data';
import { leaveMeetup, MEETUPS_CHANGED_EVENT, requestMeetupJoin } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicPost } from '@/lib/feed-data';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function MeetupJoinRoute() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { me, isAuthed } = useAuth();
  return <JoinForm key={`${postId}:${isAuthed ? me.id : 'guest'}`} postId={postId} />;
}
function JoinForm({ postId }: { postId: string }) {
  const theme = useTheme(), router = useRouter(), hidden = useContentVisibility();
  const { isAuthed, promptLogin, me } = useAuth();
  const { play } = useInteractionFeedback();
  const [post, setPost] = useState<Post | null>(null), [profile, setProfile] = useState<ChillingProfile | null>(null);
  const [participation, setParticipation] = useState<MeetupParticipation | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [recommendationAge, setRecommendationAge] = useState<number | null>(null);
  const [answer, setAnswer] = useState(''), [consent, setConsent] = useState(false), [sending, setSending] = useState(false), [sent, setSent] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  // 자리(등급) 문제는 멤버십 화면에서 바로 확인할 수 있게 안내한다.
  const membershipError = !!errorCode && !!t.actionErrors[errorCode as keyof typeof t.actionErrors]?.membership;
  useFocusEffect(useCallback(() => {
    let active = true;
    setNow(Date.now());
    setConsent(false); setLoading(true); setError(''); setErrorCode(null); setPost(null); setProfile(null); setParticipation(null); setRecommendationAge(null);
    if (!isAuthed) { setLoading(false); return; }
    void supabase.rpc('get_my_personal_info').then(({ data, error: failure }) => {
      if (active && !failure) setRecommendationAge(ageForMeetupRecommendation(data));
    }, () => {});
    void loadPublicPost(supabase, postId).then(async value => {
      const [ownProfile, request] = await Promise.all([
        value?.room?.eventKind ? loadChillingProfile(supabase) : null,
        value?.room && value.author.id !== me.id ? loadMeetupParticipation(supabase, postId, me.id) : null,
      ]);
      if (active) { setPost(value); setProfile(ownProfile); setParticipation(request); setSent(false); }
    }).catch(e => { if (active) { setError(getChillingError(e)); setErrorCode(getChillingErrorCode(e)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // retry deliberately re-runs the focused screen's load after an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, me.id, postId, retry]));
  const back = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/meetups');
  const unavailable = !post?.room || hidden('post', post.id, post.author.id);
  const availability = errorCode === 'MEETUP_FULL' ? 'full' : errorCode === 'MEETUP_EXPIRED' ? 'ended'
    : errorCode === 'MEETUP_CLOSED' ? 'closed' : chillingAvailability(post?.room ?? {}, now);
  const inactive = availability === 'ended' || availability === 'closed';
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
  const cancelRequest = async () => {
    if (busy.current || status !== 'pending') return;
    busy.current = true; setSending(true); setError('');
    try { await leaveMeetup(supabase, postId); play('success'); DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT); setSent(false); setRetry(v => v + 1); }
    catch (e) { play('warning'); setError(getChillingError(e)); }
    finally { busy.current = false; setSending(false); }
  };
  const confirmCancel = () => {
    play('selection');
    if (Platform.OS === 'web') { if (globalThis.confirm('이 모임의 참여 신청을 취소할까요?')) void cancelRequest(); }
    else Alert.alert('참여 신청 취소', '호스트가 더 이상 신청 프로필을 볼 수 없어요.', [{ text: '돌아가기', style: 'cancel' }, { text: '신청 취소', style: 'destructive', onPress: () => void cancelRequest() }]);
  };
  const submit = async () => {
    if (busy.current || unavailable || availability !== 'open' || coolingDown || own || !post || result || !answer.trim() || (modern && (!profile || !consent))) return;
    busy.current = true; setSending(true); setError(''); setErrorCode(null);
    let submitted = false;
    try {
      if (modern) await requestChillingJoin(supabase, post.id, answer, consent);
      else await requestMeetupJoin(supabase, post.id, answer);
      submitted = true; setSent(true); play('meetup'); DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      setParticipation(await loadMeetupParticipation(supabase, post.id, me.id));
    } catch (e) { play('warning'); setError(submitted ? '신청은 접수됐어요. 현재 상태를 다시 불러와 주세요.' : getChillingError(e)); setErrorCode(submitted ? null : getChillingErrorCode(e)); }
    finally { busy.current = false; setSending(false); }
  };
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <View style={[styles.head, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-join.pressable.1" onPress={() => { play('selection'); back(); }} accessibilityRole="button" accessibilityLabel="뒤로가기" style={({ pressed }) => [styles.back, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <ThemedText accessibilityRole="header" style={styles.headTitle}>참여 신청</ThemedText><View style={styles.back} />
    </View>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView analyticsId="app_meetup-join.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!isAuthed ? <Pressable analyticsId="app_meetup-join.pressable.2" onPress={() => { play('selection'); promptLogin('참여하려면 로그인해 주세요.'); }} style={styles.button} accessibilityRole="button"><ThemedText themeColor="accent">로그인하기</ThemedText></Pressable>
          : loading ? <GlingLoader color={theme.accent} accessibilityLabel="신청 정보 불러오는 중" />
            : error && !post ? <StateCard kind="error" title="신청 정보를 불러오지 못했어요" body={error} actionLabel="다시 불러오기" onAction={() => setRetry(v => v + 1)} />
            : unavailable ? <StateCard kind="blocked" title="이 모임을 볼 수 없어요" body="삭제됐거나 현재 열람할 수 없는 모임이에요." />
              : own ? <ThemedText>내가 개최한 모임이에요. 대화 탭에서 신청자를 확인할 수 있어요.</ThemedText>
                : inactive ? <><ThemedText type="subtitle">{post!.title}</ThemedText>
                    <StateCard kind="blocked" title={availability === 'ended' ? '종료된 모임이에요' : '모집이 마감됐어요'} body={`${status ? `내 신청 · ${{ pending: '승인 대기', approved: '이전에 승인됨', rejected: '거절됨', cancelled: '취소됨' }[status]}. ` : ''}새 참여 신청과 승인을 할 수 없어요.${status === 'approved' ? '승인 기록이 있어도 종료된 모임 대화에는 입장할 수 없어요.' : ''}`} />
                    <Pressable analyticsId="app_meetup-join.pressable.3" accessibilityRole="button" onPress={() => { play('selection'); router.replace('/(tabs)/meetups'); }} style={styles.button}><ThemedText themeColor="accent">다른 모임 찾기</ThemedText></Pressable>
                  </>
                : result ? <>
                    <ThemedText type="subtitle">{post!.title}</ThemedText>
                    <StateCard kind={status === 'approved' ? 'success' : 'pending'} title={status === 'approved' ? '참여가 승인됐어요' : status === 'pending' ? '승인 대기 중이에요' : '신청을 접수했어요'}
                      body={status === 'approved' ? '대화 탭에서 모임 대화와 집결 안내를 확인해 주세요.' : status === 'pending' ? availability === 'full' ? '내 신청은 대기 중이에요. 현재 정원이 차서 모임장이 승인할 수 없어요. 신청만으로 자리가 예약되지는 않아요.' : '아직 참여가 확정되지 않았어요. 모임장이 검토한 뒤 승인하면 모임 대화에 참여할 수 있어요.' : '현재 신청 상태를 다시 불러와 주세요.'} />
                    {modern && participation && <Pressable analyticsId="app_meetup-join.pressable.11" accessibilityRole="button" onPress={() => { play('selection'); router.push({ pathname: '/meetup-application', params: { requestId: participation.id } }); }} style={styles.button}><ThemedText themeColor="accent">내가 보낸 프로필과 답변 보기</ThemedText></Pressable>}
                    {status === 'pending' && <Pressable analyticsId="app_meetup-join.pressable.12" accessibilityRole="button" disabled={sending} accessibilityState={{ disabled: sending, busy: sending }} onPress={confirmCancel} style={styles.button}><ThemedText themeColor="textSecondary">{sending ? '취소 중…' : '신청 취소'}</ThemedText></Pressable>}
                    <Pressable analyticsId="app_meetup-join.pressable.9" accessibilityRole="button" disabled={sending} onPress={() => { play('selection'); setRetry(v => v + 1); }} style={styles.button}><ThemedText themeColor="accent">현재 신청 상태 새로고침</ThemedText></Pressable>
                    <RaisedActionButton analyticsId="app_meetup-join.pressable.3" onPress={() => { play('selection'); router.replace({ pathname: '/chat', params: { view: status === 'approved' ? 'group' : 'requests' } }); }} label={status === 'approved' ? '모임 대화 보기' : '대화·신청 탭 보기'} />
                  </>
                  : <>
                    <ThemedText type="subtitle">{post!.title}</ThemedText>
                    {availability === 'full' && <StateCard kind="blocked" title="정원이 모두 찼어요" body="현재 남은 자리가 없어 신청을 보낼 수 없어요. 작성한 답변은 유지돼요. 자리 현황을 다시 확인해 주세요." />}
                    {(status === 'rejected' || status === 'cancelled') && <StateCard kind={status === 'rejected' ? 'blocked' : 'empty'} title={status === 'rejected' ? '이전 신청이 거절됐어요' : '이전 신청은 취소된 상태예요'} body={coolingDown ? `이전 신청 처리 후 24시간 동안 재신청할 수 없어요. ${new Date(reapplyAt).toLocaleString('ko-KR')} 이후 다시 신청해 주세요.` : '현재 참여가 확정되지 않았어요. 답변과 공유 동의를 확인하고 다시 신청할 수 있어요.'} actionLabel={coolingDown ? '현재 상태 확인' : undefined} onAction={coolingDown ? () => setRetry(v => v + 1) : undefined} />}
                    <View style={[styles.questionCard, { backgroundColor: theme.card }]}>
                      <ThemedText type="smallBold" themeColor="accent">{post!.author.nickname}님이 궁금해요</ThemedText>
                      <ThemedText style={styles.question}>{post!.room!.applicationQuestion || '함께하고 싶은 이유를 알려주세요'}</ThemedText>
                      <TextInput value={answer} onChangeText={setAnswer} accessibilityLabel="신청 답변" multiline maxLength={300} editable={!sending} placeholder="나답게 편하게 답해주세요." placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.line, color: theme.text, backgroundColor: theme.background }]} />
                      <ThemedText type="small" themeColor="textSecondary" style={styles.count}>{answer.length}/300</ThemedText>
                    </View>
                    <View style={[styles.summary, { borderColor: theme.line }]}><ChillingEventSchedule room={post!.room!} /></View>
                    {post!.room!.recommendedAgeMin != null && <>
                      <ThemedText type="small" themeColor="textSecondary">{recommendedAgeMessage(post!.room!, recommendationAge)}</ThemedText>
                      {recommendationAge == null && <Pressable analyticsId="app_meetup-join.pressable.4" onPress={() => { play('selection'); router.push('/profile/settings'); }} accessibilityRole="button" style={styles.button}><ThemedText type="small" themeColor="accent">계정 정보·이용 목적 확인하기</ThemedText></Pressable>}
                    </>}
                    <MeetupPolicyNotice mode="join" />
                    {modern && !profile ? <>
                      <ThemedText>함께할 사람들에게 나를 소개할 모임 프로필이 필요해요.</ThemedText>
                      <Pressable analyticsId="app_meetup-join.pressable.5" onPress={() => { play('selection'); profileRoute(); }} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">모임 프로필 작성하기</ThemedText></Pressable>
                    </> : <>
                      {profile && <View style={[styles.profilePreview, { borderColor: theme.line }]}>
                        <Pressable analyticsId="app_meetup-join.pressable.13" accessibilityRole="button" accessibilityState={{ expanded: previewOpen }} onPress={() => { play('selection'); setPreviewOpen(value => !value); }} style={styles.previewHead}>
                          <View style={styles.flex}><ThemedText type="smallBold">{me.nickname}님의 모임 프로필</ThemedText><ThemedText type="small" themeColor="textSecondary">이 모임장에게 함께 보내요</ThemedText></View><ThemedText type="smallBold" themeColor="accent">{previewOpen ? '접기' : '미리보기'} ›</ThemedText>
                        </Pressable>
                        {previewOpen && <ChillingProfileCard profile={profile} identity={me} />}
                        <Pressable analyticsId="app_meetup-join.pressable.6" onPress={() => { play('selection'); profileRoute(); }} accessibilityRole="button" style={styles.button}><ThemedText themeColor="accent">프로필 수정</ThemedText></Pressable></View>}
                      {modern && <Pressable analyticsId="app_meetup-join.pressable.7" onPress={() => { play('selection'); setConsent(v => !v); }} disabled={sending} accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: sending }} style={styles.consent}>
                        <ThemedText themeColor="accent">{consent ? '☑' : '□'}</ThemedText><ThemedText type="small" style={styles.flex}>이 호스트에게 내 모임 프로필과 답변을 공유하는 데 동의해요. 다른 신청자에게는 공개되지 않아요. 신청 취소·거절·탈퇴·차단 후 호스트 열람은 종료돼요.</ThemedText>
                      </Pressable>}
                      <ThemedText type="small" themeColor="textSecondary">안전을 위한 자동 분석과 권한 있는 운영자 검토가 적용돼요. 신청 취소는 이 신청 화면에서 할 수 있어요.</ThemedText>
                    </>}
                  </>}
        {!!error && !!post && <><ThemedText accessibilityRole="alert" themeColor="accent">{error}</ThemedText>
          {membershipError && <Pressable analyticsId="app_meetup-join.pressable.10" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.button}><ThemedText type="smallBold" themeColor="accent">멤버십과 모임 자리 보기 ›</ThemedText></Pressable>}
          <Pressable analyticsId="app_meetup-join.pressable.9" onPress={() => { play('selection'); setRetry(v => v + 1); }} accessibilityRole="button" style={styles.button}><ThemedText>다시 불러오기</ThemedText></Pressable></>}
      </ScrollView>
      {isAuthed && !loading && !unavailable && !own && !inactive && !result && <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.line }]}>
        <RaisedActionButton analyticsId="app_meetup-join.pressable.8" onPress={() => { play('selection'); void submit(); }} disabled={sending || availability !== 'open' || coolingDown || !answer.trim() || (modern && (!consent || !profile))} busy={sending} label={sending ? '보내는 중…' : availability === 'full' ? '정원이 모두 찼어요' : coolingDown ? '재신청 대기 중' : modern && !profile ? '프로필 작성 후 신청 가능' : status ? '다시 신청하기' : modern ? '답변과 프로필 보내기' : '신청 답변 보내기'} />
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, flex: { flex: 1 }, content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three }, back: { width: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, headTitle: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  button: { minHeight: 44, justifyContent: 'center' }, input: { minHeight: 100, borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 16, textAlignVertical: 'top' },
  consent: { minHeight: 44, flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  questionCard: { padding: Spacing.four, borderRadius: 22, gap: Spacing.three }, question: { fontSize: 22, lineHeight: 30, fontWeight: '600' }, count: { textAlign: 'right' },
  summary: { borderWidth: 1, borderRadius: 16, padding: Spacing.three }, profilePreview: { borderWidth: 1, borderRadius: 18, padding: Spacing.three, gap: Spacing.three }, previewHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, padding: Spacing.four },
});
