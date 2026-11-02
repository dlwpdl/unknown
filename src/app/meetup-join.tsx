import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusEffect, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { Alert, Animated, AppState, DeviceEventEmitter, Easing, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { requestPushPrompt } from '@/lib/push-prompt';
import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChillingProfileCard } from '@/components/chilling-profile-card';
import { MeetupChips } from '@/components/chilling-host-profile';
import { MeetupFacts } from '@/components/post-detail';
import { Disclosure } from '@/components/disclosure';
import { DragSheet } from '@/components/drag-sheet';
import { InitialAvatar, ListCard, ListRow } from '@/components/list-card';
import { MeetupWaitlist } from '@/components/meetup-host-tools';
import { MeetupLanguagePicker } from '@/components/meetup-language';
import { MEETUP_LANGUAGE_ENGLISH_NAMES, MEETUP_LANGUAGE_NAMES, loadMeetupLanguages, otherLanguage, parseLanguageExchange, sideOpen, type MeetupLanguage, type MeetupLanguages } from '@/lib/meetup-language';
import { PopIn, StateCard } from '@/components/state-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { SeatBar } from '@/components/chilling-event';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ControlMotion, ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { chillingAvailability, chillingKind, chillingSchedule, chillingTimezoneLabel, recommendedAgeLabel } from '@/lib/chilling';
import { useAuth } from '@/lib/auth';
import { chillingProfilePreview, getChillingError, getChillingErrorCode, loadChillingProfile, loadMeetupParticipation, requestChillingJoin, type ChillingProfile, type MeetupParticipation } from '@/lib/chilling-data';
import { leaveMeetup, MEETUPS_CHANGED_EVENT, requestMeetupJoin } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicPost } from '@/lib/feed-data';
import { loadSharedLinkPost } from '@/lib/shared-link-preview';
import { SHARED_POST_RETURN_KEY } from '@/lib/sharing';
import { loadMeetupFeePayments, meetupFeeAmount, meetupFeeDue } from '@/lib/meetup-host-tools';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';
import { useNewcomerStatus } from '@/components/newcomer';
import { newcomerLocked } from '@/lib/newcomer';

/** Each screen state settles in with a short rise. Reduced motion shows it straight away. */
function Rise({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => { if (!reduced) Animated.timing(progress, { toValue: 1, duration: ControlMotion.expandMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [progress, reduced]);
  return <Animated.View style={[styles.stack, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{children}</Animated.View>;
}

/** Where a request is: a vertical line of what's done, what's happening and what's next. */
function JoinSteps({ steps }: { steps: { label: string; state: 'done' | 'now' | 'next' }[] }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  return <View style={styles.steps}>
    {steps.map((step, index) => <View key={step.label} accessible accessibilityLabel={`${step.label}, ${tr(step.state === 'done' ? '완료' : step.state === 'now' ? '진행 중' : '다음 단계')}`} style={styles.step}>
      <View style={styles.stepRail}>
        <View style={[styles.stepDot, step.state === 'done' ? { backgroundColor: theme.accent, borderColor: theme.accent } : { borderColor: step.state === 'now' ? theme.accent : theme.line }]}>
          {step.state === 'done' && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={12} tintColor={theme.accentInk} />}
        </View>
        {index < steps.length - 1 && <View style={[styles.stepLine, { backgroundColor: step.state === 'done' ? theme.accent : theme.line }]} />}
      </View>
      <ThemedText themeColor={step.state === 'next' ? 'textSecondary' : undefined} style={[styles.support, styles.stepLabel, index < steps.length - 1 && styles.stepGap, step.state === 'now' && styles.stepNow]}>{step.label}</ThemedText>
    </View>)}
  </View>;
}

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
  const [post, setPost] = useState<Post | null>(null);
  const newcomer = useNewcomerStatus(isAuthed && post?.room?.newcomerOnly === true);
  const [profile, setProfile] = useState<ChillingProfile | null>(null);
  const [participation, setParticipation] = useState<MeetupParticipation | null>(null), [feePaid, setFeePaid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [languages, setLanguages] = useState<MeetupLanguages | null>(null), [speaks, setSpeaks] = useState<MeetupLanguage | null>(null);
  const [answer, setAnswer] = useState(''), [consent, setConsent] = useState(false), [sending, setSending] = useState(false), [sent, setSent] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null), [profileError, setProfileError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const editAfterSheet = useRef(false);
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
    setConsent(false); setLoading(true); setError(''); setErrorCode(null); setProfileError(''); setPost(null); setProfile(null); setParticipation(null); setFeePaid(null); setLanguages(null); setSpeaks(null);
    // Logged out, loadPublicPost fails (it also reads comments); the guest read gives the first photo and the public meetup fields.
    const read = !isAuthed ? loadSharedLinkPost(supabase, postId).then(value => { if (active) setPost(value); }) : loadPublicPost(supabase, postId).then(async value => {
      if (!active) return;
      const [ownProfile, request, sides] = await Promise.all([
        // A profile failure (e.g. unavailable photos) only blocks submit; the meetup and request status still load.
        value?.room?.eventKind ? loadChillingProfile(supabase, 'application').catch(e => { if (active) setProfileError(getChillingError(e)); return null; }) : null,
        value?.room && value.author.id !== me.id ? loadMeetupParticipation(supabase, postId, me.id) : null,
        // Unreadable counts leave the choice open; the server still refuses a full side.
        parseLanguageExchange(value?.room) && value!.author.id !== me.id ? loadMeetupLanguages(supabase, postId).catch(() => null) : null,
      ]);
      // An unverified payment read shows the fee without a status rather than guessing.
      const payments = value?.room?.fee && request?.status === 'approved' ? await loadMeetupFeePayments(supabase, postId).catch(() => null) : null;
      if (active) { setPost(value); setProfile(ownProfile); setParticipation(request); setFeePaid(payments && payments.some(row => row.user_id === me.id)); setSent(false); setLanguages(sides); setSpeaks(sides?.mine?.speaks ?? null); }
    });
    void read.catch(e => { if (active) { setError(getChillingError(e)); setErrorCode(getChillingErrorCode(e)); } })
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
  // Newcomer-only meetups: the server rejects others too; this only replaces the form with a note.
  const locked = !inactive && !paused && ((!!newcomer.status && newcomerLocked(post?.room, newcomer.status)) || errorCode === 'MEETUP_NEWCOMERS_ONLY');
  const own = post?.author.id === me.id;
  const modern = !!post?.room?.eventKind;
  const status = participation?.status;
  const result = status === 'pending' || status === 'approved' || (sent && !status);
  const reapplyAt = (status === 'rejected' || status === 'cancelled') && participation ? Date.parse(participation.responded_at ?? participation.created_at) + 86400000 : 0;
  const coolingDown = reapplyAt > now;
  const exchange = parseLanguageExchange(post?.room);
  const choice = exchange && speaks ? { speaks, learns: otherLanguage(exchange, speaks) } : null;
  const sideFull = !!choice && (!sideOpen(languages, choice.speaks) || errorCode === 'LANGUAGE_SIDE_FULL');
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
    if (!scope || !isAuthed || busy.current || unavailable || availability !== 'open' || paused || locked || coolingDown || own || !post || result || !answer.trim() || (modern && (profile?.version !== 2 || !consent)) || (exchange && (!choice || sideFull))) return;
    busy.current = true; setSending(true); setError(''); setErrorCode(null);
    let submitted = false;
    try {
      if (modern) await requestChillingJoin(supabase, post.id, answer, consent, profile!.revision ?? '', choice);
      else await requestMeetupJoin(supabase, post.id, answer);
      if (focusedScope.current !== scope) return;
      submitted = true; setAnswer(''); setSent(true); play('meetupRequested'); DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT); requestPushPrompt('meetup_request');
      const next = await loadMeetupParticipation(supabase, post.id, me.id);
      if (focusedScope.current === scope) setParticipation(next);
    } catch (e) { if (focusedScope.current === scope) { play('warning'); setError(submitted ? "신청은 접수됐어요. 현재 상태를 다시 불러와 주세요." : getChillingError(e)); setErrorCode(submitted ? null : getChillingErrorCode(e)); if (!submitted && getChillingErrorCode(e) === 'CHILLING_PROFILE_CHANGED') { setConsent(false); setRetry(value => value + 1); } } }
    finally { if (focusedScope.current === scope) { busy.current = false; setSending(false); } }
  };
  const view = loading ? 'loading' : error && !post ? 'failed' : unavailable ? 'unavailable' : !isAuthed ? 'guest' : own ? 'own' : inactive ? 'inactive' : result ? 'result'
    : paused ? 'paused' : locked ? 'locked' : availability === 'full' ? 'full' : coolingDown ? 'cooling' : modern && profile?.version !== 2 ? 'noprofile' : 'form';
  const writing = (view === 'form' || view === 'noprofile') && !!answer.trim() && !sending;
  usePreventRemove(writing, ({ repeat }) => {
    const heading = tr('쓰던 답변이 사라져요'), message = tr('나가면 지금 쓴 답변은 남지 않아요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${heading}\n${message}`)) repeat(); return; }
    Alert.alert(heading, message, [{ text: tr('계속 쓰기'), style: 'cancel' }, { text: tr('나가기'), style: 'destructive', onPress: repeat }]);
  });
  const browse = () => { play('selection'); router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups'); };
  const reload = () => setRetry(value => value + 1);
  const browseButton = <RaisedActionButton analyticsId="app_meetup-join.pressable.3" tone="secondary" onPress={browse} label={tr('다른 모임 찾기')} />;
  const answered = !!answer.trim();
  // Plain functions, not components, so the one screen keeps one set of guards.
  const meetCard = () => {
    const room = post!.room!, cityRow = CITIES.find(city => city.id === post!.cityId), once = chillingKind(room) === 'once';
    const summary = [language === 'en' ? cityRow?.englishName : cityRow?.name, chillingSchedule(room, appLocale), room.fee && tr('회비 {0}', meetupFeeAmount(room.fee.amount))].filter(Boolean).join(' · ');
    const feeDetail = room.fee && [room.fee.note, room.fee.dueOn && tr('{0}까지', meetupFeeDue(room.fee.dueOn, appLocale))].filter(Boolean).join(' · ');
    return <View style={[styles.card, styles.meet, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <ThemedText style={Typography.label} themeColor="accent">{once ? tr('칠링') : tr('정기모임')}</ThemedText>
      <ThemedText accessibilityRole="header" style={Typography.section}>{post!.title}</ThemedText>
      <ThemedText style={Typography.supporting} themeColor="textSecondary">{summary}</ThemedText>
      {once && !!room.timezone && <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('{0} 기준', chillingTimezoneLabel(room, appLocale))}</ThemedText>}
      {!!feeDetail && <ThemedText style={Typography.supporting} themeColor="textSecondary">{feeDetail}</ThemedText>}
      <ThemedText style={Typography.supporting} themeColor="textSecondary">{recommendedAgeLabel(room, appLocale)}{room.recommendedAgeMin != null ? ` · ${tr('범위 밖이어도 신청할 수 있어요')}` : ''}</ThemedText>
      <View style={styles.seats}>
        {!!room.capacity && <View style={styles.flex}><SeatBar room={room} flush /></View>}
        <ThemedText style={[Typography.caption, styles.tabular]} themeColor="textSecondary">{tr(room.capacity ? '{0} / {1}명' : '{0}명', room.memberCount ?? 0, room.capacity)}</ThemedText>
      </View>
    </View>;
  };
  const question = () => <View style={[styles.card, styles.questionCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText style={Typography.label} themeColor="accent">{tr("{0}님이 궁금해요", post!.author.nickname)}</ThemedText>
    <ThemedText style={Typography.section}>{post!.room!.applicationQuestion || tr("함께하고 싶은 이유를 알려주세요")}</ThemedText>
    <TextInput value={answer} onChangeText={setAnswer} accessibilityLabel={tr("신청 답변")} multiline maxLength={300} editable={!sending} placeholder={tr("나답게 편하게 답해주세요.")} placeholderTextColor={theme.textSecondary} style={[styles.input, { borderColor: theme.line, color: theme.text, backgroundColor: theme.background }]} />
    <ThemedText themeColor="textSecondary" style={[Typography.caption, styles.count, styles.tabular]}>{answer.length}/300</ThemedText>
  </View>;
  const languagePicker = () => exchange && <>
    <MeetupLanguagePicker exchange={exchange} state={languages} value={speaks} disabled={sending} onChange={value => { setSpeaks(value); if (errorCode === 'LANGUAGE_SIDE_FULL') { setError(''); setErrorCode(null); } }} />
    {sideFull && <StateCard layout="start" kind="blocked" title={copy(`${MEETUP_LANGUAGE_NAMES[choice!.speaks]} 쪽은 자리가 다 찼어요`, `${MEETUP_LANGUAGE_ENGLISH_NAMES[choice!.speaks]} spots are full`)} body={copy('이쪽 멤버가 빠지면 자리가 다시 열려요. 쓴 답변은 그대로 남아 있어요.', 'A seat opens again when someone on this side leaves. Your answer stays here.')}>
      <MeetupWaitlist postId={postId} language={choice} cta="secondary" />
    </StateCard>}
  </>;
  const sentRow = (detail?: string) => <ListRow analyticsId="app_meetup-join.pressable.11" title={tr('보낸 프로필과 답변')} detail={detail} onPress={() => router.push({ pathname: '/meetup-application', params: { requestId: participation!.id } })} />;
  const footerError = !!error && !!post && <>
    {errorCode !== 'MEETUP_FULL' && errorCode !== 'MEETUP_RECRUITING_CLOSED' && errorCode !== 'LANGUAGE_SIDE_FULL' && <ThemedText style={[Typography.supporting, styles.center]} accessibilityRole="alert" themeColor="danger">{tr(error)}</ThemedText>}
    {membershipError && <Pressable analyticsId="app_meetup-join.pressable.10" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.button}><ThemedText type="smallBold" style={[styles.support, styles.center]} themeColor="accent">{tr("멤버십과 모임 자리 보기 ›")}</ThemedText></Pressable>}
    <RaisedActionButton analyticsId="app_meetup-join.pressable.9" tone="secondary" onPress={() => { play('selection'); reload(); }} label={tr("다시 불러오기")} />
  </>;
  // 로그인 전 (시안 A): 모임 상세와 같은 머리와 아래 고정 막대. 회비·모집 멈춤·질문은 로그인 전에 읽을 수 없어 넣지 않는다.
  const login = () => {
    play('selection');
    // Web sign-in can finish on /auth/callback; bring it back to this meetup instead of home.
    if (Platform.OS === 'web') { try { window.sessionStorage.setItem(SHARED_POST_RETURN_KEY, `/meetup-join?postId=${postId}`); } catch {} }
    promptLogin('참여하려면 로그인해 주세요.');
  };
  const guestHead = () => {
    const host = post!.author.nickname;
    return <>
      {!!post!.imageUris?.[0] && <Image source={{ uri: post!.imageUris[0] }} style={styles.photo} contentFit="cover" accessible accessibilityRole="image" accessibilityLabel={tr('{0} 사진', post!.title)} />}
      <MeetupChips post={post!} hideOpen />
      <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{post!.title}</ThemedText>
      <View style={styles.host}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.hostAvatar, { backgroundColor: theme.backgroundSelected }]}><ThemedText type="smallBold">{[...host][0]}</ThemedText></View>
        <ThemedText type="smallBold" style={styles.flexShrink}>{host}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{tr('호스트')}</ThemedText>
      </View>
      <MeetupFacts post={post!} canEnterChat={false} own={false} />
      {availability === 'open' && <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('로그인하면 {0}님이 남긴 질문에 답하고 신청을 보낼 수 있어요.', host)}</ThemedText>}
    </>;
  };
  const guestBar = () => {
    const room = post!.room!;
    const [title, detail] = availability === 'open' ? [room.capacity ? tr('{0}자리 남음', Math.max(0, room.capacity - room.memberCount)) : tr('{0}명 참여 중', room.memberCount), tr('승인 후 참여')]
      : availability === 'full' ? [tr('정원이 모두 찼어요'), tr('자리가 나면 순서대로 알려 드려요.')]
      : [availability === 'ended' ? tr('종료된 모임이에요') : tr('모집이 마감됐어요'), tr('새 참여 신청과 승인을 할 수 없어요.')];
    return <View style={[styles.guestBar, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={styles.guestMeta} accessibilityLiveRegion="polite">
        <ThemedText style={Typography.menu}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>
      </View>
      {availability === 'open' ? <RaisedActionButton compact analyticsId="app_meetup-join.pressable.2" onPress={login} label={tr('로그인하고 신청하기')} />
        : availability === 'full' ? <RaisedActionButton analyticsId="app_meetup-join.pressable.2" onPress={login} label={tr('로그인하고 빈자리 알림 받기')} />
        : browseButton}
    </View>;
  };
  const sendHint = !answered && modern && !consent ? tr('답변을 쓰고 동의하면 보낼 수 있어요') : !answered ? tr('답변을 쓰면 보낼 수 있어요') : modern && !consent ? tr('동의에 체크하면 보낼 수 있어요') : tr('호스트에게만 보내요');
  const pullable = view === 'result' || view === 'paused' || view === 'locked' || view === 'full' || view === 'cooling' || view === 'inactive';
  return <ThemedView style={styles.fill}><SafeAreaView style={styles.fill}>
    <View style={[styles.head, { backgroundColor: theme.background }]}>
      <Pressable analyticsId="app_meetup-join.pressable.1" onPress={() => { play('selection'); back(); }} accessibilityRole="button" accessibilityLabel={tr("뒤로가기")} style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} /></Pressable>
      <ThemedText accessibilityRole="header" style={[Typography.menu, styles.headTitle]}>{tr("참여 신청")}</ThemedText><View style={styles.headSide} />
    </View>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView analyticsId="app_meetup-join.scrollview.1" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
        refreshControl={pullable ? <RefreshControl refreshing={false} tintColor={theme.accent} onRefresh={() => { play('selection'); reload(); }} /> : undefined}>
        {view === 'loading' ? <GlingLoader color={theme.accent} accessibilityLabel={tr("신청 정보 불러오는 중")} />
            : view === 'failed' ? <StateCard kind="error" title={tr("신청 정보를 불러오지 못했어요")} body={tr(error)} actionLabel={tr("다시 불러오기")} onAction={reload} />
            : view === 'unavailable' ? <StateCard kind={error ? 'error' : 'blocked'} title={error ? tr('모임 정보를 불러오지 못했어요') : tr("이 모임을 볼 수 없어요")} body={tr(error || "삭제됐거나 현재 열람할 수 없는 모임이에요.")} actionLabel={error ? tr('다시 불러오기') : undefined} onAction={error ? reload : undefined} />
              : <Rise key={view}>
                {view === 'guest' && guestHead()}
                {view === 'own' && <>
                  {meetCard()}
                  <ThemedText style={styles.body}>{tr("내가 연 모임이에요. 채팅 탭에서 신청자를 볼 수 있어요.")}</ThemedText>
                </>}
                {view === 'inactive' && <>
                  <StateCard layout="start" kind="blocked" mark="minus" title={availability === 'ended' ? tr("종료된 모임이에요") : tr("모집이 마감됐어요")} body={`${status ? tr('내 신청 · {0}. ', tr({ pending: '승인 대기', approved: '이전에 승인됨', rejected: '거절됨', cancelled: '취소됨' }[status])) : ''}${tr('새 참여 신청과 승인을 할 수 없어요.')}${status === 'approved' ? tr('승인 기록이 있어도 종료된 모임 대화에는 입장할 수 없어요.') : ''}`} />
                  {meetCard()}
                </>}
                {view === 'result' && <>
                  <StateCard layout="start" kind={status === 'approved' ? 'success' : 'pending'} mark={status === 'approved' ? 'check' : undefined} title={status === 'approved' ? tr("참여가 승인됐어요") : status === 'pending' ? tr("승인 대기 중이에요") : tr("신청을 접수했어요")}
                    body={tr(status === 'approved' ? '모임 대화에서 집결 안내를 확인해 주세요.' : status === 'pending' ? availability === 'full' ? '내 신청은 대기 중이에요. 지금은 정원이 차서 호스트가 승인할 수 없어요. 신청만으로 자리가 잡히지는 않아요.' : '아직 참여가 확정되지 않았어요. 호스트가 승인하면 모임 대화에 들어갈 수 있어요.' : '현재 신청 상태를 다시 불러와 주세요.')}>
                    <JoinSteps steps={[{ label: tr('신청 보냄'), state: 'done' }, status === 'approved' ? { label: tr('호스트 승인'), state: 'done' } : { label: tr('호스트가 확인하는 중'), state: 'now' }, { label: tr('모임 대화 입장'), state: status === 'approved' ? 'now' : 'next' }]} />
                  </StateCard>
                  {meetCard()}
                  {status === 'approved' ? (!!post!.room!.fee || (modern && !!participation)) && <ListCard>
                    {!!post!.room!.fee && <ListRow title={tr('회비 {0}', meetupFeeAmount(post!.room!.fee.amount))} detail={[post!.room!.fee.note, post!.room!.fee.dueOn && tr('{0}까지', meetupFeeDue(post!.room!.fee.dueOn, appLocale)), feePaid == null ? '' : feePaid ? tr('냈음') : tr('아직 안 냈어요')].filter(Boolean).join(' · ') || undefined} />}
                    {modern && !!participation && sentRow()}
                  </ListCard> : modern && !!participation && <ListCard>{sentRow(tr('호스트가 보는 그대로예요'))}</ListCard>}
                  {status === 'pending' && <Pressable analyticsId="app_meetup-join.pressable.12" accessibilityRole="button" disabled={sending} accessibilityState={{ disabled: sending, busy: sending }} onPress={confirmCancel} style={styles.button}><ThemedText style={[styles.support, styles.center]} themeColor="danger">{sending ? tr("취소 중…") : tr("신청 취소")}</ThemedText></Pressable>}
                  {!status && <RaisedActionButton analyticsId="app_meetup-join.pressable.9" tone="secondary" disabled={sending} onPress={() => { play('selection'); reload(); }} label={tr("다시 불러오기")} />}
                </>}
                {view === 'paused' && <>
                  <StateCard layout="start" kind="blocked" mark="minus" title={tr("지금은 새 신청을 받지 않아요")} body={tr("호스트가 모집을 다시 열면 신청할 수 있어요.")} />
                  {meetCard()}
                </>}
                {view === 'locked' && <>
                  <StateCard layout="start" kind="blocked" mark="minus" title={tr('새 멤버만 신청할 수 있는 모임이에요')} body={tr('가입한 지 얼마 안 된 분만 받는 모임이에요. 다른 모임을 둘러봐 주세요.')} />
                  {meetCard()}
                </>}
                {view === 'full' && <>
                  <StateCard layout="start" kind="blocked" mark="alert" title={tr("정원이 모두 찼어요")} body={tr("지금은 신청을 보낼 수 없어요. 대기 명단에 있으면 자리가 났을 때 순서대로 알려 드려요. 초대가 와도 참여 신청과 호스트 승인은 필요해요.")} />
                  {meetCard()}
                  {answered && <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('쓴 답변은 남아 있어요. 신청할 수 있게 되면 이어서 쓸 수 있어요.')}</ThemedText>}
                </>}
                {view === 'cooling' && <>
                  <StateCard layout="start" kind={status === 'rejected' ? 'blocked' : 'empty'} mark="minus" title={status === 'rejected' ? tr("이전 신청이 거절됐어요") : tr("이전 신청은 취소된 상태예요")} body={tr('{0}부터 이 화면에서 다시 신청할 수 있어요.', new Intl.DateTimeFormat(appLocale, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(reapplyAt)))} />
                  {meetCard()}
                </>}
                {view === 'noprofile' && <>
                  {meetCard()}
                  <StateCard layout="start" kind={profileError ? 'error' : 'empty'} title={profileError ? tr('모임 프로필을 불러오지 못했어요') : profile ? tr('모임 프로필을 확인해 주세요') : tr('모임 프로필이 먼저 필요해요')} body={profileError ? tr(profileError) : profile ? tr('모임에서 쓸 이름과 공개 범위를 확인해 주세요. 기존 소개는 남아 있어요.') : tr('함께할 사람들에게 나를 소개하는 프로필이에요. 쓰던 답변은 그대로 남아요.')} />
                  {languagePicker()}
                  {question()}
                </>}
                {view === 'form' && <>
                  {meetCard()}
                  {status && <StateCard layout="start" kind={status === 'rejected' ? 'blocked' : 'empty'} title={status === 'rejected' ? tr("이전 신청이 거절됐어요") : tr("이전 신청은 취소된 상태예요")} body={tr('현재 참여가 확정되지 않았어요. 답변과 공유 동의를 확인하고 다시 신청할 수 있어요.')} />}
                  {languagePicker()}
                  {modern && !!profile && <ListCard>
                    <ListRow analyticsId="app_meetup-join.pressable.13" title={profile.displayName || tr('모임 멤버')} detail={tr('호스트에게 보낼 모임 프로필')} leading={<InitialAvatar name={profile.displayName || tr('모임 멤버')} />} onPress={() => setSheetOpen(true)} />
                  </ListCard>}
                  {question()}
                  {modern && !!profile && <Pressable analyticsId="app_meetup-join.pressable.7" onPress={() => { play('selection'); setConsent(v => !v); }} disabled={sending} accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: sending }}
                    style={[styles.card, styles.consent, { borderColor: consent ? theme.accent : theme.line, backgroundColor: theme.card }]}>
                    <View style={[styles.checkbox, consent ? { backgroundColor: theme.accent, borderColor: theme.accent } : { borderColor: theme.textSecondary }]}>{consent && <PopIn><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={13} tintColor={theme.accentInk} /></PopIn>}</View>
                    <View style={styles.flex}>
                      <ThemedText type="smallBold" style={styles.support}>{tr("이 호스트에게 모임 프로필과 답변을 보내는 데 동의해요")}</ThemedText>
                      <View style={styles.who}>
                        <ThemedText style={Typography.supporting} themeColor="textSecondary"><ThemedText style={Typography.supporting}>{tr("호스트")}</ThemedText>{` ${tr("모임 프로필 · 신청 답변")}`}</ThemedText>
                        <ThemedText style={Typography.supporting} themeColor="textSecondary"><ThemedText style={Typography.supporting}>{tr("승인된 뒤 멤버")}</ThemedText>{` ${profile.shareWithMembers ? tr("모임 이름 · 사진 · 짧은 소개") : tr("모임 이름만 · 사진·소개 공유는 프로필에서 바꿀 수 있어요")}`}</ThemedText>
                        <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr("다른 신청자에게는 보이지 않아요. 취소·거절·탈퇴·차단·모임 종료 뒤에는 새로 볼 수 없지만, 이미 본 내용은 되돌릴 수 없어요.")}</ThemedText>
                      </View>
                    </View>
                  </Pressable>}
                  <Disclosure analyticsId="meetup.join.policy" title={copy('신청·취소 안내', 'Application and cancellation details')}>
                    <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('승인 전까지는 자리가 잡히지 않아요. 신청은 호스트가 답하기 전까지 이 화면에서 취소할 수 있어요. 취소하거나 거절되면 24시간 뒤에 다시 신청할 수 있어요.')}</ThemedText>
                    <MeetupPolicyNotice mode="join" />
                  </Disclosure>
                  <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr('안전을 위해 자동 분석과 권한 있는 운영자 검토가 적용돼요.')}</ThemedText>
                </>}
              </Rise>}
        {!!error && !!post && (own || inactive || result) && <><ThemedText style={styles.body} accessibilityRole="alert" themeColor="danger">{tr(error)}</ThemedText>
          {membershipError && <Pressable analyticsId="app_meetup-join.pressable.10" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.button}><ThemedText type="smallBold" style={styles.support} themeColor="accent">{tr("멤버십과 모임 자리 보기 ›")}</ThemedText></Pressable>}
          <Pressable analyticsId="app_meetup-join.pressable.9" onPress={() => { play('selection'); reload(); }} accessibilityRole="button" style={styles.button}><ThemedText style={styles.body}>{tr("다시 불러오기")}</ThemedText></Pressable></>}
      </ScrollView>
      {view === 'guest' && guestBar()}
      {view !== 'guest' && view !== 'loading' && view !== 'failed' && view !== 'unavailable' && <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.line }]}>
        {view !== 'own' && view !== 'inactive' && view !== 'result' && footerError}
        {view === 'own' && <RaisedActionButton analyticsId="app_meetup-join.pressable.3" onPress={() => { play('selection'); router.push({ pathname: '/chat', params: { view: 'requests' } }); }} label={tr("참여 신청자 검토하기")} />}
        {view === 'result' && <RaisedActionButton analyticsId="app_meetup-join.pressable.3" onPress={() => { play('selection'); if (status === 'approved') router.replace({ pathname: '/chat', params: { view: 'group' } }); else router.replace({ pathname: '/(tabs)/meetups', params: { view: 'mine' } }); }} label={status === 'approved' ? tr("모임 대화 보기") : tr("내 모임에서 보기")} />}
        {(view === 'inactive' || view === 'paused' || view === 'locked' || view === 'cooling') && browseButton}
        {view === 'full' && <MeetupWaitlist postId={postId} language={choice} cta="primary" fallback={browseButton} />}
        {view === 'noprofile' && <RaisedActionButton analyticsId="app_meetup-join.pressable.5" onPress={() => { play('selection'); profileRoute(); }} label={profileError ? tr("모임 프로필 열기") : profile ? tr('모임 프로필 확인하기') : tr("모임 프로필 만들기")} />}
        {view === 'form' && <>
          <ThemedText style={[Typography.supporting, styles.center]} themeColor="textSecondary" accessibilityLiveRegion="polite">{sendHint}</ThemedText>
          <RaisedActionButton analyticsId="app_meetup-join.pressable.8" onPress={() => { play('selection'); void submit(); }} disabled={sending || !answered || (modern && !consent) || (!!exchange && (!choice || sideFull))} busy={sending} label={sending ? tr("보내는 중…") : sideFull ? copy('고른 언어 쪽은 자리가 다 찼어요', 'This language side is full') : exchange && !choice ? copy('할 줄 아는 말을 골라 주세요', 'Choose the language you speak') : status ? tr("다시 신청하기") : modern ? tr("답변과 프로필 보내기") : tr("신청 답변 보내기")} />
        </>}
      </View>}
    </KeyboardAvoidingView>
    <DragSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={tr('호스트에게 이렇게 보여요')}
      onDismissed={() => { if (editAfterSheet.current) { editAfterSheet.current = false; profileRoute(); } }}>
      {!!profile && <ScrollView analyticsId="app_meetup-join.scrollview.1" contentContainerStyle={styles.sheetBody}>
        <ChillingProfileCard profile={chillingProfilePreview(profile, 'host')} />
        <RaisedActionButton analyticsId="app_meetup-join.pressable.6" tone="secondary" onPress={() => { play('selection'); editAfterSheet.current = true; setSheetOpen(false); }} label={tr("프로필 수정")} />
      </ScrollView>}
    </DragSheet>
  </SafeAreaView></ThemedView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, flex: { flex: 1, minWidth: 0 }, stack: { gap: Spacing.three },
  content: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Spacing.three, paddingTop: Spacing.one, paddingBottom: Spacing.four, gap: Spacing.three },
  head: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.two }, headSide: { width: 44 }, headTitle: { flex: 1, textAlign: 'center' },
  body: { fontSize: 16, lineHeight: 24 }, support: { fontSize: 14, lineHeight: 20 }, center: { textAlign: 'center' }, tabular: { fontVariant: ['tabular-nums'] },
  button: { minHeight: 44, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: 16 },
  meet: { padding: Spacing.three, gap: Spacing.half },
  seats: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  questionCard: { padding: Spacing.three, gap: Spacing.two },
  input: { minHeight: 104, borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 16, textAlignVertical: 'top' }, count: { textAlign: 'right' },
  consent: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start', padding: Spacing.three },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  who: { gap: Spacing.half, marginTop: Spacing.two },
  steps: { marginTop: Spacing.two },
  step: { flexDirection: 'row', gap: Spacing.two + Spacing.half }, stepRail: { width: 22, alignItems: 'center' },
  stepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }, stepLine: { width: 2, flex: 1, minHeight: 14 },
  stepLabel: { flex: 1, paddingTop: 1 }, stepGap: { paddingBottom: Spacing.three }, stepNow: { fontWeight: '600' },
  footer: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', borderTopWidth: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.one + Spacing.half },
  sheetBody: { gap: Spacing.three, paddingBottom: Spacing.two },
  // 로그인 전 머리·막대: post-detail.tsx의 host·meetupBar 값과 같다.
  photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16 },
  host: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 }, flexShrink: { flexShrink: 1 },
  hostAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  guestBar: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: 1 },
  guestMeta: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 },
});
